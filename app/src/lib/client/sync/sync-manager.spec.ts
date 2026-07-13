import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '$lib/client/db/test-harness';
import { createCollation, updateCollationMetadata } from '$lib/client/db/repositories/collations';
import {
	upsertCloudConnection,
	upsertCloudProjectFolder,
} from '$lib/client/db/repositories/cloud-connections';
import { createProject as createProjectRepository } from '$lib/client/db/repositories/projects';
import type { CollationCheckpoint } from '$lib/client/db/repositories/revisions';
import {
	createCommittedCollationCheckpointWithFiles,
	loadCollationWithWorkingFile,
	saveWorkingCollationArtifact,
} from '$lib/client/db/repositories/collation-files';
import { createTranscription } from '$lib/client/db/repositories/transcriptions';
import { deleteCollationWithFiles } from '$lib/client/db/repositories/entity-deletion';
import { MemoryStoreBackend } from '$lib/client/store/memory-store-backend.spec-support';
import type { StoreOperationOptions } from '$lib/client/store';
import { COLLATION_FIXTURE } from '$lib/client/store';
import {
	readTextFile,
	collationTeiFile,
	collationPrimaryFile,
	collationCheckpointFile,
	sealDocument,
	serializeSealedDocument,
	TOMBSTONE_CURRENT_VERSION,
	TOMBSTONE_FORMAT,
	transcriptionPrimaryFile,
	transcriptionWorkingFile,
	writeTextFileAtomic,
} from '$lib/client/store';
import {
	serializeCloudFile,
	serializeCollationCloudFile,
	serializeCollationHistoryCloudFile,
	serializeProjectCloudFile,
} from './cloud-files';
import { MockCloudStorageProvider, type MockProviderOperation } from './providers/mock-provider';
import { FakeDirectoryHandle } from './providers/fake-file-system-access.spec-support';
import { LocalFolderStorageProvider } from './providers/local-folder-provider';
import type { CloudFileMetadata, CloudListResult, CloudWriteResult } from './providers/provider';
import {
	OpenObjectSyncPoller,
	backupProject,
	backupProjectEntity,
	commitProjectTranscriptionForSync,
	deriveEntityCloudBackupState,
	downloadAndCompareProjectManifest,
	pollOpenEntity,
	publishEntity,
	listProjectArchiveFiles,
	type SyncManagerOptions,
	type SyncProjectContext,
} from './sync-manager';
import { importProjectFileTree } from './project-zip-import';

interface ProviderCall {
	operation: MockProviderOperation;
	path?: string;
}

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;
let storeOptions: StoreOperationOptions;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
	storeOptions = { backend };
});

afterEach(async () => {
	await harness.destroy();
});

function createProject(
	db: Parameters<typeof createProjectRepository>[0],
	input: Parameters<typeof createProjectRepository>[1],
	options: StoreOperationOptions = storeOptions
) {
	return createProjectRepository(db, input, options);
}

function syncStagingEntries(): string[] {
	return [...backend.directories, ...backend.files.keys()]
		.filter(path => path.includes('/staging/'))
		.sort();
}

describe('sync manager', () => {
	it('creates a committed checkpoint and marks manual commits sync pending', async () => {
		const projectTranscriptionId = await createProjectTranscription();

		const result = await commitProjectTranscriptionForSync(
			harness.db,
			{
				projectTranscriptionId,
				checkpointId: 'tx-cp-1',
				commitMessage: 'Ready for sync',
				authorName: 'Editor',
				createdAt: '2026-06-10T12:00:00.000Z',
			},
			syncOptions()
		);

		expect(result.uiState).toBe('sync pending');
		expect(result.checkpoint).toMatchObject({
			id: 'tx-cp-1',
			isCommitted: true,
			commitMessage: 'Ready for sync',
		});
		await expect(
			harness.db
				.selectFrom('transcription_checkpoints')
				.select(['id', 'is_committed'])
				.where('id', '=', 'tx-cp-1')
				.executeTakeFirst()
		).resolves.toEqual({ id: 'tx-cp-1', is_committed: 1 });
	});

	it('uploads checkpoint files before primary files and updates metadata after both writes', async () => {
		const checkpoint = await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();

		const result = await publishEntity(
			harness.db,
			provider,
			context,
			{ entityType: 'collation', entityId: 'col-1' },
			syncOptions({ now: () => '2026-06-10T12:10:00.000Z' })
		);

		expect(result.uiState).toBe('synced');
		expect(result.uploadedPaths).toEqual([
			'history/collations/col-1/col-cp-1.json',
			'collations/col-1.json',
		]);
		expect(
			provider.calls.filter(call => call.operation === 'create-file').map(call => call.path)
		).toEqual(['history/collations/col-1/col-cp-1.json', 'collations/col-1.json']);
		await expect(loadMetadata()).resolves.toMatchObject({
			last_synced_revision: checkpoint.id,
			last_synced_hash: checkpoint.contentHash,
			cloud_file_revision: 'rev-1',
		});

		provider.calls = [];
		const unchangedPoll = await pollOpenEntity(
			harness.db,
			provider,
			context,
			{
				entityType: 'collation',
				entityId: 'col-1',
			},
			syncOptions()
		);

		expect(unchangedPoll.uiState).toBe('synced');
		expect(provider.calls.some(call => call.operation === 'download-file')).toBe(false);
	});

	it('derives local cloud backup state from committed heads and sync metadata', async () => {
		const checkpoint = await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		const reference = { entityType: 'collation' as const, entityId: 'col-1' };
		const head = { revisionId: checkpoint.id, contentHash: checkpoint.contentHash };

		await expect(
			deriveEntityCloudBackupState(harness.db, context, reference, head, false)
		).resolves.toMatchObject({
			status: 'committed-pending-backup',
			lastSyncedRevision: null,
			cloudPath: 'collations/col-1.json',
		});

		await harness.db
			.insertInto('cloud_sync_metadata')
			.values({
				connection_id: context.connectionId,
				scope_type: 'project',
				scope_id: context.projectId,
				entity_type: 'collation',
				entity_id: 'col-1',
				cloud_file_id: 'file-col-1',
				cloud_file_revision: 'rev-1',
				cloud_path: 'collations/col-1.json',
				last_synced_revision: checkpoint.id,
				last_synced_hash: checkpoint.contentHash,
				last_synced_at: '2026-06-10T12:10:00.000Z',
			})
			.execute();

		await expect(
			deriveEntityCloudBackupState(harness.db, context, reference, head, false)
		).resolves.toMatchObject({
			status: 'backed-up',
			lastSyncedRevision: checkpoint.id,
			lastSyncedHash: checkpoint.contentHash,
			lastSyncedAt: '2026-06-10T12:10:00.000Z',
		});
		await expect(
			deriveEntityCloudBackupState(harness.db, context, reference, head, false, {
				lastSeenRemoteHead: { revisionId: 'col-cp-remote', contentHash: 'sha256:remote' },
			})
		).resolves.toMatchObject({
			status: 'remote-update-available',
			lastSeenRemoteRevision: 'col-cp-remote',
			lastSeenRemoteHash: 'sha256:remote',
		});
		await expect(
			deriveEntityCloudBackupState(
				harness.db,
				context,
				reference,
				{ revisionId: 'col-cp-local', contentHash: 'sha256:local' },
				false,
				{
					lastSeenRemoteHead: {
						revisionId: 'col-cp-remote',
						contentHash: 'sha256:remote',
					},
				}
			)
		).resolves.toMatchObject({ status: 'unknown' });
		await expect(
			deriveEntityCloudBackupState(harness.db, context, reference, head, true)
		).resolves.toMatchObject({ status: 'uncommitted-local-changes' });
		await expect(
			deriveEntityCloudBackupState(harness.db, context, reference, null, false)
		).resolves.toMatchObject({ status: 'never-backed-up' });
		expect(provider.calls).toEqual([]);
	});

	it('leaves sync metadata untouched when primary update conflicts after checkpoint upload', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await publishEntity(
			harness.db,
			provider,
			context,
			{ entityType: 'collation', entityId: 'col-1' },
			syncOptions()
		);

		await updateCollationMetadata(harness.db, {
			id: 'col-1',
			notes: 'Second committed notes',
			updatedAt: '2026-06-10T12:20:00.000Z',
		});
		await saveCanonicalCollation(harness.db, storeOptions);
		const second = await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{
				collationId: 'col-1',
				checkpointId: 'col-cp-2',
				createdAt: '2026-06-10T12:21:00.000Z',
			},
			storeOptions
		);
		provider.failNext('conflict', 'update-file', 'Primary changed remotely.');

		const result = await publishEntity(
			harness.db,
			provider,
			context,
			{ entityType: 'collation', entityId: 'col-1' },
			syncOptions()
		);

		expect(result.uiState).toBe('conflict requires resolution');
		expect(result.providerError).toBe('conflict');
		expect(result.uploadedPaths).toContain('history/collations/col-1/col-cp-2.json');
		await expect(loadMetadata()).resolves.toMatchObject({
			last_synced_revision: 'col-cp-1',
		});
		expect(
			await remoteFile(provider, context, `history/collations/col-1/${second.id}.json`)
		).not.toBeNull();
	});

	it('quarantines remote primary files with invalid hashes instead of applying them', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await publishEntity(
			harness.db,
			provider,
			context,
			{ entityType: 'collation', entityId: 'col-1' },
			syncOptions()
		);
		const primary = await remoteFile(provider, context, 'collations/col-1.json');
		if (!primary) throw new Error('Expected remote primary file.');
		const original = JSON.parse(await provider.downloadFile(primary.id)) as Record<
			string,
			unknown
		>;
		await provider.updateFile(
			primary.id,
			JSON.stringify({ ...original, notes: 'Tampered remote notes' }),
			primary.revision
		);

		const result = await pollOpenEntity(
			harness.db,
			provider,
			context,
			{
				entityType: 'collation',
				entityId: 'col-1',
			},
			syncOptions()
		);

		expect(result.uiState).toBe('conflict requires resolution');
		expect(result.quarantines).toMatchObject([
			{ path: 'collations/col-1.json', code: 'hash_mismatch' },
		]);
		await expect(loadCollationNotes('col-1')).resolves.toBe('Initial notes');
	});

	it('preserves dirty local working rows as draft checkpoints when a remote update is available', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await publishEntity(
			harness.db,
			provider,
			context,
			{ entityType: 'collation', entityId: 'col-1' },
			syncOptions()
		);
		await pushRemoteCollationRevision(
			provider,
			context,
			'Remote committed notes',
			'col-cp-remote'
		);
		await updateCollationMetadata(harness.db, {
			id: 'col-1',
			notes: 'Unsynced local draft',
			updatedAt: '2026-06-10T12:30:00.000Z',
		});
		await saveCanonicalCollation(harness.db, storeOptions);

		const result = await pollOpenEntity(
			harness.db,
			provider,
			context,
			{ entityType: 'collation', entityId: 'col-1' },
			syncOptions({ authorName: 'Local Editor', now: () => '2026-06-10T12:31:00.000Z' })
		);

		expect(result.uiState).toBe('remote update available');
		expect(result.draftCheckpointId).toBeTruthy();
		await expect(
			harness.db
				.selectFrom('collation_checkpoints')
				.select(['is_committed', 'parent_checkpoint_id'])
				.where('id', '=', result.draftCheckpointId ?? '')
				.executeTakeFirst()
		).resolves.toEqual({ is_committed: 0, parent_checkpoint_id: 'col-cp-1' });
		await expect(loadCollationNotes('col-1')).resolves.toBe('Unsynced local draft');
	});

	it('creates local conflict copies when local and remote committed heads diverge', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await publishEntity(
			harness.db,
			provider,
			context,
			{ entityType: 'collation', entityId: 'col-1' },
			syncOptions()
		);
		await pushRemoteCollationRevision(
			provider,
			context,
			'Remote committed notes',
			'col-cp-remote'
		);
		await updateCollationMetadata(harness.db, {
			id: 'col-1',
			notes: 'Local committed notes',
			updatedAt: '2026-06-10T12:40:00.000Z',
		});
		await saveCanonicalCollation(harness.db, storeOptions);
		await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{
				collationId: 'col-1',
				checkpointId: 'col-cp-local',
				createdAt: '2026-06-10T12:41:00.000Z',
			},
			storeOptions
		);

		const result = await pollOpenEntity(
			harness.db,
			provider,
			context,
			{ entityType: 'collation', entityId: 'col-1' },
			syncOptions({ authorName: 'Local Editor', now: () => '2026-06-10T12:42:00.000Z' })
		);

		expect(result.uiState).toBe('conflict requires resolution');
		expect(result.conflictCopyId).toBeTruthy();
		await expect(loadCollationNotes(result.conflictCopyId ?? '')).resolves.toBe(
			'Local committed notes'
		);
	});

	it('publishes a canonical tombstone before deleting the remote primary in the production mirror', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await backupProject(harness.db, provider, context, syncOptions());
		await deleteCollationWithFiles(
			harness.db,
			'col-1',
			{ tombstoneId: 'tombstone-col-1', deletedAt: '2026-06-10T12:50:00.000Z' },
			storeOptions
		);
		provider.calls = [];

		const result = await backupProject(harness.db, provider, context, syncOptions());

		const tombstoneWrite = provider.calls.findIndex(
			call => call.operation === 'create-file' && call.path === 'tombstones/collation--col-1.json'
		);
		const primaryDelete = provider.calls.findIndex(
			call => call.operation === 'delete-file'
		);
		expect(tombstoneWrite).toBeGreaterThanOrEqual(0);
		expect(primaryDelete).toBeGreaterThan(tombstoneWrite);
		expect(result.deletedPaths).toContain('collations/col-1.json');
		expect(await remoteFile(provider, context, 'collations/col-1.json')).toBeNull();
		expect(await remoteFile(provider, context, 'history/collations/col-1/col-cp-1.json')).not.toBeNull();
	});

	it('applies a remote tombstone, retains history, and heals an interrupted remote primary deletion', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await backupProject(harness.db, provider, context, syncOptions());
		const tombstone = await sealDocument(TOMBSTONE_FORMAT, TOMBSTONE_CURRENT_VERSION, {
			id: 'remote-tombstone-col-1',
			project_id: 'project-1',
			entity_type: 'collation',
			entity_id: 'col-1',
			cloud_path: 'collations/col-1.json',
			deletion_revision_id: 'col-cp-1',
			deleted_by: 'Remote editor',
			deleted_at: '2026-06-10T13:01:00.000Z',
		});
		await provider.createFile(
			context.cloudFolderId,
			'tombstones/collation--col-1.json',
			serializeSealedDocument(tombstone)
		);

		const result = await backupProject(harness.db, provider, context, syncOptions());

		expect(result.downloadedPaths).toContain('tombstones/collation--col-1.json');
		expect(result.deletedPaths).toContain('collations/col-1.json');
		const projectSlug = await loadProjectStorageSlug('project-1');
		await expect(readTextFile(collationPrimaryFile(projectSlug, 'col-1'), storeOptions)).rejects.toThrow();
		await expect(
			readTextFile(collationCheckpointFile(projectSlug, 'col-1', 'col-cp-1'), storeOptions)
		).resolves.toContain('col-cp-1');
		await expect(
			harness.db.selectFrom('collations').select('id').where('id', '=', 'col-1').executeTakeFirst()
		).resolves.toBeUndefined();
		expect(await remoteFile(provider, context, 'collations/col-1.json')).toBeNull();
	});

	it('backs up project entities before uploading the project manifest', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();

		const result = await backupProject(harness.db, provider, context, {
			now: () => '2026-06-10T13:00:00.000Z',
			storeOptions,
		});

		expect(result.uiState).toBe('synced');
		expect(result.manifestUploaded).toBe(true);
		expect(result.uploadedPaths).toEqual([
			'history/collations/col-1/col-cp-1.json',
			'collations/col-1.json',
			'collations/col-1.tei.xml',
			'project.json',
		]);
		expect(
			provider.calls.filter(call => call.operation === 'create-file').map(call => call.path)
		).toEqual([
			'history/collations/col-1/col-cp-1.json',
			'collations/col-1.json',
			'collations/col-1.tei.xml',
			'project.json',
		]);
		const manifest = await remoteFile(provider, context, 'project.json');
		expect(manifest).not.toBeNull();
		await expect(
			harness.db
				.selectFrom('cloud_project_folders')
				.select('last_fully_synced_at')
				.where('project_id', '=', 'project-1')
				.where('connection_id', '=', 'conn-1')
				.executeTakeFirst()
		).resolves.toEqual({ last_fully_synced_at: '2026-06-10T13:00:00.000Z' });
	});

	it('backs up projects into the selected local folder provider layout', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedLocalFolderProvider();

		const result = await backupProject(harness.db, provider, context, {
			now: () => '2026-06-10T13:00:00.000Z',
			storeOptions,
		});

		expect(result.uiState).toBe('synced');
		expect(result.uploadedPaths).toEqual([
			'history/collations/col-1/col-cp-1.json',
			'collations/col-1.json',
			'collations/col-1.tei.xml',
			'project.json',
		]);
		await expect(
			provider.downloadFile('Apatosaurus/Projects/project-1/project.json')
		).resolves.toContain('"id":"project-1"');
		const listing = await provider.listFiles('Apatosaurus/Projects/project-1', {
			recursive: true,
		});
		expect(listing.entries.map(entry => entry.path)).toEqual([
			'Apatosaurus/Projects/project-1/collations',
			'Apatosaurus/Projects/project-1/collations/col-1.json',
			'Apatosaurus/Projects/project-1/collations/col-1.tei.xml',
			'Apatosaurus/Projects/project-1/history',
			'Apatosaurus/Projects/project-1/history/collations',
			'Apatosaurus/Projects/project-1/history/collations/col-1',
			'Apatosaurus/Projects/project-1/history/collations/col-1/col-cp-1.json',
			'Apatosaurus/Projects/project-1/project.json',
		]);
	});

	it('mirrors canonical project files byte-for-byte and excludes working files', async () => {
		const projectTranscriptionId = await createProjectTranscription();
		await commitProjectTranscriptionForSync(
			harness.db,
			{
				projectTranscriptionId,
				checkpointId: 'tx-cp-1',
				commitMessage: 'Ready for sync',
				authorName: 'Editor',
				createdAt: '2026-06-10T12:00:00.000Z',
			},
			syncOptions()
		);
		const { provider, context } = await createConnectedProvider();
		const projectSlug = await loadProjectStorageSlug('project-1');
		await writeTextFileAtomic(
			transcriptionWorkingFile(projectSlug, projectTranscriptionId),
			'{"local":"draft"}',
			storeOptions
		);

		const result = await backupProject(harness.db, provider, context, {
			now: () => '2026-06-10T13:00:00.000Z',
			storeOptions,
		});

		expect(result.uiState).toBe('synced');
		expect(result.uploadedPaths).toContain(`transcriptions/${projectTranscriptionId}.tei.xml`);
		expect(result.uploadedPaths).not.toContain(
			`transcriptions/${projectTranscriptionId}.working.json`
		);
		const remotePrimary = await remoteFile(
			provider,
			context,
			`transcriptions/${projectTranscriptionId}.json`
		);
		if (!remotePrimary) throw new Error('Expected remote transcription primary.');
		await expect(provider.downloadFile(remotePrimary.id)).resolves.toBe(
			await readTextFile(
				transcriptionPrimaryFile(projectSlug, projectTranscriptionId),
				storeOptions
			)
		);
		expect(
			await remoteFile(provider, context, `transcriptions/${projectTranscriptionId}.tei.xml`)
		).not.toBeNull();
		expect(
			await remoteFile(
				provider,
				context,
				`transcriptions/${projectTranscriptionId}.working.json`
			)
		).toBeNull();
	});

	it('pulls valid remote mirror changes without leaving per-file validation staging', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await backupProject(harness.db, provider, context, {
			now: () => '2026-06-10T13:00:00.000Z',
			storeOptions,
		});
		await pushRemoteCollationRevision(
			provider,
			context,
			'Remote committed notes',
			'col-cp-remote'
		);
		const remoteTei = await remoteFile(provider, context, 'collations/col-1.tei.xml');
		if (!remoteTei) throw new Error('Expected remote TEI file.');
		await provider.updateFile(remoteTei.id, '<TEI>remote is not authoritative</TEI>', remoteTei.revision);

		const result = await backupProject(harness.db, provider, context, {
			now: () => '2026-06-10T13:05:00.000Z',
			storeOptions,
		});

		expect(result.uiState).toBe('synced');
		expect(result.downloadedPaths).toContain('collations/col-1.json');
		expect(result.downloadedPaths).toContain('history/collations/col-1/col-cp-remote.json');
		await expect(loadCollationNotes('col-1')).resolves.toBe('Remote committed notes');
		const projectSlug = await loadProjectStorageSlug('project-1');
		const regeneratedTei = await readTextFile(collationTeiFile(projectSlug, 'col-1'), storeOptions);
		expect(regeneratedTei).toContain('<TEI');
		expect(regeneratedTei).not.toContain('remote is not authoritative');
		const mirroredTei = await remoteFile(provider, context, 'collations/col-1.tei.xml');
		if (!mirroredTei) throw new Error('Expected regenerated remote TEI file.');
		await expect(provider.downloadFile(mirroredTei.id)).resolves.toBe(regeneratedTei);
		expect(syncStagingEntries()).toEqual([]);
	});

	it('completes independent changed and remote-only paths beside corrupt and conflicting primaries', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		await createCollation(harness.db, {
			id: 'col-2',
			projectId: 'project-1',
			title: 'Romans 1:2',
			verseIdentifier: 'Romans 1:2',
			now: '2026-06-10T12:00:00.000Z',
		});
		await updateCollationMetadata(harness.db, {
			id: 'col-2',
			notes: 'Second initial notes',
			updatedAt: '2026-06-10T12:01:00.000Z',
		});
		await saveCanonicalCollation(harness.db, storeOptions, 'Project', 'col-2');
		await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{ collationId: 'col-2', checkpointId: 'col-2-cp-1', createdAt: '2026-06-10T12:02:00.000Z' },
			storeOptions
		);
		const { provider, context } = await createConnectedProvider();
		await backupProject(harness.db, provider, context, syncOptions());
		await pushRemoteCollationRevision(provider, context, 'Accepted remote notes', 'col-cp-remote');
		await pushRemoteCollationRevision(
			provider,
			context,
			'Remote conflicting notes',
			'col-2-cp-remote',
			'Remote Conflict',
			'col-2',
			'col-2-cp-1'
		);
		await updateCollationMetadata(harness.db, {
			id: 'col-2',
			notes: 'Local conflicting notes',
			updatedAt: '2026-06-10T13:04:00.000Z',
		});
		await saveCanonicalCollation(harness.db, storeOptions, 'Project', 'col-2');
		await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{ collationId: 'col-2', checkpointId: 'col-2-cp-local', createdAt: '2026-06-10T13:04:30.000Z' },
			storeOptions
		);
		await harness.db
			.deleteFrom('sync_file_fingerprints')
			.where('target_id', '=', context.connectionId)
			.where('file_path', '=', 'collations/col-2.json')
			.execute();
		await provider.createFile(context.cloudFolderId, 'collations/corrupt.json', '{not-json');

		const result = await backupProject(harness.db, provider, context, syncOptions());

		expect(result.uiState).toBe('conflict requires resolution');
		expect(result.quarantines).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: 'collations/corrupt.json', code: 'invalid_json' }),
				expect.objectContaining({ path: 'collations/col-2.json', code: 'hash_mismatch' }),
			])
		);
		await expect(loadCollationNotes('col-1')).resolves.toBe('Accepted remote notes');
		expect(result.downloadedPaths).toEqual(
			expect.arrayContaining([
				'collations/col-1.json',
				'history/collations/col-1/col-cp-remote.json',
			])
		);
		expect(result.conflictCopyId).toBeTruthy();
		await expect(loadCollationNotes(result.conflictCopyId ?? '')).resolves.toBe(
			'Local conflicting notes'
		);
		const completedPaths = await harness.db
			.selectFrom('sync_file_fingerprints')
			.select('file_path')
			.where('target_id', '=', context.connectionId)
			.where('file_path', 'in', [
				'collations/col-1.json',
				'history/collations/col-1/col-cp-remote.json',
				'collations/col-2.json',
				'collations/corrupt.json',
			])
			.orderBy('file_path')
			.execute();
		expect(completedPaths).toEqual([
			{ file_path: 'collations/col-1.json' },
			{ file_path: 'history/collations/col-1/col-cp-remote.json' },
		]);
		await expect(
			harness.db.selectFrom('collations').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()
		).resolves.toEqual({ count: 3 });
	});

	it('quarantines invalid remote mirror files without leaving per-file validation staging', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await backupProject(harness.db, provider, context, {
			now: () => '2026-06-10T13:00:00.000Z',
			storeOptions,
		});
		const primary = await remoteFile(provider, context, 'collations/col-1.json');
		if (!primary) throw new Error('Expected remote primary file.');
		const original = JSON.parse(await provider.downloadFile(primary.id)) as Record<
			string,
			unknown
		>;
		await provider.updateFile(
			primary.id,
			JSON.stringify({ ...original, notes: 'Tampered remote notes' }),
			primary.revision
		);

		const result = await backupProject(harness.db, provider, context, {
			now: () => '2026-06-10T13:05:00.000Z',
			storeOptions,
		});

		expect(result.uiState).toBe('conflict requires resolution');
		expect(result.quarantines).toMatchObject([
			{ path: 'collations/col-1.json', code: 'hash_mismatch' },
		]);
		await expect(loadCollationNotes('col-1')).resolves.toBe('Initial notes');
		expect(syncStagingEntries()).toEqual([]);
	});

	it('creates conflict copies when local and remote mirror files both change', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await backupProject(harness.db, provider, context, {
			now: () => '2026-06-10T13:00:00.000Z',
			storeOptions,
		});
		await pushRemoteCollationRevision(
			provider,
			context,
			'Remote committed notes',
			'col-cp-remote',
			'Remote Primary'
		);
		const divergentRemoteTei = await remoteFile(provider, context, 'collations/col-1.tei.xml');
		if (!divergentRemoteTei) throw new Error('Expected remote TEI file.');
		await provider.updateFile(
			divergentRemoteTei.id,
			'<TEI>untrusted divergent bytes</TEI>',
			divergentRemoteTei.revision
		);
		await updateCollationMetadata(harness.db, {
			id: 'col-1',
			notes: 'Local committed notes',
			updatedAt: '2026-06-10T13:04:00.000Z',
		});
		await saveCanonicalCollation(harness.db, storeOptions);
		await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{
				collationId: 'col-1',
				checkpointId: 'col-cp-local',
				createdAt: '2026-06-10T13:04:30.000Z',
			},
			storeOptions
		);

		const result = await backupProject(harness.db, provider, context, {
			now: () => '2026-06-10T13:05:00.000Z',
			authorName: 'Local Editor',
			storeOptions,
		});

		expect(result.uiState).toBe('conflict requires resolution');
		expect(result.conflictCopyId).toBeTruthy();
		await expect(loadCollationNotes(result.conflictCopyId ?? '')).resolves.toBe(
			'Local committed notes'
		);
		const projectSlug = await loadProjectStorageSlug('project-1');
		const localTei = await readTextFile(collationTeiFile(projectSlug, 'col-1'), storeOptions);
		expect(localTei).toContain('<title>Project Collation</title>');
		expect(localTei).not.toContain('Remote Primary');
		const remoteTei = await remoteFile(provider, context, 'collations/col-1.tei.xml');
		if (!remoteTei) throw new Error('Expected regenerated remote TEI file.');
		const remoteTeiContent = await provider.downloadFile(remoteTei.id);
		expect(remoteTeiContent).toContain('<title>Remote Primary Collation</title>');
		expect(remoteTeiContent).not.toContain('untrusted divergent bytes');
	});

	it('syncs two independent stores through push, pull, no-op, cache rebuild, and divergence', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context: contextA } = await createConnectedProvider();
		const storeB = createLocalDbTestHarness();
		const storeOptionsB = { backend: new MemoryStoreBackend() };
		const contextB: SyncProjectContext = { ...contextA, connectionId: 'target-b' };
		try {
			const archive = await listProjectArchiveFiles(harness.db, 'project-1', { storeOptions });
			const imported = await importProjectFileTree(
				storeB.db,
				archive.map(file => ({ path: file.path, read: async () => file.content })),
				{ storeOptions: storeOptionsB }
			);
			expect(imported.ok).toBe(true);
			await backupProject(harness.db, provider, contextA, syncOptions());
			const initialB = await backupProject(storeB.db, provider, contextB, {
				storeOptions: storeOptionsB,
			});
			expect(initialB.uiState).toBe('synced');

			await updateCollationMetadata(harness.db, {
				id: 'col-1', notes: 'A pushed notes', updatedAt: '2026-06-10T14:00:00.000Z',
			});
			await saveCanonicalCollation(harness.db, storeOptions);
			await createCommittedCollationCheckpointWithFiles(
				harness.db,
				{ collationId: 'col-1', checkpointId: 'col-cp-a2', createdAt: '2026-06-10T14:01:00.000Z' },
				storeOptions
			);
			await backupProject(harness.db, provider, contextA, syncOptions());
			const pullB = await backupProject(storeB.db, provider, contextB, { storeOptions: storeOptionsB });
			expect(pullB.downloadedPaths).toContain('collations/col-1.json');
			expect((await loadCollationWithWorkingFile(storeB.db, 'col-1', storeOptionsB))?.row.notes).toBe(
				'A pushed notes'
			);

			const noOp = await backupProject(storeB.db, provider, contextB, { storeOptions: storeOptionsB });
			expect(noOp.uploadedPaths).toEqual([]);
			expect(noOp.downloadedPaths).toEqual([]);
			await storeB.db.deleteFrom('sync_file_fingerprints').where('target_id', '=', 'target-b').execute();
			const rebuiltCache = await backupProject(storeB.db, provider, contextB, { storeOptions: storeOptionsB });
			expect(rebuiltCache.uiState).toBe('synced');
			expect(rebuiltCache.uploadedPaths).toEqual([]);
			expect(rebuiltCache.downloadedPaths).toEqual([]);

			await updateCollationMetadata(harness.db, {
				id: 'col-1', notes: 'A divergent notes', updatedAt: '2026-06-10T14:10:00.000Z',
			});
			await saveCanonicalCollation(harness.db, storeOptions);
			await createCommittedCollationCheckpointWithFiles(
				harness.db,
				{ collationId: 'col-1', checkpointId: 'col-cp-a3', createdAt: '2026-06-10T14:11:00.000Z' },
				storeOptions
			);
			await updateCollationMetadata(storeB.db, {
				id: 'col-1', notes: 'B divergent notes', updatedAt: '2026-06-10T14:10:30.000Z',
			});
			await saveCanonicalCollation(storeB.db, storeOptionsB);
			await createCommittedCollationCheckpointWithFiles(
				storeB.db,
				{ collationId: 'col-1', checkpointId: 'col-cp-b3', createdAt: '2026-06-10T14:11:30.000Z' },
				storeOptionsB
			);
			await backupProject(harness.db, provider, contextA, syncOptions());
			const conflictB = await backupProject(storeB.db, provider, contextB, {
				storeOptions: storeOptionsB,
				authorName: 'B editor',
			});
			expect(conflictB.uiState).toBe('conflict requires resolution');
			expect(conflictB.conflictCopyId).toBeTruthy();
			expect(
				(await loadCollationWithWorkingFile(storeB.db, conflictB.conflictCopyId ?? '', storeOptionsB))?.row.notes
			).toBe('B divergent notes');
		} finally {
			await storeB.destroy();
		}
	});

	it('backs up one project entity before updating the project manifest', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();

		const result = await backupProjectEntity(
			harness.db,
			provider,
			context,
			{ entityType: 'collation', entityId: 'col-1' },
			syncOptions({ now: () => '2026-06-10T13:00:00.000Z' })
		);

		expect(result.uiState).toBe('synced');
		expect(result.manifestUploaded).toBe(true);
		expect(result.uploadedPaths).toEqual([
			'history/collations/col-1/col-cp-1.json',
			'collations/col-1.json',
			'project.json',
		]);
		expect(
			provider.calls.filter(call => call.operation === 'create-file').map(call => call.path)
		).toEqual([
			'history/collations/col-1/col-cp-1.json',
			'collations/col-1.json',
			'project.json',
		]);
	});

	it('blocks strict project backup when an entity has uncommitted local changes', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await updateCollationMetadata(harness.db, {
			id: 'col-1',
			notes: 'Uncommitted notes',
			updatedAt: '2026-06-10T13:05:00.000Z',
		});
		await saveCanonicalCollation(harness.db, storeOptions);

		const result = await backupProject(harness.db, provider, context, syncOptions());

		expect(result.uiState).toBe('uncommitted local changes');
		expect(result.manifestUploaded).toBe(false);
		expect(result.skippedItems).toMatchObject([
			{ itemType: 'collation', itemId: 'col-1', status: 'uncommitted-local-changes' },
		]);
		expect(provider.calls.filter(call => call.operation === 'create-file')).toEqual([]);
	});

	it('creates a missing local default project folder before backing up', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		await upsertCloudConnection(harness.db, {
			id: 'conn-local',
			providerId: 'local-folder',
			providerAccountId: 'local-root',
			accountEmail: 'Local folder',
		});
		await upsertCloudProjectFolder(harness.db, {
			projectId: 'project-1',
			connectionId: 'conn-local',
			cloudFolderId: 'Apatosaurus/Projects/project-1',
			cloudFolderPath: 'Apatosaurus/Projects/project-1',
		});
		const provider = new LocalFolderStorageProvider(
			new FakeDirectoryHandle('root') as unknown as FileSystemDirectoryHandle
		);
		const context: SyncProjectContext = {
			connectionId: 'conn-local',
			projectId: 'project-1',
			cloudFolderId: 'Apatosaurus/Projects/project-1',
			cloudFolderPath: 'Apatosaurus/Projects/project-1',
		};

		const result = await backupProject(harness.db, provider, context, syncOptions());

		expect(result.uiState).toBe('synced');
		await expect(
			provider.downloadFile('Apatosaurus/Projects/project-1/project.json')
		).resolves.toContain('"id":"project-1"');
		await expect(
			harness.db
				.selectFrom('cloud_project_folders')
				.select([
					'cloud_folder_id as cloudFolderId',
					'cloud_folder_path as cloudFolderPath',
				])
				.where('project_id', '=', 'project-1')
				.executeTakeFirstOrThrow()
		).resolves.toEqual({
			cloudFolderId: 'Apatosaurus/Projects/project-1',
			cloudFolderPath: 'Apatosaurus/Projects/project-1',
		});
	});

	it('compares remote project manifests against local and last synced entity heads', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await backupProject(harness.db, provider, context, syncOptions());

		await expect(
			downloadAndCompareProjectManifest(harness.db, provider, context, storeOptions)
		).resolves.toMatchObject({
			state: 'up-to-date',
		});

		await pushRemoteCollationRevision(
			provider,
			context,
			'Remote committed notes',
			'col-cp-remote'
		);

		await expect(
			downloadAndCompareProjectManifest(harness.db, provider, context, storeOptions)
		).resolves.toMatchObject({
			state: 'remote-update-available',
		});
	});

	it('backs off on transient polling failures and stops for reauthorization', async () => {
		let attempt = 0;
		const scheduledDelays: number[] = [];
		const poller = new OpenObjectSyncPoller({
			baseIntervalMs: 10,
			maxIntervalMs: 40,
			setTimeout: ((_callback: () => void, delay?: number) => {
				scheduledDelays.push(delay ?? 0);
				return scheduledDelays.length as unknown as ReturnType<typeof setTimeout>;
			}) as typeof setTimeout,
			clearTimeout: (() => undefined) as typeof clearTimeout,
			poll: async () => {
				attempt += 1;
				if (attempt === 1) {
					return {
						uiState: 'sync pending',
						providerError: 'rate-limited',
						uploadedPaths: [],
						downloadedPaths: [],
						deletedPaths: [],
						quarantines: [],
					};
				}
				if (attempt === 2) {
					return {
						uiState: 'synced',
						uploadedPaths: [],
						downloadedPaths: [],
						deletedPaths: [],
						quarantines: [],
					};
				}
				return {
					uiState: 'sync pending',
					providerError: 'reauthorization-required',
					uploadedPaths: [],
					downloadedPaths: [],
					deletedPaths: [],
					quarantines: [],
				};
			},
		});

		poller.start();
		await poller.pollNow();
		expect(poller.connectionState).toBe('backing-off');
		expect(poller.nextDelayMs).toBe(20);
		await poller.pollNow();
		expect(poller.connectionState).toBe('idle');
		expect(poller.nextDelayMs).toBe(10);
		await poller.pollNow();
		expect(poller.connectionState).toBe('reconnect-required');
	});

	it('resumes polling after folder permission is re-granted', async () => {
		let granted = false;
		let polls = 0;
		const poller = new OpenObjectSyncPoller({
			setTimeout: ((callback: () => void) => 1 as unknown as ReturnType<typeof setTimeout>) as typeof setTimeout,
			clearTimeout: (() => undefined) as typeof clearTimeout,
			poll: async () => {
				polls += 1;
				return {
					uiState: granted ? 'synced' : 'sync pending',
					providerError: granted ? undefined : 'reauthorization-required',
					uploadedPaths: [],
					downloadedPaths: [],
					deletedPaths: [],
					quarantines: [],
				};
			},
		});
		poller.start();
		await poller.pollNow();
		expect(poller.connectionState).toBe('reconnect-required');

		granted = true;
		poller.resumeAfterReconnect();
		await poller.pollNow();

		expect(polls).toBe(2);
		expect(poller.connectionState).toBe('idle');
		expect(poller.uiState).toBe('synced');
	});
});

class RecordingMockProvider extends MockCloudStorageProvider {
	calls: ProviderCall[] = [];

	async listFiles(
		folderId: string,
		options: { recursive?: boolean; cursor?: string } = {}
	): Promise<CloudListResult> {
		this.calls.push({ operation: 'list-files' });
		return super.listFiles(folderId, options);
	}

	async downloadFile(fileId: string): Promise<string> {
		this.calls.push({ operation: 'download-file' });
		return super.downloadFile(fileId);
	}

	async createFile(folderId: string, path: string, content: string): Promise<CloudWriteResult> {
		this.calls.push({ operation: 'create-file', path });
		return super.createFile(folderId, path, content);
	}

	async updateFile(
		fileId: string,
		content: string,
		expectedRevision: string
	): Promise<CloudWriteResult> {
		this.calls.push({ operation: 'update-file' });
		return super.updateFile(fileId, content, expectedRevision);
	}

	async deleteFile(fileId: string, expectedRevision?: string): Promise<void> {
		this.calls.push({ operation: 'delete-file', path: fileId });
		return super.deleteFile(fileId, expectedRevision);
	}
}

async function createConnectedProvider(): Promise<{
	provider: RecordingMockProvider;
	context: SyncProjectContext;
}> {
	await upsertCloudConnection(harness.db, {
		id: 'conn-1',
		providerId: 'mock',
		providerAccountId: 'acct-1',
		accountEmail: 'editor@example.com',
	});
	const provider = new RecordingMockProvider({ now: () => '2026-06-10T12:00:00.000Z' });
	const folderId = await provider.createFolder('Project');
	await upsertCloudProjectFolder(harness.db, {
		projectId: 'project-1',
		connectionId: 'conn-1',
		cloudFolderId: folderId,
		cloudFolderPath: 'Project',
	});
	provider.calls = [];
	return {
		provider,
		context: {
			connectionId: 'conn-1',
			projectId: 'project-1',
			cloudFolderId: folderId,
			cloudFolderPath: 'Project',
		},
	};
}

async function createConnectedLocalFolderProvider(): Promise<{
	provider: LocalFolderStorageProvider;
	context: SyncProjectContext;
}> {
	await upsertCloudConnection(harness.db, {
		id: 'conn-local',
		providerId: 'local-folder',
		providerAccountId: 'local-root',
		accountEmail: 'Local folder',
	});
	const provider = new LocalFolderStorageProvider(
		new FakeDirectoryHandle('root') as unknown as FileSystemDirectoryHandle
	);
	const appFolderId = await provider.createFolder('Apatosaurus');
	const projectsFolderId = await provider.createFolder('Projects', appFolderId);
	const folderId = await provider.createFolder('project-1', projectsFolderId);
	await upsertCloudProjectFolder(harness.db, {
		projectId: 'project-1',
		connectionId: 'conn-local',
		cloudFolderId: folderId,
		cloudFolderPath: 'Apatosaurus/Projects/project-1',
	});
	return {
		provider,
		context: {
			connectionId: 'conn-local',
			projectId: 'project-1',
			cloudFolderId: folderId,
			cloudFolderPath: 'Apatosaurus/Projects/project-1',
		},
	};
}

async function createCommittedProjectCollation(
	notes: string,
	checkpointId: string
): Promise<CollationCheckpoint> {
	await createProject(harness.db, { id: 'project-1', name: 'Project' });
	await createCollation(harness.db, {
		id: 'col-1',
		projectId: 'project-1',
		title: 'Romans 1:1',
		verseIdentifier: 'Romans 1:1',
		now: '2026-06-10T12:00:00.000Z',
	});
	await updateCollationMetadata(harness.db, {
		id: 'col-1',
		notes,
		updatedAt: '2026-06-10T12:01:00.000Z',
	});
	await saveCanonicalCollation(harness.db, storeOptions);
	return createCommittedCollationCheckpointWithFiles(
		harness.db,
		{
			collationId: 'col-1',
			checkpointId,
			createdAt: '2026-06-10T12:02:00.000Z',
		},
		storeOptions
	);
}

async function saveCanonicalCollation(
	db: LocalDbTestHarness['db'],
	options: StoreOperationOptions,
	projectName = 'Project',
	collationId = 'col-1'
): Promise<void> {
	const document = structuredClone(COLLATION_FIXTURE.document);
	document.meta.projectName = projectName;
	await saveWorkingCollationArtifact(
		db,
		{
			collationId,
			artifactType: 'collation_document_v1',
			payload: JSON.stringify(document),
			now: '2026-06-10T12:01:00.000Z',
		},
		options
	);
}

async function createProjectTranscription(): Promise<string> {
	await createProject(harness.db, { id: 'project-1', name: 'Project' });
	await createTranscription(harness.db, {
		id: 'tx-1',
		projectId: 'project-1',
		projectTranscriptionId: 'pt-1',
		title: 'Witness 01',
		siglum: '01',
		document: documentWithVerses(['Romans 1:1']),
		transcriber: 'Editor',
		repository: 'Library',
		settlement: 'City',
		language: 'grc',
	});
	return 'pt-1';
}

async function pushRemoteCollationRevision(
	provider: RecordingMockProvider,
	context: SyncProjectContext,
	notes: string,
	checkpointId: string,
	documentProjectName = 'Project',
	collationId = 'col-1',
	initialCheckpointId = 'col-cp-1'
): Promise<void> {
	const remoteHarness = createLocalDbTestHarness();
	const remoteStoreOptions = { backend: new MemoryStoreBackend() };
	try {
		await createProject(
			remoteHarness.db,
			{ id: 'project-1', name: 'Project' },
			remoteStoreOptions
		);
		await createCollation(remoteHarness.db, {
			id: collationId,
			projectId: 'project-1',
			title: 'Romans 1:1',
			verseIdentifier: 'Romans 1:1',
			now: '2026-06-10T12:00:00.000Z',
		});
		await updateCollationMetadata(remoteHarness.db, {
			id: collationId,
			notes: 'Initial notes',
			updatedAt: '2026-06-10T12:01:00.000Z',
		});
		await saveCanonicalCollation(remoteHarness.db, remoteStoreOptions, 'Project', collationId);
		await createCommittedCollationCheckpointWithFiles(
			remoteHarness.db,
			{
				collationId,
				checkpointId: initialCheckpointId,
				createdAt: '2026-06-10T12:02:00.000Z',
			},
			remoteStoreOptions
		);
		await updateCollationMetadata(remoteHarness.db, {
			id: collationId,
			notes,
			updatedAt: '2026-06-10T12:25:00.000Z',
		});
		await saveCanonicalCollation(
			remoteHarness.db,
			remoteStoreOptions,
			documentProjectName,
			collationId
		);
		await createCommittedCollationCheckpointWithFiles(
			remoteHarness.db,
			{
				collationId,
				checkpointId,
				createdAt: '2026-06-10T12:26:00.000Z',
			},
			remoteStoreOptions
		);
		const historyPath = `history/collations/${collationId}/${checkpointId}.json`;
		const history = await serializeCollationHistoryCloudFile(
			remoteHarness.db,
			collationId,
			checkpointId,
			remoteStoreOptions
		);
		await provider.createFile(
			context.cloudFolderId,
			historyPath,
			await serializeCloudFile(history)
		);
		const primary = await remoteFile(provider, context, `collations/${collationId}.json`);
		if (!primary) throw new Error('Expected remote primary file.');
		const remotePrimary = await serializeCollationCloudFile(
			remoteHarness.db,
			collationId,
			remoteStoreOptions
		);
		await provider.updateFile(
			primary.id,
			await serializeCloudFile(remotePrimary),
			primary.revision
		);
		const manifest = await remoteFile(provider, context, 'project.json');
		const remoteManifest = await serializeProjectCloudFile(remoteHarness.db, 'project-1');
		if (manifest) {
			await provider.updateFile(
				manifest.id,
				await serializeCloudFile(remoteManifest),
				manifest.revision
			);
		} else {
			await provider.createFile(
				context.cloudFolderId,
				'project.json',
				await serializeCloudFile(remoteManifest)
			);
		}
	} finally {
		await remoteHarness.destroy();
	}
}

async function remoteFile(
	provider: RecordingMockProvider,
	context: SyncProjectContext,
	path: string
): Promise<CloudFileMetadata | null> {
	let cursor: string | undefined;
	do {
		const page = await provider.listFiles(context.cloudFolderId, { recursive: true, cursor });
		const match = page.entries.find(
			entry => !entry.isFolder && relativeEntryPath(entry.path, context) === path
		);
		if (match) return match;
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return null;
}

async function loadMetadata() {
	return harness.db
		.selectFrom('cloud_sync_metadata')
		.selectAll()
		.where('connection_id', '=', 'conn-1')
		.where('entity_type', '=', 'collation')
		.where('entity_id', '=', 'col-1')
		.executeTakeFirst();
}

async function loadCollationNotes(collationId: string): Promise<string | undefined> {
	return (await loadCollationWithWorkingFile(harness.db, collationId, storeOptions))?.row.notes;
}

async function loadProjectStorageSlug(projectId: string): Promise<string> {
	const row = await harness.db
		.selectFrom('projects')
		.select('storage_slug')
		.where('id', '=', projectId)
		.executeTakeFirstOrThrow();
	return row.storage_slug;
}

function relativeEntryPath(path: string, context: SyncProjectContext): string {
	const root = context.cloudFolderPath ?? '';
	return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function syncOptions(options: SyncManagerOptions = {}): SyncManagerOptions {
	return { ...options, storeOptions: options.storeOptions ?? storeOptions };
}

function documentWithVerses(verses: string[]): StoredTranscriptionDocument {
	return {
		type: 'transcriptionDocument',
		pages: [
			{
				type: 'page',
				id: 'page-1',
				columns: [
					{
						type: 'column',
						number: 1,
						lines: [
							{
								type: 'line',
								number: 1,
								items: verses.map(value => {
									const [book = '', chapterVerse = ''] = value.split(' ');
									const [chapter = '', verse = ''] = chapterVerse.split(':');
									return {
										type: 'milestone' as const,
										kind: 'verse' as const,
										attrs: { book, chapter, verse },
									};
								}),
							},
						],
					},
				],
			},
		],
	};
}
