import {
	createCbgmAnalysisWithFiles,
	createTranscriptionWithFiles,
	createLocalDbTestHarness,
	type LocalDbTestHarness,
} from '$lib/testing/local-db-harness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/transcription/content';
import { createCollation, updateCollationMetadata } from '$lib/db/repositories/collations';
import { createProject as createProjectRepository } from '$lib/db/repositories/projects';
import type { CollationCheckpoint } from '$lib/db/repositories/revisions';
import {
	createCommittedCollationCheckpointWithFiles,
	loadCollationWithWorkingFile,
	saveWorkingCollationArtifact,
	saveWorkingCollationMetadata,
} from '$lib/db/repositories/collation-files';
import { createTranscription } from '$lib/db/repositories/transcriptions';
import { convertProjectToTei } from '$lib/db/repositories/tei-conversion';
import { rebuildIndexFromStore } from '$lib/db/repositories/index-rebuild';
import jsonProject from '$lib/storage/legacy-json/fixtures/json-project.json';
import {
	createCommittedTranscriptionCheckpointWithFiles,
	loadTranscriptionWithWorkingFile,
	saveWorkingTranscriptionContent,
} from '$lib/db/repositories/transcription-files';
import {
	deleteCbgmAnalysisWithFiles,
	deleteCollationWithFiles,
	deleteTranscriptionWithFiles,
} from '$lib/db/repositories/entity-deletion';
import {
	completeCoherence,
	listAnalyses as listCbgmAnalyses,
	readCache,
	setGlobalStemmaState,
} from '$lib/db/repositories/cbgm-analyses';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import type { StoreOperationOptions } from '$lib/storage/opfs-store';

import {
	readFileBytes,
	readTextFile,
	writeFileBytesAtomic,
	writeTextFileAtomic,
} from '$lib/storage/opfs-store';
import {
	cbgmAnalysisRelativeFiles,
	collationCheckpointTeiRelativeFile,
	collationTeiFile,
	joinStorePath,
	projectFolder,
	projectManifestFile,
	transcriptionTeiFile,
} from '$lib/storage/layout';
import { sealDocument, serializeSealedDocument } from '$lib/storage/envelope';
import { TOMBSTONE_CURRENT_VERSION, TOMBSTONE_FORMAT } from '$lib/storage/formats';
import { teiContentHash } from '$lib/storage/tei-content';
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
import {
	backupProject,
	listPendingUploadPaths,
	recordSyncedFile,
	type SyncManagerOptions,
} from './sync-manager';
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
			cloudPath: 'collations/col-1.tei.xml',
		});

		await harness.db
			.insertInto('sync_file_fingerprints')
			.values({
				target_id: context.connectionId,
				project_id: context.projectId,
				file_path: 'collations/col-1.tei.xml',
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
		expect(result.deletedPaths).toContain('collations/col-1.tei.xml');
		expect(await remoteFile(provider, context, 'collations/col-1.tei.xml')).toBeNull();
		expect(
			await remoteFile(provider, context, 'history/collations/col-1/col-cp-1.tei.xml')
		).toBeNull();
	});

	it('applies a remote tombstone, removes history, and heals an interrupted remote primary deletion', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		await backupProject(harness.db, provider, context, syncOptions());
		const tombstone = await sealDocument(TOMBSTONE_FORMAT, TOMBSTONE_CURRENT_VERSION, {
			id: 'remote-tombstone-col-1',
			project_id: 'project-1',
			entity_type: 'collation',
			entity_id: 'col-1',
			cloud_path: 'collations/col-1.tei.xml',
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
		expect(result.deletedPaths).toContain('collations/col-1.tei.xml');
		const projectSlug = await loadProjectStorageSlug('project-1');
		await expect(
			readTextFile(collationTeiFile(projectSlug, 'col-1'), storeOptions)
		).rejects.toThrow();
		await expect(
			readTextFile(
				joinStorePath(
					projectFolder(projectSlug),
					collationCheckpointTeiRelativeFile('col-1', 'col-cp-1')
				),
				storeOptions
			)
		).rejects.toThrow();
		await expect(
			harness.db
				.selectFrom('collations')
				.select('id')
				.where('id', '=', 'col-1')
				.executeTakeFirst()
		).resolves.toBeUndefined();
		expect(await remoteFile(provider, context, 'collations/col-1.tei.xml')).toBeNull();
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
		const file = (await remoteFile(other, context, 'collations/col-1.tei.xml'))!;
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
		expect(result.uploadedPaths).toContain('history/collations/col-1/col-cp-2.tei.xml');
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
				'history/collations/col-1/col-cp-b.tei.xml'
			);

			const pulled = await syncA();

			expect(pulled.uiState).toBe('synced');
			expect(pulled.downloadedPaths).toContain('history/collations/col-1/col-cp-b.tei.xml');
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
			'history/collations/col-1/col-cp-2.tei.xml'
		);

		const next = await backupProject(harness.db, provider, context, syncOptions());

		expect(next.uploadedPaths).toContain('history/collations/col-1/col-cp-2.tei.xml');
		expect(await listPendingUploadPaths(harness.db, context, storeOptions)).toEqual([]);
	});

	it('uploads a file whose size or modification time changed since its last sync', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		const hashedProjects = new Set<string>();
		const sync = () =>
			backupProject(harness.db, provider, context, syncOptions({ hashedProjects }));
		expect((await sync()).uiState).toBe('synced');
		expect(hashedProjects).toContain('project-1');

		rewriteStoredFile(
			'collations/col-1.tei.xml',
			text => text.replace('Romans', 'Ramons'),
			'touch'
		);
		rewriteStoredFile('history/collations/col-1/col-cp-1.tei.xml', text => `${text}\n`, 'keep');
		const result = await sync();

		expect(result.uiState).toBe('synced');
		expect(result.uploadedPaths).toEqual(
			expect.arrayContaining([
				'collations/col-1.tei.xml',
				'history/collations/col-1/col-cp-1.tei.xml',
			])
		);
		expect(await listPendingUploadPaths(harness.db, context, storeOptions, true)).toEqual([]);
	});

	it('does not read files whose size and modification time match their last sync', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		const hashedProjects = new Set<string>();
		const sync = () =>
			backupProject(harness.db, provider, context, syncOptions({ hashedProjects }));
		await sync();
		const synced = new Map(backend.lastModified);
		await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{
				collationId: 'col-1',
				checkpointId: 'col-cp-2',
				createdAt: '2026-06-10T12:03:00.000Z',
			},
			storeOptions
		);
		const unchanged = [...synced]
			.filter(([path, time]) => backend.lastModified.get(path) === time)
			.map(([path]) => path)
			.filter(path => !path.endsWith('/project.json'));
		expect(unchanged).toContain(storedPath('history/collations/col-1/col-cp-1.tei.xml'));
		const textReads = vi.spyOn(backend, 'readTextFile');
		const byteReads = vi.spyOn(backend, 'readFileBytes');

		const result = await sync();

		expect(result.uploadedPaths).toContain('history/collations/col-1/col-cp-2.tei.xml');
		const readPaths = [...textReads.mock.calls, ...byteReads.mock.calls].map(([path]) => path);
		expect(readPaths.filter(path => unchanged.includes(path))).toEqual([]);
		textReads.mockClear();
		byteReads.mockClear();
		expect(await listPendingUploadPaths(harness.db, context, storeOptions, true)).toEqual([]);
		expect(textReads).not.toHaveBeenCalled();
		expect(byteReads).not.toHaveBeenCalled();
	});

	it("hashes every file on a session's first sync, catching a change that kept size and time", async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		const { provider, context } = await createConnectedProvider();
		const firstSession = new Set<string>();
		expect(
			(
				await backupProject(
					harness.db,
					provider,
					context,
					syncOptions({ hashedProjects: firstSession })
				)
			).uiState
		).toBe('synced');

		rewriteStoredFile(
			'collations/col-1.tei.xml',
			text => text.replace('Romans', 'Ramons'),
			'keep'
		);
		const sameSession = await backupProject(
			harness.db,
			provider,
			context,
			syncOptions({ hashedProjects: firstSession })
		);
		const nextSession = await backupProject(
			harness.db,
			provider,
			context,
			syncOptions({ hashedProjects: new Set() })
		);

		expect(sameSession.uploadedPaths).not.toContain('collations/col-1.tei.xml');
		expect(nextSession.uploadedPaths).toContain('collations/col-1.tei.xml');
		const uploaded = await remoteFile(provider, context, 'collations/col-1.tei.xml');
		expect(await provider.downloadFile(uploaded!.id)).toContain('Ramons');
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
		const broken = (await remoteFile(provider, context, 'collations/col-1.tei.xml'))!;
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

	it('mirrors a binary CBGM cache byte for byte and downloads it again only when its revision changes', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
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
			const cacheA = joinStorePath(
				projectFolder(await loadProjectStorageSlug('project-1')),
				'cbgm/x.sqlite'
			);
			const cacheB = joinStorePath(projectFolder(imported.storageSlug), 'cbgm/x.sqlite');
			const syncB = () =>
				backupProject(storeB.db, provider, contextB, { storeOptions: storeOptionsB });
			const cache = binaryCache(4096, 1);
			await writeFileBytesAtomic(cacheA, cache, storeOptions);

			const pushA = await backupProject(harness.db, provider, contextA, syncOptions());
			expect(pushA.uploadedPaths).toContain('cbgm/x.sqlite');
			const remote = (await remoteFile(provider, contextA, 'cbgm/x.sqlite'))!;
			expect(remote.size).toBe(cache.byteLength);
			expect(await provider.downloadFileBytes(remote.id)).toEqual(cache);
			const pullB = await syncB();
			expect(pullB.uiState).toBe('synced');
			expect(pullB.downloadedPaths).toEqual(['cbgm/x.sqlite']);
			expect(await readFileBytes(cacheB, storeOptionsB)).toEqual(cache);

			provider.calls = [];
			const unchanged = await syncB();
			expect(unchanged.uiState).toBe('synced');
			expect(provider.calls.filter(call => call.operation === 'download-file')).toEqual([]);

			const recomputed = binaryCache(8192, 7);
			await writeFileBytesAtomic(cacheA, recomputed, storeOptions);
			expect(
				(await backupProject(harness.db, provider, contextA, syncOptions())).uploadedPaths
			).toEqual(['cbgm/x.sqlite']);
			provider.calls = [];
			const changed = await syncB();
			expect(changed.uiState).toBe('synced');
			expect(changed.downloadedPaths).toEqual(['cbgm/x.sqlite']);
			expect(provider.calls.filter(call => call.operation === 'download-file')).toHaveLength(
				1
			);
			expect(await readFileBytes(cacheB, storeOptionsB)).toEqual(recomputed);
		} finally {
			await storeB.destroy();
		}
	});

	it('deletes an analysis on a second store through its tombstone, sidecars included', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		await createCbgmAnalysisWithFiles(harness.db, 'project-1', {}, storeOptions);
		const cache = binaryCache(4096, 9);
		await completeCoherence(harness.db, 'project-1', 'analysis-1', cache, storeOptions);
		await setGlobalStemmaState(
			harness.db,
			'project-1',
			'analysis-1',
			'imported-dot',
			undefined,
			'digraph global {}',
			storeOptions
		);
		const { provider, context: contextA } = await createConnectedProvider();
		const contextB: SyncProjectContext = { ...contextA, connectionId: 'target-b' };
		const analysisPaths = Object.values(cbgmAnalysisRelativeFiles('analysis-1'));
		await backupProject(harness.db, provider, contextA, syncOptions());
		expect(await listRemoteFiles(provider, contextA)).toEqual(
			expect.arrayContaining(analysisPaths)
		);
		const storeB = createLocalDbTestHarness();
		const storeOptionsB = { backend: new MemoryStoreBackend() };
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
			const syncB = () =>
				backupProject(storeB.db, provider, contextB, { storeOptions: storeOptionsB });
			expect((await syncB()).uiState).toBe('synced');
			expect(await readCache(storeB.db, 'analysis-1', storeOptionsB)).toEqual(cache);

			await deleteCbgmAnalysisWithFiles(
				harness.db,
				'project-1',
				'analysis-1',
				{ tombstoneId: 'tombstone-analysis-1' },
				storeOptions
			);
			const pushA = await backupProject(harness.db, provider, contextA, syncOptions());
			expect(pushA.deletedPaths).toEqual(expect.arrayContaining(analysisPaths));
			await provider.createFile(contextA.cloudFolderId, 'cbgm/analysis-1.sqlite', cache);

			const pullB = await syncB();

			expect(pullB.uiState).toBe('synced');
			expect(pullB.downloadedPaths).toContain('tombstones/cbgm_analysis--analysis-1.json');
			expect(pullB.deletedPaths).toEqual(['cbgm/analysis-1.sqlite']);
			expect(await listCbgmAnalyses(storeB.db, 'project-1')).toEqual([]);
			expect(
				[...storeOptionsB.backend.files.keys()].filter(path => path.includes('/cbgm/'))
			).toEqual([]);
			expect(
				(await listRemoteFiles(provider, contextA)).filter(path => path.startsWith('cbgm/'))
			).toEqual([]);
			expect((await syncB()).uploadedPaths).toEqual([]);
		} finally {
			await storeB.destroy();
		}
	});

	it('keeps an analysis metadata and cache together when two stores both change it', async () => {
		await createCommittedProjectCollation('Initial notes', 'col-cp-1');
		await createCbgmAnalysisWithFiles(harness.db, 'project-1', {}, storeOptions);
		const { provider, context: contextA } = await createConnectedProvider();
		const contextB: SyncProjectContext = { ...contextA, connectionId: 'target-b' };
		const syncA = () => backupProject(harness.db, provider, contextA, syncOptions());
		await syncA();
		const storeB = createLocalDbTestHarness();
		const storeOptionsB = { backend: new MemoryStoreBackend() };
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
			const syncB = () =>
				backupProject(storeB.db, provider, contextB, { storeOptions: storeOptionsB });
			expect((await syncB()).uiState).toBe('synced');

			const cacheB = binaryCache(4096, 2);
			await completeCoherence(
				harness.db,
				'project-1',
				'analysis-1',
				binaryCache(4096, 1),
				storeOptions
			);
			await completeCoherence(storeB.db, 'project-1', 'analysis-1', cacheB, storeOptionsB);
			expect((await syncA()).uiState).toBe('synced');
			const pushB = await syncB();
			expect(pushB.quarantines).toEqual([]);
			expect(pushB.uploadedPaths).toEqual(
				expect.arrayContaining(['cbgm/analysis-1.json', 'cbgm/analysis-1.sqlite'])
			);
			expect((await syncA()).uiState).toBe('synced');
			expect(await readCache(harness.db, 'analysis-1', storeOptions)).toEqual(cacheB);

			await setGlobalStemmaState(
				harness.db,
				'project-1',
				'analysis-1',
				'ready',
				binaryCache(8192, 3),
				undefined,
				storeOptions
			);
			await setGlobalStemmaState(
				storeB.db,
				'project-1',
				'analysis-1',
				'computing',
				undefined,
				undefined,
				storeOptionsB
			);
			expect((await syncA()).uiState).toBe('synced');
			const markB = await syncB();
			expect(markB.quarantines).toEqual([]);
			expect(markB.uploadedPaths).toEqual(
				expect.arrayContaining(['cbgm/analysis-1.json', 'cbgm/analysis-1.sqlite'])
			);
			expect((await syncA()).uiState).toBe('synced');
			for (const [db, options] of [
				[harness.db, storeOptions],
				[storeB.db, storeOptionsB],
			] as const) {
				expect(await readCache(db, 'analysis-1', options)).toEqual(cacheB);
				expect(await listCbgmAnalyses(db, 'project-1')).toMatchObject([
					{ id: 'analysis-1', global_stemma: 'computing' },
				]);
			}
		} finally {
			await storeB.destroy();
		}
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
			'history/collations/col-1/col-cp-1.tei.xml',
			'collations/col-1.tei.xml',
			'project.json',
		]);
		expect(
			provider.calls.filter(call => call.operation === 'create-file').map(call => call.path)
		).toEqual([
			'history/collations/col-1/col-cp-1.tei.xml',
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
			'history/collations/col-1/col-cp-1.tei.xml',
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
			'Apatosaurus/Projects/project-1/collations/col-1.tei.xml',
			'Apatosaurus/Projects/project-1/history',
			'Apatosaurus/Projects/project-1/history/collations',
			'Apatosaurus/Projects/project-1/history/collations/col-1',
			'Apatosaurus/Projects/project-1/history/collations/col-1/col-cp-1.tei.xml',
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
			`transcriptions/${projectTranscriptionId}.tei.xml`
		);
		if (!remotePrimary) throw new Error('Expected remote transcription primary.');
		await expect(provider.downloadFile(remotePrimary.id)).resolves.toBe(
			await readTextFile(
				transcriptionTeiFile(projectSlug, projectTranscriptionId),
				storeOptions
			)
		);
		expect(
			await remoteFile(
				provider,
				context,
				`history/transcriptions/${projectTranscriptionId}/tx-cp-1.tei.xml`
			)
		).not.toBeNull();
		expect(
			(await listRemoteFiles(provider, context)).filter(
				path => path.includes(projectTranscriptionId) && path.endsWith('.json')
			)
		).toEqual([]);
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

		const result = await backupProject(harness.db, provider, context, {
			now: () => '2026-06-10T13:05:00.000Z',
			storeOptions,
		});

		expect(result.uiState).toBe('synced');
		expect(result.downloadedPaths).toContain('collations/col-1.tei.xml');
		expect(result.downloadedPaths).toContain('history/collations/col-1/col-cp-remote.tei.xml');
		await expect(loadCollationNotes('col-1')).resolves.toBe('Remote committed notes');
		const projectSlug = await loadProjectStorageSlug('project-1');
		const mirroredTei = await remoteFile(provider, context, 'collations/col-1.tei.xml');
		if (!mirroredTei) throw new Error('Expected remote TEI file.');
		await expect(provider.downloadFile(mirroredTei.id)).resolves.toBe(
			await readTextFile(collationTeiFile(projectSlug, 'col-1'), storeOptions)
		);
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
			.where('file_path', '=', 'collations/col-2.tei.xml')
			.execute();
		await provider.createFile(context.cloudFolderId, 'collations/corrupt.json', '{not-json');

		const result = await backupProject(harness.db, provider, context, syncOptions());

		expect(result.uiState).toBe('conflict requires resolution');
		expect(result.quarantines).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: 'collations/corrupt.json', code: 'invalid_shape' }),
				expect.objectContaining({
					path: 'collations/col-2.tei.xml',
					code: 'hash_mismatch',
				}),
			])
		);
		await expect(loadCollationNotes('col-1')).resolves.toBe('Accepted remote notes');
		expect(result.downloadedPaths).toEqual(
			expect.arrayContaining([
				'collations/col-1.tei.xml',
				'history/collations/col-1/col-cp-remote.tei.xml',
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
				'collations/col-1.tei.xml',
				'history/collations/col-1/col-cp-remote.tei.xml',
				'collations/col-2.tei.xml',
				'collations/corrupt.json',
			])
			.orderBy('file_path')
			.execute();
		expect(completedPaths).toEqual([
			{ file_path: 'collations/col-1.tei.xml' },
			{ file_path: 'collations/col-2.tei.xml' },
			{ file_path: 'history/collations/col-1/col-cp-remote.tei.xml' },
		]);
		await expect(loadCollationNotes('col-2')).resolves.toBe('Remote conflicting notes');
		await expect(
			harness.db
				.selectFrom('collations')
				.select(({ fn }) => fn.countAll<number>().as('count'))
				.executeTakeFirstOrThrow()
		).resolves.toEqual({ count: 3 });
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
		if (!remoteTei) throw new Error('Expected remote TEI file.');
		await expect(provider.downloadFile(remoteTei.id)).resolves.toBe(localTei);
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
			expect(pushA.uploadedPaths).toContain('transcriptions/pt-1.tei.xml');
			const pullB = await backupProject(storeB.db, provider, contextB, {
				storeOptions: storeOptionsB,
			});
			expect(pullB.downloadedPaths).toContain('collations/col-1.tei.xml');
			expect(pullB.downloadedPaths).toContain('transcriptions/pt-1.tei.xml');
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

	it('re-indexes only the changed TEI transcription after a pull', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		for (const n of [1, 2]) {
			await createTranscriptionWithFiles(
				harness.db,
				{
					id: `tx-${n}`,
					projectId: 'project-1',
					projectTranscriptionId: `pt-${n}`,
					title: `Witness 0${n}`,
					siglum: `0${n}`,
					document: documentWithVerses(['Romans 1:1']),
					transcriber: '',
					repository: '',
					settlement: '',
					language: 'grc',
				},
				storeOptions
			);
		}
		const { provider, context: contextA } = await createConnectedProvider();
		const storeB = createLocalDbTestHarness();
		const storeOptionsB = { backend: new MemoryStoreBackend() };
		const contextB: SyncProjectContext = { ...contextA, connectionId: 'target-b' };
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
			await backupProject(storeB.db, provider, contextB, { storeOptions: storeOptionsB });
			await saveWorkingTranscriptionContent(
				harness.db,
				{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
				storeOptions
			);
			await backupProject(harness.db, provider, contextA, syncOptions());
			// A full rebuild would restore this title from pt-2's file.
			await storeB.db
				.updateTable('transcriptions')
				.set({ title: 'Untouched index row' })
				.where('id', '=', 'tx-2')
				.execute();

			const pullB = await backupProject(storeB.db, provider, contextB, {
				storeOptions: storeOptionsB,
			});

			expect(pullB.downloadedPaths).toEqual(['transcriptions/pt-1.tei.xml']);
			expect(
				(await loadTranscriptionWithWorkingFile(storeB.db, 'tx-1', storeOptionsB))
					?.content_json
			).toContain('"verse":"2"');
			expect(
				await storeB.db
					.selectFrom('transcriptions')
					.select('title')
					.where('id', '=', 'tx-2')
					.executeTakeFirst()
			).toEqual({ title: 'Untouched index row' });
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
		const slug = await loadProjectStorageSlug('project-1');
		await writeFileBytesAtomic(
			joinStorePath(projectFolder(slug), 'cbgm/x.sqlite'),
			binaryCache(4096, 1),
			storeOptions
		);
		const placement = {
			projectId: 'project-1',
			locationId: marker.id,
			folderName: slug,
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
		expect(result.uploadedPaths).toContain('cbgm/x.sqlite');

		await expect(
			removeProjectsFromDevice(harness.db, [placement], storeOptions)
		).resolves.toEqual({ ok: true });
		expect([...backend.files.keys()].filter(path => path.includes(`/${slug}/`))).toEqual([]);
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
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1' },
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
			['collations/col-1.tei.xml', collationTeiFile(projectSlug, 'col-1')],
			['transcriptions/pt-1.tei.xml', transcriptionTeiFile(projectSlug, 'pt-1')],
		]) {
			const remote = await remoteFile(provider, context, path);
			if (!remote) throw new Error(`Expected remote ${path}.`);
			await expect(provider.downloadFile(remote.id)).resolves.toBe(
				await readTextFile(localPath, storeOptions)
			);
		}
		await expect(
			readTextFile(collationTeiFile(projectSlug, 'col-1'), storeOptions)
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
		expect(archived.map(file => file.path)).toContain('transcriptions/pt-1.tei.xml');
		expect(archived.filter(file => file.path.includes('.presence'))).toEqual([]);
		const exported = await exportProjectZip(harness.db, 'project-1', { storeOptions });
		expect(new TextDecoder().decode(exported.bytes)).not.toContain('.presence');
	});

	it('moves a project with its history between two locations and stops a second store from syncing it', async () => {
		const now = () => '2026-10-03T12:00:00.000Z';
		const destination = new MockCloudStorageProvider({ now });
		let destinationAtMarker: Map<string, string | Uint8Array> | null = null;
		const source = new (class extends MockCloudStorageProvider {
			async createFile(folderId: string, path: string, content: string | Uint8Array) {
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
		const cache = binaryCache(4096, 3);
		await createCbgmAnalysisWithFiles(harness.db, 'project-1', {}, storeOptions);
		await completeCoherence(harness.db, 'project-1', 'analysis-1', cache, storeOptions);
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
			expect(await listCbgmAnalyses(storeB.db, 'project-1')).toMatchObject([
				{ id: 'analysis-1', coherence: 'ready' },
			]);
			expect(await readCache(storeB.db, 'analysis-1', storeOptionsB)).toEqual(cache);
			await createCommittedTranscriptionCheckpointWithFiles(
				storeB.db,
				{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-b', label: 'Unsynced B' },
				storeOptionsB
			);

			const archive = await listProjectArchiveFiles(harness.db, 'project-1', {
				storeOptions,
			});
			expect(archive.map(file => file.path)).toEqual(
				expect.arrayContaining([
					'history/transcriptions/pt-1/tx-cp-1.tei.xml',
					'cbgm/analysis-1.json',
					'cbgm/analysis-1.input.xml',
					'cbgm/analysis-1.sqlite',
				])
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
				expect(destinationAtMarker!.get(path)).toEqual(content);
			}
			const sourceAfter = await snapshotContents(source);
			expect([...sourceAfter.keys()].filter(path => path.startsWith(`${slug}/`))).toEqual([
				`${slug}/moved.json`,
			]);
			expect(JSON.parse(sourceAfter.get(`${slug}/moved.json`) as string)).toEqual({
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
		await writeFileBytesAtomic(
			joinStorePath(projectFolder(slug), 'cbgm/x.sqlite'),
			binaryCache(4096, 5),
			storeOptions
		);
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

describe('sync manager with TEI-canonical transcriptions', () => {
	it('syncs the TEI primary byte for byte in both directions', async () => {
		const stores = await teiTranscriptionOnTwoStores();
		try {
			await saveWorkingTranscriptionContent(
				harness.db,
				{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
				storeOptions
			);
			const pushA = await stores.syncA();
			expect(pushA.uploadedPaths).toContain(TEI_PATH);
			const pullB = await stores.syncB();
			expect(pullB.downloadedPaths).toContain(TEI_PATH);
			const fromA = await stores.teiA();
			expect(await stores.remoteTei()).toBe(fromA);
			expect(await stores.teiB()).toBe(fromA);

			await saveWorkingTranscriptionContent(
				stores.storeB.db,
				{ id: 'tx-1', document: documentWithVerses(['Romans 1:3']) },
				stores.storeOptionsB
			);
			expect((await stores.syncB()).uploadedPaths).toContain(TEI_PATH);
			expect((await stores.syncA()).downloadedPaths).toContain(TEI_PATH);
			const fromB = await stores.teiB();
			expect(await stores.remoteTei()).toBe(fromB);
			expect(await stores.teiA()).toBe(fromB);
			expect(
				(await listRemoteFiles(stores.provider, stores.contextA)).filter(path =>
					path.startsWith('transcriptions/')
				)
			).toEqual([TEI_PATH]);
		} finally {
			await stores.storeB.destroy();
		}
	});

	it('takes the remote file without a conflict copy when two Currents differ only in save time', async () => {
		const stores = await teiTranscriptionOnTwoStores();
		try {
			const resave = async (
				db: LocalDbTestHarness['db'],
				options: StoreOperationOptions,
				updatedAt: string
			) => {
				const current = await loadTranscriptionWithWorkingFile(db, 'tx-1', options);
				await saveWorkingTranscriptionContent(
					db,
					{ id: 'tx-1', document: JSON.parse(current?.content_json ?? ''), updatedAt },
					options
				);
			};
			await resave(harness.db, storeOptions, '2026-06-11T09:00:00.000Z');
			await resave(stores.storeB.db, stores.storeOptionsB, '2026-06-11T09:05:00.000Z');
			const [teiA, teiB] = [await stores.teiA(), await stores.teiB()];
			expect(teiA).not.toBe(teiB);
			expect(await teiContentHash(teiA)).toBe(await teiContentHash(teiB));

			await stores.syncA();
			const resultB = await stores.syncB({ authorName: 'B editor' });

			expect(resultB.uiState).toBe('synced');
			expect(resultB.quarantines).toEqual([]);
			expect(resultB.conflictCopyId).toBeUndefined();
			expect(resultB.downloadedPaths).toContain(TEI_PATH);
			expect(await stores.teiB()).toBe(teiA);
			expect(
				await stores.storeB.db.selectFrom('project_transcriptions').select('id').execute()
			).toEqual([{ id: 'pt-1' }]);
		} finally {
			await stores.storeB.destroy();
		}
	});

	it('turns a real collision between two Currents into a TEI conflict copy', async () => {
		const stores = await teiTranscriptionOnTwoStores();
		try {
			await saveWorkingTranscriptionContent(
				harness.db,
				{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
				storeOptions
			);
			await saveWorkingTranscriptionContent(
				stores.storeB.db,
				{ id: 'tx-1', document: documentWithVerses(['Romans 1:3']) },
				stores.storeOptionsB
			);
			await stores.syncA();
			const conflictB = await stores.syncB({ authorName: 'B editor' });

			expect(conflictB.uiState).toBe('conflict requires resolution');
			const copyId = conflictB.conflictCopyId ?? '';
			expect(copyId).toBeTruthy();
			expect(conflictB.uploadedPaths).toContain(`transcriptions/${copyId}.tei.xml`);
			expect(await stores.teiB()).toBe(await stores.teiA());
			const contents = await stores.storeB.db
				.selectFrom('project_transcriptions')
				.innerJoin(
					'transcriptions',
					'transcriptions.id',
					'project_transcriptions.transcription_id'
				)
				.select(['project_transcriptions.id as id', 'transcriptions.content_json'])
				.orderBy('project_transcriptions.id')
				.execute();
			expect(contents).toHaveLength(2);
			const verseOf = (id: string) =>
				/"verse":"(\d+)"/.exec(
					contents.find(row => row.id === id)?.content_json ?? ''
				)?.[1];
			expect(verseOf('pt-1')).toBe('2');
			expect(verseOf(copyId)).toBe('3');
			expect((await stores.syncB()).uiState).toBe('synced');
		} finally {
			await stores.storeB.destroy();
		}
	});

	it('quarantines an unparseable remote Current and keeps the local file', async () => {
		const stores = await teiTranscriptionOnTwoStores();
		try {
			const file = await remoteFile(stores.provider, stores.contextA, TEI_PATH);
			const good = await stores.teiB();
			const broken = (await stores.remoteTei()).replace('</text>', '');
			expect(broken).not.toBe(good);
			await stores.provider.updateFile(file!.id, broken, file!.revision);

			const result = await stores.syncB();

			expect(result.downloadedPaths).not.toContain(TEI_PATH);
			expect(result.quarantines).toEqual([
				expect.objectContaining({ path: TEI_PATH, code: 'invalid_tei' }),
			]);
			expect(await stores.teiB()).toBe(good);
		} finally {
			await stores.storeB.destroy();
		}
	});

	it('does not sync a project with JSON heads until it is converted to TEI', async () => {
		for (const [path, content] of Object.entries(jsonProject as Record<string, string>))
			await writeTextFileAtomic(`projects/project-slug/${path}`, content, storeOptions);
		await rebuildIndexFromStore(harness.db, storeOptions);
		const { provider, context } = await createConnectedProvider();

		const pending = await backupProject(harness.db, provider, context, syncOptions());

		expect(pending).toMatchObject({
			uiState: 'sync pending',
			manifestUploaded: false,
			uploadedPaths: [],
		});
		expect(provider.calls).toEqual([]);

		expect(await convertProjectToTei(harness.db, 'project-1', storeOptions)).toMatchObject({
			status: 'converted',
		});
		const synced = await backupProject(harness.db, provider, context, syncOptions());

		expect(synced).toMatchObject({ uiState: 'synced', manifestUploaded: true });
		expect(
			(await listRemoteFiles(provider, context)).filter(path => !path.endsWith('.tei.xml'))
		).toEqual(['project.json']);
	});

	it('takes the remote edit without a conflict copy when a second store converts the shared JSON project', async () => {
		const stores = await jsonProjectOnTwoStores();
		try {
			expect(await convertProjectToTei(harness.db, 'project-1', storeOptions)).toMatchObject({
				status: 'converted',
			});
			const firstA = await stores.syncA();
			expect(firstA).toMatchObject({ uiState: 'synced', downloadedPaths: [] });
			expect(firstA.uploadedPaths).toContain(TEI_PATH);
			await saveWorkingTranscriptionContent(
				harness.db,
				{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
				storeOptions
			);
			expect((await stores.syncA()).uploadedPaths).toContain(TEI_PATH);
			expect(await stores.convertB()).toMatchObject({ status: 'converted' });

			const resultB = await stores.syncB();

			expect(resultB.quarantines).toEqual([]);
			expect(resultB.conflictCopyId).toBeUndefined();
			expect(resultB.downloadedPaths).toContain(TEI_PATH);
			expect(await stores.teiB()).toBe(await stores.teiA());
		} finally {
			await stores.storeB.destroy();
		}
	});

	it('still conflicts when the second store changed its JSON since the last sync before converting', async () => {
		const stores = await jsonProjectOnTwoStores();
		try {
			await convertProjectToTei(harness.db, 'project-1', storeOptions);
			await stores.syncA();
			await saveWorkingTranscriptionContent(
				harness.db,
				{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
				storeOptions
			);
			await stores.syncA();
			const jsonB = 'projects/project-slug/transcriptions/pt-1.json';
			await writeTextFileAtomic(
				jsonB,
				`${await readTextFile(jsonB, stores.storeOptionsB)}\n`,
				stores.storeOptionsB
			);
			expect(await stores.convertB()).toMatchObject({ status: 'converted' });

			const resultB = await stores.syncB({ authorName: 'B editor' });

			expect(resultB.quarantines).toEqual([
				expect.objectContaining({ path: TEI_PATH, code: 'hash_mismatch' }),
			]);
			expect(resultB.conflictCopyId).toBeTruthy();
		} finally {
			await stores.storeB.destroy();
		}
	});

	it('deletes a TEI transcription with its Versions from both stores through its tombstone', async () => {
		const stores = await teiTranscriptionOnTwoStores();
		const entityPath = /(^|\/)(transcriptions\/pt-1\.|history\/transcriptions\/pt-1\/)/;
		const storeFiles = (store: MemoryStoreBackend) =>
			[...store.files.keys()].filter(path => entityPath.test(path));
		try {
			expect(storeFiles(stores.backendB)).not.toEqual([]);
			await deleteTranscriptionWithFiles(harness.db, 'tx-1', {}, storeOptions);
			expect(storeFiles(backend)).toEqual([]);

			const pushA = await stores.syncA();
			expect(pushA.uploadedPaths).toContain('tombstones/project-transcription--pt-1.json');
			expect(pushA.deletedPaths).toContain(TEI_PATH);
			expect(pushA.deletedPaths).toContain('history/transcriptions/pt-1/tx-cp-1.tei.xml');
			const pullB = await stores.syncB();

			expect(pullB.uiState).toBe('synced');
			expect(storeFiles(stores.backendB)).toEqual([]);
			expect(storeFiles(backend)).toEqual([]);
			expect(
				(await listRemoteFiles(stores.provider, stores.contextA)).filter(path =>
					entityPath.test(path)
				)
			).toEqual([]);
			expect(
				await stores.storeB.db.selectFrom('transcriptions').select('id').execute()
			).toEqual([]);
			const tombstoneB = [...stores.backendB.files.entries()].find(([path]) =>
				path.endsWith('tombstones/project-transcription--pt-1.json')
			)?.[1];
			expect(JSON.parse(String(tombstoneB)).cloud_path).toBe(TEI_PATH);
		} finally {
			await stores.storeB.destroy();
		}
	});
});

describe('sync manager with TEI-canonical collations', () => {
	it('syncs the collation TEI byte for byte and re-indexes only it after a pull', async () => {
		const stores = await teiCollationOnTwoStores();
		try {
			await saveWorkingCollationMetadata(
				harness.db,
				{ id: 'col-1', notes: 'From A', updatedAt: '2026-06-11T09:00:00.000Z' },
				storeOptions
			);
			expect((await stores.syncA()).uploadedPaths).toContain(TEI_COLLATION_PATH);
			await stores.storeB.db
				.updateTable('projects')
				.set({ description: 'Untouched index row' })
				.execute();
			const pullB = await stores.syncB();
			expect(pullB.downloadedPaths).toEqual([TEI_COLLATION_PATH]);
			expect(await stores.teiB()).toBe(await stores.teiA());
			expect(await stores.remoteTei()).toBe(await stores.teiA());
			expect(
				(
					await loadCollationWithWorkingFile(
						stores.storeB.db,
						'col-1',
						stores.storeOptionsB
					)
				)?.row.notes
			).toBe('From A');
			expect(
				await stores.storeB.db.selectFrom('projects').select('description').execute()
			).toEqual([{ description: 'Untouched index row' }]);

			await saveWorkingCollationMetadata(
				stores.storeB.db,
				{ id: 'col-1', notes: 'From B', updatedAt: '2026-06-11T10:00:00.000Z' },
				stores.storeOptionsB
			);
			expect((await stores.syncB()).uploadedPaths).toContain(TEI_COLLATION_PATH);
			expect((await stores.syncA()).downloadedPaths).toContain(TEI_COLLATION_PATH);
			expect(await stores.teiA()).toBe(await stores.teiB());
			expect(
				(await listRemoteFiles(stores.provider, stores.contextA)).filter(path =>
					path.startsWith('collations/')
				)
			).toEqual([TEI_COLLATION_PATH]);
		} finally {
			await stores.storeB.destroy();
		}
	});

	it('takes the remote collation without a conflict copy when two Currents differ only in save time', async () => {
		const stores = await teiCollationOnTwoStores();
		try {
			await saveCanonicalCollation(
				harness.db,
				storeOptions,
				'Project',
				'col-1',
				'2026-06-11T09:00:00.000Z'
			);
			await saveCanonicalCollation(
				stores.storeB.db,
				stores.storeOptionsB,
				'Project',
				'col-1',
				'2026-06-11T09:05:00.000Z'
			);
			const [teiA, teiB] = [await stores.teiA(), await stores.teiB()];
			expect(teiA).not.toBe(teiB);
			expect(await teiContentHash(teiA)).toBe(await teiContentHash(teiB));

			await stores.syncA();
			const resultB = await stores.syncB({ authorName: 'B editor' });

			expect(resultB.uiState).toBe('synced');
			expect(resultB.quarantines).toEqual([]);
			expect(resultB.conflictCopyId).toBeUndefined();
			expect(resultB.downloadedPaths).toContain(TEI_COLLATION_PATH);
			expect(await stores.teiB()).toBe(teiA);
			expect(await stores.storeB.db.selectFrom('collations').select('id').execute()).toEqual([
				{ id: 'col-1' },
			]);
		} finally {
			await stores.storeB.destroy();
		}
	});

	it('turns a real collision between two collation Currents into a TEI conflict copy', async () => {
		const stores = await teiCollationOnTwoStores();
		try {
			await saveWorkingCollationMetadata(
				harness.db,
				{ id: 'col-1', notes: 'From A' },
				storeOptions
			);
			await saveWorkingCollationMetadata(
				stores.storeB.db,
				{ id: 'col-1', notes: 'From B' },
				stores.storeOptionsB
			);
			await stores.syncA();
			const conflictB = await stores.syncB({ authorName: 'B editor' });

			expect(conflictB.uiState).toBe('conflict requires resolution');
			const copyId = conflictB.conflictCopyId ?? '';
			expect(copyId).toBeTruthy();
			expect(conflictB.uploadedPaths).toContain(`collations/${copyId}.tei.xml`);
			expect(
				conflictB.uploadedPaths.some(
					path => path.endsWith('.json') && path.startsWith('collations/')
				)
			).toBe(false);
			expect(await stores.teiB()).toBe(await stores.teiA());
			const notes = await stores.storeB.db
				.selectFrom('collations')
				.select(['id', 'notes'])
				.orderBy('id')
				.execute();
			expect(notes).toHaveLength(2);
			expect(notes.find(row => row.id === 'col-1')?.notes).toBe('From A');
			expect(notes.find(row => row.id === copyId)?.notes).toBe('From B');
			expect((await stores.syncB()).uiState).toBe('synced');
		} finally {
			await stores.storeB.destroy();
		}
	});

	it('deletes a TEI collation with its Versions from both stores through its tombstone', async () => {
		const stores = await teiCollationOnTwoStores();
		const entityPath = /(^|\/)(collations\/col-1\.|history\/collations\/col-1\/)/;
		const storeFiles = (store: MemoryStoreBackend) =>
			[...store.files.keys()].filter(path => entityPath.test(path));
		try {
			expect(storeFiles(stores.backendB)).not.toEqual([]);
			await deleteCollationWithFiles(harness.db, 'col-1', {}, storeOptions);
			expect(storeFiles(backend)).toEqual([]);

			const pushA = await stores.syncA();
			expect(pushA.uploadedPaths).toContain('tombstones/collation--col-1.json');
			expect(pushA.deletedPaths).toContain(TEI_COLLATION_PATH);
			expect(pushA.deletedPaths).toContain('history/collations/col-1/col-cp-1.tei.xml');
			const pullB = await stores.syncB();

			expect(pullB.uiState).toBe('synced');
			expect(storeFiles(stores.backendB)).toEqual([]);
			expect(
				(await listRemoteFiles(stores.provider, stores.contextA)).filter(path =>
					entityPath.test(path)
				)
			).toEqual([]);
			expect(await stores.storeB.db.selectFrom('collations').select('id').execute()).toEqual(
				[]
			);
			const tombstoneB = [...stores.backendB.files.entries()].find(([path]) =>
				path.endsWith('tombstones/collation--col-1.json')
			)?.[1];
			expect(JSON.parse(String(tombstoneB)).cloud_path).toBe(TEI_COLLATION_PATH);
		} finally {
			await stores.storeB.destroy();
		}
	});
});

const TEI_COLLATION_PATH = 'collations/col-1.tei.xml';

async function createTeiCollation(): Promise<void> {
	await createCollation(harness.db, {
		id: 'col-1',
		projectId: 'project-1',
		title: 'Romans 1:1',
		verseIdentifier: 'Romans 1:1',
		now: '2026-06-10T12:00:00.000Z',
	});
	await saveCanonicalCollation(harness.db, storeOptions, 'Project', 'col-1');
	await createCommittedCollationCheckpointWithFiles(
		harness.db,
		{ collationId: 'col-1', checkpointId: 'col-cp-1', createdAt: '2026-06-10T12:02:00.000Z' },
		storeOptions
	);
}

async function teiCollationOnTwoStores() {
	await createProject(harness.db, { id: 'project-1', name: 'Project' });
	await createTeiCollation();
	const { provider, context: contextA } = await createConnectedProvider();
	const storeB = createLocalDbTestHarness();
	const backendB = new MemoryStoreBackend();
	const storeOptionsB = { backend: backendB };
	const contextB: SyncProjectContext = { ...contextA, connectionId: 'target-b' };
	const archive = await listProjectArchiveFiles(harness.db, 'project-1', { storeOptions });
	const imported = await importProjectFileTree(
		storeB.db,
		archive.map(file => ({ path: file.path, read: async () => file.content })),
		{ storeOptions: storeOptionsB }
	);
	expect(imported.ok).toBe(true);
	const syncA = () => backupProject(harness.db, provider, contextA, syncOptions());
	const syncB = (options: SyncManagerOptions = {}) =>
		backupProject(storeB.db, provider, contextB, { ...options, storeOptions: storeOptionsB });
	const projectSlug = await loadProjectStorageSlug('project-1');
	const slugB = (
		await storeB.db.selectFrom('projects').select('storage_slug').executeTakeFirstOrThrow()
	).storage_slug;
	await syncA();
	expect((await syncB()).uiState).toBe('synced');
	return {
		provider,
		contextA,
		storeB,
		backendB,
		storeOptionsB,
		syncA,
		syncB,
		teiA: () => readTextFile(collationTeiFile(projectSlug, 'col-1'), storeOptions),
		teiB: () => readTextFile(collationTeiFile(slugB, 'col-1'), storeOptionsB),
		remoteTei: async () => {
			const file = await remoteFile(provider, contextA, TEI_COLLATION_PATH);
			if (!file) throw new Error('Expected remote TEI primary.');
			return provider.downloadFile(file.id);
		},
	};
}

const TEI_PATH = 'transcriptions/pt-1.tei.xml';

async function createTeiTranscription(): Promise<void> {
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
		{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-1' },
		storeOptions
	);
}

async function teiTranscriptionOnTwoStores() {
	await createProject(harness.db, { id: 'project-1', name: 'Project' });
	await createTeiTranscription();
	const { provider, context: contextA } = await createConnectedProvider();
	const storeB = createLocalDbTestHarness();
	const backendB = new MemoryStoreBackend();
	const storeOptionsB = { backend: backendB };
	const contextB: SyncProjectContext = { ...contextA, connectionId: 'target-b' };
	const archive = await listProjectArchiveFiles(harness.db, 'project-1', { storeOptions });
	const imported = await importProjectFileTree(
		storeB.db,
		archive.map(file => ({ path: file.path, read: async () => file.content })),
		{ storeOptions: storeOptionsB }
	);
	expect(imported.ok).toBe(true);
	const syncA = () => backupProject(harness.db, provider, contextA, syncOptions());
	const syncB = (options: SyncManagerOptions = {}) =>
		backupProject(storeB.db, provider, contextB, { ...options, storeOptions: storeOptionsB });
	const projectSlug = await loadProjectStorageSlug('project-1');
	const slugB = (
		await storeB.db.selectFrom('projects').select('storage_slug').executeTakeFirstOrThrow()
	).storage_slug;
	await syncA();
	expect((await syncB()).uiState).toBe('synced');
	return {
		provider,
		contextA,
		storeB,
		backendB,
		storeOptionsB,
		syncA,
		syncB,
		teiA: () => readTextFile(transcriptionTeiFile(projectSlug, 'pt-1'), storeOptions),
		teiB: () => readTextFile(transcriptionTeiFile(slugB, 'pt-1'), storeOptionsB),
		remoteTei: async () => {
			const file = await remoteFile(provider, contextA, TEI_PATH);
			if (!file) throw new Error('Expected remote TEI primary.');
			return provider.downloadFile(file.id);
		},
	};
}

// Both stores and the remote hold the JSON project as a build before TEI conversion synced it.
async function jsonProjectOnTwoStores() {
	const files = Object.entries(jsonProject as Record<string, string>);
	const storeB = createLocalDbTestHarness();
	const backendB = new MemoryStoreBackend();
	const storeOptionsB = { backend: backendB };
	const { provider, context: contextA } = await createConnectedProvider();
	const contextB: SyncProjectContext = { ...contextA, connectionId: 'target-b' };
	for (const [path, content] of files) {
		const storePath = `projects/project-slug/${path}`;
		await writeTextFileAtomic(storePath, content, storeOptions);
		await writeTextFileAtomic(storePath, content, storeOptionsB);
	}
	await rebuildIndexFromStore(harness.db, storeOptions);
	await rebuildIndexFromStore(storeB.db, storeOptionsB);
	for (const [path, content] of files) {
		const remote = {
			...(await provider.createFile(contextA.cloudFolderId, path, content)),
			name: path.split('/').pop()!,
			isFolder: false,
		};
		const file = { path, storePath: `projects/project-slug/${path}`, content };
		const syncedAt = '2026-06-01T00:00:00.000Z';
		await recordSyncedFile(harness.db, contextA, file, remote, syncedAt);
		await recordSyncedFile(storeB.db, contextB, file, remote, syncedAt);
	}
	return {
		storeB,
		storeOptionsB,
		syncA: () => backupProject(harness.db, provider, contextA, syncOptions()),
		syncB: (options: SyncManagerOptions = {}) =>
			backupProject(storeB.db, provider, contextB, {
				...options,
				storeOptions: storeOptionsB,
			}),
		convertB: () => convertProjectToTei(storeB.db, 'project-1', storeOptionsB),
		teiA: () => readTextFile(transcriptionTeiFile('project-slug', 'pt-1'), storeOptions),
		teiB: () => readTextFile(transcriptionTeiFile('project-slug', 'pt-1'), storeOptionsB),
	};
}

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

	async downloadFileBytes(fileId: string): Promise<Uint8Array> {
		this.calls.push({ operation: 'download-file' });
		return super.downloadFileBytes(fileId);
	}

	async createFile(
		folderId: string,
		path: string,
		content: string | Uint8Array
	): Promise<CloudWriteResult> {
		this.calls.push({ operation: 'create-file', path });
		return super.createFile(folderId, path, content);
	}

	async updateFile(
		fileId: string,
		content: string | Uint8Array,
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
	collationId = 'col-1',
	now = '2026-06-10T12:01:00.000Z'
): Promise<void> {
	const document = structuredClone(COLLATION_FIXTURE.document);
	document.meta.projectName = projectName;
	await saveWorkingCollationArtifact(
		db,
		{
			collationId,
			artifactType: 'collation_document_v1',
			payload: JSON.stringify(document),
			now,
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
		const historyPath = `history/collations/${collationId}/${checkpointId}.tei.xml`;
		const remoteProject = await remoteHarness.db
			.selectFrom('projects')
			.select('storage_slug')
			.where('id', '=', 'project-1')
			.executeTakeFirstOrThrow();
		const history = await readTextFile(
			joinStorePath(
				projectFolder(remoteProject.storage_slug),
				collationCheckpointTeiRelativeFile(collationId, checkpointId)
			),
			remoteStoreOptions
		);
		await provider.createFile(context.cloudFolderId, historyPath, history);
		const primary = await remoteFile(provider, context, `collations/${collationId}.tei.xml`);
		if (!primary) throw new Error('Expected remote primary file.');
		const remotePrimary = await readTextFile(
			collationTeiFile(remoteProject.storage_slug, collationId),
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

async function snapshotContents(
	provider: MockCloudStorageProvider
): Promise<Map<string, string | Uint8Array>> {
	const contents = new Map<string, string | Uint8Array>();
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
				entry.name.endsWith('.sqlite')
					? await MockCloudStorageProvider.prototype.downloadFileBytes.call(
							provider,
							entry.id
						)
					: await MockCloudStorageProvider.prototype.downloadFile.call(provider, entry.id)
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

function binaryCache(length: number, step: number): Uint8Array {
	return Uint8Array.from({ length }, (_, index) => (index * step) % 256);
}

function storedPath(relativePath: string): string {
	const path = [...backend.files.keys()].find(path => path.endsWith(`/${relativePath}`));
	if (!path) throw new Error(`No stored file ends with ${relativePath}.`);
	return path;
}

/** Edits a stored file in place, keeping or advancing its modification time. */
function rewriteStoredFile(
	relativePath: string,
	edit: (text: string) => string,
	time: 'keep' | 'touch'
): void {
	const path = storedPath(relativePath);
	const content = backend.files.get(path)!;
	const next = edit(typeof content === 'string' ? content : new TextDecoder().decode(content));
	expect(next).not.toBe(content);
	backend.files.set(path, next);
	if (time === 'touch') backend.touch(path);
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
