import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { MemoryStoreBackend } from '$lib/client/store/memory-store-backend.spec-support';
import { upsertCloudConnection } from './cloud-connections';
import { createProject as createProjectRepository, syncProjectTranscriptionIds } from './projects';
import {
	createCommittedCollationCheckpoint,
	createCommittedTranscriptionCheckpoint,
} from './revisions';
import { createTranscription, updateTranscriptionContent } from './transcriptions';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import {
	createCollation,
	deleteCollation,
	getCollationVersionStatus,
	listCollationsWithProjectNames,
	listProjectCollationVersionStatuses,
	loadCollation,
	saveCollationArtifact,
	saveCollationProjection,
	updateCollationMetadata,
} from './collations';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;

beforeEach(async () => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
	await createProject(harness.db, {
		id: 'default-project',
		storageSlug: 'default-project',
		name: 'Default',
	});
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

describe('collations repository', () => {
	it('lists collations with project names without loading artifact/projection rows', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			name: 'Romans',
			updatedAt: '2024-01-01T00:00:00.000Z',
		});
		await insertCollation('col-older', 'Older', '2024-01-02T00:00:00.000Z');
		await insertCollation('col-newer', 'Newer', '2024-01-03T00:00:00.000Z');

		const rows = await listCollationsWithProjectNames(harness.db);

		expect(rows).toEqual([
			{
				id: 'col-newer',
				projectId: 'project-1',
				projectName: 'Romans',
				title: 'Newer',
				verseIdentifier: 'Rom 1:1',
				status: 'setup',
				updatedAt: '2024-01-03T00:00:00.000Z',
			},
			{
				id: 'col-older',
				projectId: 'project-1',
				projectName: 'Romans',
				title: 'Older',
				verseIdentifier: 'Rom 1:1',
				status: 'setup',
				updatedAt: '2024-01-02T00:00:00.000Z',
			},
		]);
		expect(rows[0]).not.toHaveProperty('payload');
	});

	it('hard deletes a collation and cascades child artifacts', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Romans' });
		await insertCollation('col-1', 'Romans 1:1', '2024-01-02T00:00:00.000Z');
		await harness.db
			.insertInto('collation_artifacts')
			.values({
				id: 'artifact-1',
				collation_id: 'col-1',
				artifact_type: 'canonical',
				payload: '{}',
				created_at: '2024-01-02T00:00:00.000Z',
			})
			.execute();

		await deleteCollation(harness.db, 'col-1');

		await expect(listCollationsWithProjectNames(harness.db)).resolves.toEqual([]);
		await expect(
			harness.db.selectFrom('collation_artifacts').selectAll().execute()
		).resolves.toEqual([]);
	});

	it('creates, loads, and updates the canonical artifact and metadata', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Romans' });
		const id = await createCollation(harness.db, {
			id: 'col-1',
			projectId: 'project-1',
			title: 'Romans 1:1',
			verseIdentifier: 'Rom 1:1',
			now: '2024-01-02T00:00:00.000Z',
		});

		const artifactId = await saveCollationArtifact(harness.db, {
			collationId: id,
			artifactId: 'artifact-1',
			artifactType: 'collation_document_v1',
			payload: '{"version":1}',
			now: '2024-01-02T00:00:00.000Z',
		});
		await saveCollationArtifact(harness.db, {
			collationId: id,
			artifactId,
			artifactType: 'collation_document_v1',
			payload: '{"version":2}',
			now: '2024-01-03T00:00:00.000Z',
		});
		await updateCollationMetadata(harness.db, {
			id,
			status: 'complete',
			updatedAt: '2024-01-04T00:00:00.000Z',
		});

		const loaded = await loadCollation(harness.db, id);
		expect(loaded?.artifact).toMatchObject({ id: 'artifact-1', payload: '{"version":2}' });
		expect(loaded?.row.status).toBe('complete');
		expect(loaded?.row.updatedAt).toBe('2024-01-04T00:00:00.000Z');
	});

	it('replaces derived projection rows in one transaction', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Romans' });
		await insertCollation('col-1', 'Romans 1:1', '2024-01-02T00:00:00.000Z');

		await saveCollationProjection(harness.db, {
			collationId: 'col-1',
			witnesses: [
				{
					witnessId: 'A',
					transcriptionId: null,
					sourceVersion: 'v1',
					content: 'In principio',
					position: 0,
				},
			],
			tokens: [{ witnessId: 'A', tokenIndex: 0, tokenText: 'In' }],
			variationUnits: [
				{
					startIndex: 0,
					endIndex: 1,
					unitType: 'variation',
					baseText: 'In',
					readings: [
						{
							readingOrder: 0,
							readingText: 'In',
							isOmission: false,
							isLacuna: false,
							witnessIds: ['A'],
						},
					],
				},
			],
		});
		await saveCollationProjection(harness.db, {
			collationId: 'col-1',
			witnesses: [
				{
					witnessId: 'B',
					transcriptionId: null,
					sourceVersion: 'v2',
					content: 'Principio',
					position: 0,
				},
			],
			tokens: [{ witnessId: 'B', tokenIndex: 0, tokenText: 'Principio' }],
			variationUnits: [],
		});

		const loaded = await loadCollation(harness.db, 'col-1');
		expect(loaded?.projection.witnesses).toEqual([
			{
				witnessId: 'B',
				transcriptionId: null,
				sourceVersion: 'v2',
				content: 'Principio',
				position: 0,
			},
		]);
		expect(loaded?.projection.tokens).toEqual([
			{ witnessId: 'B', tokenIndex: 0, tokenText: 'Principio' },
		]);
		expect(loaded?.projection.variationUnits).toEqual([]);
	});

	it('stores exact committed source revisions for project transcription witnesses', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Romans' });
		await createTranscription(harness.db, {
			id: 'tx-1',
			projectId: 'project-1',
			projectTranscriptionId: 'pt-1',
			title: 'Witness 01',
			siglum: '01',
			transcriber: 'Editor',
			repository: 'Library',
			settlement: 'City',
			language: 'grc',
		});
		const snapshotId = 'tx-1';
		const projectTranscriptionId = 'pt-1';
		const checkpoint = await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId,
			checkpointId: 'tx-cp-1',
			createdAt: '2026-06-09T10:00:00.000Z',
		});
		await insertCollation('col-1', 'Romans 1:1', '2024-01-02T00:00:00.000Z');

		await saveCollationProjection(harness.db, {
			collationId: 'col-1',
			witnesses: [
				{
					witnessId: '01',
					transcriptionId: snapshotId,
					sourceVersion: '2024-01-01T00:00:00.000Z',
					content: 'In principio',
					position: 0,
				},
			],
			tokens: [],
			variationUnits: [],
		});

		const row = await harness.db
			.selectFrom('collation_witnesses')
			.selectAll()
			.where('collation_id', '=', 'col-1')
			.executeTakeFirstOrThrow();
		expect(row).toMatchObject({
			project_transcription_id: projectTranscriptionId,
			transcription_id: snapshotId,
			source_revision_id: checkpoint.id,
			source_content_hash: checkpoint.contentHash,
		});

		await saveCollationProjection(harness.db, {
			collationId: 'col-1',
			witnesses: [
				{
					witnessId: '01',
					transcriptionId: snapshotId,
					sourceVersion: 'tx-cp-older',
					sourceContentHash: 'sha256:older',
					content: 'In principio',
					position: 0,
				},
			],
			tokens: [],
			variationUnits: [],
		});

		const explicitPinnedRow = await harness.db
			.selectFrom('collation_witnesses')
			.selectAll()
			.where('collation_id', '=', 'col-1')
			.executeTakeFirstOrThrow();
		expect(explicitPinnedRow).toMatchObject({
			project_transcription_id: projectTranscriptionId,
			transcription_id: snapshotId,
			source_revision_id: 'tx-cp-older',
			source_content_hash: 'sha256:older',
		});
	});

	it('rejects witnesses owned by another project', async () => {
		await insertProject('project-1', 'Romans');
		await insertProject('project-2', 'Galatians');
		await createTranscription(harness.db, {
			...sourceTranscription('tx-foreign', 'F'),
			projectId: 'project-2',
			projectTranscriptionId: 'pt-foreign',
		});
		await insertCollation('col-1', 'Romans 1:1', '2024-01-02T00:00:00.000Z');

		await expect(
			saveCollationProjection(harness.db, {
				collationId: 'col-1',
				witnesses: [
					{
						witnessId: 'F',
						transcriptionId: 'tx-foreign',
						projectTranscriptionId: 'pt-foreign',
						sourceVersion: 'v1',
						content: 'foreign',
						position: 0,
					},
				],
				tokens: [],
				variationUnits: [],
			})
		).rejects.toThrow('does not belong to collation project project-1');
	});

	it('rejects a project transcription id that does not match its witness transcription', async () => {
		await insertProject('project-1', 'Romans');
		await createTranscription(harness.db, {
			...sourceTranscription('tx-1', '01'),
			projectId: 'project-1',
			projectTranscriptionId: 'pt-1',
		});
		await createTranscription(harness.db, {
			...sourceTranscription('tx-2', '02'),
			projectId: 'project-1',
			projectTranscriptionId: 'pt-2',
		});
		await insertCollation('col-1', 'Romans 1:1', '2024-01-02T00:00:00.000Z');

		await expect(
			saveCollationProjection(harness.db, {
				collationId: 'col-1',
				witnesses: [
					{
						witnessId: '01',
						transcriptionId: 'tx-1',
						projectTranscriptionId: 'pt-2',
						sourceVersion: 'v1',
						content: 'local',
						position: 0,
					},
				],
				tokens: [],
				variationUnits: [],
			})
		).rejects.toThrow('does not match transcription tx-1');
	});

	it('reports collation version status and witness source states', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Romans' });
		await createTranscription(harness.db, {
			...sourceTranscription('tx-1', '01'),
			projectId: 'project-1',
			projectTranscriptionId: 'pt-1',
		});
		await createTranscription(harness.db, {
			...sourceTranscription('tx-2', '02'),
			projectId: 'project-1',
			projectTranscriptionId: 'pt-2',
		});
		const snapshotAId = 'tx-1';
		const snapshotBId = 'tx-2';
		const projectTranscriptionAId = 'pt-1';
		const projectTranscriptionBId = 'pt-2';
		const sourceCheckpoint = await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscriptionAId,
			checkpointId: 'tx-cp-1',
		});
		const collationId = await createCollation(harness.db, {
			id: 'col-1',
			projectId: 'project-1',
			title: 'Romans 1:1',
			verseIdentifier: 'Rom 1:1',
			now: '2024-01-02T00:00:00.000Z',
		});
		await saveCollationProjection(harness.db, {
			collationId,
			witnesses: [
				{
					witnessId: '01',
					transcriptionId: snapshotAId,
					sourceVersion: 'fallback',
					content: 'In principio',
					position: 0,
				},
				{
					witnessId: '02',
					transcriptionId: snapshotBId,
					sourceVersion: 'fallback',
					content: 'In principio erat',
					position: 1,
				},
				{
					witnessId: 'legacy',
					transcriptionId: null,
					sourceVersion: 'legacy-rev',
					sourceContentHash: 'sha256:legacy',
					content: 'Legacy content',
					position: 2,
				},
			],
			tokens: [],
			variationUnits: [],
		});

		const initialStatus = await getCollationVersionStatus(harness.db, collationId);

		expect(initialStatus).toMatchObject({
			projectId: 'project-1',
			collationId,
			title: 'Romans 1:1',
			verseIdentifier: 'Rom 1:1',
			workflowStatus: 'setup',
			currentCheckpoint: null,
			dirtyToCheckpoint: true,
			commitState: 'never-committed',
		});
		expect(initialStatus.workingContentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(initialStatus.witnesses).toEqual([
			{
				witnessId: '01',
				position: 0,
				projectTranscriptionId: projectTranscriptionAId,
				projectOwnedTranscriptionId: snapshotAId,
				pinnedCheckpoint: {
					revisionId: 'tx-cp-1',
					contentHash: sourceCheckpoint.contentHash,
				},
				availableCheckpoint: {
					revisionId: 'tx-cp-1',
					contentHash: sourceCheckpoint.contentHash,
				},
				sourceDirtyToCheckpoint: false,
				versionState: 'pinned-current',
			},
			{
				witnessId: '02',
				position: 1,
				projectTranscriptionId: projectTranscriptionBId,
				projectOwnedTranscriptionId: snapshotBId,
				pinnedCheckpoint: null,
				availableCheckpoint: null,
				sourceDirtyToCheckpoint: true,
				versionState: 'source-has-no-committed-version',
			},
			{
				witnessId: 'legacy',
				position: 2,
				projectTranscriptionId: null,
				projectOwnedTranscriptionId: null,
				pinnedCheckpoint: { revisionId: 'legacy-rev', contentHash: 'sha256:legacy' },
				availableCheckpoint: null,
				sourceDirtyToCheckpoint: null,
				versionState: 'no-source',
			},
		]);
		expect(
			(await listProjectCollationVersionStatuses(harness.db, 'project-1'))[0].collationId
		).toBe(collationId);

		const collationCheckpoint = await createCommittedCollationCheckpoint(harness.db, {
			collationId,
			checkpointId: 'col-cp-1',
		});
		const cleanStatus = await getCollationVersionStatus(harness.db, collationId);

		expect(cleanStatus).toMatchObject({
			currentCheckpoint: {
				revisionId: 'col-cp-1',
				contentHash: collationCheckpoint.contentHash,
			},
			workingContentHash: collationCheckpoint.contentHash,
			dirtyToCheckpoint: false,
			commitState: 'clean',
		});

		const syncContext = await createSyncContext();
		await harness.db
			.insertInto('cloud_sync_metadata')
			.values({
				connection_id: syncContext.connectionId,
				scope_type: 'project',
				scope_id: syncContext.projectId,
				entity_type: 'collation',
				entity_id: collationId,
				cloud_file_id: 'file-col-1',
				cloud_file_revision: 'rev-1',
				cloud_path: `collations/${collationId}.json`,
				last_synced_revision: collationCheckpoint.id,
				last_synced_hash: collationCheckpoint.contentHash,
				last_synced_at: '2026-06-10T12:10:00.000Z',
			})
			.execute();
		await expect(
			getCollationVersionStatus(harness.db, collationId, { syncContext })
		).resolves.toMatchObject({
			cloudBackupState: {
				status: 'backed-up',
				lastSyncedRevision: 'col-cp-1',
				lastSyncedHash: collationCheckpoint.contentHash,
				cloudPath: `collations/${collationId}.json`,
			},
		});

		await updateCollationMetadata(harness.db, { id: collationId, notes: 'Needs review' });
		const dirtyStatus = await getCollationVersionStatus(harness.db, collationId, {
			syncContext,
		});

		expect(dirtyStatus).toMatchObject({
			currentCheckpoint: {
				revisionId: 'col-cp-1',
				contentHash: collationCheckpoint.contentHash,
			},
			dirtyToCheckpoint: true,
			commitState: 'dirty',
			cloudBackupState: { status: 'uncommitted-local-changes' },
		});
		expect(dirtyStatus.workingContentHash).not.toBe(collationCheckpoint.contentHash);
		expect(dirtyStatus.witnesses[0].versionState).toBe('pinned-current');
	});

	it('reports dirty and newer witness source versions separately from collation dirty state', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Romans' });
		await createTranscription(harness.db, {
			...sourceTranscription('tx-1', '01'),
			projectId: 'project-1',
			projectTranscriptionId: 'pt-1',
		});
		const snapshotId = 'tx-1';
		const projectTranscriptionId = 'pt-1';
		const firstSourceCheckpoint = await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId,
			checkpointId: 'tx-cp-1',
		});
		await createCollation(harness.db, {
			id: 'col-1',
			projectId: 'project-1',
			title: 'Romans 1:1',
			verseIdentifier: 'Rom 1:1',
		});
		await saveCollationProjection(harness.db, {
			collationId: 'col-1',
			witnesses: [
				{
					witnessId: '01',
					transcriptionId: snapshotId,
					sourceVersion: 'fallback',
					content: 'In principio',
					position: 0,
				},
			],
			tokens: [],
			variationUnits: [],
		});
		await createCommittedCollationCheckpoint(harness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-1',
		});

		await updateTranscriptionContent(harness.db, {
			id: snapshotId,
			document: documentWithVerses(['Romans 1:2']),
		});
		const sourceDirtyStatus = await getCollationVersionStatus(harness.db, 'col-1');

		expect(sourceDirtyStatus.commitState).toBe('clean');
		expect(sourceDirtyStatus.witnesses[0]).toMatchObject({
			pinnedCheckpoint: {
				revisionId: 'tx-cp-1',
				contentHash: firstSourceCheckpoint.contentHash,
			},
			availableCheckpoint: {
				revisionId: 'tx-cp-1',
				contentHash: firstSourceCheckpoint.contentHash,
			},
			sourceDirtyToCheckpoint: true,
			versionState: 'source-has-uncommitted-changes',
		});

		const secondSourceCheckpoint = await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId,
			checkpointId: 'tx-cp-2',
		});
		const newerSourceStatus = await getCollationVersionStatus(harness.db, 'col-1');

		expect(newerSourceStatus.commitState).toBe('clean');
		expect(newerSourceStatus.witnesses[0]).toMatchObject({
			pinnedCheckpoint: {
				revisionId: 'tx-cp-1',
				contentHash: firstSourceCheckpoint.contentHash,
			},
			availableCheckpoint: {
				revisionId: 'tx-cp-2',
				contentHash: secondSourceCheckpoint.contentHash,
			},
			sourceDirtyToCheckpoint: false,
			versionState: 'newer-source-available',
		});
	});
});

async function getProjectTranscriptionId(transcriptionId: string): Promise<string> {
	const row = await harness.db
		.selectFrom('project_transcriptions')
		.select('id')
		.where('transcription_id', '=', transcriptionId)
		.executeTakeFirstOrThrow();
	if (!row.id) throw new Error('Missing project transcription id.');
	return row.id;
}

async function createSyncContext() {
	await upsertCloudConnection(harness.db, {
		id: 'conn-1',
		providerId: 'mock',
		providerAccountId: 'acct-1',
		accountEmail: 'editor@example.com',
	});
	return {
		connectionId: 'conn-1',
		projectId: 'project-1',
		cloudFolderId: 'folder-1',
		cloudFolderPath: 'Project',
	};
}

async function insertCollation(id: string, title: string, updatedAt: string): Promise<void> {
	await harness.db
		.insertInto('collations')
		.values({
			id,
			project_id: 'project-1',
			current_revision_id: '',
			current_content_hash: '',
			title,
			verse_identifier: 'Rom 1:1',
			status: 'setup',
			group_path: '',
			notes: '',
			sort_key: 0,
			created_at: '2024-01-01T00:00:00.000Z',
			updated_at: updatedAt,
		})
		.execute();
}

async function insertProject(id: string, name: string): Promise<void> {
	await harness.db
		.insertInto('projects')
		.values({
			id,
			storage_slug: `${id}-slug`,
			name,
			description: '',
			charter: '',
			collation_settings: '{}',
			created_at: '2024-01-01T00:00:00.000Z',
			updated_at: '2024-01-01T00:00:00.000Z',
		})
		.execute();
}

function sourceTranscription(id: string, siglum: string) {
	return {
		id,
		title: `Witness ${siglum}`,
		siglum,
		document: documentWithVerses(['Romans 1:1']),
		transcriber: 'Editor',
		repository: 'Library',
		settlement: 'City',
		language: 'grc',
	};
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
