import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '$lib/client/db/test-harness';
import { createCollation, updateCollationMetadata } from '$lib/client/db/repositories/collations';
import {
	upsertCloudConnection,
	upsertCloudProjectFolder,
} from '$lib/client/db/repositories/cloud-connections';
import { createProject, syncProjectTranscriptionIds } from '$lib/client/db/repositories/projects';
import {
	createCommittedCollationCheckpoint,
	type CollationCheckpoint,
} from '$lib/client/db/repositories/revisions';
import { createTranscription } from '$lib/client/db/repositories/transcriptions';
import { createCollationTombstone } from './conflicts';
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
	syncProjectTombstones,
	type SyncProjectContext,
} from './sync-manager';

interface ProviderCall {
	operation: MockProviderOperation;
	path?: string;
}

let harness: LocalDbTestHarness;

beforeEach(() => {
	harness = createLocalDbTestHarness();
});

afterEach(async () => {
	await harness.destroy();
});

describe('sync manager', () => {
	it('creates a committed checkpoint and marks manual commits sync pending', async () => {
		const projectTranscriptionId = await createProjectTranscription();

		const result = await commitProjectTranscriptionForSync(harness.db, {
			projectTranscriptionId,
			checkpointId: 'tx-cp-1',
			commitMessage: 'Ready for sync',
			authorName: 'Editor',
			createdAt: '2026-06-10T12:00:00.000Z',
		});

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
			{ now: () => '2026-06-10T12:10:00.000Z' }
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
		const unchangedPoll = await pollOpenEntity(harness.db, provider, context, {
			entityType: 'collation',
			entityId: 'col-1',
		});

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
		await publishEntity(harness.db, provider, context, {
			entityType: 'collation',
			entityId: 'col-1',
		});

		await updateCollationMetadata(harness.db, {
			id: 'col-1',
			notes: 'Second committed notes',
			updatedAt: '2026-06-10T12:20:00.000Z',
		});
		const second = await createCommittedCollationCheckpoint(harness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-2',
			createdAt: '2026-06-10T12:21:00.000Z',
		});
		provider.failNext('conflict', 'update-file', 'Primary changed remotely.');

		const result = await publishEntity(harness.db, provider, context, {
			entityType: 'collation',
			entityId: 'col-1',
		});

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
		await publishEntity(harness.db, provider, context, {
			entityType: 'collation',
			entityId: 'col-1',
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

		const result = await pollOpenEntity(harness.db, provider, context, {
			entityType: 'collation',
			entityId: 'col-1',
		});

		expect(result.uiState).toBe('conflict requires resolution');
		expect(result.quarantines).toMatchObject([
			{ path: 'collations/col-1.json', code: 'hash_mismatch' },
		]);
		await expect(loadCollationNotes('col-1')).resolves.toBe('Initial notes');
	});

	it('preserves dirty local working rows as draft checkpoints when a remote update is available', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await publishEntity(harness.db, provider, context, {
			entityType: 'collation',
			entityId: 'col-1',
		});
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

		const result = await pollOpenEntity(
			harness.db,
			provider,
			context,
			{ entityType: 'collation', entityId: 'col-1' },
			{ authorName: 'Local Editor', now: () => '2026-06-10T12:31:00.000Z' }
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
		await publishEntity(harness.db, provider, context, {
			entityType: 'collation',
			entityId: 'col-1',
		});
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
		await createCommittedCollationCheckpoint(harness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-local',
			createdAt: '2026-06-10T12:41:00.000Z',
		});

		const result = await pollOpenEntity(
			harness.db,
			provider,
			context,
			{ entityType: 'collation', entityId: 'col-1' },
			{ authorName: 'Local Editor', now: () => '2026-06-10T12:42:00.000Z' }
		);

		expect(result.uiState).toBe('conflict requires resolution');
		expect(result.conflictCopyId).toBeTruthy();
		await expect(loadCollationNotes(result.conflictCopyId ?? '')).resolves.toBe(
			'Local committed notes'
		);
	});

	it('uploads local tombstones and deletes guarded remote primary files', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await publishEntity(harness.db, provider, context, {
			entityType: 'collation',
			entityId: 'col-1',
		});
		await createCollationTombstone(harness.db, {
			id: 'tombstone-col-1',
			entityId: 'col-1',
			deletedBy: 'editor@example.com',
			deletedAt: '2026-06-10T12:50:00.000Z',
		});

		const result = await syncProjectTombstones(harness.db, provider, context);

		expect(result.uploadedPaths).toContain('tombstones/tombstone-col-1.json');
		expect(result.deletedPaths).toContain('collations/col-1.json');
		expect(await remoteFile(provider, context, 'collations/col-1.json')).toBeNull();
		expect(
			await remoteFile(provider, context, 'tombstones/tombstone-col-1.json')
		).not.toBeNull();
	});

	it('backs up project entities before uploading the project manifest', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();

		const result = await backupProject(harness.db, provider, context, {
			now: () => '2026-06-10T13:00:00.000Z',
		});

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
		});

		expect(result.uiState).toBe('synced');
		expect(result.uploadedPaths).toEqual([
			'history/collations/col-1/col-cp-1.json',
			'collations/col-1.json',
			'project.json',
		]);
		await expect(provider.downloadFile('Apatosaurus/Projects/project-1/project.json')).resolves.toContain(
			'"id":"project-1"'
		);
		const listing = await provider.listFiles('Apatosaurus/Projects/project-1', { recursive: true });
		expect(listing.entries.map(entry => entry.path)).toEqual([
			'Apatosaurus/Projects/project-1/collations',
			'Apatosaurus/Projects/project-1/collations/col-1.json',
			'Apatosaurus/Projects/project-1/history',
			'Apatosaurus/Projects/project-1/history/collations',
			'Apatosaurus/Projects/project-1/history/collations/col-1',
			'Apatosaurus/Projects/project-1/history/collations/col-1/col-cp-1.json',
			'Apatosaurus/Projects/project-1/project.json',
		]);
	});

	it('backs up one project entity before updating the project manifest', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();

		const result = await backupProjectEntity(
			harness.db,
			provider,
			context,
			{ entityType: 'collation', entityId: 'col-1' },
			{ now: () => '2026-06-10T13:00:00.000Z' }
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

		const result = await backupProject(harness.db, provider, context);

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

		const result = await backupProject(harness.db, provider, context);

		expect(result.uiState).toBe('synced');
		await expect(provider.downloadFile('Apatosaurus/Projects/project-1/project.json')).resolves.toContain(
			'"id":"project-1"'
		);
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
		await backupProject(harness.db, provider, context);

		await expect(
			downloadAndCompareProjectManifest(harness.db, provider, context)
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
			downloadAndCompareProjectManifest(harness.db, provider, context)
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
		this.calls.push({ operation: 'delete-file' });
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
	return createCommittedCollationCheckpoint(harness.db, {
		collationId: 'col-1',
		checkpointId,
		createdAt: '2026-06-10T12:02:00.000Z',
	});
}

async function createProjectTranscription(): Promise<string> {
	await createProject(harness.db, { id: 'project-1', name: 'Project' });
	await createTranscription(harness.db, {
		id: 'tx-1',
		title: 'Witness 01',
		siglum: '01',
		document: documentWithVerses(['Romans 1:1']),
		transcriber: 'Editor',
		repository: 'Library',
		settlement: 'City',
		language: 'grc',
	});
	const [snapshotId] = await syncProjectTranscriptionIds(harness.db, 'project-1', ['tx-1']);
	const row = await harness.db
		.selectFrom('project_transcriptions')
		.select('id')
		.where('transcription_id', '=', snapshotId)
		.executeTakeFirstOrThrow();
	if (!row.id) throw new Error('Missing project transcription id.');
	return row.id;
}

async function pushRemoteCollationRevision(
	provider: RecordingMockProvider,
	context: SyncProjectContext,
	notes: string,
	checkpointId: string
): Promise<void> {
	const remoteHarness = createLocalDbTestHarness();
	try {
		await createProject(remoteHarness.db, { id: 'project-1', name: 'Project' });
		await createCollation(remoteHarness.db, {
			id: 'col-1',
			projectId: 'project-1',
			title: 'Romans 1:1',
			verseIdentifier: 'Romans 1:1',
			now: '2026-06-10T12:00:00.000Z',
		});
		await updateCollationMetadata(remoteHarness.db, {
			id: 'col-1',
			notes: 'Initial notes',
			updatedAt: '2026-06-10T12:01:00.000Z',
		});
		await createCommittedCollationCheckpoint(remoteHarness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-1',
			createdAt: '2026-06-10T12:02:00.000Z',
		});
		await updateCollationMetadata(remoteHarness.db, {
			id: 'col-1',
			notes,
			updatedAt: '2026-06-10T12:25:00.000Z',
		});
		await createCommittedCollationCheckpoint(remoteHarness.db, {
			collationId: 'col-1',
			checkpointId,
			createdAt: '2026-06-10T12:26:00.000Z',
		});
		const historyPath = `history/collations/col-1/${checkpointId}.json`;
		const history = await serializeCollationHistoryCloudFile(
			remoteHarness.db,
			'col-1',
			checkpointId
		);
		await provider.createFile(context.cloudFolderId, historyPath, serializeCloudFile(history));
		const primary = await remoteFile(provider, context, 'collations/col-1.json');
		if (!primary) throw new Error('Expected remote primary file.');
		const remotePrimary = await serializeCollationCloudFile(remoteHarness.db, 'col-1');
		await provider.updateFile(primary.id, serializeCloudFile(remotePrimary), primary.revision);
		const manifest = await remoteFile(provider, context, 'project.json');
		const remoteManifest = await serializeProjectCloudFile(remoteHarness.db, 'project-1');
		if (manifest) {
			await provider.updateFile(
				manifest.id,
				serializeCloudFile(remoteManifest),
				manifest.revision
			);
		} else {
			await provider.createFile(
				context.cloudFolderId,
				'project.json',
				serializeCloudFile(remoteManifest)
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
	const row = await harness.db
		.selectFrom('collations')
		.select('notes')
		.where('id', '=', collationId)
		.executeTakeFirst();
	return row?.notes;
}

function relativeEntryPath(path: string, context: SyncProjectContext): string {
	const root = context.cloudFolderPath ?? '';
	return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
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
