import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '$lib/client/db/test-harness';
import { createCollation } from '$lib/client/db/repositories/collations';
import {
	upsertCloudConnection,
	upsertCloudProjectFolder,
} from '$lib/client/db/repositories/cloud-connections';
import { createProject, syncProjectTranscriptionIds } from '$lib/client/db/repositories/projects';
import { removeLocalProject } from '$lib/client/db/repositories/project-removal';
import { buildTranscriptionHashPayload } from '$lib/client/db/repositories/revisions';
import {
	createCommittedCollationCheckpointWithFiles,
	saveWorkingCollationArtifact,
} from '$lib/client/db/repositories/collation-files';
import { createCommittedTranscriptionCheckpointWithFiles } from '$lib/client/db/repositories/transcription-files';
import { MemoryStoreBackend } from '$lib/client/store/memory-store-backend.spec-support';
import { COLLATION_FIXTURE } from '$lib/client/store';
import { hashCanonicalPayload } from './canonical-json';
import { createTranscription } from '$lib/client/db/repositories/transcriptions';
import {
	parseCollationCloudFile,
	parseHistoryCloudFile,
	parseProjectCloudFile,
	parseProjectTranscriptionCloudFile,
	projectRelativeCloudPaths,
	serializeCloudFile,
	serializeCollationCloudFile,
	serializeCollationHistoryCloudFile,
	serializeProjectCloudFile,
	serializeProjectTranscriptionCloudFile,
	serializeProjectTranscriptionHistoryCloudFile,
	serializeTombstoneCloudFile,
	type CollationHistoryCloudFile,
	type ProjectTranscriptionHistoryCloudFile,
} from './cloud-files';
import {
	compareRemoteManifestToLocalProject,
	importCloudProject,
	listCloudProjectCandidates,
	pollLinkedProjectManifest,
	pullLinkedProjectUpdates,
} from './project-restore';
import { FakeDirectoryHandle } from './providers/fake-file-system-access.spec-support';
import { LocalFolderStorageProvider } from './providers/local-folder-provider';
import { MockCloudStorageProvider } from './providers/mock-provider';
import type { CloudStorageProvider } from './providers/provider';

let harness: LocalDbTestHarness;

beforeEach(() => {
	harness = createLocalDbTestHarness();
});

afterEach(async () => {
	await harness.destroy();
});

describe('cloud project browser restore candidates', () => {
	it('finds valid cloud project manifests under the provider root', async () => {
		const provider = new MockCloudStorageProvider({ now: () => '2026-06-10T12:00:00.000Z' });
		const projectFolderId = await provider.createFolder('Project One');
		await provider.createFile(
			projectFolderId,
			'project.json',
			await projectManifest('project-1')
		);

		const candidates = await listCloudProjectCandidates(
			harness.db,
			provider,
			'conn-1',
			provider.rootFolderId
		);

		expect(candidates).toMatchObject([
			{
				connectionId: 'conn-1',
				folderId: projectFolderId,
				folderPath: 'Project One',
				projectId: 'project-1',
				name: 'Project project-1',
				classification: 'not-local',
				quarantines: [],
				manifestRevision: 'rev-1',
			},
		]);
	});

	it('classifies existing local project folder links', async () => {
		await createCloudConnection();
		await createProject(harness.db, { id: 'project-1', name: 'Local Project' });
		const provider = new MockCloudStorageProvider({ now: () => '2026-06-10T12:00:00.000Z' });
		const projectFolderId = await provider.createFolder('Project One');
		await provider.createFile(
			projectFolderId,
			'project.json',
			await projectManifest('project-1')
		);

		await expect(
			listCloudProjectCandidates(harness.db, provider, 'conn-1', provider.rootFolderId)
		).resolves.toMatchObject([{ classification: 'local-same-id-unlinked' }]);

		await upsertCloudProjectFolder(harness.db, {
			projectId: 'project-1',
			connectionId: 'conn-1',
			cloudFolderId: projectFolderId,
			cloudFolderPath: 'Project One',
		});

		await expect(
			listCloudProjectCandidates(harness.db, provider, 'conn-1', provider.rootFolderId)
		).resolves.toMatchObject([{ classification: 'already-linked' }]);
	});

	it('classifies same-ID projects linked to a different cloud folder as conflicts', async () => {
		await createCloudConnection();
		await createProject(harness.db, { id: 'project-1', name: 'Local Project' });
		const provider = new MockCloudStorageProvider({ now: () => '2026-06-10T12:00:00.000Z' });
		const projectFolderId = await provider.createFolder('Project One');
		await provider.createFile(
			projectFolderId,
			'project.json',
			await projectManifest('project-1')
		);
		await upsertCloudProjectFolder(harness.db, {
			projectId: 'project-1',
			connectionId: 'conn-1',
			cloudFolderId: 'other-folder',
			cloudFolderPath: 'Other Project',
		});

		const candidates = await listCloudProjectCandidates(
			harness.db,
			provider,
			'conn-1',
			provider.rootFolderId
		);

		expect(candidates).toMatchObject([{ classification: 'local-conflict' }]);
	});

	it('quarantines invalid project manifests without failing discovery', async () => {
		const provider = new MockCloudStorageProvider({ now: () => '2026-06-10T12:00:00.000Z' });
		const projectFolderId = await provider.createFolder('Broken Project');
		await provider.createFile(projectFolderId, 'project.json', '{not-json');

		const candidates = await listCloudProjectCandidates(
			harness.db,
			provider,
			'conn-1',
			provider.rootFolderId
		);

		expect(candidates).toMatchObject([
			{
				folderId: projectFolderId,
				folderPath: 'Broken Project',
				classification: 'quarantined',
				quarantines: [{ path: 'Broken Project/project.json', code: 'invalid_json' }],
			},
		]);
	});

	it('returns an unavailable candidate when provider listing fails', async () => {
		const provider = new MockCloudStorageProvider();
		provider.failNext('provider-unavailable', 'list-files', 'Provider is down.');

		const candidates = await listCloudProjectCandidates(
			harness.db,
			provider,
			'conn-1',
			provider.rootFolderId
		);

		expect(candidates).toEqual([
			expect.objectContaining({
				folderId: provider.rootFolderId,
				classification: 'unavailable',
				providerError: 'provider-unavailable',
				providerMessage: 'Provider is down.',
			}),
		]);
	});
});

describe('cloud project import', () => {
	it('browses and imports project backups from a local folder provider layout', async () => {
		await createCloudConnection({ providerId: 'local-folder', accountEmail: 'Local folder' });
		const provider = new LocalFolderStorageProvider(
			new FakeDirectoryHandle('root') as unknown as FileSystemDirectoryHandle
		);
		const appFolderId = await provider.createFolder('Apatosaurus');
		const projectsFolderId = await provider.createFolder('Projects', appFolderId);
		const remote = await createRemoteProjectBackup(provider, 'project-local-restore', {
			parentFolderId: projectsFolderId,
			folderName: 'project-local-restore',
		});

		const candidates = await listCloudProjectCandidates(
			harness.db,
			provider,
			'conn-1',
			projectsFolderId
		);
		expect(candidates).toMatchObject([
			{
				classification: 'not-local',
				folderId: remote.folderId,
				folderPath: 'Apatosaurus/Projects/project-local-restore',
				projectId: 'project-local-restore',
			},
		]);

		const result = await importCloudProject(harness.db, provider, {
			connectionId: 'conn-1',
			folderId: remote.folderId,
			folderPath: 'Apatosaurus/Projects/project-local-restore',
			mode: 'create-local',
		});

		expect(result).toMatchObject({
			projectId: 'project-local-restore',
			projectTranscriptionIds: [remote.projectTranscriptionId],
			collationIds: [remote.collationId],
			quarantines: [],
		});
		await expect(
			harness.db
				.selectFrom('cloud_project_folders')
				.select(['project_id', 'connection_id', 'cloud_folder_id', 'cloud_folder_path'])
				.where('project_id', '=', 'project-local-restore')
				.executeTakeFirst()
		).resolves.toMatchObject({
			project_id: 'project-local-restore',
			connection_id: 'conn-1',
			cloud_folder_id: remote.folderId,
			cloud_folder_path: 'Apatosaurus/Projects/project-local-restore',
		});
	});

	it('restores a local-folder project after removing the local copy', async () => {
		await createCloudConnection({ providerId: 'local-folder', accountEmail: 'Local folder' });
		const provider = new LocalFolderStorageProvider(
			new FakeDirectoryHandle('root') as unknown as FileSystemDirectoryHandle
		);
		const appFolderId = await provider.createFolder('Apatosaurus');
		const projectsFolderId = await provider.createFolder('Projects', appFolderId);
		const remote = await createRemoteProjectBackup(provider, 'project-remove-restore', {
			parentFolderId: projectsFolderId,
			folderName: 'project-remove-restore',
		});

		await importCloudProject(harness.db, provider, {
			connectionId: 'conn-1',
			folderId: remote.folderId,
			folderPath: 'Apatosaurus/Projects/project-remove-restore',
			mode: 'create-local',
		});

		const removal = await removeLocalProject(harness.db, {
			projectId: 'project-remove-restore',
			connectionId: 'conn-1',
		});

		expect(removal).toMatchObject({
			projectId: 'project-remove-restore',
			removedProjectTranscriptions: 1,
			removedProjectOwnedTranscriptions: 1,
			removedCollations: 1,
		});
		await expect(
			harness.db
				.selectFrom('projects')
				.select('id')
				.where('id', '=', 'project-remove-restore')
				.executeTakeFirst()
		).resolves.toBeUndefined();

		const candidates = await listCloudProjectCandidates(
			harness.db,
			provider,
			'conn-1',
			projectsFolderId
		);
		expect(candidates).toMatchObject([
			{
				classification: 'not-local',
				folderId: remote.folderId,
				projectId: 'project-remove-restore',
			},
		]);

		await expect(
			importCloudProject(harness.db, provider, {
				connectionId: 'conn-1',
				folderId: remote.folderId,
				folderPath: 'Apatosaurus/Projects/project-remove-restore',
				mode: 'create-local',
			})
		).resolves.toMatchObject({
			projectId: 'project-remove-restore',
			projectTranscriptionIds: [remote.projectTranscriptionId],
			collationIds: [remote.collationId],
			quarantines: [],
		});
		await expect(
			harness.db
				.selectFrom('collations')
				.select(['id', 'project_id'])
				.where('id', '=', remote.collationId)
				.executeTakeFirst()
		).resolves.toEqual({ id: remote.collationId, project_id: 'project-remove-restore' });
	});

	it('imports project metadata, project transcription primary, history, folder link, and sync metadata', async () => {
		await createCloudConnection();
		const provider = new MockCloudStorageProvider({ now: () => '2026-06-10T12:00:00.000Z' });
		const remote = await createRemoteProjectBackup(provider, 'project-restore-1');

		const result = await importCloudProject(harness.db, provider, {
			connectionId: 'conn-1',
			folderId: remote.folderId,
			folderPath: 'Restored Project',
			mode: 'create-local',
		});

		expect(result).toEqual({
			projectId: 'project-restore-1',
			projectTranscriptionIds: [remote.projectTranscriptionId],
			collationIds: [remote.collationId],
			tombstoneIds: [remote.tombstoneId],
			quarantines: [],
		});
		await expect(
			harness.db
				.selectFrom('projects')
				.select(['id', 'name', 'description'])
				.where('id', '=', 'project-restore-1')
				.executeTakeFirst()
		).resolves.toMatchObject({
			id: 'project-restore-1',
			name: 'Remote Restored Project',
			description: 'Backed up project.',
		});
		await expect(
			harness.db
				.selectFrom('project_transcriptions')
				.selectAll()
				.where('id', '=', remote.projectTranscriptionId)
				.executeTakeFirst()
		).resolves.toMatchObject({
			id: remote.projectTranscriptionId,
			project_id: 'project-restore-1',
			transcription_id: remote.transcriptionId,
		});
		await expect(
			harness.db
				.selectFrom('transcriptions')
				.select(['id', 'project_id', 'current_revision_id', 'current_content_hash'])
				.where('id', '=', remote.transcriptionId)
				.executeTakeFirst()
		).resolves.toMatchObject({
			id: remote.transcriptionId,
			project_id: 'project-restore-1',
			current_revision_id: 'tx-cp-restore-1',
			current_content_hash: remote.contentHash,
		});
		await expect(
			harness.db
				.selectFrom('transcription_checkpoints')
				.select(['id', 'transcription_id', 'content_hash', 'is_committed'])
				.where('id', '=', 'tx-cp-restore-1')
				.executeTakeFirst()
		).resolves.toMatchObject({
			id: 'tx-cp-restore-1',
			transcription_id: remote.transcriptionId,
			content_hash: remote.contentHash,
			is_committed: 1,
		});
		await expect(
			harness.db
				.selectFrom('transcription_verse_index')
				.select(['transcription_id', 'verse_identifier'])
				.where('transcription_id', '=', remote.transcriptionId)
				.execute()
		).resolves.toEqual([
			{ transcription_id: remote.transcriptionId, verse_identifier: 'John 18:1' },
		]);
		await expect(
			harness.db
				.selectFrom('collations')
				.select(['id', 'project_id', 'current_revision_id', 'current_content_hash'])
				.where('id', '=', remote.collationId)
				.executeTakeFirst()
		).resolves.toMatchObject({
			id: remote.collationId,
			project_id: 'project-restore-1',
			current_revision_id: 'col-cp-restore-1',
			current_content_hash: remote.collationContentHash,
		});
		await expect(
			harness.db
				.selectFrom('collation_witnesses')
				.select([
					'collation_id',
					'project_transcription_id',
					'transcription_id',
					'source_revision_id',
				])
				.where('collation_id', '=', remote.collationId)
				.execute()
		).resolves.toEqual([
			{
				collation_id: remote.collationId,
				project_transcription_id: remote.projectTranscriptionId,
				transcription_id: remote.transcriptionId,
				source_revision_id: 'tx-cp-restore-1',
			},
		]);
		await expect(
			harness.db
				.selectFrom('collation_checkpoints')
				.select(['id', 'collation_id', 'content_hash', 'is_committed'])
				.where('id', '=', 'col-cp-restore-1')
				.executeTakeFirst()
		).resolves.toMatchObject({
			id: 'col-cp-restore-1',
			collation_id: remote.collationId,
			content_hash: remote.collationContentHash,
			is_committed: 1,
		});
		await expect(
			harness.db
				.selectFrom('sync_tombstones')
				.select(['id', 'project_id', 'entity_type', 'entity_id'])
				.where('id', '=', remote.tombstoneId)
				.executeTakeFirst()
		).resolves.toMatchObject({
			id: remote.tombstoneId,
			project_id: 'project-restore-1',
			entity_type: 'project-transcription',
			entity_id: 'deleted-pt-restore-1',
		});
		await expect(
			harness.db
				.selectFrom('cloud_project_folders')
				.select(['project_id', 'connection_id', 'cloud_folder_id', 'cloud_folder_path'])
				.where('project_id', '=', 'project-restore-1')
				.executeTakeFirst()
		).resolves.toMatchObject({
			project_id: 'project-restore-1',
			connection_id: 'conn-1',
			cloud_folder_id: remote.folderId,
			cloud_folder_path: 'Restored Project',
		});
		await expect(
			harness.db
				.selectFrom('cloud_sync_metadata')
				.select([
					'connection_id',
					'scope_type',
					'scope_id',
					'entity_type',
					'entity_id',
					'cloud_file_id',
					'cloud_file_revision',
					'cloud_path',
					'last_synced_revision',
					'last_synced_hash',
				])
				.where('entity_id', '=', remote.projectTranscriptionId)
				.executeTakeFirst()
		).resolves.toMatchObject({
			connection_id: 'conn-1',
			scope_type: 'project',
			scope_id: 'project-restore-1',
			entity_type: 'project-transcription',
			entity_id: remote.projectTranscriptionId,
			cloud_file_id: remote.primaryFileId,
			cloud_file_revision: 'rev-1',
			cloud_path: projectRelativeCloudPaths().transcriptions(remote.projectTranscriptionId),
			last_synced_revision: 'tx-cp-restore-1',
			last_synced_hash: remote.contentHash,
		});
		await expect(
			harness.db
				.selectFrom('cloud_sync_metadata')
				.select([
					'entity_type',
					'entity_id',
					'cloud_file_id',
					'cloud_path',
					'last_synced_revision',
					'last_synced_hash',
				])
				.where('entity_id', '=', remote.collationId)
				.executeTakeFirst()
		).resolves.toMatchObject({
			entity_type: 'collation',
			entity_id: remote.collationId,
			cloud_file_id: remote.collationPrimaryFileId,
			cloud_path: projectRelativeCloudPaths().collations(remote.collationId),
			last_synced_revision: 'col-cp-restore-1',
			last_synced_hash: remote.collationContentHash,
		});
	});

	it('quarantines missing transcription head history without writing local rows', async () => {
		await createCloudConnection();
		const provider = new MockCloudStorageProvider({ now: () => '2026-06-10T12:00:00.000Z' });
		const remote = await createRemoteProjectBackup(provider, 'project-missing-history', {
			includeHistory: false,
		});

		const result = await importCloudProject(harness.db, provider, {
			connectionId: 'conn-1',
			folderId: remote.folderId,
			folderPath: 'Restored Project',
			mode: 'create-local',
		});

		expect(result.quarantines).toEqual([
			expect.objectContaining({
				path: projectRelativeCloudPaths().transcriptionHistory(
					remote.projectTranscriptionId,
					'tx-cp-restore-1'
				),
				code: 'invalid_shape',
			}),
		]);
		await expect(
			harness.db
				.selectFrom('projects')
				.select('id')
				.where('id', '=', 'project-missing-history')
				.executeTakeFirst()
		).resolves.toBeUndefined();
	});
});

describe('linked cloud project manifest polling', () => {
	it('compares a linked remote manifest to local committed heads and sync metadata', async () => {
		await createCloudConnection();
		const provider = new MockCloudStorageProvider({ now: () => '2026-06-10T12:00:00.000Z' });
		const remote = await createRemoteProjectBackup(provider, 'project-poll-1');
		await importCloudProject(harness.db, provider, {
			connectionId: 'conn-1',
			folderId: remote.folderId,
			folderPath: 'Restored Project',
			mode: 'create-local',
		});

		const result = await pollLinkedProjectManifest(harness.db, provider, {
			connectionId: 'conn-1',
			projectId: 'project-poll-1',
			cloudFolderId: remote.folderId,
			cloudFolderPath: 'Restored Project',
		});

		expect(result).toMatchObject({
			ok: true,
			comparison: {
				projectId: 'project-poll-1',
				status: 'up-to-date',
				manifestRevision: 'rev-1',
				quarantines: [],
				entities: expect.arrayContaining([
					expect.objectContaining({
						entityType: 'project-transcription',
						entityId: remote.projectTranscriptionId,
						status: 'up-to-date',
						localHead: {
							revisionId: 'tx-cp-restore-1',
							contentHash: remote.contentHash,
						},
						remoteHead: {
							revisionId: 'tx-cp-restore-1',
							contentHash: remote.contentHash,
						},
						lastSyncedHead: {
							revisionId: 'tx-cp-restore-1',
							contentHash: remote.contentHash,
						},
					}),
					expect.objectContaining({
						entityType: 'collation',
						entityId: remote.collationId,
						status: 'up-to-date',
					}),
				]),
			},
		});
	});

	it('detects remote updates from project.json without downloading entity primaries', async () => {
		await createCloudConnection();
		const provider = new MockCloudStorageProvider({ now: () => '2026-06-10T12:00:00.000Z' });
		const remote = await createRemoteProjectBackup(provider, 'project-poll-remote-update');
		await importCloudProject(harness.db, provider, {
			connectionId: 'conn-1',
			folderId: remote.folderId,
			folderPath: 'Restored Project',
			mode: 'create-local',
		});
		await provider.updateFile(
			remote.manifestFileId,
			await remoteManifestWithHead(remote, {
				transcriptionRevisionId: 'tx-cp-remote-2',
				transcriptionContentHash: 'sha256:remote-transcription-2',
			}),
			'rev-1'
		);

		const result = await pollLinkedProjectManifest(harness.db, provider, {
			connectionId: 'conn-1',
			projectId: 'project-poll-remote-update',
			cloudFolderId: remote.folderId,
		});

		expect(result).toMatchObject({
			ok: true,
			comparison: {
				status: 'remote-update-available',
				manifestRevision: 'rev-2',
				entities: expect.arrayContaining([
					expect.objectContaining({
						entityType: 'project-transcription',
						entityId: remote.projectTranscriptionId,
						status: 'remote-update-available',
						remoteHead: {
							revisionId: 'tx-cp-remote-2',
							contentHash: 'sha256:remote-transcription-2',
						},
					}),
				]),
			},
		});
	});

	it('classifies linked local and remote changes from the last synced head as diverged', async () => {
		await createCloudConnection();
		const provider = new MockCloudStorageProvider({ now: () => '2026-06-10T12:00:00.000Z' });
		const remote = await createRemoteProjectBackup(provider, 'project-poll-diverged');
		await importCloudProject(harness.db, provider, {
			connectionId: 'conn-1',
			folderId: remote.folderId,
			folderPath: 'Restored Project',
			mode: 'create-local',
		});
		await harness.db
			.updateTable('transcriptions')
			.set({ current_revision_id: 'tx-cp-local-2', current_content_hash: remote.contentHash })
			.where('id', '=', remote.transcriptionId)
			.execute();

		const parsedManifest = await parseProjectCloudFile(
			await remoteManifestWithHead(remote, {
				transcriptionRevisionId: 'tx-cp-remote-2',
				transcriptionContentHash: 'sha256:remote-transcription-2',
			})
		);
		if (!parsedManifest.ok) throw new Error('Expected valid remote manifest.');
		const comparison = await compareRemoteManifestToLocalProject(
			harness.db,
			parsedManifest.value,
			{
				connectionId: 'conn-1',
				projectId: 'project-poll-diverged',
			}
		);

		expect(comparison).toMatchObject({
			status: 'diverged',
			entities: expect.arrayContaining([
				expect.objectContaining({
					entityType: 'project-transcription',
					entityId: remote.projectTranscriptionId,
					status: 'diverged',
					localHead: { revisionId: 'tx-cp-local-2', contentHash: remote.contentHash },
					lastSyncedHead: {
						revisionId: 'tx-cp-restore-1',
						contentHash: remote.contentHash,
					},
				}),
			]),
		});
	});
});

describe('linked cloud project pull', () => {
	it('applies changed project transcription and collation heads after explicit pull', async () => {
		await createCloudConnection();
		const provider = new MockCloudStorageProvider({ now: () => '2026-06-10T12:00:00.000Z' });
		const remote = await createRemoteProjectBackup(provider, 'project-pull-remote-update');
		await importCloudProject(harness.db, provider, {
			connectionId: 'conn-1',
			folderId: remote.folderId,
			folderPath: 'Restored Project',
			mode: 'create-local',
		});
		const remoteUpdate = await writeRemoteHeadUpdate(provider, remote, {
			transcriptionRevisionId: 'tx-cp-remote-2',
			collationRevisionId: 'col-cp-remote-2',
		});

		const result = await pullLinkedProjectUpdates(harness.db, provider, {
			connectionId: 'conn-1',
			projectId: 'project-pull-remote-update',
			cloudFolderId: remote.folderId,
			cloudFolderPath: 'Restored Project',
		});

		expect(result).toEqual({
			projectId: 'project-pull-remote-update',
			projectTranscriptionIds: [remote.projectTranscriptionId],
			collationIds: [remote.collationId],
			tombstoneIds: [],
			quarantines: [],
		});
		await expect(
			harness.db
				.selectFrom('transcriptions')
				.select(['title', 'current_revision_id', 'current_content_hash'])
				.where('id', '=', remote.transcriptionId)
				.executeTakeFirst()
		).resolves.toMatchObject({
			title: 'Remote Witness Updated',
			current_revision_id: 'tx-cp-remote-2',
			current_content_hash: remoteUpdate.transcriptionContentHash,
		});
		await expect(
			harness.db
				.selectFrom('collations')
				.select(['title', 'current_revision_id', 'current_content_hash'])
				.where('id', '=', remote.collationId)
				.executeTakeFirst()
		).resolves.toMatchObject({
			title: 'Remote Collation Updated',
			current_revision_id: 'col-cp-remote-2',
			current_content_hash: remoteUpdate.collationContentHash,
		});
		await expect(
			harness.db
				.selectFrom('cloud_sync_metadata')
				.select(['entity_id', 'last_synced_revision', 'last_synced_hash'])
				.where('entity_id', 'in', [remote.projectTranscriptionId, remote.collationId])
				.orderBy('entity_id')
				.execute()
		).resolves.toEqual(
			expect.arrayContaining([
				{
					entity_id: remote.collationId,
					last_synced_revision: 'col-cp-remote-2',
					last_synced_hash: remoteUpdate.collationContentHash,
				},
				{
					entity_id: remote.projectTranscriptionId,
					last_synced_revision: 'tx-cp-remote-2',
					last_synced_hash: remoteUpdate.transcriptionContentHash,
				},
			])
		);
	});

	it('blocks pull when local and remote heads have diverged', async () => {
		await createCloudConnection();
		const provider = new MockCloudStorageProvider({ now: () => '2026-06-10T12:00:00.000Z' });
		const remote = await createRemoteProjectBackup(provider, 'project-pull-diverged');
		await importCloudProject(harness.db, provider, {
			connectionId: 'conn-1',
			folderId: remote.folderId,
			folderPath: 'Restored Project',
			mode: 'create-local',
		});
		await harness.db
			.updateTable('transcriptions')
			.set({ current_revision_id: 'tx-cp-local-2', current_content_hash: remote.contentHash })
			.where('id', '=', remote.transcriptionId)
			.execute();
		await writeRemoteHeadUpdate(provider, remote, {
			transcriptionRevisionId: 'tx-cp-remote-2',
		});

		const result = await pullLinkedProjectUpdates(harness.db, provider, {
			connectionId: 'conn-1',
			projectId: 'project-pull-diverged',
			cloudFolderId: remote.folderId,
			cloudFolderPath: 'Restored Project',
		});

		expect(result.quarantines).toEqual([
			expect.objectContaining({
				path: projectRelativeCloudPaths().transcriptions(remote.projectTranscriptionId),
				actual: 'diverged',
			}),
		]);
		await expect(
			harness.db
				.selectFrom('transcriptions')
				.select('current_revision_id')
				.where('id', '=', remote.transcriptionId)
				.executeTakeFirst()
		).resolves.toMatchObject({ current_revision_id: 'tx-cp-local-2' });
	});
});

async function projectManifest(projectId: string): Promise<string> {
	const remoteHarness = createLocalDbTestHarness();
	try {
		await createProject(remoteHarness.db, {
			id: projectId,
			name: `Project ${projectId}`,
			description: `Description for ${projectId}`,
			createdAt: '2026-06-10T12:00:00.000Z',
			updatedAt: '2026-06-10T12:05:00.000Z',
		});
		return serializeCloudFile(await serializeProjectCloudFile(remoteHarness.db, projectId));
	} finally {
		await remoteHarness.destroy();
	}
}

async function createCloudConnection(
	input: { providerId?: string; accountEmail?: string } = {}
): Promise<void> {
	await upsertCloudConnection(harness.db, {
		id: 'conn-1',
		providerId: input.providerId ?? 'mock',
		providerAccountId: 'acct-1',
		accountEmail: input.accountEmail ?? 'editor@example.com',
	});
}

async function createRemoteProjectBackup(
	provider: CloudStorageProvider,
	projectId: string,
	options: { folderName?: string; includeHistory?: boolean; parentFolderId?: string } = {}
): Promise<{
	projectId: string;
	folderId: string;
	projectTranscriptionId: string;
	transcriptionId: string;
	contentHash: string;
	primaryFileId: string;
	collationId: string;
	collationContentHash: string;
	collationPrimaryFileId: string;
	tombstoneId: string;
	tombstoneContentHash: string;
	manifestFileId: string;
}> {
	const includeHistory = options.includeHistory ?? true;
	const remoteHarness = createLocalDbTestHarness();
	const remoteStoreOptions = { backend: new MemoryStoreBackend() };
	try {
		await createProject(remoteHarness.db, {
			id: projectId,
			name: 'Remote Restored Project',
			description: 'Backed up project.',
			createdAt: '2026-06-10T12:00:00.000Z',
			updatedAt: '2026-06-10T12:10:00.000Z',
		});
		await createTranscription(remoteHarness.db, {
			id: 'library-source-restore-1',
			title: 'Remote Witness',
			siglum: 'R',
			description: 'Remote witness transcription.',
			document: documentWithVerses(['John 18:1']),
			createdAt: '2026-06-10T12:00:00.000Z',
			updatedAt: '2026-06-10T12:00:00.000Z',
			transcriber: 'Editor',
			repository: 'Archive',
			settlement: 'City',
			language: 'grc',
		});
		const [transcriptionId] = await syncProjectTranscriptionIds(remoteHarness.db, projectId, [
			'library-source-restore-1',
		]);
		const projectTranscriptionId = await getRemoteProjectTranscriptionId(
			remoteHarness,
			transcriptionId
		);
		const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
			remoteHarness.db,
			{
				projectTranscriptionId,
				checkpointId: 'tx-cp-restore-1',
				commitMessage: 'Initial remote commit',
				authorName: 'Editor',
				createdAt: '2026-06-10T12:05:00.000Z',
			},
			remoteStoreOptions
		);
		await createCollation(remoteHarness.db, {
			id: 'col-restore-1',
			projectId,
			title: 'Remote Collation',
			verseIdentifier: 'John 18:1',
			now: '2026-06-10T12:06:00.000Z',
		});
		await remoteHarness.db
			.insertInto('collation_witnesses')
			.values({
				id: 'witness-restore-1',
				collation_id: 'col-restore-1',
				witness_id: 'R',
				content: 'Remote witness text',
				position: 0,
				project_transcription_id: projectTranscriptionId,
				transcription_id: transcriptionId,
				source_revision_id: checkpoint.id,
				source_content_hash: checkpoint.contentHash,
			})
			.execute();
		await remoteHarness.db
			.insertInto('collation_tokens')
			.values({
				id: 'token-restore-1',
				collation_id: 'col-restore-1',
				witness_id: 'R',
				token_index: 0,
				token_text: 'Remote',
			})
			.execute();
		await saveWorkingCollationArtifact(
			remoteHarness.db,
			{
				collationId: 'col-restore-1',
				artifactId: 'artifact-restore-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify({
					...COLLATION_FIXTURE.document,
					meta: {
						collationId: 'col-restore-1',
						projectId,
						projectName: 'Remote Restored Project',
					},
					setup: {
						...COLLATION_FIXTURE.document.setup,
						witnesses: [
							{
								type: 'witness',
								id: 'R',
								siglum: 'R',
								transcriptionId,
								sourceVersion: checkpoint.id,
								sourceContentHash: checkpoint.contentHash,
								content: 'Remote witness text',
								treatment: 'full',
								isBaseText: true,
								isExcluded: false,
								overridesDefault: false,
								sourceTokens: [
									{
										kind: 'text',
										original: 'Remote',
										segments: [],
										gap: null,
										tokenId: 'R::source::0',
										sourceRef: { witnessId: 'R', transcriptionId, index: 0 },
									},
								],
							},
						],
					},
				}),
				now: '2026-06-10T12:07:00.000Z',
			},
			remoteStoreOptions
		);
		const collationCheckpoint = await createCommittedCollationCheckpointWithFiles(
			remoteHarness.db,
			{
				collationId: 'col-restore-1',
				checkpointId: 'col-cp-restore-1',
				commitMessage: 'Initial collation commit',
				authorName: 'Editor',
				createdAt: '2026-06-10T12:08:00.000Z',
			},
			remoteStoreOptions
		);
		await remoteHarness.db
			.insertInto('sync_tombstones')
			.values({
				id: 'tombstone-restore-1',
				project_id: projectId,
				entity_type: 'project-transcription',
				entity_id: 'deleted-pt-restore-1',
				cloud_path: projectRelativeCloudPaths().transcriptions('deleted-pt-restore-1'),
				deletion_revision_id: 'deleted-cp-restore-1',
				deleted_by: 'editor@example.com',
				deleted_at: '2026-06-10T12:09:00.000Z',
			})
			.execute();
		const primary = await serializeProjectTranscriptionCloudFile(
			remoteHarness.db,
			projectTranscriptionId
		);
		const history = await serializeProjectTranscriptionHistoryCloudFile(
			remoteHarness.db,
			projectTranscriptionId,
			'tx-cp-restore-1',
			remoteStoreOptions
		);
		const collationPrimary = await serializeCollationCloudFile(
			remoteHarness.db,
			'col-restore-1',
			remoteStoreOptions
		);
		const collationHistory = await serializeCollationHistoryCloudFile(
			remoteHarness.db,
			'col-restore-1',
			'col-cp-restore-1',
			remoteStoreOptions
		);
		const tombstone = await serializeTombstoneCloudFile(
			remoteHarness.db,
			'tombstone-restore-1'
		);
		const manifest = await serializeProjectCloudFile(remoteHarness.db, projectId);
		const folderId = await provider.createFolder(
			options.folderName ?? 'Restored Project',
			options.parentFolderId
		);
		const manifestWrite = await provider.createFile(
			folderId,
			'project.json',
			await serializeCloudFile(manifest)
		);
		const primaryWrite = await provider.createFile(
			folderId,
			projectRelativeCloudPaths().transcriptions(projectTranscriptionId),
			await serializeCloudFile(primary)
		);
		if (includeHistory) {
			await provider.createFile(
				folderId,
				projectRelativeCloudPaths().transcriptionHistory(
					projectTranscriptionId,
					'tx-cp-restore-1'
				),
				await serializeCloudFile(history)
			);
		}
		const collationPrimaryWrite = await provider.createFile(
			folderId,
			projectRelativeCloudPaths().collations('col-restore-1'),
			await serializeCloudFile(collationPrimary)
		);
		await provider.createFile(
			folderId,
			projectRelativeCloudPaths().collationHistory('col-restore-1', 'col-cp-restore-1'),
			await serializeCloudFile(collationHistory)
		);
		await provider.createFile(
			folderId,
			projectRelativeCloudPaths().tombstones('project-transcription', 'deleted-pt-restore-1'),
			await serializeCloudFile(tombstone)
		);
		return {
			projectId,
			folderId,
			projectTranscriptionId,
			transcriptionId,
			contentHash: checkpoint.contentHash,
			primaryFileId: primaryWrite.id,
			collationId: 'col-restore-1',
			collationContentHash: collationCheckpoint.contentHash,
			collationPrimaryFileId: collationPrimaryWrite.id,
			tombstoneId: 'tombstone-restore-1',
			tombstoneContentHash: manifest.tombstones[0]?.content_hash ?? '',
			manifestFileId: manifestWrite.id,
		};
	} finally {
		await remoteHarness.destroy();
	}
}

async function remoteManifestWithHead(
	remote: Awaited<ReturnType<typeof createRemoteProjectBackup>>,
	input: {
		transcriptionRevisionId?: string;
		transcriptionContentHash?: string;
		collationRevisionId?: string;
		collationContentHash?: string;
	} = {}
): Promise<string> {
	return serializeCloudFile({
		schema_version: 1,
		id: remote.projectId,
		name: 'Remote Restored Project',
		description: 'Backed up project.',
		charter: '',
		collation_settings: {},
		manifest_content_hash: 'sha256:changed-manifest',
		transcriptions: [
			{
				project_transcription_id: remote.projectTranscriptionId,
				transcription_id: remote.transcriptionId,
				current_revision: {
					id: input.transcriptionRevisionId ?? 'tx-cp-restore-1',
					content_hash: input.transcriptionContentHash ?? remote.contentHash,
				},
				title: 'Remote Witness',
				siglum: 'R',
				primary_path: projectRelativeCloudPaths().transcriptions(
					remote.projectTranscriptionId
				),
			},
		],
		collations: [
			{
				collation_id: remote.collationId,
				current_revision: {
					id: input.collationRevisionId ?? 'col-cp-restore-1',
					content_hash: input.collationContentHash ?? remote.collationContentHash,
				},
				title: 'Remote Collation',
				verse_identifier: 'John 18:1',
				primary_path: projectRelativeCloudPaths().collations(remote.collationId),
			},
		],
		tombstones: [
			{
				tombstone_id: remote.tombstoneId,
				entity_type: 'project-transcription',
				entity_id: 'deleted-pt-restore-1',
				deletion_revision_id: 'deleted-cp-restore-1',
				content_hash: remote.tombstoneContentHash,
				primary_path: projectRelativeCloudPaths().tombstones(
					'project-transcription',
					'deleted-pt-restore-1'
				),
				deleted_at: '2026-06-10T12:09:00.000Z',
			},
		],
		created_at: '2026-06-10T12:00:00.000Z',
		updated_at: '2026-06-10T12:10:00.000Z',
	});
}

async function writeRemoteHeadUpdate(
	provider: MockCloudStorageProvider,
	remote: Awaited<ReturnType<typeof createRemoteProjectBackup>>,
	input: {
		transcriptionRevisionId?: string;
		collationRevisionId?: string;
	}
): Promise<{ transcriptionContentHash?: string; collationContentHash?: string }> {
	let transcriptionContentHash: string | undefined;
	let collationContentHash: string | undefined;
	if (input.transcriptionRevisionId) {
		const parsedPrimary = await parseProjectTranscriptionCloudFile(
			await provider.downloadFile(remote.primaryFileId)
		);
		if (!parsedPrimary.ok) throw new Error('Expected valid remote transcription primary.');
		const primary = parsedPrimary.value;
		primary.title = 'Remote Witness Updated';
		primary.created_at ??= '2026-06-10T12:00:00.000Z';
		primary.updated_at = '2026-06-10T12:15:00.000Z';
		transcriptionContentHash = await hashCanonicalPayload(
			buildTranscriptionHashPayload(primary)
		);
		primary.current_revision = {
			id: input.transcriptionRevisionId,
			content_hash: transcriptionContentHash,
			created_at: '2026-06-10T12:15:00.000Z',
			author_name: 'Editor',
		};
		await provider.updateFile(remote.primaryFileId, await serializeCloudFile(primary), 'rev-1');
		const parsedHistory = await parseHistoryCloudFile(
			await provider.downloadFile(
				await findRemoteFileId(
					provider,
					remote.folderId,
					projectRelativeCloudPaths().transcriptionHistory(
						remote.projectTranscriptionId,
						'tx-cp-restore-1'
					)
				)
			)
		);
		if (!parsedHistory.ok || parsedHistory.value.entity_type !== 'project-transcription') {
			throw new Error('Expected valid remote transcription history.');
		}
		const history: ProjectTranscriptionHistoryCloudFile = parsedHistory.value;
		history.checkpoint_id = input.transcriptionRevisionId;
		history.content_hash = transcriptionContentHash;
		history.commit_message = 'Remote transcription update';
		history.created_at = '2026-06-10T12:15:00.000Z';
		history.payload = buildTranscriptionHashPayload(primary);
		await provider.createFile(
			remote.folderId,
			projectRelativeCloudPaths().transcriptionHistory(
				remote.projectTranscriptionId,
				input.transcriptionRevisionId
			),
			await serializeCloudFile(history)
		);
	}
	if (input.collationRevisionId) {
		const parsedPrimary = await parseCollationCloudFile(
			await provider.downloadFile(remote.collationPrimaryFileId)
		);
		if (!parsedPrimary.ok) throw new Error('Expected valid remote collation primary.');
		const primary = parsedPrimary.value;
		primary.title = 'Remote Collation Updated';
		primary.created_at ??= '2026-06-10T12:06:00.000Z';
		primary.updated_at = '2026-06-10T12:16:00.000Z';
		const collationContent = {
			id: primary.id,
			project_id: primary.project_id,
			title: primary.title,
			verse_identifier: primary.verse_identifier,
			status: primary.status,
			group_path: primary.group_path,
			notes: primary.notes,
			sort_key: primary.sort_key,
			document: primary.document,
		};
		collationContentHash = await hashCanonicalPayload(collationContent);
		primary.current_revision = {
			id: input.collationRevisionId,
			content_hash: collationContentHash,
			created_at: '2026-06-10T12:16:00.000Z',
			author_name: 'Editor',
		};
		await provider.updateFile(
			remote.collationPrimaryFileId,
			await serializeCloudFile(primary),
			'rev-1'
		);
		const parsedHistory = await parseHistoryCloudFile(
			await provider.downloadFile(
				await findRemoteFileId(
					provider,
					remote.folderId,
					projectRelativeCloudPaths().collationHistory(
						remote.collationId,
						'col-cp-restore-1'
					)
				)
			)
		);
		if (!parsedHistory.ok || parsedHistory.value.entity_type !== 'collation') {
			throw new Error('Expected valid remote collation history.');
		}
		const history: CollationHistoryCloudFile = parsedHistory.value;
		history.checkpoint_id = input.collationRevisionId;
		history.content_hash = collationContentHash;
		history.commit_message = 'Remote collation update';
		history.created_at = '2026-06-10T12:16:00.000Z';
		history.payload = collationContent;
		await provider.createFile(
			remote.folderId,
			projectRelativeCloudPaths().collationHistory(
				remote.collationId,
				input.collationRevisionId
			),
			await serializeCloudFile(history)
		);
	}
	await provider.updateFile(
		remote.manifestFileId,
		await remoteManifestWithHead(remote, {
			transcriptionRevisionId: input.transcriptionRevisionId,
			transcriptionContentHash,
			collationRevisionId: input.collationRevisionId,
			collationContentHash,
		}),
		'rev-1'
	);
	return { transcriptionContentHash, collationContentHash };
}

async function findRemoteFileId(
	provider: MockCloudStorageProvider,
	folderId: string,
	relativePath: string
): Promise<string> {
	const page = await provider.listFiles(folderId, { recursive: true });
	const file = page.entries.find(entry => entry.path.endsWith(relativePath));
	if (!file) throw new Error(`Missing remote file ${relativePath}.`);
	return file.id;
}

async function getRemoteProjectTranscriptionId(
	remoteHarness: LocalDbTestHarness,
	transcriptionId: string
): Promise<string> {
	const row = await remoteHarness.db
		.selectFrom('project_transcriptions')
		.select('id')
		.where('transcription_id', '=', transcriptionId)
		.executeTakeFirstOrThrow();
	if (!row.id) throw new Error('Missing project transcription id.');
	return row.id;
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
