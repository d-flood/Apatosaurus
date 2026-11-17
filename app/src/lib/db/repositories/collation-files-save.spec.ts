import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	generatedFixture,
	stateFixture,
	stateLoadFixtures,
	type Fixture,
} from '$lib/collation/__fixtures__/collation-fixtures';
import { collationState } from '$lib/collation/collation-state.svelte';
import {
	COLLATION_DOCUMENT_ARTIFACT_TYPE,
	parseCollationDocument,
	serializeCollationDocument,
} from '$lib/collation/collation-document';
import { buildSerializedCollationProjectionRows } from '$lib/collation/collation-projection';
import type { SaveCollationArtifactInput } from '$lib/db/repositories/collations';
import {
	createLocalDbTestHarness,
	createTranscriptionWithFiles,
	type LocalDbTestHarness,
} from '$lib/testing/local-db-harness';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import {
	getCollationVersionStatusWithWorkingFile,
	getSavedCollationVersionStatus,
	loadCollationWithWorkingFile,
	saveWorkingCollationArtifact,
} from './collation-files';
import { createCollation } from './collations';
import { createProject, getProject, getProjectTranscriptionIds } from './projects';
import { loadTranscriptionContentHash } from './revisions';
import {
	createCommittedTranscriptionCheckpointWithFiles,
	saveWorkingTranscriptionContent,
} from './transcription-files';
import { getVerseIndexRowsForVerse } from './transcriptions';
import { verseMilestones } from './verse-milestones.spec-support';

const client = vi.hoisted(() => ({
	loadCollation: vi.fn(),
	getProject: vi.fn(),
	getProjectTranscriptionIds: vi.fn(),
	getVerseIndexRowsForVerse: vi.fn(),
	getCollationVersionStatus: vi.fn(),
	saveCollationArtifact: vi.fn(),
}));

vi.mock('$lib/db/client', async importOriginal => ({
	...(await importOriginal<typeof import('$lib/db/client')>()),
	...client,
}));

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;
let saves: Array<{ input: SaveCollationArtifactInput; checked: Promise<void> }>;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
	saves = [];
	const db = () => harness.db;
	client.loadCollation.mockImplementation(id =>
		loadCollationWithWorkingFile(db(), id, { backend })
	);
	client.getProject.mockImplementation(id => getProject(db(), id));
	client.getProjectTranscriptionIds.mockImplementation(id =>
		getProjectTranscriptionIds(db(), id)
	);
	client.getVerseIndexRowsForVerse.mockImplementation((verse, ids) =>
		getVerseIndexRowsForVerse(db(), verse, ids)
	);
	client.getCollationVersionStatus.mockImplementation(id =>
		getCollationVersionStatusWithWorkingFile(db(), id)
	);
	client.saveCollationArtifact.mockImplementation(async (input: SaveCollationArtifactInput) => {
		const artifactId = await saveWorkingCollationArtifact(db(), input, { backend });
		const versionStatus = await getSavedCollationVersionStatus(db(), input.collationId);
		saves.push({
			input,
			checked: (async () => {
				expect(versionStatus).toEqual(
					await getCollationVersionStatusWithWorkingFile(db(), input.collationId)
				);
				expect(await storedProjection()).toEqual(fullProjection(input.payload));
			})(),
		});
		return { artifactId, versionStatus };
	});
});

afterEach(async () => {
	collationState.reset();
	await harness.destroy();
});

type State = typeof collationState;

function variationUnit(state: State) {
	const unitId = state
		.getVariationUnitSpans()
		.map(span => span.unitId)
		.find(id => state.getReadingsForUnit(id).length >= 2);
	if (!unitId) throw new Error('Fixture has no unit with two readings.');
	return { unitId, readings: () => state.getReadingsForUnit(unitId) };
}

function unitReadings(state: State) {
	return state
		.getVariationUnitSpans()
		.flatMap(({ unitId }) =>
			state.getReadingsForUnit(unitId).map(reading => ({ unitId, readingId: reading.id }))
		);
}

/** False when no candidate accepts the action, as a fixture without a second main reading. */
function firstOk<T>(candidates: T[], act: (candidate: T) => boolean): boolean {
	return candidates.some(act);
}

const editorialActions: Array<[string, (state: State) => unknown]> = [
	[
		'reading type',
		s => {
			const { unitId, readings } = variationUnit(s);
			s.setReadingType(unitId, readings()[1].id, 'orthographic');
		},
	],
	[
		'reading certainty',
		s => {
			const { unitId, readings } = variationUnit(s);
			s.setReadingCertainty(unitId, readings()[1].id, 'high');
		},
	],
	[
		'reading note',
		s => {
			const { unitId, readings } = variationUnit(s);
			s.setReadingNote(unitId, readings()[1].id, 'Reading note');
		},
	],
	[
		'lemma',
		s =>
			firstOk(unitReadings(s), ({ unitId, readingId }) => {
				if (s.getLemmaReadingId(unitId) === readingId) return false;
				return s.setLemmaReading(unitId, readingId).ok;
			}),
	],
	[
		'reading parent',
		s =>
			firstOk(unitReadings(s), ({ unitId, readingId }) => {
				const parent = s.getReadingsForUnit(unitId)[0].id;
				return parent !== readingId && s.setReadingParent(unitId, readingId, parent).ok;
			}),
	],
	['added reading', s => s.addReading(variationUnit(s).unitId)],
	['connectivity', s => s.setConnectivity(variationUnit(s).unitId, 3)],
	[
		'declared unit',
		s => {
			const ids = s.alignmentColumns.map(column => column.id);
			return firstOk(
				ids.slice(1).map((id, index) => [ids[index], id]),
				pair => {
					const before = s.declaredUnits.length;
					return s.declareUnit(pair) && s.declaredUnits.length > before;
				}
			);
		},
	],
	[
		'merged columns',
		s => {
			const [first, second] = s.alignmentColumns;
			if (!second) return false;
			s.mergeColumns([first.id, second.id]);
		},
	],
	[
		'split column',
		s => {
			const columns = s.alignmentColumns.map(column => column.id);
			return firstOk(columns, id => s.canSplitColumn(id) && (s.splitColumn(id), true));
		},
	],
	['excluded witness', s => s.toggleWitnessExclusion(s.witnesses.at(-1)!.witnessId)],
	['undo', s => s.undo()],
];

describe('collation save shortcuts', () => {
	const fixtures = async (): Promise<Fixture[]> => [
		generatedFixture(),
		await stateFixture(),
		...stateLoadFixtures().filter(
			fixture => (fixture.document.alignment?.columns.length ?? 0) > 0
		),
	];

	it('returns the fresh Version status and the full projection after each editorial action', async () => {
		for (const fixture of await fixtures()) {
			const state = await openFixture(fixture);
			const source = state.witnesses.find(witness => witness.transcriptionId)!;
			const sourceId = source.transcriptionId;
			const projectTranscriptionId = `pt-${sourceId}`;
			const skipped: string[] = [];
			const act = async (kind: string, action: (state: State) => unknown) => {
				const before = saves.length;
				if ((await action(state)) === false) {
					skipped.push(kind);
					return;
				}
				await state.flushPendingSave();
				expect(saves.length, `${fixture.name}: ${kind}`).toBe(before + 1);
				await saves.at(-1)!.checked;
			};
			const sourceState = () =>
				state.versionStatus?.witnesses.find(entry => entry.witnessId === source.witnessId)
					?.versionState;

			for (const [kind, action] of editorialActions) await act(kind, action);
			if (fixture.name === 'generated 100 witnesses') expect(skipped).toEqual([]);

			const captureCurrent = () => async (s: State) =>
				s.updateWitness(source.witnessId, {
					source: {
						kind: 'current',
						transcriptionId: sourceId,
						capturedAt: new Date().toISOString(),
						contentHash: await loadTranscriptionContentHash(
							harness.db,
							projectTranscriptionId
						),
					},
				});
			await act('witness source', captureCurrent());
			expect(sourceState()).toBe('up-to-date');

			const ids = await projectionIds();
			await act('note only', s => s.setNotes('Collation note'));
			expect(await projectionIds()).toEqual(ids);

			await saveWorkingTranscriptionContent(
				harness.db,
				{
					id: sourceId,
					document: transcriptionDocument(),
				},
				{ backend }
			);
			await act('save after a transcription edit', s => s.setNotes('After an edit'));
			expect(sourceState()).toBe('source-changed');

			await act('recaptured source', captureCurrent());
			expect(sourceState()).toBe('up-to-date');
			await createCommittedTranscriptionCheckpointWithFiles(
				harness.db,
				{ projectTranscriptionId, createdAt: new Date(Date.now() + 60_000).toISOString() },
				{ backend }
			);
			await act('save after a named Version', s => s.setNotes('After a Version'));
			expect(sourceState()).toBe('source-changed');

			collationState.reset();
			await harness.destroy();
			harness = createLocalDbTestHarness();
			backend = new MemoryStoreBackend();
		}
	}, 120_000);
});

async function openFixture(fixture: Fixture): Promise<State> {
	collationState.reset();
	await createProject(
		harness.db,
		{
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Project',
			createdAt: '2026-07-04T00:00:00.000Z',
			updatedAt: '2026-07-04T00:00:00.000Z',
		},
		{ backend }
	);
	const transcriptionIds = new Set(
		fixture.document.setup.witnesses.map(witness => witness.transcriptionId).filter(Boolean)
	);
	for (const id of transcriptionIds)
		await createTranscriptionWithFiles(
			harness.db,
			{
				id,
				projectId: 'project-1',
				projectTranscriptionId: `pt-${id}`,
				title: id,
				siglum: id,
				document: { type: 'transcriptionDocument', pages: [] },
				transcriber: '',
				repository: '',
				settlement: '',
				language: 'grc',
			},
			{ backend }
		);
	await createCollation(harness.db, {
		id: 'col-1',
		projectId: 'project-1',
		title: fixture.name,
		verseIdentifier: fixture.document.setup.segment.name,
		now: '2026-07-04T00:00:00.000Z',
	});
	await saveWorkingCollationArtifact(
		harness.db,
		{
			collationId: 'col-1',
			artifactType: COLLATION_DOCUMENT_ARTIFACT_TYPE,
			payload: serializeCollationDocument(fixture.document),
		},
		{ backend }
	);
	expect(await collationState.loadCollationById('col-1')).toBe(true);
	await vi.waitFor(() => expect(collationState.versionStatus).not.toBeNull());
	return collationState;
}

function transcriptionDocument() {
	return {
		type: 'transcriptionDocument' as const,
		pages: [
			{
				type: 'page' as const,
				id: 'page-1',
				columns: [
					{
						type: 'column' as const,
						number: 1,
						lines: [
							{
								type: 'line' as const,
								number: 1,
								items: verseMilestones(['Romans 1:1']),
							},
						],
					},
				],
			},
		],
	};
}

async function projectionIds(): Promise<string[]> {
	const tables = [
		'collation_witnesses',
		'collation_tokens',
		'collation_variation_units',
		'collation_readings',
		'collation_reading_witnesses',
	] as const;
	const ids = await Promise.all(
		tables.map(table => harness.db.selectFrom(table).select('id').execute())
	);
	return ids.flatMap(rows => rows.map(row => row.id!)).sort();
}

interface ComparableProjection {
	witnesses: unknown[];
	tokens: unknown[];
	units: unknown[];
}

async function storedProjection(): Promise<ComparableProjection> {
	const db = harness.db;
	const [witnesses, tokens, units, readings, readingWitnesses] = await Promise.all([
		db
			.selectFrom('collation_witnesses')
			.selectAll()
			.where('collation_id', '=', 'col-1')
			.execute(),
		db.selectFrom('collation_tokens').selectAll().where('collation_id', '=', 'col-1').execute(),
		db
			.selectFrom('collation_variation_units')
			.selectAll()
			.where('collation_id', '=', 'col-1')
			.execute(),
		db.selectFrom('collation_readings').selectAll().execute(),
		db.selectFrom('collation_reading_witnesses').selectAll().execute(),
	]);
	return comparable({
		witnesses,
		tokens,
		units,
		readings: readings.map(row => ({
			...row,
			is_lacuna: row.is_lacuna === 1,
			is_omission: row.is_omission === 1,
		})),
		readingWitnesses,
	});
}

function fullProjection(payload: string): ComparableProjection {
	const rows = buildSerializedCollationProjectionRows(
		'col-1',
		parseCollationDocument(payload)!,
		new Map(
			[...new Set(JSON.parse(payload).setup.witnesses.map((w: any) => w.transcriptionId))]
				.filter(Boolean)
				.map(id => [id as string, `pt-${id}`])
		)
	);
	return comparable({
		witnesses: rows.witnesses,
		tokens: rows.tokens.map(row => ({ ...row, token_text: row.token_text.slice(0, 255) })),
		units: rows.variation_units,
		readings: rows.readings,
		readingWitnesses: rows.reading_witnesses,
	});
}

function comparable(rows: {
	witnesses: object[];
	tokens: object[];
	units: Array<{ id: string | null }>;
	readings: Array<{ id: string | null; variation_unit_id: string }>;
	readingWitnesses: Array<{ reading_id: string; witness_id: string }>;
}): ComparableProjection {
	const strip = (row: object) => {
		const { id: _id, collation_id: _collation, ...rest } = row as Record<string, unknown>;
		return rest;
	};
	const sorted = (values: unknown[]) =>
		values
			.map(value => JSON.stringify(value))
			.sort()
			.map(value => JSON.parse(value));
	return {
		witnesses: sorted(rows.witnesses.map(strip)),
		tokens: sorted(rows.tokens.map(strip)),
		units: sorted(
			rows.units.map(unit => ({
				...strip(unit),
				readings: sorted(
					rows.readings
						.filter(reading => reading.variation_unit_id === unit.id)
						.map(({ variation_unit_id: _unit, ...reading }) => ({
							...strip(reading),
							witnesses: rows.readingWitnesses
								.filter(witness => witness.reading_id === reading.id)
								.map(witness => witness.witness_id)
								.sort(),
						}))
				),
			}))
		),
	};
}
