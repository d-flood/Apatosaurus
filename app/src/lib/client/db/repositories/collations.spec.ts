import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProject, syncProjectTranscriptionIds } from './projects';
import { createCommittedTranscriptionCheckpoint } from './revisions';
import { createTranscription } from './transcriptions';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import {
	createCollation,
	deleteCollation,
	listCollationsWithProjectNames,
	loadCollation,
	saveCollationArtifact,
	saveCollationProjection,
	updateCollationMetadata,
} from './collations';

let harness: LocalDbTestHarness;

beforeEach(() => {
	harness = createLocalDbTestHarness();
});

afterEach(async () => {
	await harness.destroy();
});

describe('collations repository', () => {
	it('lists collations with project names without loading artifact/projection rows', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Romans', updatedAt: '2024-01-01T00:00:00.000Z' });
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
		await expect(harness.db.selectFrom('collation_artifacts').selectAll().execute()).resolves.toEqual([]);
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
			witnesses: [{ witnessId: 'A', transcriptionId: null, sourceVersion: 'v1', content: 'In principio', position: 0 }],
			tokens: [{ witnessId: 'A', tokenIndex: 0, tokenText: 'In' }],
			variationUnits: [
				{
					startIndex: 0,
					endIndex: 1,
					unitType: 'variation',
					baseText: 'In',
					readings: [{ readingOrder: 0, readingText: 'In', isOmission: false, isLacuna: false, witnessIds: ['A'] }],
				},
			],
		});
		await saveCollationProjection(harness.db, {
			collationId: 'col-1',
			witnesses: [{ witnessId: 'B', transcriptionId: null, sourceVersion: 'v2', content: 'Principio', position: 0 }],
			tokens: [{ witnessId: 'B', tokenIndex: 0, tokenText: 'Principio' }],
			variationUnits: [],
		});

		const loaded = await loadCollation(harness.db, 'col-1');
		expect(loaded?.projection.witnesses).toEqual([
			{ witnessId: 'B', transcriptionId: null, sourceVersion: 'v2', content: 'Principio', position: 0 },
		]);
		expect(loaded?.projection.tokens).toEqual([{ witnessId: 'B', tokenIndex: 0, tokenText: 'Principio' }]);
		expect(loaded?.projection.variationUnits).toEqual([]);
	});

	it('stores exact committed source revisions for project transcription witnesses', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Romans' });
		await createTranscription(harness.db, {
			id: 'tx-1',
			title: 'Witness 01',
			siglum: '01',
			transcriber: 'Editor',
			repository: 'Library',
			settlement: 'City',
			language: 'grc',
		});
		const [snapshotId] = await syncProjectTranscriptionIds(harness.db, 'project-1', ['tx-1']);
		const projectTranscriptionId = await getProjectTranscriptionId(snapshotId);
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
