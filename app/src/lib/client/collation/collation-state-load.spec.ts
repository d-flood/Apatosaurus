import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCollationDocument, serializeCollationDocument } from './collation-document';

const {
	ensureDjazzkitRuntime,
	getCollationRow,
	createCollationRow,
	updateCollationRow,
	getArtifactRow,
	createArtifactRow,
	updateArtifactRow,
	getProjectRow,
	getTranscriptionRows,
	listCollationWitnessRows,
	createCollationWitnessRow,
	updateCollationWitnessRow,
	listCollationTokenRows,
	createCollationTokenRow,
	updateCollationTokenRow,
	listVariationUnitRows,
	createVariationUnitRow,
	updateVariationUnitRow,
	listReadingRows,
	createReadingRow,
	updateReadingRow,
	listReadingWitnessRows,
	createReadingWitnessRow,
	updateReadingWitnessRow,
	gatherWitnessesForVerse,
} = vi.hoisted(() => ({
	ensureDjazzkitRuntime: vi.fn(),
	getCollationRow: vi.fn(),
	createCollationRow: vi.fn(),
	updateCollationRow: vi.fn(),
	getArtifactRow: vi.fn(),
	createArtifactRow: vi.fn(),
	updateArtifactRow: vi.fn(),
	getProjectRow: vi.fn(),
	getTranscriptionRows: vi.fn(),
	listCollationWitnessRows: vi.fn(),
	createCollationWitnessRow: vi.fn(),
	updateCollationWitnessRow: vi.fn(),
	listCollationTokenRows: vi.fn(),
	createCollationTokenRow: vi.fn(),
	updateCollationTokenRow: vi.fn(),
	listVariationUnitRows: vi.fn(),
	createVariationUnitRow: vi.fn(),
	updateVariationUnitRow: vi.fn(),
	listReadingRows: vi.fn(),
	createReadingRow: vi.fn(),
	updateReadingRow: vi.fn(),
	listReadingWitnessRows: vi.fn(),
	createReadingWitnessRow: vi.fn(),
	updateReadingWitnessRow: vi.fn(),
	gatherWitnessesForVerse: vi.fn(),
}));

function makeFilterQuery<T>(handlers: { first?: () => Promise<T>; all?: () => Promise<T[]> }) {
	const query = {
		filter: vi.fn(() => query),
		orderBy: vi.fn(() => query),
		first: handlers.first,
		all: handlers.all,
	};
	return query;
}

vi.mock('$lib/client/djazzkit-runtime', () => ({
	ensureDjazzkitRuntime,
}));

vi.mock('$generated/models/Collation', () => ({
	Collation: {
		objects: {
			filter: vi.fn(() => makeFilterQuery({ first: getCollationRow })),
			create: createCollationRow,
			update: updateCollationRow,
		},
	},
}));

vi.mock('$generated/models/CollationArtifact', () => ({
	CollationArtifact: {
		objects: {
			filter: vi.fn(() => makeFilterQuery({ first: getArtifactRow })),
			create: createArtifactRow,
			update: updateArtifactRow,
		},
	},
}));

vi.mock('$generated/models/Project', () => ({
	Project: {
		objects: {
			filter: vi.fn(() => makeFilterQuery({ first: getProjectRow })),
		},
	},
}));

vi.mock('$generated/models/Transcription', () => ({
	Transcription: {
		objects: {
			filter: vi.fn(() => makeFilterQuery({ all: getTranscriptionRows })),
		},
	},
}));

vi.mock('$generated/models/CollationWitness', () => ({
	CollationWitness: {
		objects: {
			filter: vi.fn(() => makeFilterQuery({ all: listCollationWitnessRows })),
			create: createCollationWitnessRow,
			update: updateCollationWitnessRow,
		},
	},
}));

vi.mock('$generated/models/CollationToken', () => ({
	CollationToken: {
		objects: {
			filter: vi.fn(() => makeFilterQuery({ all: listCollationTokenRows })),
			create: createCollationTokenRow,
			update: updateCollationTokenRow,
		},
	},
}));

vi.mock('$generated/models/CollationVariationUnit', () => ({
	CollationVariationUnit: {
		objects: {
			filter: vi.fn(() => makeFilterQuery({ all: listVariationUnitRows })),
			create: createVariationUnitRow,
			update: updateVariationUnitRow,
		},
	},
}));

vi.mock('$generated/models/CollationReading', () => ({
	CollationReading: {
		objects: {
			all: vi.fn(() => makeFilterQuery({ all: listReadingRows })),
			create: createReadingRow,
			update: updateReadingRow,
		},
	},
}));

vi.mock('$generated/models/CollationReadingWitness', () => ({
	CollationReadingWitness: {
		objects: {
			all: vi.fn(() => makeFilterQuery({ all: listReadingWitnessRows })),
			create: createReadingWitnessRow,
			update: updateReadingWitnessRow,
		},
	},
}));

vi.mock('./collation-runner', () => ({
	gatherWitnessesForVerse,
}));

function makeWitness(witnessId: string, content: string, isBaseText: boolean = false) {
	return {
		witnessId,
		siglum: witnessId,
		transcriptionId: `${witnessId}-tx`,
		sourceVersion: '2026-03-10T00:00:00.000Z',
		content,
		tokens: content.split(/\s+/).filter(Boolean).map((token) => ({
			kind: 'text' as const,
			original: token,
			segments: [
				{
					text: token,
					hasUnclear: false,
					isPunctuation: false,
					isSupplied: false,
				},
			],
			gap: null,
		})),
		treatment: 'inherit' as const,
		isBaseText,
		isExcluded: false,
		overridesDefault: false,
	};
}

function makeDocumentPayload() {
	return serializeCollationDocument(
		buildCollationDocument({
			collationId: 'col-1',
			projectId: 'proj-1',
			projectName: 'Project 1',
			phase: 'alignment',
			furthestPhase: 'alignment',
			selectedVerse: {
				identifier: 'Romans 1:1',
				book: 'Romans',
				chapter: '1',
				verse: '1',
				count: 2,
			},
			selectedBook: 'Romans',
			selectedChapter: '1',
			selectedVerseNum: '1',
			witnesses: [
				makeWitness('A', 'και θεος', true),
				makeWitness('B', 'και λογος'),
			],
			rules: [],
			ignoreWordBreaks: false,
			lowercase: false,
			ignoreTokenWhitespace: true,
			ignorePunctuation: false,
			suppliedTextMode: 'clear',
			segmentation: true,
			alignmentColumns: [],
			witnessOrder: ['A', 'B'],
			classifiedReadings: new Map(),
			stemmaEdges: new Map(),
			alignmentDisplayMode: 'regularized',
			alignmentLayout: 'variation-units',
		}),
	);
}

async function importState() {
	const mod = await import('./collation-state.svelte');
	return mod.collationState;
}

describe('collationState artifact-first persistence', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		ensureDjazzkitRuntime.mockResolvedValue(undefined);
		getCollationRow.mockResolvedValue({
			_djazzkit_id: 'col-1',
			project_id: 'proj-1',
			verse_identifier: 'Romans 1:1',
			status: 'alignment',
		});
		createCollationRow.mockResolvedValue(undefined);
		updateCollationRow.mockResolvedValue(undefined);
		getArtifactRow.mockResolvedValue({
			_djazzkit_id: 'artifact-1',
			payload: makeDocumentPayload(),
		});
		createArtifactRow.mockResolvedValue(undefined);
		updateArtifactRow.mockResolvedValue(undefined);
		getProjectRow.mockResolvedValue({
			_djazzkit_id: 'proj-1',
			name: 'Project 1',
			collation_settings: JSON.stringify({
				regularizationRules: [],
				ignoreWordBreaks: false,
				lowercase: false,
				ignoreTokenWhitespace: true,
				ignorePunctuation: false,
				suppliedTextMode: 'clear',
				segmentation: true,
				transcriptionWitnessTreatments: {},
			}),
		});
		getTranscriptionRows.mockResolvedValue([
			{
				_djazzkit_id: 'A-tx',
				_djazzkit_deleted: false,
				_djazzkit_updated_at: '2026-03-10T00:00:00.000Z',
				updated_at: '2026-03-10T00:00:00.000Z',
			},
			{
				_djazzkit_id: 'B-tx',
				_djazzkit_deleted: false,
				_djazzkit_updated_at: '2026-03-10T00:00:00.000Z',
				updated_at: '2026-03-10T00:00:00.000Z',
			},
		]);
		listCollationWitnessRows.mockResolvedValue([]);
		createCollationWitnessRow.mockResolvedValue(undefined);
		updateCollationWitnessRow.mockResolvedValue(undefined);
		listCollationTokenRows.mockResolvedValue([]);
		createCollationTokenRow.mockResolvedValue(undefined);
		updateCollationTokenRow.mockResolvedValue(undefined);
		listVariationUnitRows.mockResolvedValue([]);
		createVariationUnitRow.mockResolvedValue(undefined);
		updateVariationUnitRow.mockResolvedValue(undefined);
		listReadingRows.mockResolvedValue([]);
		createReadingRow.mockResolvedValue(undefined);
		updateReadingRow.mockResolvedValue(undefined);
		listReadingWitnessRows.mockResolvedValue([]);
		createReadingWitnessRow.mockResolvedValue(undefined);
		updateReadingWitnessRow.mockResolvedValue(undefined);
		gatherWitnessesForVerse.mockResolvedValue([]);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('loads from the canonical artifact without refreshing unchanged witnesses', async () => {
		const collationState = await importState();
		collationState.reset();

		const loaded = await collationState.loadCollationById('col-1');

		expect(loaded).toBe(true);
		expect(collationState.selectedVerse?.identifier).toBe('Romans 1:1');
		expect(collationState.alignmentLayout).toBe('variation-units');
		expect(collationState.ignoreWordBreaks).toBe(false);
		expect(gatherWitnessesForVerse).not.toHaveBeenCalled();
	}, 30000);

	it('does not block artifact load while changed witnesses refresh in the background', async () => {
		getTranscriptionRows.mockResolvedValue([
			{
				_djazzkit_id: 'A-tx',
				_djazzkit_deleted: false,
				_djazzkit_updated_at: '2026-03-12T00:00:00.000Z',
				updated_at: '2026-03-12T00:00:00.000Z',
			},
			{
				_djazzkit_id: 'B-tx',
				_djazzkit_deleted: false,
				_djazzkit_updated_at: '2026-03-10T00:00:00.000Z',
				updated_at: '2026-03-10T00:00:00.000Z',
			},
		]);
		gatherWitnessesForVerse.mockReturnValue(new Promise(() => {}));
		const collationState = await importState();
		collationState.reset();

		const loaded = await collationState.loadCollationById('col-1');
		await Promise.resolve();
		await Promise.resolve();

		expect(loaded).toBe(true);
		expect(gatherWitnessesForVerse).toHaveBeenCalledWith('Romans 1:1', ['A-tx'], {
			ignoreWordBreaks: false,
		});
	}, 30000);

	it('can refresh witness tokens from source before rerunning collation', async () => {
		gatherWitnessesForVerse.mockResolvedValue([
			{
				id: 'A',
				siglum: 'A',
				content: 'κλη\\nτος',
				tokens: [
					{
						kind: 'text',
						original: 'κλη\\nτος',
						segments: [
							{
								text: 'κλη\\nτος',
								hasUnclear: false,
								isPunctuation: false,
								isSupplied: false,
							},
						],
						gap: null,
					},
				],
				transcriptionUid: 'A-tx',
				sourceVersion: '2026-03-10T00:00:00.000Z',
			},
		]);
		const collationState = await importState();
		collationState.reset();
		await collationState.loadCollationById('col-1');

		const changed = await collationState.refreshWitnessesFromSource(['A-tx']);

		expect(changed).toBe(true);
		expect(gatherWitnessesForVerse).toHaveBeenCalledWith('Romans 1:1', ['A-tx'], {
			ignoreWordBreaks: false,
		});
		expect(collationState.witnesses[0]?.tokens[0]?.original).toBe('κλη\\nτος');
	}, 30000);

	it('refreshes witness tokens after load when project preprocessing differs from the artifact', async () => {
		getProjectRow.mockResolvedValue({
			_djazzkit_id: 'proj-1',
			name: 'Project 1',
			collation_settings: JSON.stringify({
				regularizationRules: [],
				ignoreWordBreaks: true,
				lowercase: false,
				ignoreTokenWhitespace: true,
				ignorePunctuation: false,
				suppliedTextMode: 'clear',
				segmentation: true,
				transcriptionWitnessTreatments: {},
			}),
		});
		gatherWitnessesForVerse.mockResolvedValue([
			{
				id: 'A',
				siglum: 'A',
				content: 'κλητος',
				tokens: [
					{
						kind: 'text',
						original: 'κλητος',
						segments: [
							{
								text: 'κλητος',
								hasUnclear: false,
								isPunctuation: false,
								isSupplied: false,
							},
						],
						gap: null,
					},
				],
				transcriptionUid: 'A-tx',
				sourceVersion: '2026-03-10T00:00:00.000Z',
			},
		]);
		const collationState = await importState();
		collationState.reset();

		const loaded = await collationState.loadCollationById('col-1');

		expect(loaded).toBe(true);
		expect(collationState.ignoreWordBreaks).toBe(true);
		expect(gatherWitnessesForVerse).toHaveBeenCalledWith('Romans 1:1', ['A-tx', 'B-tx'], {
			ignoreWordBreaks: true,
		});
		expect(collationState.witnesses[0]?.tokens[0]?.original).toBe('κλητος');
	});

	it('skips normalized projection writes until the collation reaches stemma', async () => {
		const collationState = await importState();
		collationState.reset();
		await collationState.selectProject('proj-1');
		await vi.advanceTimersByTimeAsync(801);
		vi.clearAllMocks();
		ensureDjazzkitRuntime.mockResolvedValue(undefined);
		getArtifactRow.mockResolvedValue({
			_djazzkit_id: 'artifact-existing',
		});

		const collationId = await collationState.createNewCollation('Romans 1:1', 'Romans 1:1');
		vi.clearAllMocks();
		ensureDjazzkitRuntime.mockResolvedValue(undefined);
		getArtifactRow.mockResolvedValue({
			_djazzkit_id: 'artifact-existing',
		});
		updateArtifactRow.mockResolvedValue(undefined);
		updateCollationRow.mockResolvedValue(undefined);

		collationState.selectedVerse = {
			identifier: 'Romans 1:1',
			book: 'Romans',
			chapter: '1',
			verse: '1',
			count: 2,
		};
		collationState.setWitnesses([
			makeWitness('A', 'και θεος', true),
			makeWitness('B', 'και λογος'),
		]);
		collationState.nextPhase();
		await vi.advanceTimersByTimeAsync(801);

		expect(updateCollationRow).toHaveBeenCalledWith(
			collationId,
			expect.objectContaining({ status: 'regularization' }),
		);
		expect(listCollationWitnessRows).not.toHaveBeenCalled();
	});

	it('materializes the normalized projection when the collation is saved in stemma', async () => {
		const collationState = await importState();
		collationState.reset();
		await collationState.selectProject('proj-1');
		await vi.advanceTimersByTimeAsync(801);
		vi.clearAllMocks();
		ensureDjazzkitRuntime.mockResolvedValue(undefined);
		getArtifactRow.mockResolvedValue({
			_djazzkit_id: 'artifact-existing',
		});

		const collationId = await collationState.createNewCollation('Romans 1:1', 'Romans 1:1');
		vi.clearAllMocks();
		ensureDjazzkitRuntime.mockResolvedValue(undefined);
		getArtifactRow.mockResolvedValue({
			_djazzkit_id: 'artifact-existing',
		});
		updateArtifactRow.mockResolvedValue(undefined);
		updateCollationRow.mockResolvedValue(undefined);

		collationState.selectedVerse = {
			identifier: 'Romans 1:1',
			book: 'Romans',
			chapter: '1',
			verse: '1',
			count: 2,
		};
		collationState.setWitnesses([
			makeWitness('A', 'και θεος', true),
			makeWitness('B', 'και λογος'),
		]);
		collationState.nextPhase();
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: [
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						[
							'A',
							{
								text: 'και',
								regularizedText: 'και',
								alignmentValue: 'και',
								sourceTokenIds: ['A::source::0'],
								kind: 'text',
								gap: null,
								isOmission: false,
								isLacuna: false,
								isRegularized: false,
								ruleIds: [],
								regularizationTypes: [],
							},
						],
						[
							'B',
							{
								text: 'και',
								regularizedText: 'και',
								alignmentValue: 'και',
								sourceTokenIds: ['B::source::0'],
								kind: 'text',
								gap: null,
								isOmission: false,
								isLacuna: false,
								isRegularized: false,
								ruleIds: [],
								regularizationTypes: [],
							},
						],
					],
				},
			],
		});
		collationState.nextPhase();
		collationState.nextPhase();
		collationState.nextPhase();
		await vi.advanceTimersByTimeAsync(801);

		expect(listCollationWitnessRows).toHaveBeenCalled();
		expect(updateCollationRow).toHaveBeenCalledWith(
			collationId,
			expect.objectContaining({ status: 'complete' }),
		);
	});
});
