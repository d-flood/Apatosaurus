import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import { MemoryStoreBackend } from '$lib/client/store/memory-store-backend.spec-support';
import { upsertCloudConnection } from './cloud-connections';
import { createCollation } from './collations';
import { createProject as createProjectRepository, syncProjectTranscriptionIds } from './projects';
import { removeLocalProject } from './project-removal';
import {
	createCommittedCollationCheckpoint,
	createCommittedTranscriptionCheckpoint,
} from './revisions';
import { createCommittedTranscriptionCheckpointWithFiles } from './transcription-files';
import { createTranscription } from './transcriptions';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
});

afterEach(async () => {
	await harness.destroy();
});

function createProject(
	db: Parameters<typeof createProjectRepository>[0],
	input: Parameters<typeof createProjectRepository>[1]
) {
	return createProjectRepository(db, input, { backend });
}

describe('project local removal repository', () => {
	it('removes project-contained local data and leaves default-project transcriptions intact', async () => {
		await createProject(harness.db, { id: 'library-project', name: 'Library' });
		await createTranscription(harness.db, {
			...baseTranscription('library-1', 'A'),
			projectId: 'library-project',
			projectTranscriptionId: 'library-pt-1',
		});
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'library-pt-1', checkpointId: 'library-cp-1' },
			{ backend }
		);
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		const [projectOwnedTranscriptionId] = await syncProjectTranscriptionIds(
			harness.db,
			'project-1',
			['library-1'],
			{ backend }
		);
		const projectTranscription = await harness.db
			.selectFrom('project_transcriptions')
			.select('id')
			.where('project_id', '=', 'project-1')
			.executeTakeFirstOrThrow();
		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscription.id!,
			commitMessage: 'Initial transcription',
			authorName: 'Editor',
		});
		const collationId = await createCollation(harness.db, {
			id: 'collation-1',
			projectId: 'project-1',
			title: 'Collation',
			verseIdentifier: 'Romans 1:1',
		});
		await createCommittedCollationCheckpoint(harness.db, {
			collationId,
			commitMessage: 'Initial collation',
			authorName: 'Editor',
		});
		await createBackupRows('project-1', projectOwnedTranscriptionId, collationId);

		const result = await removeLocalProject(harness.db, {
			projectId: 'project-1',
			connectionId: 'conn-1',
		});

		expect(result).toMatchObject({
			projectId: 'project-1',
			removedProjectTranscriptions: 1,
			removedProjectOwnedTranscriptions: 1,
			removedCollations: 1,
			removedCheckpoints: 3,
			removedSyncMetadata: 3,
			removedTombstones: 1,
		});
		const remainingProjects = await harness.db
			.selectFrom('projects')
			.select(['id', 'name'])
			.orderBy('name')
			.execute();
		expect(remainingProjects.map(row => row.name)).toEqual(['Library']);
		const libraryProject = remainingProjects.find(row => row.name === 'Library')!;
		const remainingProjectTranscriptions = await harness.db
			.selectFrom('project_transcriptions')
			.select(['project_id', 'transcription_id'])
			.execute();
		expect(remainingProjectTranscriptions).toEqual([
			{ project_id: libraryProject.id, transcription_id: 'library-1' },
		]);
		await expectNoRows('collations');
		await expectNoRows('collation_checkpoints');
		await expect(
			harness.db
				.selectFrom('transcription_checkpoints')
				.select(['id', 'transcription_id'])
				.execute()
		).resolves.toEqual([{ id: 'library-cp-1', transcription_id: 'library-1' }]);
		await expectNoRows('cloud_sync_metadata');
		await expectNoRows('cloud_project_folders');
		await expectNoRows('sync_tombstones');
		const remainingTranscriptions = await harness.db
			.selectFrom('transcriptions')
			.select(['id', 'project_id'])
			.orderBy('id')
			.execute();
		expect(remainingTranscriptions).toEqual([
			{ id: 'library-1', project_id: 'library-project' },
		]);
	});
});

async function createBackupRows(
	projectId: string,
	projectOwnedTranscriptionId: string,
	collationId: string
) {
	await upsertCloudConnection(harness.db, {
		id: 'conn-1',
		providerId: 'mock',
		providerAccountId: 'acct-1',
		accountEmail: 'editor@example.com',
	});
	await harness.db
		.insertInto('cloud_project_folders')
		.values({
			project_id: projectId,
			connection_id: 'conn-1',
			cloud_folder_id: 'folder-1',
			cloud_folder_path: 'Apatosaurus/Projects/project-1',
			sync_cursor: '',
			last_fully_synced_at: '2024-01-01T00:00:00.000Z',
		})
		.execute();
	await harness.db
		.insertInto('cloud_sync_metadata')
		.values([
			metadataRow('project', projectId, 'project-manifest', projectId, 'project.json'),
			metadataRow(
				'project',
				projectId,
				'project-transcription',
				projectOwnedTranscriptionId,
				'transcriptions/pt.json'
			),
			metadataRow(
				'project',
				projectId,
				'collation',
				collationId,
				'collations/collation.json'
			),
		])
		.execute();
	await harness.db
		.insertInto('sync_tombstones')
		.values({
			id: 'tombstone-1',
			project_id: projectId,
			entity_type: 'collation',
			entity_id: 'removed-collation',
			cloud_path: 'collations/removed-collation.json',
			deletion_revision_id: 'delete-1',
			deleted_by: 'Editor',
			deleted_at: '2024-01-01T00:00:00.000Z',
		})
		.execute();
}

function metadataRow(
	scopeType: string,
	scopeId: string,
	entityType: string,
	entityId: string,
	cloudPath: string
) {
	return {
		connection_id: 'conn-1',
		scope_type: scopeType,
		scope_id: scopeId,
		entity_type: entityType,
		entity_id: entityId,
		cloud_file_id: cloudPath,
		cloud_file_revision: 'rev-1',
		cloud_path: cloudPath,
		last_synced_revision: 'checkpoint-1',
		last_synced_hash: 'sha256:hash',
		last_synced_at: '2024-01-01T00:00:00.000Z',
	};
}

async function expectNoRows(table: keyof import('../types.generated').Database) {
	const rows = await harness.db.selectFrom(table).selectAll().execute();
	expect(rows).toEqual([]);
}

function baseTranscription(id: string, siglum: string) {
	return {
		id,
		title: `Witness ${siglum}`,
		siglum,
		transcriber: 'Editor',
		repository: 'Library',
		settlement: 'City',
		language: 'grc',
	};
}
