import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/transcription/content';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import { createProject as createProjectRepository } from './projects';
import {
	createCommittedCollationCheckpoint,
	createCommittedTranscriptionCheckpoint,
	getTranscriptionCurrentContentHashes,
} from './revisions';
import { createTranscription, updateTranscriptionContent } from './transcriptions';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '$lib/testing/local-db-harness';
import {
	createCollation,
	getCollationWitnessSourceStatuses,
	deleteCollation,
	listCollationsWithProjectNames,
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

	it('creates and updates the canonical artifact and metadata', async () => {
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

		await expect(
			harness.db
				.selectFrom('collation_artifacts')
				.select(['id', 'payload'])
				.where('collation_id', '=', id)
				.execute()
		).resolves.toEqual([{ id: 'artifact-1', payload: '{"version":2}' }]);
		await expect(
			harness.db
				.selectFrom('collations')
				.select(['status', 'updated_at'])
				.where('id', '=', id)
				.executeTakeFirst()
		).resolves.toEqual({ status: 'complete', updated_at: '2024-01-04T00:00:00.000Z' });
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
					content: 'Principio',
					position: 0,
				},
			],
			tokens: [{ witnessId: 'B', tokenIndex: 0, tokenText: 'Principio' }],
			variationUnits: [],
		});

		const witnesses = await harness.db
			.selectFrom('collation_witnesses')
			.select(['witness_id', 'content', 'position'])
			.where('collation_id', '=', 'col-1')
			.execute();
		expect(witnesses).toEqual([{ witness_id: 'B', content: 'Principio', position: 0 }]);
		const tokens = await harness.db
			.selectFrom('collation_tokens')
			.select(['witness_id', 'token_index', 'token_text'])
			.where('collation_id', '=', 'col-1')
			.execute();
		expect(tokens).toEqual([{ witness_id: 'B', token_index: 0, token_text: 'Principio' }]);
		const units = await harness.db
			.selectFrom('collation_variation_units')
			.select('id')
			.where('collation_id', '=', 'col-1')
			.execute();
		expect(units).toEqual([]);
	});

	it('stores witness sources for project transcription witnesses', async () => {
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
		await insertCollation('col-1', 'Romans 1:1', '2024-01-02T00:00:00.000Z');

		await saveCollationProjection(harness.db, {
			collationId: 'col-1',
			witnesses: [
				{
					witnessId: '01',
					transcriptionId: 'tx-1',
					source: { kind: 'version', transcriptionId: 'tx-1', versionId: 'tx-cp-1' },
					content: 'In principio',
					position: 0,
				},
			],
			tokens: [],
			variationUnits: [],
		});

		const versionRow = await harness.db
			.selectFrom('collation_witnesses')
			.selectAll()
			.where('collation_id', '=', 'col-1')
			.executeTakeFirstOrThrow();
		expect(versionRow).toMatchObject({
			project_transcription_id: 'pt-1',
			transcription_id: 'tx-1',
			source_kind: 'version',
			source_revision_id: 'tx-cp-1',
			source_content_hash: '',
			source_captured_at: '',
		});

		await saveCollationProjection(harness.db, {
			collationId: 'col-1',
			witnesses: [
				{
					witnessId: '01',
					transcriptionId: 'tx-1',
					source: {
						kind: 'current',
						transcriptionId: 'tx-1',
						capturedAt: '2026-09-27T14:02:00.000Z',
						contentHash: 'sha256:current',
					},
					content: 'In principio',
					position: 0,
				},
			],
			tokens: [],
			variationUnits: [],
		});

		const currentRow = await harness.db
			.selectFrom('collation_witnesses')
			.selectAll()
			.where('collation_id', '=', 'col-1')
			.executeTakeFirstOrThrow();
		expect(currentRow).toMatchObject({
			project_transcription_id: 'pt-1',
			transcription_id: 'tx-1',
			source_kind: 'current',
			source_revision_id: '',
			source_content_hash: 'sha256:current',
			source_captured_at: '2026-09-27T14:02:00.000Z',
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
						content: 'local',
						position: 0,
					},
				],
				tokens: [],
				variationUnits: [],
			})
		).rejects.toThrow('does not match transcription tx-1');
	});

	it('offers a witness refresh only after its source Current changes or gains a version', async () => {
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
		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: 'pt-2',
			checkpointId: 'tx-2-cp-1',
			createdAt: '2026-01-01T00:00:00.000Z',
		});
		const capturedHashes = await getTranscriptionCurrentContentHashes(harness.db, [
			'tx-1',
			'tx-2',
		]);
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
					witnessId: 'current',
					transcriptionId: 'tx-1',
					source: {
						kind: 'current',
						transcriptionId: 'tx-1',
						capturedAt: '2026-01-02T00:00:00.000Z',
						contentHash: capturedHashes['tx-1'],
					},
					content: 'In principio',
					position: 0,
				},
				{
					witnessId: 'version',
					transcriptionId: 'tx-2',
					source: { kind: 'version', transcriptionId: 'tx-2', versionId: 'tx-2-cp-1' },
					content: 'In principio',
					position: 1,
				},
			],
			tokens: [],
			variationUnits: [],
		});
		const states = async () =>
			(await getCollationWitnessSourceStatuses(harness.db, 'col-1')).map(
				witness => witness.versionState
			);

		expect(await states()).toEqual(['up-to-date', 'up-to-date']);

		await createCommittedCollationCheckpoint(harness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-1',
		});
		expect(await states()).toEqual(['up-to-date', 'up-to-date']);

		await updateTranscriptionContent(harness.db, {
			id: 'tx-2',
			document: documentWithVerses(['Romans 1:2']),
		});
		expect(await states()).toEqual(['up-to-date', 'up-to-date']);

		await updateTranscriptionContent(harness.db, {
			id: 'tx-1',
			document: documentWithVerses(['Romans 1:2']),
		});
		expect(await states()).toEqual(['source-changed', 'up-to-date']);

		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: 'pt-2',
			checkpointId: 'tx-2-cp-2',
			createdAt: '2026-01-03T00:00:00.000Z',
		});
		expect(await states()).toEqual(['source-changed', 'source-changed']);
	});

	it('offers a Current witness refresh when its unchanged source gains a version', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Romans' });
		await createTranscription(harness.db, {
			...sourceTranscription('tx-1', '01'),
			projectId: 'project-1',
			projectTranscriptionId: 'pt-1',
		});
		const capturedHashes = await getTranscriptionCurrentContentHashes(harness.db, ['tx-1']);
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
					transcriptionId: 'tx-1',
					source: {
						kind: 'current',
						transcriptionId: 'tx-1',
						capturedAt: '2026-01-02T00:00:00.000Z',
						contentHash: capturedHashes['tx-1'],
					},
					content: 'In principio',
					position: 0,
				},
			],
			tokens: [],
			variationUnits: [],
		});

		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: 'pt-1',
			checkpointId: 'tx-cp-1',
			createdAt: '2026-01-03T00:00:00.000Z',
		});

		expect((await getCollationWitnessSourceStatuses(harness.db, 'col-1'))[0]).toMatchObject({
			versionState: 'source-changed',
		});
	});
});

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
			conflict_of_collation_id: '',
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
