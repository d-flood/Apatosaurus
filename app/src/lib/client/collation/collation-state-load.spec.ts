import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCollationDocument, serializeCollationDocument } from './collation-document';

const {
	loadCollation,
	createCollation,
	saveCollationArtifact,
	saveCollationProjection,
	updateCollationMetadata,
	getProject,
	createProject,
	updateProjectMetadata,
	getTranscriptionVersionsByIds,
	gatherWitnessesForVerse,
} = vi.hoisted(() => ({
	loadCollation: vi.fn(),
	createCollation: vi.fn(),
	saveCollationArtifact: vi.fn(),
	saveCollationProjection: vi.fn(),
	updateCollationMetadata: vi.fn(),
	getProject: vi.fn(),
	createProject: vi.fn(),
	updateProjectMetadata: vi.fn(),
	getTranscriptionVersionsByIds: vi.fn(),
	gatherWitnessesForVerse: vi.fn(),
}));

vi.mock('$lib/client/db/client', () => ({
	loadCollation,
	createCollation,
	saveCollationArtifact,
	saveCollationProjection,
	updateCollationMetadata,
	getProject,
	createProject,
	updateProjectMetadata,
	getTranscriptionVersionsByIds,
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
		tokens: content
			.split(/\s+/)
			.filter(Boolean)
			.map(token => ({
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
			witnesses: [makeWitness('A', 'και θεος', true), makeWitness('B', 'και λογος')],
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
		})
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
		loadCollation.mockResolvedValue({
			row: {
				id: 'col-1',
				projectId: 'proj-1',
				title: 'Romans 1:1',
				verseIdentifier: 'Romans 1:1',
				status: 'alignment',
				groupPath: '',
				notes: '',
				sortKey: 0,
				createdAt: '2026-03-10T00:00:00.000Z',
				updatedAt: '2026-03-10T00:00:00.000Z',
			},
			artifact: {
				id: 'artifact-1',
				artifactType: 'collation_document_v1',
				payload: makeDocumentPayload(),
				createdAt: '2026-03-10T00:00:00.000Z',
			},
			legacyArtifact: null,
			projection: { witnesses: [], tokens: [], variationUnits: [] },
		});
		createCollation.mockResolvedValue('col-new');
		saveCollationArtifact.mockResolvedValue('artifact-existing');
		saveCollationProjection.mockResolvedValue(undefined);
		updateCollationMetadata.mockResolvedValue(undefined);
		createProject.mockResolvedValue('proj-new');
		updateProjectMetadata.mockResolvedValue(undefined);
		getProject.mockResolvedValue({
			id: 'proj-1',
			name: 'Project 1',
			description: '',
			charter: '',
			collationSettings: {
				regularizationRules: [],
				ignoreWordBreaks: false,
				lowercase: false,
				ignoreTokenWhitespace: true,
				ignorePunctuation: false,
				suppliedTextMode: 'clear',
				segmentation: true,
				transcriptionWitnessTreatments: {},
			},
			ownerId: null,
			createdAt: '2026-03-10T00:00:00.000Z',
			updatedAt: '2026-03-10T00:00:00.000Z',
		});
		getTranscriptionVersionsByIds.mockResolvedValue([
			{
				id: 'A-tx',
				updated_at: '2026-03-10T00:00:00.000Z',
			},
			{
				id: 'B-tx',
				updated_at: '2026-03-10T00:00:00.000Z',
			},
		]);
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
		getTranscriptionVersionsByIds.mockResolvedValue([
			{
				id: 'A-tx',
				updated_at: '2026-03-12T00:00:00.000Z',
			},
			{
				id: 'B-tx',
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
		getProject.mockResolvedValue({
			id: 'proj-1',
			name: 'Project 1',
			description: '',
			charter: '',
			collationSettings: {
				regularizationRules: [],
				ignoreWordBreaks: true,
				lowercase: false,
				ignoreTokenWhitespace: true,
				ignorePunctuation: false,
				suppliedTextMode: 'clear',
				segmentation: true,
				transcriptionWitnessTreatments: {},
			},
			ownerId: null,
			createdAt: '2026-03-10T00:00:00.000Z',
			updatedAt: '2026-03-10T00:00:00.000Z',
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

		const collationId = await collationState.createNewCollation('Romans 1:1', 'Romans 1:1');
		vi.clearAllMocks();

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

		expect(updateCollationMetadata).toHaveBeenCalledWith(
			expect.objectContaining({ id: collationId, status: 'regularization' })
		);
		expect(saveCollationProjection).not.toHaveBeenCalled();
	});

	it('materializes the normalized projection when the collation is saved in stemma', async () => {
		const collationState = await importState();
		collationState.reset();
		await collationState.selectProject('proj-1');
		await vi.advanceTimersByTimeAsync(801);
		vi.clearAllMocks();

		const collationId = await collationState.createNewCollation('Romans 1:1', 'Romans 1:1');
		vi.clearAllMocks();

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

		expect(saveCollationProjection).toHaveBeenCalled();
		expect(updateCollationMetadata).toHaveBeenCalledWith(
			expect.objectContaining({ id: collationId, status: 'complete' })
		);
	});
});
