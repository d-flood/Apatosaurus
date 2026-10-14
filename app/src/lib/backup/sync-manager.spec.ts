import {
	createTranscriptionWithFiles,
	createLocalDbTestHarness,
	type LocalDbTestHarness,
} from '$lib/testing/local-db-harness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/transcription/content';
import { createCollation, updateCollationMetadata } from '$lib/db/repositories/collations';
import { createProject as createProjectRepository } from '$lib/db/repositories/projects';
import { listCollationVersions, type CollationCheckpoint } from '$lib/db/repositories/revisions';
import {
	createCommittedCollationCheckpointWithFiles,
	loadCollationWithWorkingFile,
	saveWorkingCollationArtifact,
	updateCollationVersionNote,
} from '$lib/db/repositories/collation-files';
import { createTranscription } from '$lib/db/repositories/transcriptions';
import {
	createCommittedTranscriptionCheckpointWithFiles,
	loadTranscriptionWithWorkingFile,
	saveWorkingTranscriptionContent,
} from '$lib/db/repositories/transcription-files';
import { deleteCollationWithFiles } from '$lib/db/repositories/entity-deletion';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import type { StoreOperationOptions } from '$lib/storage/opfs-store';

import { readTextFile, writeTextFileAtomic } from '$lib/storage/opfs-store';
import {
	collationTeiFile,
	collationPrimaryFile,
	collationCheckpointFile,
	joinStorePath,
	projectFolder,
	projectManifestFile,
	transcriptionPrimaryFile,
} from '$lib/storage/layout';
import { sealDocument, serializeSealedDocument } from '$lib/storage/envelope';
import { TOMBSTONE_CURRENT_VERSION, TOMBSTONE_FORMAT } from '$lib/storage/formats';
import { MockCloudStorageProvider, type MockProviderOperation } from './providers/mock-provider';
import { FakeDirectoryHandle } from './providers/fake-file-system-access.spec-support';
import { LocalFolderStorageProvider } from './providers/local-folder-provider';
import { DropboxStorageProvider } from './providers/dropbox-provider';
import { FakeDropboxApi } from './providers/dropbox-fake.spec-support';
import { FakeGoogleDriveApi } from './providers/google-drive-fake.spec-support';
import { GoogleDriveStorageProvider } from './providers/google-drive-provider';
import {
	LOCATION_ROOT_FOLDER_ID,
	type CloudFileMetadata,
	type CloudListResult,
	type CloudStorageProvider,
	type CloudWriteResult,
} from './providers/provider';
import { browseFolder } from './folder-browser';
import { backupProject, listPendingUploadPaths, type SyncManagerOptions } from './sync-manager';
import { reconcileConflictCopy } from './conflicts';
import { ensureLocationMarker } from './location-marker';
import { discoverLocationProjects } from './location-discovery';
import { importProjectFileTree } from './project-zip-import';
import {
	deriveEntityCloudBackupState,
	placementSyncContext,
	type SyncProjectContext,
} from './backup-status';
import { deleteProjectLocally, removeProjectsFromDevice } from './project-removal';
import { deleteProjectFromLocation, moveProject } from './project-move';
import {
	clearRemovedProjects,
	listProjectPlacements,
	upsertProjectPlacements,
} from '$lib/storage/project-locations';
import { listProjectArchiveFiles } from '$lib/backup/project-archive';
import { exportProjectZip } from '$lib/backup/project-zip-export';
import { OpenObjectSyncPoller } from '$lib/backup/sync-poller';
import { COLLATION_FIXTURE } from '$lib/storage/formats/payload-fixtures';

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
			.insertInto('sync_file_fingerprints')
			.values({
				target_id: context.connectionId,
				project_id: context.projectId,
				file_path: 'collations/col-1.json',
				local_content_hash: '',
				local_size: 0,
				local_modified_at: '',
				remote_file_id: 'file-col-1',
				remote_revision: 'rev-1',
				remote_content_hash: '',
				remote_size: 0,
				remote_modified_at: '',
				synced_at: '2026-06-10T12:10:00.000Z',
				entity_type: 'collation',
				entity_id: 'col-1',
				revision_id: checkpoint.id,
				entity_content_hash: checkpoint.contentHash,
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
			call =>
				call.operation === 'create-file' && call.path === 'tombstones/collation--col-1.json'
		);
		const primaryDelete = provider.calls.findIndex(call => call.operation === 'delete-file');
		expect(tombstoneWrite).toBeGreaterThanOrEqual(0);
		expect(primaryDelete).toBeGreaterThan(tombstoneWrite);
		expect(result.deletedPaths).toContain('collations/col-1.json');
		expect(await remoteFile(provider, context, 'collations/col-1.json')).toBeNull();
		expect(
			await remoteFile(provider, context, 'history/collations/col-1/col-cp-1.json')
		).not.toBeNull();
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
		await expect(
			readTextFile(collationPrimaryFile(projectSlug, 'col-1'), storeOptions)
		).rejects.toThrow();
		await expect(
			readTextFile(collationCheckpointFile(projectSlug, 'col-1', 'col-cp-1'), storeOptions)
		).resolves.toContain('col-cp-1');
		await expect(
			harness.db
				.selectFrom('collations')
				.select('id')
				.where('id', '=', 'col-1')
				.executeTakeFirst()
		).resolves.toBeUndefined();
		expect(await remoteFile(provider, context, 'collations/col-1.json')).toBeNull();
	});

	it('checks a synced Drive project with a single request, recognising its own uploads', async () => {
		const { api, sync } = await quietDriveProject();

		const result = await sync();

		expect(result.uiState).toBe('synced');
		expect(api.calls).not.toContain('GET /files');
		expect(result.uploadedPaths).toEqual([]);
		api.calls = [];
		await sync();
		expect(api.calls).toEqual(['GET /changes']);
	});

	it('runs a full sync when a synced file changes remotely', async () => {
		const { api, sync, context, connect } = await quietDriveProject();
		const other = connect();
		const file = (await remoteFile(other, context, 'collations/col-1.json'))!;
		await other.updateFile(file.id, await other.downloadFile(file.id), file.revision);
		api.calls = [];

		const result = await sync();

		expect(result.uiState).toBe('synced');
		expect(api.calls).toContain('GET /files');
		api.calls = [];
		await sync();
		expect(api.calls).toEqual(['GET /changes']);
	});

	it('uploads local edits to a synced project whose remote has not changed', async () => {
		const { api, sync } = await quietDriveProject();
		await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{
				collationId: 'col-1',
				checkpointId: 'col-cp-2',
				createdAt: '2026-06-10T12:03:00.000Z',
			},
			storeOptions
		);

		const result = await sync();

		expect(result.uiState).toBe('synced');
		expect(result.uploadedPaths).toContain('history/collations/col-1/col-cp-2.json');
		api.calls = [];
		expect((await sync()).uploadedPaths).toEqual([]);
		expect(api.calls).not.toContain('GET /files');
		api.calls = [];
		await sync();
		expect(api.calls).toEqual(['GET /changes']);
	});

	it('checks a synced local folder for changes without a full sync', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedLocalFolderProvider();
		const first = await backupProject(harness.db, provider, context, syncOptions());
		expect(first.remoteCursor).toBeDefined();
		const writes = vi.spyOn(provider, 'createFile');

		const quiet = await backupProject(
			harness.db,
			provider,
			context,
			syncOptions({ remoteCursor: first.remoteCursor })
		);

		expect(quiet.uiState).toBe('synced');
		expect(quiet.entityResults).toEqual([]);
		expect(writes).not.toHaveBeenCalled();
	});

	it('makes no cloud requests while it holds exclusive local access', async () => {
		const { exclusive, guard, violations } = guardedExclusive();
		const now = '2026-10-03T12:00:00.000Z';
		const provider = guard(new MockCloudStorageProvider({ now: () => now }));
		await ensureLocationMarker(provider, provider.rootFolderId, 'location-1', now);
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const slug = await loadProjectStorageSlug('project-1');
		const placement = {
			projectId: 'project-1',
			locationId: 'location-1',
			folderName: slug,
			needsLocationChoice: false,
		};
		await moveProject(
			harness.db,
			{
				projectId: 'project-1',
				source: null,
				destination: {
					provider,
					rootFolderId: provider.rootFolderId,
					locationId: placement.locationId,
					folderName: slug,
					label: 'Dropbox/Apatosaurus',
				},
				movedBy: 'Ada',
			},
			syncOptions({ exclusive })
		);
		const context = placementSyncContext(placement);
		const syncA = () =>
			backupProject(harness.db, provider, context, syncOptions({ exclusive }));
		expect((await syncA()).uiState).toBe('synced');

		const storeB = createLocalDbTestHarness();
		const storeOptionsB = { backend: new MemoryStoreBackend() };
		try {
			const discovered = await discoverLocationProjects(
				storeB.db,
				provider,
				provider.rootFolderId,
				{ storeOptions: storeOptionsB, exclusive }
			);
			expect(discovered.projects).toEqual([
				{ projectId: 'project-1', folderName: slug, imported: true },
			]);
			const syncB = () =>
				backupProject(storeB.db, provider, context, {
					storeOptions: storeOptionsB,
					exclusive,
				});
			expect((await syncB()).uiState).toBe('synced');
			await createCommittedCollationCheckpointWithFiles(
				storeB.db,
				{
					collationId: 'col-1',
					checkpointId: 'col-cp-b',
					createdAt: '2026-06-10T12:05:00.000Z',
				},
				storeOptionsB
			);
			expect((await syncB()).uploadedPaths).toContain(
				'history/collations/col-1/col-cp-b.json'
			);

			const pulled = await syncA();

			expect(pulled.uiState).toBe('synced');
			expect(pulled.downloadedPaths).toContain('history/collations/col-1/col-cp-b.json');
			expect(violations).toEqual([]);
		} finally {
			await storeB.destroy();
		}
	});

	it('leaves edits made while uploads run pending for the next sync', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		let edit: Promise<unknown> | undefined;
		const editing = new Proxy(provider, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (property !== 'createFile') return value;
				return async (...args: Parameters<RecordingMockProvider['createFile']>) => {
					edit ??= createCommittedCollationCheckpointWithFiles(
						harness.db,
						{
							collationId: 'col-1',
							checkpointId: 'col-cp-2',
							createdAt: '2026-06-10T12:03:00.000Z',
						},
						storeOptions
					);
					await edit;
					return target.createFile(...args);
				};
			},
		});

		expect((await backupProject(harness.db, editing, context, syncOptions())).uiState).toBe(
			'synced'
		);
		expect(await listPendingUploadPaths(harness.db, context, storeOptions)).toContain(
			'history/collations/col-1/col-cp-2.json'
		);

		const next = await backupProject(harness.db, provider, context, syncOptions());

		expect(next.uploadedPaths).toContain('history/collations/col-1/col-cp-2.json');
		expect(await listPendingUploadPaths(harness.db, context, storeOptions)).toEqual([]);
	});

	it('does not download a project that failed to import again until it changes', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await ensureLocationMarker(
			provider,
			provider.rootFolderId,
			'location-1',
			'2026-10-03T12:00:00.000Z'
		);
		await backupProject(harness.db, provider, context, syncOptions());
		const broken = (await remoteFile(provider, context, 'collations/col-1.json'))!;
		await provider.updateFile(broken.id, 'not json', broken.revision);
		const storeB = createLocalDbTestHarness();
		const failedImports = new Map<string, string>();
		try {
			const discover = () =>
				discoverLocationProjects(storeB.db, provider, provider.rootFolderId, {
					storeOptions: { backend: new MemoryStoreBackend() },
					failedImports,
				});
			expect((await discover()).projects).toEqual([]);
			provider.calls = [];

			expect((await discover()).projects).toEqual([]);

			expect(provider.calls.filter(call => call.operation === 'download-file')).toHaveLength(
				1
			);
		} finally {
			await storeB.destroy();
		}
	});

	it('does not download remote files that have not changed since the last sync', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await backupProject(harness.db, provider, context, syncOptions());
		provider.calls = [];

		const result = await backupProject(harness.db, provider, context, syncOptions());

		expect(result.uiState).toBe('synced');
		expect(provider.calls.filter(call => call.operation === 'download-file')).toEqual([]);
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

	it('mirrors canonical project files byte-for-byte and no working files exist', async () => {
		const projectTranscriptionId = await createProjectTranscription();
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId,
				checkpointId: 'tx-cp-1',
				commitMessage: 'Ready for sync',
				authorName: 'Editor',
				createdAt: '2026-06-10T12:00:00.000Z',
			},
			storeOptions
		);
		const { provider, context } = await createConnectedProvider();
		const projectSlug = await loadProjectStorageSlug('project-1');
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
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
		expect([...backend.files.keys()].filter(path => path.endsWith('.working.json'))).toEqual(
			[]
		);
		expect(
			(await listRemoteFiles(provider, context)).filter(path =>
				path.endsWith('.working.json')
			)
		).toEqual([]);
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
		await provider.updateFile(
			remoteTei.id,
			'<TEI>remote is not authoritative</TEI>',
			remoteTei.revision
		);

		const result = await backupProject(harness.db, provider, context, {
			now: () => '2026-06-10T13:05:00.000Z',
			storeOptions,
		});

		expect(result.uiState).toBe('synced');
		expect(result.downloadedPaths).toContain('collations/col-1.json');
		expect(result.downloadedPaths).toContain('history/collations/col-1/col-cp-remote.json');
		await expect(loadCollationNotes('col-1')).resolves.toBe('Remote committed notes');
		const projectSlug = await loadProjectStorageSlug('project-1');
		const regeneratedTei = await readTextFile(
			collationTeiFile(projectSlug, 'col-1'),
			storeOptions
		);
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
			{
				collationId: 'col-2',
				checkpointId: 'col-2-cp-1',
				createdAt: '2026-06-10T12:02:00.000Z',
			},
			storeOptions
		);
		const { provider, context } = await createConnectedProvider();
		await backupProject(harness.db, provider, context, syncOptions());
		await pushRemoteCollationRevision(
			provider,
			context,
			'Accepted remote notes',
			'col-cp-remote'
		);
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
			{
				collationId: 'col-2',
				checkpointId: 'col-2-cp-local',
				createdAt: '2026-06-10T13:04:30.000Z',
			},
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
			{ file_path: 'collations/col-2.json' },
			{ file_path: 'history/collations/col-1/col-cp-remote.json' },
		]);
		await expect(loadCollationNotes('col-2')).resolves.toBe('Remote conflicting notes');
		await expect(
			harness.db
				.selectFrom('collations')
				.select(({ fn }) => fn.countAll<number>().as('count'))
				.executeTakeFirstOrThrow()
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
		expect(localTei).toContain('<title>Remote Primary Collation</title>');
		await expect(loadCollationNotes('col-1')).resolves.toBe('Remote committed notes');
		const remoteTei = await remoteFile(provider, context, 'collations/col-1.tei.xml');
		if (!remoteTei) throw new Error('Expected regenerated remote TEI file.');
		const remoteTeiContent = await provider.downloadFile(remoteTei.id);
		expect(remoteTeiContent).toContain('<title>Remote Primary Collation</title>');
		expect(remoteTeiContent).not.toContain('untrusted divergent bytes');
	});

	it('syncs two independent stores through push, pull, no-op, cache rebuild, and divergence', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		await createTranscriptionWithFiles(
			harness.db,
			{
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
			},
			storeOptions
		);
		const { provider, context: contextA } = await createConnectedProvider();
		const storeB = createLocalDbTestHarness();
		const storeOptionsB = { backend: new MemoryStoreBackend() };
		const contextB: SyncProjectContext = { ...contextA, connectionId: 'target-b' };
		try {
			const archive = await listProjectArchiveFiles(harness.db, 'project-1', {
				storeOptions,
			});
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
				id: 'col-1',
				notes: 'A pushed notes',
				updatedAt: '2026-06-10T14:00:00.000Z',
			});
			await saveCanonicalCollation(harness.db, storeOptions);
			await saveWorkingTranscriptionContent(
				harness.db,
				{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
				storeOptions
			);
			const pushA = await backupProject(harness.db, provider, contextA, syncOptions());
			expect(pushA.uiState).toBe('synced');
			expect(pushA.uploadedPaths).toContain('transcriptions/pt-1.json');
			const pullB = await backupProject(storeB.db, provider, contextB, {
				storeOptions: storeOptionsB,
			});
			expect(pullB.downloadedPaths).toContain('collations/col-1.json');
			expect(pullB.downloadedPaths).toContain('transcriptions/pt-1.json');
			expect(
				(await loadCollationWithWorkingFile(storeB.db, 'col-1', storeOptionsB))?.row.notes
			).toBe('A pushed notes');
			expect(
				(await loadTranscriptionWithWorkingFile(storeB.db, 'tx-1', storeOptionsB))
					?.content_json
			).toContain('"verse":"2"');

			const noOp = await backupProject(storeB.db, provider, contextB, {
				storeOptions: storeOptionsB,
			});
			expect(noOp.uploadedPaths).toEqual([]);
			expect(noOp.downloadedPaths).toEqual([]);
			await storeB.db
				.deleteFrom('sync_file_fingerprints')
				.where('target_id', '=', 'target-b')
				.execute();
			const rebuiltCache = await backupProject(storeB.db, provider, contextB, {
				storeOptions: storeOptionsB,
			});
			expect(rebuiltCache.uiState).toBe('synced');
			expect(rebuiltCache.uploadedPaths).toEqual([]);
			expect(rebuiltCache.downloadedPaths).toEqual([]);

			await updateCollationMetadata(harness.db, {
				id: 'col-1',
				notes: 'A divergent notes',
				updatedAt: '2026-06-10T14:10:00.000Z',
			});
			await saveCanonicalCollation(harness.db, storeOptions);
			await updateCollationMetadata(storeB.db, {
				id: 'col-1',
				notes: 'B divergent notes',
				updatedAt: '2026-06-10T14:10:30.000Z',
			});
			await saveCanonicalCollation(storeB.db, storeOptionsB);
			await backupProject(harness.db, provider, contextA, syncOptions());
			const conflictB = await backupProject(storeB.db, provider, contextB, {
				storeOptions: storeOptionsB,
				authorName: 'B editor',
			});
			expect(conflictB.uiState).toBe('conflict requires resolution');
			expect(conflictB.conflictCopyId).toBeTruthy();
			expect(
				(
					await loadCollationWithWorkingFile(
						storeB.db,
						conflictB.conflictCopyId ?? '',
						storeOptionsB
					)
				)?.row.notes
			).toBe('B divergent notes');
			expect(
				await storeB.db
					.selectFrom('collations')
					.select('id')
					.where('project_id', '=', 'project-1')
					.execute()
			).toHaveLength(2);
			expect(
				(await loadCollationWithWorkingFile(storeB.db, 'col-1', storeOptionsB))?.row.notes
			).toBe('A divergent notes');
			const settled = await backupProject(storeB.db, provider, contextB, {
				storeOptions: storeOptionsB,
			});
			expect(settled.uiState).toBe('synced');
			expect(settled.conflictCopyId).toBeUndefined();
			await backupProject(harness.db, provider, contextA, syncOptions());
			expect((await harness.db.selectFrom('collations').select('id').execute()).length).toBe(
				2
			);
			await reconcileConflictCopy(
				storeB.db,
				conflictB.conflictCopyId ?? '',
				{},
				storeOptionsB
			);
			await backupProject(storeB.db, provider, contextB, { storeOptions: storeOptionsB });
			const pullA = await backupProject(harness.db, provider, contextA, syncOptions());
			expect(pullA.uiState).toBe('synced');
			expect(pullA.hasConflictCopies).toBe(false);
			expect((await harness.db.selectFrom('collations').select('id').execute()).length).toBe(
				1
			);
		} finally {
			await storeB.destroy();
		}
	});

	it('syncs two projects placed in one location into separate subfolders and discovers both from a second store', async () => {
		const provider = new RecordingMockProvider({ now: () => '2026-06-10T12:00:00.000Z' });
		const { marker } = await ensureLocationMarker(
			provider,
			provider.rootFolderId,
			'location-1',
			'2026-06-10T12:00:00.000Z'
		);
		for (const [id, name] of [
			['project-1', 'First Project'],
			['project-2', 'Second Project'],
		]) {
			await createProject(harness.db, { id, name });
			const slug = await loadProjectStorageSlug(id);
			const folderId = await provider.createFolder(slug);
			const result = await backupProject(
				harness.db,
				provider,
				{
					projectId: id,
					connectionId: marker.id,
					cloudFolderId: folderId,
					cloudFolderPath: slug,
				},
				syncOptions()
			);
			expect(result.uiState).toBe('synced');
		}
		const [slugA, slugB] = await Promise.all([
			loadProjectStorageSlug('project-1'),
			loadProjectStorageSlug('project-2'),
		]);
		expect(slugA).not.toBe(slugB);
		const rootPaths = await listRemoteFiles(provider, {
			projectId: 'project-1',
			connectionId: marker.id,
			cloudFolderId: provider.rootFolderId,
		});
		expect(rootPaths).toEqual(
			expect.arrayContaining([
				'apatosaurus-location.json',
				`${slugA}/project.json`,
				`${slugB}/project.json`,
			])
		);

		const storeB = createLocalDbTestHarness();
		const storeOptionsB = { backend: new MemoryStoreBackend() };
		try {
			const discovered = await discoverLocationProjects(
				storeB.db,
				provider,
				provider.rootFolderId,
				{ storeOptions: storeOptionsB }
			);
			expect(discovered.locationId).toBe('location-1');
			expect(discovered.projects).toEqual(
				expect.arrayContaining([
					{ projectId: 'project-1', folderName: slugA, imported: true },
					{ projectId: 'project-2', folderName: slugB, imported: true },
				])
			);
			const names = await storeB.db.selectFrom('projects').select('name').execute();
			expect(names.map(row => row.name).sort()).toEqual(['First Project', 'Second Project']);
			const folderId = await provider.createFolder(slugA);
			const resync = await backupProject(
				storeB.db,
				provider,
				{
					projectId: 'project-1',
					connectionId: marker.id,
					cloudFolderId: folderId,
					cloudFolderPath: slugA,
				},
				{ storeOptions: storeOptionsB }
			);
			expect(resync.uiState).toBe('synced');
			expect(resync.uploadedPaths).toEqual([]);
			const again = await discoverLocationProjects(
				storeB.db,
				provider,
				provider.rootFolderId,
				{ storeOptions: storeOptionsB }
			);
			expect(again.projects.every(project => !project.imported)).toBe(true);
		} finally {
			await storeB.destroy();
		}
	});

	it('removes a synced project from this device although Current changed since its last version', async () => {
		const provider = new RecordingMockProvider({ now: () => '2026-10-03T12:00:00.000Z' });
		const { marker } = await ensureLocationMarker(
			provider,
			provider.rootFolderId,
			'location-1',
			'2026-10-03T12:00:00.000Z'
		);
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		await createTranscriptionWithFiles(
			harness.db,
			{
				id: 'tx-1',
				projectId: 'project-1',
				projectTranscriptionId: 'pt-1',
				title: 'Witness',
				siglum: '01',
				document: documentWithVerses(['Romans 1:1']),
				transcriber: 'Editor',
				repository: 'Library',
				settlement: 'City',
				language: 'grc',
			},
			storeOptions
		);
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
			storeOptions
		);
		const placement = {
			projectId: 'project-1',
			locationId: marker.id,
			folderName: await loadProjectStorageSlug('project-1'),
			needsLocationChoice: false,
		};
		await upsertProjectPlacements([placement], storeOptions);
		const result = await backupProject(
			harness.db,
			provider,
			placementSyncContext(placement),
			syncOptions()
		);
		expect(result.uiState).toBe('synced');

		await expect(
			removeProjectsFromDevice(harness.db, [placement], storeOptions)
		).resolves.toEqual({ ok: true });
	});

	it('downloads every project when a second store signs in, and removes one from that device only', async () => {
		const provider = new RecordingMockProvider({ now: () => '2026-10-03T12:00:00.000Z' });
		const { marker } = await ensureLocationMarker(
			provider,
			provider.rootFolderId,
			'location-1',
			'2026-10-03T12:00:00.000Z'
		);
		const slugs: Record<string, string> = {};
		for (const [id, name] of [
			['project-1', 'First Project'],
			['project-2', 'Second Project'],
		]) {
			await createProject(harness.db, { id, name });
			await createTranscriptionWithFiles(
				harness.db,
				{
					id: `tx-${id}`,
					projectId: id,
					projectTranscriptionId: `pt-${id}`,
					title: `Witness ${name}`,
					siglum: '01',
					document: documentWithVerses(['Romans 1:1']),
					transcriber: 'Editor',
					repository: 'Library',
					settlement: 'City',
					language: 'grc',
				},
				storeOptions
			);
			slugs[id] = await loadProjectStorageSlug(id);
			const result = await backupProject(
				harness.db,
				provider,
				{
					projectId: id,
					connectionId: marker.id,
					cloudFolderId: slugs[id],
					cloudFolderPath: slugs[id],
				},
				syncOptions()
			);
			expect(result.uiState).toBe('synced');
		}

		const storeB = createLocalDbTestHarness();
		const storeOptionsB = { backend: new MemoryStoreBackend() };
		const discoverB = () =>
			discoverLocationProjects(storeB.db, provider, provider.rootFolderId, {
				storeOptions: storeOptionsB,
			});
		const transcriptionTitlesB = async () =>
			(await storeB.db.selectFrom('transcriptions').select('title').execute())
				.map(row => row.title)
				.sort();
		try {
			const discovered = await discoverB();
			expect(discovered.projects).toEqual(
				expect.arrayContaining([
					{ projectId: 'project-1', folderName: slugs['project-1'], imported: true },
					{ projectId: 'project-2', folderName: slugs['project-2'], imported: true },
				])
			);
			expect(await transcriptionTitlesB()).toEqual([
				'Witness First Project',
				'Witness Second Project',
			]);
			const placementsB = discovered.projects.map(project => ({
				projectId: project.projectId,
				locationId: discovered.locationId,
				folderName: project.folderName,
				needsLocationChoice: false,
			}));
			await upsertProjectPlacements(placementsB, storeOptionsB);
			for (const placement of placementsB) {
				const resync = await backupProject(
					storeB.db,
					provider,
					placementSyncContext(placement),
					{ storeOptions: storeOptionsB }
				);
				expect(resync.uploadedPaths).toEqual([]);
			}

			const remoteBefore = await snapshotRemote(provider);
			provider.calls = [];
			const removed = await removeProjectsFromDevice(
				storeB.db,
				placementsB.filter(placement => placement.projectId === 'project-1'),
				storeOptionsB
			);
			expect(removed).toEqual({ ok: true });
			expect(provider.calls).toEqual([]);
			expect(await snapshotRemote(provider)).toEqual(remoteBefore);
			expect(await transcriptionTitlesB()).toEqual(['Witness Second Project']);
			expect(
				[...storeOptionsB.backend.files.keys()].filter(path =>
					path.includes(slugs['project-1'])
				)
			).toEqual([]);
			expect(await storeB.db.selectFrom('sync_tombstones').selectAll().execute()).toEqual([]);
			expect(
				(await listProjectPlacements(storeOptionsB)).map(placement => placement.projectId)
			).toEqual(['project-2']);

			expect((await discoverB()).projects).toEqual([]);
			expect(await transcriptionTitlesB()).toEqual(['Witness Second Project']);

			await clearRemovedProjects([discovered.locationId], storeOptionsB);
			expect((await discoverB()).projects).toEqual([
				{ projectId: 'project-1', folderName: slugs['project-1'], imported: true },
			]);
			expect(await transcriptionTitlesB()).toEqual([
				'Witness First Project',
				'Witness Second Project',
			]);
			expect(await snapshotRemote(provider)).toEqual(remoteBefore);
		} finally {
			await storeB.destroy();
		}
	});

	it('syncs a project placed in a Google Drive location and discovers it from a second store', async () => {
		const api = new FakeGoogleDriveApi();
		const options = { tokens: api.tokens, fetch: api.fetch };
		const myDrive = new GoogleDriveStorageProvider({ ...options, driveRootId: 'root' });
		const provider = new GoogleDriveStorageProvider({
			...options,
			driveRootId: await myDrive.folderDriveId(await myDrive.createFolder('Apatosaurus')),
		});
		const { marker } = await ensureLocationMarker(
			provider,
			provider.rootFolderId,
			'google-personal',
			'2026-10-03T12:00:00.000Z'
		);
		await createProject(harness.db, { id: 'project-g', name: 'Drive Project' });
		const slug = await loadProjectStorageSlug('project-g');
		const context: SyncProjectContext = {
			projectId: 'project-g',
			connectionId: marker.id,
			cloudFolderId: slug,
			cloudFolderPath: slug,
		};

		const first = await backupProject(harness.db, provider, context, syncOptions());
		expect(first.uiState).toBe('synced');
		expect(first.uploadedPaths).toContain('project.json');
		const again = await backupProject(harness.db, provider, context, syncOptions());
		expect(again.uiState).toBe('synced');
		expect(again.uploadedPaths).toEqual([]);
		expect(api.missingSupportsAllDrives).toEqual([]);

		const storeB = createLocalDbTestHarness();
		const storeOptionsB = { backend: new MemoryStoreBackend() };
		try {
			const deviceB = new GoogleDriveStorageProvider({
				...options,
				driveRootId: api.findByName('Apatosaurus')!.id,
			});
			const discovered = await discoverLocationProjects(
				storeB.db,
				deviceB,
				deviceB.rootFolderId,
				{ storeOptions: storeOptionsB }
			);
			expect(discovered).toEqual({
				locationId: 'google-personal',
				projects: [{ projectId: 'project-g', folderName: slug, imported: true }],
			});
			const resync = await backupProject(storeB.db, deviceB, context, {
				storeOptions: storeOptionsB,
			});
			expect(resync.uiState).toBe('synced');
			expect(resync.uploadedPaths).toEqual([]);
		} finally {
			await storeB.destroy();
		}
	});

	it('deletes a team project for everyone into the Drive trash and stops a teammate syncing it', async () => {
		const api = new FakeGoogleDriveApi();
		const options = { tokens: api.tokens, fetch: api.fetch };
		const lab = api.addSharedDrive('Lab');
		const provider = new GoogleDriveStorageProvider({
			...options,
			driveRootId: lab,
			sharedDriveId: lab,
		});
		await ensureLocationMarker(
			provider,
			provider.rootFolderId,
			'team-location',
			'2026-10-03T12:00:00.000Z'
		);
		await createProject(harness.db, { id: 'project-t', name: 'Team Project' });
		const slug = await loadProjectStorageSlug('project-t');
		const placement = {
			projectId: 'project-t',
			locationId: 'team-location',
			folderName: slug,
			needsLocationChoice: false,
		};
		await upsertProjectPlacements([placement], storeOptions);
		const context = placementSyncContext(placement);
		expect((await backupProject(harness.db, provider, context, syncOptions())).uiState).toBe(
			'synced'
		);

		const storeB = createLocalDbTestHarness();
		const storeOptionsB = { backend: new MemoryStoreBackend() };
		try {
			await discoverLocationProjects(storeB.db, provider, provider.rootFolderId, {
				storeOptions: storeOptionsB,
			});
			await upsertProjectPlacements([placement], storeOptionsB);
			const syncB = () =>
				backupProject(storeB.db, provider, context, { storeOptions: storeOptionsB });
			expect((await syncB()).uiState).toBe('synced');

			await deleteProjectFromLocation(
				{ provider, rootFolderId: provider.rootFolderId, ...placement },
				{ deletedAt: '2026-10-04T09:00:00.000Z', deletedBy: 'Ada' }
			);
			await deleteProjectLocally(harness.db, 'project-t', storeOptions);

			expect(api.findByName('project.json')).toMatchObject({ trashed: true });
			expect(api.findByName('deleted.json')?.trashed).toBeFalsy();
			expect(await listProjectPlacements(storeOptions)).toEqual([]);
			expect(await harness.db.selectFrom('projects').select('id').execute()).toEqual([]);

			const resultB = await syncB();
			expect(resultB.deleted).toEqual({
				deletedAt: '2026-10-04T09:00:00.000Z',
				deletedBy: 'Ada',
			});
			expect(resultB.uploadedPaths).toEqual([]);
			expect(api.findByName('project.json')).toMatchObject({ trashed: true });
			expect(await listProjectPlacements(storeOptionsB)).toEqual([
				{
					projectId: 'project-t',
					locationId: null,
					folderName: null,
					needsLocationChoice: false,
					deleted: resultB.deleted,
				},
			]);
			expect(await storeB.db.selectFrom('projects').select('id').execute()).toEqual([
				{ id: 'project-t' },
			]);
		} finally {
			await storeB.destroy();
		}
	});

	it("syncs two accounts' locations independently", async () => {
		const accounts = await Promise.all(
			['project-a', 'project-b'].map(async (projectId, index) => {
				const api = new FakeDropboxApi();
				const options = { tokens: api.tokens, fetch: api.fetch };
				const rootPath = `/${await new DropboxStorageProvider({ ...options, rootPath: '' }).createFolder('Apatosaurus')}`;
				const provider = new DropboxStorageProvider({ ...options, rootPath });
				const { marker } = await ensureLocationMarker(
					provider,
					provider.rootFolderId,
					`location-${index}`,
					'2026-10-03T12:00:00.000Z'
				);
				await createProject(harness.db, { id: projectId, name: projectId });
				const slug = await loadProjectStorageSlug(projectId);
				const context: SyncProjectContext = {
					projectId,
					connectionId: marker.id,
					cloudFolderId: slug,
					cloudFolderPath: slug,
				};
				return { api, provider, context, slug };
			})
		);
		const [a, b] = accounts;

		for (const { provider, context } of accounts) {
			const result = await backupProject(harness.db, provider, context, syncOptions());
			expect(result.uiState).toBe('synced');
		}
		expect(await listRootFiles(a.provider)).toEqual(
			expect.arrayContaining([`${a.slug}/project.json`])
		);
		expect(await listRootFiles(a.provider)).not.toContain(`${b.slug}/project.json`);
		expect(await listRootFiles(b.provider)).toEqual(
			expect.arrayContaining([`${b.slug}/project.json`])
		);
		expect(await listRootFiles(b.provider)).not.toContain(`${a.slug}/project.json`);

		b.api.revoke();
		const callsBefore = b.api.calls.length;
		const resultA = await backupProject(harness.db, a.provider, a.context, syncOptions());
		expect(resultA.uiState).toBe('synced');
		expect(b.api.calls).toHaveLength(callsBefore);
		await expect(
			backupProject(harness.db, b.provider, b.context, syncOptions())
		).rejects.toMatchObject({ code: 'reauthorization-required' });
		const fingerprints = await harness.db
			.selectFrom('sync_file_fingerprints')
			.select(['target_id', 'project_id'])
			.distinct()
			.execute();
		expect(fingerprints).toEqual(
			expect.arrayContaining([
				{ target_id: 'location-0', project_id: 'project-a' },
				{ target_id: 'location-1', project_id: 'project-b' },
			])
		);
		expect(fingerprints).toHaveLength(2);
	});

	it('converges two stores that add the same marked Dropbox team folder', async () => {
		const api = new FakeDropboxApi({ rootNamespaceId: 'team-ns' });
		const options = { tokens: api.tokens, fetch: api.fetch, rootNamespaceId: 'team-ns' };
		const teamRoot = new DropboxStorageProvider({ ...options, rootPath: '' });
		await ensureLocationMarker(
			new DropboxStorageProvider({
				...options,
				rootPath: `/${await teamRoot.createFolder('Lab/Projects')}`,
			}),
			LOCATION_ROOT_FOLDER_ID,
			'team-location',
			'2026-10-03T12:00:00.000Z'
		);
		expect(await browseFolder(teamRoot, 'Lab')).toEqual({
			hasMarker: false,
			folders: [{ id: 'Lab/Projects', name: 'Projects', hasMarker: true }],
		});

		const storeB = createLocalDbTestHarness();
		const stores = [
			{ db: harness.db, storeOptions, projectId: 'project-a' },
			{
				db: storeB.db,
				storeOptions: { backend: new MemoryStoreBackend() },
				projectId: 'project-b',
			},
		];
		const addTeamFolder = async (store: (typeof stores)[number]) => {
			const provider = new DropboxStorageProvider({ ...options, rootPath: '/Lab/Projects' });
			return discoverLocationProjects(store.db, provider, provider.rootFolderId, {
				storeOptions: store.storeOptions,
			});
		};
		const projectIds = async (store: (typeof stores)[number]) =>
			(await store.db.selectFrom('projects').select('id').orderBy('id').execute()).map(
				row => row.id
			);
		try {
			for (const store of stores) {
				expect((await addTeamFolder(store)).locationId).toBe('team-location');
				await createProjectRepository(
					store.db,
					{ id: store.projectId, name: store.projectId },
					store.storeOptions
				);
				const { storage_slug: slug } = await store.db
					.selectFrom('projects')
					.select('storage_slug')
					.where('id', '=', store.projectId)
					.executeTakeFirstOrThrow();
				const result = await backupProject(
					store.db,
					new DropboxStorageProvider({ ...options, rootPath: '/Lab/Projects' }),
					{
						projectId: store.projectId,
						connectionId: 'team-location',
						cloudFolderId: slug,
						cloudFolderPath: slug,
					},
					{ storeOptions: store.storeOptions }
				);
				expect(result.uiState).toBe('synced');
			}
			await addTeamFolder(stores[0]);

			expect(await projectIds(stores[0])).toEqual(['project-a', 'project-b']);
			expect(await projectIds(stores[1])).toEqual(['project-a', 'project-b']);
			expect(api.missingPathRoot).toEqual([]);
		} finally {
			await storeB.destroy();
		}
	});

	it('keeps versions two stores name from the same parent without a conflict copy', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		await createTranscriptionWithFiles(
			harness.db,
			{
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
			},
			storeOptions
		);
		const { provider, context: contextA } = await createConnectedProvider();
		const storeB = createLocalDbTestHarness();
		const storeOptionsB = { backend: new MemoryStoreBackend() };
		const contextB: SyncProjectContext = { ...contextA, connectionId: 'target-b' };
		const syncB = () =>
			backupProject(storeB.db, provider, contextB, { storeOptions: storeOptionsB });
		try {
			const archive = await listProjectArchiveFiles(harness.db, 'project-1', {
				storeOptions,
			});
			await importProjectFileTree(
				storeB.db,
				archive.map(file => ({ path: file.path, read: async () => file.content })),
				{ storeOptions: storeOptionsB }
			);
			await backupProject(harness.db, provider, contextA, syncOptions());
			expect((await syncB()).uiState).toBe('synced');

			await createCommittedTranscriptionCheckpointWithFiles(
				harness.db,
				{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-a', label: 'From A' },
				storeOptions
			);
			await createCommittedTranscriptionCheckpointWithFiles(
				storeB.db,
				{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-b', label: 'From B' },
				storeOptionsB
			);
			await backupProject(harness.db, provider, contextA, syncOptions());
			const resultB = await syncB();
			const resultA = await backupProject(harness.db, provider, contextA, syncOptions());

			for (const result of [resultA, resultB]) {
				expect(result.uiState).toBe('synced');
				expect(result.conflictCopyId).toBeUndefined();
			}
			for (const db of [harness.db, storeB.db]) {
				const versions = await db
					.selectFrom('transcription_checkpoints')
					.select(['id', 'parent_checkpoint_id', 'label'])
					.where('id', 'in', ['tx-cp-a', 'tx-cp-b'])
					.orderBy('id')
					.execute();
				expect(versions.map(version => version.label)).toEqual(['From A', 'From B']);
				expect(new Set(versions.map(version => version.parent_checkpoint_id)).size).toBe(1);
				expect(await db.selectFrom('transcriptions').select('id').execute()).toHaveLength(
					1
				);
			}
		} finally {
			await storeB.destroy();
		}
	});

	it('resolves concurrent note edits on one version by last write', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context: contextA } = await createConnectedProvider();
		const storeB = createLocalDbTestHarness();
		const storeOptionsB = { backend: new MemoryStoreBackend() };
		const contextB: SyncProjectContext = { ...contextA, connectionId: 'target-b' };
		const syncB = () =>
			backupProject(storeB.db, provider, contextB, { storeOptions: storeOptionsB });
		try {
			const archive = await listProjectArchiveFiles(harness.db, 'project-1', {
				storeOptions,
			});
			await importProjectFileTree(
				storeB.db,
				archive.map(file => ({ path: file.path, read: async () => file.content })),
				{ storeOptions: storeOptionsB }
			);
			await backupProject(harness.db, provider, contextA, syncOptions());
			await syncB();

			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date('2026-06-11T10:00:00.000Z'));
			await updateCollationVersionNote(
				harness.db,
				'col-1',
				'col-cp-1',
				'Note from A',
				storeOptions
			);
			vi.setSystemTime(new Date('2026-06-11T10:05:00.000Z'));
			await updateCollationVersionNote(
				storeB.db,
				'col-1',
				'col-cp-1',
				'Note from B',
				storeOptionsB
			);
			vi.useRealTimers();

			await backupProject(harness.db, provider, contextA, syncOptions());
			const resultB = await syncB();
			const resultA = await backupProject(harness.db, provider, contextA, syncOptions());

			for (const result of [resultA, resultB]) {
				expect(result.uiState).toBe('synced');
				expect(result.quarantines).toEqual([]);
			}
			for (const db of [harness.db, storeB.db]) {
				const [version] = await listCollationVersions(db, 'col-1');
				expect(version.note).toBe('Note from B');
			}
		} finally {
			vi.useRealTimers();
			await storeB.destroy();
		}
	});

	it('backs up Current without any version named', async () => {
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
			notes: 'Unnamed notes',
			updatedAt: '2026-06-10T13:05:00.000Z',
		});
		await saveCanonicalCollation(harness.db, storeOptions);
		await createTranscriptionWithFiles(
			harness.db,
			{
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
			},
			storeOptions
		);
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
			storeOptions
		);
		const { provider, context } = await createConnectedProvider();

		const result = await backupProject(harness.db, provider, context, syncOptions());

		expect(result.uiState).toBe('synced');
		expect(result.manifestUploaded).toBe(true);
		const projectSlug = await loadProjectStorageSlug('project-1');
		for (const [path, localPath] of [
			['collations/col-1.json', collationPrimaryFile(projectSlug, 'col-1')],
			['transcriptions/pt-1.json', transcriptionPrimaryFile(projectSlug, 'pt-1')],
		]) {
			const remote = await remoteFile(provider, context, path);
			if (!remote) throw new Error(`Expected remote ${path}.`);
			await expect(provider.downloadFile(remote.id)).resolves.toBe(
				await readTextFile(localPath, storeOptions)
			);
		}
		await expect(
			readTextFile(collationPrimaryFile(projectSlug, 'col-1'), storeOptions)
		).resolves.toContain('Unnamed notes');
	});

	it('ignores presence files in the remote and keeps them out of zip exports', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		await createTranscriptionWithFiles(
			harness.db,
			{
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
			},
			storeOptions
		);
		const { provider, context } = await createConnectedProvider();
		await backupProject(harness.db, provider, context, syncOptions());
		const presence = JSON.stringify({
			deviceId: 'device-2',
			deviceName: 'MacBook',
			author: 'Anna',
			accountId: null,
			documentId: 'pt-1',
			editedAt: '2026-06-10T12:00:00.000Z',
		});
		await provider.createFile(context.cloudFolderId, '.presence/pt-1/device-2.json', presence);
		await provider.createFile(
			context.cloudFolderId,
			'.presence/pt-1/device-3.json',
			'not json'
		);
		const projectSlug = await loadProjectStorageSlug('project-1');
		await writeTextFileAtomic(
			joinStorePath(projectFolder(projectSlug), '.presence/pt-1/device-1.json'),
			presence,
			storeOptions
		);
		provider.calls = [];

		const result = await backupProject(harness.db, provider, context, syncOptions());

		expect(result.uiState).toBe('synced');
		expect(result.quarantines).toEqual([]);
		expect(result.conflictCopyId).toBeUndefined();
		expect(result.hasConflictCopies).toBe(false);
		expect(result.downloadedPaths).toEqual([]);
		expect(result.uploadedPaths).toEqual([]);
		expect([...backend.files.keys()].filter(path => path.includes('device-2'))).toEqual([]);
		const archived = await listProjectArchiveFiles(harness.db, 'project-1', { storeOptions });
		expect(archived.map(file => file.path)).toContain('transcriptions/pt-1.json');
		expect(archived.filter(file => file.path.includes('.presence'))).toEqual([]);
		const exported = await exportProjectZip(harness.db, 'project-1', { storeOptions });
		expect(new TextDecoder().decode(exported.bytes)).not.toContain('.presence');
	});

	it('moves a project with its history between two locations and stops a second store from syncing it', async () => {
		const now = () => '2026-10-03T12:00:00.000Z';
		const destination = new MockCloudStorageProvider({ now });
		let destinationAtMarker: Map<string, string> | null = null;
		const source = new (class extends MockCloudStorageProvider {
			async createFile(folderId: string, path: string, content: string) {
				if (path === 'moved.json')
					destinationAtMarker = await snapshotContents(destination);
				return super.createFile(folderId, path, content);
			}
		})({ now });
		await ensureLocationMarker(source, source.rootFolderId, 'source-location', now());
		await ensureLocationMarker(destination, destination.rootFolderId, 'team-location', now());
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		await createTranscriptionWithFiles(
			harness.db,
			{
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
			},
			storeOptions
		);
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-1', label: 'Version 1' },
			storeOptions
		);
		const slug = await loadProjectStorageSlug('project-1');
		const placement = {
			projectId: 'project-1',
			locationId: 'source-location',
			folderName: slug,
			needsLocationChoice: false,
		};
		await upsertProjectPlacements([placement], storeOptions);
		expect(
			(
				await backupProject(
					harness.db,
					source,
					placementSyncContext(placement),
					syncOptions()
				)
			).uiState
		).toBe('synced');

		const storeB = createLocalDbTestHarness();
		const storeOptionsB = { backend: new MemoryStoreBackend() };
		try {
			await discoverLocationProjects(storeB.db, source, source.rootFolderId, {
				storeOptions: storeOptionsB,
			});
			await upsertProjectPlacements([placement], storeOptionsB);
			const syncB = () =>
				backupProject(storeB.db, source, placementSyncContext(placement), {
					storeOptions: storeOptionsB,
				});
			expect((await syncB()).uiState).toBe('synced');
			await createCommittedTranscriptionCheckpointWithFiles(
				storeB.db,
				{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-b', label: 'Unsynced B' },
				storeOptionsB
			);

			const archive = await listProjectArchiveFiles(harness.db, 'project-1', {
				storeOptions,
			});
			expect(archive.map(file => file.path)).toContain(
				'history/transcriptions/pt-1/tx-cp-1.json'
			);
			await moveProject(
				harness.db,
				{
					projectId: 'project-1',
					source: { provider: source, rootFolderId: source.rootFolderId, ...placement },
					destination: {
						provider: destination,
						rootFolderId: destination.rootFolderId,
						locationId: 'team-location',
						folderName: slug,
						label: 'Dropbox/Lab',
					},
					movedBy: 'Ada',
				},
				syncOptions({ now })
			);

			const expected = new Map(archive.map(file => [`${slug}/${file.path}`, file.content]));
			expect(destinationAtMarker).not.toBeNull();
			for (const [path, content] of expected) {
				expect(destinationAtMarker!.get(path)).toBe(content);
			}
			const sourceAfter = await snapshotContents(source);
			expect([...sourceAfter.keys()].filter(path => path.startsWith(`${slug}/`))).toEqual([
				`${slug}/moved.json`,
			]);
			expect(JSON.parse(sourceAfter.get(`${slug}/moved.json`)!)).toEqual({
				format: 'apatosaurus.moved',
				version: 1,
				moved_at: '2026-10-03T12:00:00.000Z',
				moved_by: 'Ada',
				destination_label: 'Dropbox/Lab',
			});
			expect(await listProjectPlacements(storeOptions)).toEqual([
				{ ...placement, locationId: 'team-location' },
			]);

			const resultB = await syncB();
			expect(resultB.moved).toEqual({
				movedAt: '2026-10-03T12:00:00.000Z',
				movedBy: 'Ada',
				destinationLabel: 'Dropbox/Lab',
			});
			expect(resultB.uploadedPaths).toEqual([]);
			expect(await snapshotContents(source)).toEqual(sourceAfter);
			expect(await listProjectPlacements(storeOptionsB)).toEqual([
				{
					projectId: 'project-1',
					locationId: null,
					folderName: null,
					needsLocationChoice: false,
					moved: resultB.moved,
				},
			]);
			const versionsB = await storeB.db
				.selectFrom('transcription_checkpoints')
				.select('label')
				.where('id', 'in', ['tx-cp-1', 'tx-cp-b'])
				.orderBy('label')
				.execute();
			expect(versionsB.map(version => version.label)).toEqual(['Unsynced B', 'Version 1']);
		} finally {
			await storeB.destroy();
		}
	});

	it('does not download a moved project again on its first sync at the destination', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const destination = new RecordingMockProvider({ now: () => '2026-10-03T12:00:00.000Z' });
		const slug = await loadProjectStorageSlug('project-1');
		const placement = {
			projectId: 'project-1',
			locationId: 'dropbox-location',
			folderName: slug,
			needsLocationChoice: false,
		};
		await moveProject(
			harness.db,
			{
				projectId: 'project-1',
				source: null,
				destination: {
					provider: destination,
					rootFolderId: destination.rootFolderId,
					locationId: placement.locationId,
					folderName: slug,
					label: 'Dropbox/Apatosaurus',
				},
				movedBy: 'Ada',
			},
			syncOptions()
		);
		destination.calls = [];

		const result = await backupProject(
			harness.db,
			destination,
			placementSyncContext(placement),
			syncOptions()
		);

		expect(result.uiState).toBe('synced');
		expect(result.uploadedPaths).toEqual([]);
		expect(destination.calls.filter(call => call.operation === 'download-file')).toEqual([]);
	});

	it('leaves the source intact and removes the partial destination when verification fails', async () => {
		const now = () => '2026-10-03T12:00:00.000Z';
		const source = new MockCloudStorageProvider({ now });
		const destination = new (class extends MockCloudStorageProvider {
			async downloadFile(fileId: string) {
				return `${await super.downloadFile(fileId)} `;
			}
		})({ now });
		await createCommittedProjectCollation('Notes', 'col-cp-1');
		const slug = await loadProjectStorageSlug('project-1');
		const placement = {
			projectId: 'project-1',
			locationId: 'source-location',
			folderName: slug,
			needsLocationChoice: false,
		};
		await upsertProjectPlacements([placement], storeOptions);
		await backupProject(harness.db, source, placementSyncContext(placement), syncOptions());
		const sourceBefore = await snapshotContents(source);

		await expect(
			moveProject(
				harness.db,
				{
					projectId: 'project-1',
					source: { provider: source, rootFolderId: source.rootFolderId, ...placement },
					destination: {
						provider: destination,
						rootFolderId: destination.rootFolderId,
						locationId: 'team-location',
						folderName: slug,
						label: 'Dropbox/Lab',
					},
					movedBy: 'Ada',
				},
				syncOptions({ now })
			)
		).rejects.toThrow(/could not verify/);

		expect(await snapshotContents(source)).toEqual(sourceBefore);
		expect([...(await snapshotContents(destination)).keys()]).toEqual([]);
		const folders = await destination.listFiles(destination.rootFolderId);
		expect(folders.entries).toEqual([]);
		expect(await listProjectPlacements(storeOptions)).toEqual([placement]);
	});

	it('creates a missing local default project folder before backing up', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
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
			setTimeout: ((_callback: () => void) =>
				1 as unknown as ReturnType<typeof setTimeout>) as typeof setTimeout,
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
	const provider = new RecordingMockProvider({ now: () => '2026-06-10T12:00:00.000Z' });
	const folderId = await provider.createFolder('Project');
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
	const provider = new LocalFolderStorageProvider(
		new FakeDirectoryHandle('root') as unknown as FileSystemDirectoryHandle
	);
	const appFolderId = await provider.createFolder('Apatosaurus');
	const projectsFolderId = await provider.createFolder('Projects', appFolderId);
	const folderId = await provider.createFolder('project-1', projectsFolderId);
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
		const remoteProject = await remoteHarness.db
			.selectFrom('projects')
			.select('storage_slug')
			.where('id', '=', 'project-1')
			.executeTakeFirstOrThrow();
		const history = await readTextFile(
			collationCheckpointFile(remoteProject.storage_slug, collationId, checkpointId),
			remoteStoreOptions
		);
		await provider.createFile(context.cloudFolderId, historyPath, history);
		const primary = await remoteFile(provider, context, `collations/${collationId}.json`);
		if (!primary) throw new Error('Expected remote primary file.');
		const remotePrimary = await readTextFile(
			collationPrimaryFile(remoteProject.storage_slug, collationId),
			remoteStoreOptions
		);
		await provider.updateFile(primary.id, remotePrimary, primary.revision);
		const manifest = await remoteFile(provider, context, 'project.json');
		const remoteManifest = await readTextFile(
			projectManifestFile(remoteProject.storage_slug),
			remoteStoreOptions
		);
		if (manifest) {
			await provider.updateFile(manifest.id, remoteManifest, manifest.revision);
		} else {
			await provider.createFile(context.cloudFolderId, 'project.json', remoteManifest);
		}
	} finally {
		await remoteHarness.destroy();
	}
}

async function quietDriveProject() {
	await createCommittedProjectCollation('Initial notes', 'col-cp-1');
	const api = new FakeGoogleDriveApi();
	const options = { tokens: api.tokens, fetch: api.fetch };
	const myDrive = new GoogleDriveStorageProvider({ ...options, driveRootId: 'root' });
	const driveRootId = await myDrive.folderDriveId(await myDrive.createFolder('Apatosaurus'));
	const connect = () => new GoogleDriveStorageProvider({ ...options, driveRootId });
	const context: SyncProjectContext = {
		projectId: 'project-1',
		connectionId: 'google-personal',
		cloudFolderId: 'Project',
		cloudFolderPath: 'Project',
	};
	let remoteCursor: string | undefined;
	const sync = async () => {
		const result = await backupProject(
			harness.db,
			connect(),
			context,
			syncOptions({ remoteCursor })
		);
		remoteCursor = result.remoteCursor;
		return result;
	};
	expect((await sync()).uiState).toBe('synced');
	api.calls = [];
	return { api, sync, context, connect };
}

function guardedExclusive() {
	let held = false;
	const violations: string[] = [];
	const exclusive = async <T>(work: () => Promise<T>): Promise<T> => {
		held = true;
		try {
			return await work();
		} finally {
			held = false;
		}
	};
	const guard = <P extends object>(provider: P): P =>
		new Proxy(provider, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (typeof value !== 'function') return value;
				return (...args: unknown[]) => {
					if (held) violations.push(String(property));
					return value.apply(target, args);
				};
			},
		});
	return { exclusive, guard, violations };
}

async function remoteFile(
	provider: CloudStorageProvider,
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

async function listRemoteFiles(
	provider: RecordingMockProvider,
	context: SyncProjectContext
): Promise<string[]> {
	const paths: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await provider.listFiles(context.cloudFolderId, { recursive: true, cursor });
		for (const entry of page.entries)
			if (!entry.isFolder) paths.push(relativeEntryPath(entry.path, context));
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return paths;
}

async function snapshotRemote(provider: RecordingMockProvider): Promise<string[]> {
	const entries: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await MockCloudStorageProvider.prototype.listFiles.call(
			provider,
			provider.rootFolderId,
			{ recursive: true, cursor }
		);
		entries.push(...page.entries.map(entry => `${entry.path}@${entry.revision}`));
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return entries.sort();
}

async function snapshotContents(provider: MockCloudStorageProvider): Promise<Map<string, string>> {
	const contents = new Map<string, string>();
	let cursor: string | undefined;
	do {
		const page = await MockCloudStorageProvider.prototype.listFiles.call(
			provider,
			provider.rootFolderId,
			{ recursive: true, cursor }
		);
		for (const entry of page.entries) {
			if (entry.isFolder || entry.name === 'apatosaurus-location.json') continue;
			contents.set(
				entry.path,
				await MockCloudStorageProvider.prototype.downloadFile.call(provider, entry.id)
			);
		}
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return contents;
}

async function listRootFiles(provider: DropboxStorageProvider): Promise<string[]> {
	const paths: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await provider.listFiles(provider.rootFolderId, { recursive: true, cursor });
		paths.push(...page.entries.filter(entry => !entry.isFolder).map(entry => entry.path));
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return paths;
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
