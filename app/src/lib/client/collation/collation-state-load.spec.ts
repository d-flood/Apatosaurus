import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deserializeAlignmentColumns } from './alignment-snapshot';
import {
	buildCollationDocument,
	parseCollationDocument,
	serializeCollationDocument,
} from './collation-document';

const {
	loadCollation,
	createCollation,
	saveCollationArtifact,
	saveCollationProjection,
	updateCollationMetadata,
	getProject,
	getProjectTranscriptionIds,
	listVerseIndexRowsForTranscriptions,
	createProject,
	updateProjectMetadata,
	getCollationVersionStatus,
	loadCommittedTranscriptionCheckpointPayload,
	gatherWitnessesForSegment,
	prepareWitnessesFromDocument,
	coerceTranscriptionDocument,
} = vi.hoisted(() => ({
	loadCollation: vi.fn(),
	createCollation: vi.fn(),
	saveCollationArtifact: vi.fn(),
	saveCollationProjection: vi.fn(),
	updateCollationMetadata: vi.fn(),
	getProject: vi.fn(),
	getProjectTranscriptionIds: vi.fn(),
	listVerseIndexRowsForTranscriptions: vi.fn(),
	createProject: vi.fn(),
	updateProjectMetadata: vi.fn(),
	getCollationVersionStatus: vi.fn(),
	loadCommittedTranscriptionCheckpointPayload: vi.fn(),
	gatherWitnessesForSegment: vi.fn(),
	prepareWitnessesFromDocument: vi.fn(),
	coerceTranscriptionDocument: vi.fn(),
}));

vi.mock('$lib/client/db/client', () => ({
	loadCollation,
	createCollation,
	saveCollationArtifact,
	saveCollationProjection,
	updateCollationMetadata,
	getProject,
	getProjectTranscriptionIds,
	listVerseIndexRowsForTranscriptions,
	createProject,
	updateProjectMetadata,
	getCollationVersionStatus,
	loadCommittedTranscriptionCheckpointPayload,
}));

vi.mock('./collation-runner', () => ({
	gatherWitnessesForSegment,
	prepareWitnessesFromDocument,
}));

vi.mock('$lib/client/transcription/content', () => ({
	coerceTranscriptionDocument,
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

function makeTextCell(text: string) {
	return {
		text,
		regularizedText: text,
		alignmentValue: text,
		sourceTokenIds: [],
		kind: 'text' as const,
		gap: null,
		isOmission: false,
		isLacuna: false,
		isRegularized: false,
		ruleIds: [],
		regularizationTypes: [],
	};
}

function makePreparedWitness(transcriptionId: string, content: string, sourceVersion: string) {
	const tokens = content
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
		}));
	return {
		id: 'A',
		siglum: 'A',
		kind: 'firsthand' as const,
		handId: 'firsthand',
		content,
		tokens,
		fullContent: content,
		fullTokens: tokens,
		transcriptionUid: transcriptionId,
		sourceVersion,
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
			segment: { id: 'segment-1', name: 'Romans 1:1', members: ['Romans 1:1'] },
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
			unitDecisions: new Map(),
			readingArcs: new Map(),
			alignmentDisplayMode: 'regularized',
			alignmentLayout: 'variation-units',
		})
	);
}

function makeDecisionDocumentPayload(corruptPersistedReadings = false) {
	const document = buildCollationDocument({
		collationId: 'col-1',
		projectId: 'proj-1',
		projectName: 'Project 1',
		phase: 'readings',
		furthestPhase: 'readings',
		segment: { id: 'segment-1', name: 'Romans 1:1', members: ['Romans 1:1'] },
		witnesses: [makeWitness('A', 'alpha', true), makeWitness('B', 'beta')],
		rules: [],
		ignoreWordBreaks: false,
		lowercase: false,
		ignoreTokenWhitespace: true,
		ignorePunctuation: false,
		suppliedTextMode: 'clear',
		segmentation: true,
		alignmentColumns: deserializeAlignmentColumns([
			{
				id: 'col-1',
				index: 0,
				merged: false,
				cells: [
					['A', makeTextCell('alpha')],
					['B', makeTextCell('beta')],
				],
			},
		]),
		witnessOrder: ['A', 'B'],
		classifiedReadings: new Map(),
		unitDecisions: new Map([
			[
				'unit:col-1',
				{
					subreadingOf: {
						'col-1::beta::original': 'col-1::alpha::original',
					},
				},
			],
		]),
		readingArcs: new Map(),
		alignmentDisplayMode: 'regularized',
		alignmentLayout: 'variation-units',
	});
	if (corruptPersistedReadings && document.apparatus?.units[0]) {
		document.apparatus.units[0].readings = [];
	}
	return serializeCollationDocument(document);
}

function makeMalformedApparatusConnectivityPayload(connectivity: unknown) {
	const document = JSON.parse(makeDecisionDocumentPayload()) as {
		apparatus: { units: Array<{ decisions: Record<string, unknown> }> };
	};
	document.apparatus.units[0]!.decisions.connectivity = connectivity;
	return JSON.stringify(document);
}

function makeReadingTypeDocumentPayload() {
	return serializeCollationDocument(
		buildCollationDocument({
			collationId: 'col-1',
			projectId: 'proj-1',
			projectName: 'Project 1',
			phase: 'readings',
			furthestPhase: 'readings',
			segment: { id: 'segment-1', name: 'Romans 1:1', members: ['Romans 1:1'] },
			witnesses: [makeWitness('A', 'alpha', true), makeWitness('B', 'beta')],
			rules: [],
			ignoreWordBreaks: false,
			lowercase: false,
			ignoreTokenWhitespace: true,
			ignorePunctuation: false,
			suppliedTextMode: 'clear',
			segmentation: true,
			alignmentColumns: deserializeAlignmentColumns([
				{
					id: 'col-1',
					index: 0,
					merged: false,
					cells: [
						['A', makeTextCell('alpha')],
						['B', makeTextCell('beta')],
					],
				},
			]),
			witnessOrder: ['A', 'B'],
			classifiedReadings: new Map(),
			unitDecisions: new Map([
				[
					'unit:col-1',
					{
						readingType: { 'col-1::beta::original': 'itacism' },
						certainty: { 'col-1::beta::original': 'low' as const },
					},
				],
			]),
			readingArcs: new Map(),
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
			createdAt: '2026-03-10T00:00:00.000Z',
			updatedAt: '2026-03-10T00:00:00.000Z',
		});
		getProjectTranscriptionIds.mockResolvedValue(['A-tx', 'B-tx']);
		listVerseIndexRowsForTranscriptions.mockResolvedValue([
			{
				id: 'verse-row-a',
				transcription_id: 'A-tx',
				verse_identifier: 'Romans 1:1',
				book: 'Romans',
				chapter: '1',
				verse: '1',
				last_indexed_at: '2026-03-10T00:00:00.000Z',
			},
			{
				id: 'verse-row-b',
				transcription_id: 'B-tx',
				verse_identifier: 'Romans 1:1',
				book: 'Romans',
				chapter: '1',
				verse: '1',
				last_indexed_at: '2026-03-10T00:00:00.000Z',
			},
		]);
		gatherWitnessesForSegment.mockResolvedValue({
			witnesses: [],
			orphanedMembers: [],
			error: null,
		});
		prepareWitnessesFromDocument.mockReturnValue([]);
		coerceTranscriptionDocument.mockReturnValue(null);
		getCollationVersionStatus.mockResolvedValue(null);
		loadCommittedTranscriptionCheckpointPayload.mockResolvedValue(null);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('loads from the canonical artifact without refreshing unchanged witnesses', async () => {
		const collationState = await importState();
		collationState.reset();

		const loaded = await collationState.loadCollationById('col-1');

		expect(loaded).toBe(true);
		expect(collationState.segment).toEqual({
			id: 'segment-1',
			name: 'Romans 1:1',
			members: ['Romans 1:1'],
		});
		expect(collationState.selectedVerse).toEqual({
			identifier: 'Romans 1:1',
			book: 'Romans',
			chapter: '1',
			verse: '1',
			count: 2,
		});
		expect(collationState.alignmentLayout).toBe('variation-units');
		expect(collationState.ignoreWordBreaks).toBe(false);
	}, 30000);

	it('recomputes readings from alignment and decisions instead of loading persisted readings', async () => {
		const loadedValue = await loadCollation();
		loadCollation.mockResolvedValue({
			...loadedValue,
			artifact: {
				...loadedValue.artifact,
				payload: makeDecisionDocumentPayload(true),
			},
		});
		const collationState = await importState();
		collationState.reset();

		expect(await collationState.loadCollationById('col-1')).toBe(true);
		expect(
			collationState.getReadingsForUnit(0).map(reading => ({
				text: reading.text,
				parentReadingId: reading.parentReadingId,
			}))
		).toEqual([
			{ text: 'alpha', parentReadingId: null },
			{ text: 'beta', parentReadingId: 'col-1::alpha::original' },
		]);
	}, 30000);

	it('refuses artifacts with apparatus connectivity instead of silently stripping it', async () => {
		for (const connectivity of [10, 0, 'absolute', '0']) {
			expect(parseCollationDocument(makeMalformedApparatusConnectivityPayload(connectivity))).toBeNull();
		}

		const loadedValue = await loadCollation();
		loadCollation.mockResolvedValue({
			...loadedValue,
			artifact: {
				...loadedValue.artifact,
				payload: makeMalformedApparatusConnectivityPayload('absolute'),
			},
		});
		const collationState = await importState();
		collationState.reset();

		expect(await collationState.loadCollationById('col-1')).toBe(false);
	}, 30000);

	it('round-trips a project-supplied reading type through the store and the document', async () => {
		const loadedValue = await loadCollation();
		loadCollation.mockResolvedValue({
			...loadedValue,
			artifact: { ...loadedValue.artifact, payload: makeReadingTypeDocumentPayload() },
		});
		const collationState = await importState();
		collationState.reset();
		expect(await collationState.loadCollationById('col-1')).toBe(true);

		const beta = collationState.getReadingsForUnit(0).find(reading => reading.text === 'beta')!;
		expect([beta.readingType, beta.certainty]).toEqual(['itacism', 'low']);

		collationState.setReadingType(0, beta.id, 'scribal-leap');
		expect(await collationState.flushPendingSave()).toBe(true);
		expect(saveCollationArtifact).toHaveBeenCalledWith(
			expect.objectContaining({ payload: expect.stringContaining('scribal-leap') })
		);
	}, 30000);

	it('drops a project reading-type vocabulary on reset', async () => {
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
				readingTypes: [
					{ id: 'itacism', label: 'Itacism', description: '', selectable: true },
				],
			},
			createdAt: '2026-03-10T00:00:00.000Z',
			updatedAt: '2026-03-10T00:00:00.000Z',
		});
		const collationState = await importState();
		collationState.reset();
		expect(await collationState.loadCollationById('col-1')).toBe(true);
		expect(collationState.getReadingTypeVocabulary().map(type => type.id)).toContain('itacism');

		// A vocabulary left behind by reset would be copied into the next project created.
		collationState.reset();
		expect(collationState.getReadingTypeVocabulary().map(type => type.id)).not.toContain(
			'itacism'
		);
	}, 30000);

	it('leaves the selected verse orphaned when its member is absent from the project index', async () => {
		getProjectTranscriptionIds.mockResolvedValue([]);
		listVerseIndexRowsForTranscriptions.mockResolvedValue([]);
		gatherWitnessesForSegment.mockResolvedValue({
			witnesses: [],
			orphanedMembers: ['Romans 1:1'],
			error: null,
		});
		const collationState = await importState();
		collationState.reset();

		const loaded = await collationState.loadCollationById('col-1');

		expect(loaded).toBe(true);
		expect(collationState.selectedVerse).toBeNull();
		expect(collationState.selectedBook).toBe('');
		expect(collationState.selectedChapter).toBe('');
		expect(collationState.selectedVerseNum).toBe('');
		expect(collationState.orphanedMembers).toEqual(['Romans 1:1']);
		expect(gatherWitnessesForSegment).toHaveBeenCalledWith({ members: ['Romans 1:1'] }, [], {
			ignoreWordBreaks: false,
		});
		expect(collationState.saveStatus).toBe('saved');
	}, 30000);

	it('does not automatically refresh changed witnesses on load (pinned witness model)', async () => {
		const collationState = await importState();
		collationState.reset();

		const loaded = await collationState.loadCollationById('col-1');
		await Promise.resolve();
		await Promise.resolve();

		expect(loaded).toBe(true);
	}, 30000);

	it('can refresh witness tokens from source before rerunning collation', async () => {
		gatherWitnessesForSegment.mockResolvedValue({
			witnesses: [
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
			],
			orphanedMembers: ['Romans 1:1'],
			error: null,
		});
		const collationState = await importState();
		collationState.reset();
		await collationState.loadCollationById('col-1');

		const changed = await collationState.refreshWitnessesFromSource(['A-tx']);

		expect(changed).toBe(true);
		expect(gatherWitnessesForSegment).toHaveBeenCalledWith(
			{ members: ['Romans 1:1'] },
			['A-tx'],
			{
				ignoreWordBreaks: false,
			}
		);
		expect(collationState.witnesses[0]?.tokens[0]?.original).toBe('κλη\\nτος');
		expect(collationState.orphanedMembers).toEqual(['Romans 1:1']);
	}, 30000);

	it('recomputes orphaned members across the project after a partial source refresh', async () => {
		const collationState = await importState();
		collationState.reset();
		await collationState.loadCollationById('col-1');
		collationState.setSegmentMembers(['A 1:1', 'B 1:1']);
		collationState.setOrphanedMembers(['A 1:1']);
		vi.clearAllMocks();

		gatherWitnessesForSegment.mockImplementation(
			async (_segment: { members: string[] }, transcriptionIds: string[]) => {
				if (transcriptionIds.length === 1) {
					return {
						witnesses: [makePreparedWitness('A-tx', 'refreshed A', 'source-a')],
						orphanedMembers: ['B 1:1'],
						error: null,
					};
				}
				return { witnesses: [], orphanedMembers: [], error: null };
			}
		);

		const changed = await collationState.refreshWitnessesFromSource(['A-tx']);

		expect(changed).toBe(true);
		expect(collationState.witnesses[0]?.content).toBe('refreshed A');
		expect(collationState.orphanedMembers).toEqual([]);
		expect(getProjectTranscriptionIds).toHaveBeenCalledWith('proj-1');
		expect(gatherWitnessesForSegment).toHaveBeenLastCalledWith(
			{ members: ['A 1:1', 'B 1:1'] },
			['A-tx', 'B-tx'],
			{ ignoreWordBreaks: false }
		);
	}, 30000);

	it('reports all members as orphaned when source refresh receives an empty scope', async () => {
		gatherWitnessesForSegment.mockResolvedValue({
			witnesses: [],
			orphanedMembers: ['Romans 1:1'],
			error: null,
		});
		const collationState = await importState();
		collationState.reset();
		await collationState.loadCollationById('col-1');
		vi.clearAllMocks();

		const changed = await collationState.refreshWitnessesFromSource([]);

		expect(changed).toBe(false);
		expect(gatherWitnessesForSegment).toHaveBeenCalledWith({ members: ['Romans 1:1'] }, [], {
			ignoreWordBreaks: false,
		});
		expect(collationState.orphanedMembers).toEqual(['Romans 1:1']);
	}, 30000);

	it('refreshWitnessSource replaces witness content from a committed checkpoint and marks dirty', async () => {
		const checkpointDocument = { type: 'transcriptionDocument', pages: [] };
		coerceTranscriptionDocument.mockReturnValue(checkpointDocument);
		prepareWitnessesFromDocument.mockReturnValue([
			{
				id: 'A',
				siglum: 'A',
				kind: 'firsthand',
				handId: 'firsthand',
				content: 'refreshed',
				tokens: [
					{
						kind: 'text' as const,
						original: 'refreshed',
						segments: [
							{
								text: 'refreshed',
								hasUnclear: false,
								isPunctuation: false,
								isSupplied: false,
							},
						],
						gap: null,
					},
				],
				transcriptionUid: 'A-tx',
				sourceVersion: 'cp-refreshed',
			},
		]);
		loadCommittedTranscriptionCheckpointPayload.mockResolvedValue({
			id: 'cp-refreshed',
			transcriptionId: 'A-tx',
			parentCheckpointId: null,
			contentHash: 'sha256:refreshed',
			isCommitted: true,
			commitMessage: null,
			authorName: '',
			createdAt: '2026-06-20T00:00:00.000Z',
			payload: {
				project_transcription_id: 'pt-a',
				id: 'A-tx',
				format: 'tei',
				title: 'Witness A',
				siglum: 'A',
				description: '',
				content_json: checkpointDocument,
				owner: null,
				is_public: false,
				tags: [],
				transcriber: '',
				repository: '',
				settlement: '',
				language: 'grc',
				iiif_manifest_sources: [],
				page_canvas_links: [],
				canvas_annotations: [],
			},
		});
		getCollationVersionStatus.mockResolvedValue({
			projectId: 'proj-1',
			collationId: 'col-1',
			title: 'Romans 1:1',
			verseIdentifier: 'Romans 1:1',
			workflowStatus: 'alignment',
			currentCheckpoint: null,
			workingContentHash: 'sha256:working',
			dirtyToCheckpoint: true,
			commitState: 'never-committed',
			witnesses: [
				{
					witnessId: 'A',
					position: 0,
					projectTranscriptionId: 'pt-a',
					projectOwnedTranscriptionId: 'A-tx',
					pinnedCheckpoint: { revisionId: 'cp-old', contentHash: 'sha256:old' },
					availableCheckpoint: {
						revisionId: 'cp-refreshed',
						contentHash: 'sha256:refreshed',
					},
					sourceDirtyToCheckpoint: false,
					versionState: 'newer-source-available',
				},
			],
		});

		const collationState = await importState();
		collationState.reset();
		await collationState.loadCollationById('col-1');
		vi.clearAllMocks();

		const refreshed = await collationState.refreshWitnessSource('A', 'cp-refreshed');

		expect(refreshed).toBe(true);
		expect(loadCommittedTranscriptionCheckpointPayload).toHaveBeenCalledWith(
			'A-tx',
			'cp-refreshed'
		);
		expect(prepareWitnessesFromDocument).toHaveBeenCalledWith(
			expect.objectContaining({
				verseIdentifier: 'Romans 1:1',
				transcriptionId: 'A-tx',
				sourceVersion: 'cp-refreshed',
			})
		);
		expect(collationState.witnesses[0]?.content).toBe('refreshed');
		expect(collationState.witnesses[0]?.sourceVersion).toBe('cp-refreshed');
		expect(collationState.witnesses[0]?.sourceContentHash).toBe('sha256:refreshed');
		expect(collationState.saveStatus).toBe('unsaved');

		const flushed = await collationState.flushPendingSave();

		expect(flushed).toBe(true);
		expect(saveCollationArtifact).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.stringContaining('sha256:refreshed'),
			})
		);
	}, 30000);

	it('refreshes a checkpoint witness from a later segment member', async () => {
		const checkpointDocument = { type: 'transcriptionDocument', pages: [] };
		const prepared = makePreparedWitness('A-tx', 'later refreshed', 'cp-later');
		const collationState = await importState();
		collationState.reset();
		await collationState.loadCollationById('col-1');
		collationState.setSegmentMembers(['Romans 1:1', 'Later 1:1']);
		vi.clearAllMocks();
		coerceTranscriptionDocument.mockReturnValue(checkpointDocument);
		prepareWitnessesFromDocument.mockImplementation(input =>
			input.verseIdentifier === 'Later 1:1' ? [prepared] : []
		);
		loadCommittedTranscriptionCheckpointPayload.mockResolvedValue({
			id: 'cp-later',
			contentHash: 'sha256:later',
			payload: { siglum: 'A', content_json: checkpointDocument },
		});

		const refreshed = await collationState.refreshWitnessSource('A', 'cp-later');

		expect(refreshed).toBe(true);
		expect(prepareWitnessesFromDocument).toHaveBeenCalledWith(
			expect.objectContaining({ verseIdentifier: 'Romans 1:1' })
		);
		expect(prepareWitnessesFromDocument).toHaveBeenCalledWith(
			expect.objectContaining({ verseIdentifier: 'Later 1:1' })
		);
		expect(collationState.witnesses[0]?.content).toBe('later refreshed');
	});

	it('refuses a checkpoint refresh when one transcription matches distinct segment members', async () => {
		const checkpointDocument = { type: 'transcriptionDocument', pages: [] };
		const prepared = makePreparedWitness('A-tx', 'ambiguous', 'cp-ambiguous');
		const collationState = await importState();
		collationState.reset();
		await collationState.loadCollationById('col-1');
		collationState.setSegmentMembers(['Romans 1:1', 'Later 1:1']);
		vi.clearAllMocks();
		coerceTranscriptionDocument.mockReturnValue(checkpointDocument);
		prepareWitnessesFromDocument.mockReturnValue([prepared]);
		loadCommittedTranscriptionCheckpointPayload.mockResolvedValue({
			id: 'cp-ambiguous',
			contentHash: 'sha256:ambiguous',
			payload: { siglum: 'A', content_json: checkpointDocument },
		});

		const refreshed = await collationState.refreshWitnessSource('A', 'cp-ambiguous');

		expect(refreshed).toBe(false);
		expect(collationState.witnesses[0]?.content).toBe('και θεος');
	});

	it('does not apply a checkpoint after any captured segment member changes', async () => {
		const collationState = await importState();
		collationState.reset();
		await collationState.loadCollationById('col-1');
		collationState.setSegmentMembers(['Romans 1:1', 'Later 1:1']);
		vi.clearAllMocks();

		let resolveLoaded!: (value: unknown) => void;
		loadCommittedTranscriptionCheckpointPayload.mockReturnValue(
			new Promise(resolve => {
				resolveLoaded = resolve;
			})
		);

		const refreshPromise = collationState.refreshWitnessSource('A', 'cp-delayed');
		await Promise.resolve();
		collationState.setSegmentMembers(['Romans 1:1', 'Later 1:1', 'Changed 1:1']);
		resolveLoaded({
			id: 'cp-delayed',
			contentHash: 'sha256:delayed',
			payload: { siglum: 'A', content_json: {} },
		});

		expect(await refreshPromise).toBe(false);
		expect(prepareWitnessesFromDocument).not.toHaveBeenCalled();
		expect(collationState.witnesses[0]?.content).toBe('και θεος');
	});

	it('refreshAllStaleWitnessSources refreshes all stale witnesses before one dirty mark', async () => {
		const checkpointDocument = { type: 'transcriptionDocument', pages: [] };
		coerceTranscriptionDocument.mockReturnValue(checkpointDocument);
		prepareWitnessesFromDocument.mockImplementation(input => {
			const transcriptionId = String(input.transcriptionId);
			const witnessId = transcriptionId.startsWith('A') ? 'A' : 'B';
			const content = `${witnessId.toLowerCase()} refreshed`;
			return [
				{
					id: witnessId,
					siglum: witnessId,
					kind: 'firsthand',
					handId: 'firsthand',
					content,
					tokens: [
						{
							kind: 'text' as const,
							original: content,
							segments: [
								{
									text: content,
									hasUnclear: false,
									isPunctuation: false,
									isSupplied: false,
								},
							],
							gap: null,
						},
					],
					transcriptionUid: transcriptionId,
					sourceVersion: String(input.sourceVersion),
				},
			];
		});
		loadCommittedTranscriptionCheckpointPayload.mockImplementation(
			(transcriptionId, checkpointId) =>
				Promise.resolve({
					id: checkpointId,
					transcriptionId,
					parentCheckpointId: null,
					contentHash: `sha256:${checkpointId}`,
					isCommitted: true,
					commitMessage: null,
					authorName: '',
					createdAt: '2026-06-20T00:00:00.000Z',
					payload: {
						project_transcription_id: `pt-${transcriptionId}`,
						id: transcriptionId,
						format: 'tei',
						title: `Witness ${transcriptionId}`,
						siglum: transcriptionId.startsWith('A') ? 'A' : 'B',
						description: '',
						content_json: checkpointDocument,
						owner: null,
						is_public: false,
						tags: [],
						transcriber: '',
						repository: '',
						settlement: '',
						language: 'grc',
						iiif_manifest_sources: [],
						page_canvas_links: [],
						canvas_annotations: [],
					},
				})
		);
		getCollationVersionStatus.mockResolvedValue({
			projectId: 'proj-1',
			collationId: 'col-1',
			title: 'Romans 1:1',
			verseIdentifier: 'Romans 1:1',
			workflowStatus: 'alignment',
			currentCheckpoint: null,
			workingContentHash: 'sha256:working',
			dirtyToCheckpoint: true,
			commitState: 'dirty',
			witnesses: [
				{
					witnessId: 'A',
					position: 0,
					projectTranscriptionId: 'pt-a',
					projectOwnedTranscriptionId: 'A-tx',
					pinnedCheckpoint: { revisionId: 'cp-a-old', contentHash: 'sha256:a-old' },
					availableCheckpoint: { revisionId: 'cp-a-new', contentHash: 'sha256:cp-a-new' },
					sourceDirtyToCheckpoint: false,
					versionState: 'newer-source-available',
				},
				{
					witnessId: 'B',
					position: 1,
					projectTranscriptionId: 'pt-b',
					projectOwnedTranscriptionId: 'B-tx',
					pinnedCheckpoint: { revisionId: 'cp-b-old', contentHash: 'sha256:b-old' },
					availableCheckpoint: { revisionId: 'cp-b-new', contentHash: 'sha256:cp-b-new' },
					sourceDirtyToCheckpoint: false,
					versionState: 'newer-source-available',
				},
			],
		});

		const collationState = await importState();
		collationState.reset();
		await collationState.loadCollationById('col-1');
		vi.clearAllMocks();

		const refreshedCount = await collationState.refreshAllStaleWitnessSources();

		expect(refreshedCount).toBe(2);
		expect(loadCommittedTranscriptionCheckpointPayload).toHaveBeenCalledWith(
			'A-tx',
			'cp-a-new'
		);
		expect(loadCommittedTranscriptionCheckpointPayload).toHaveBeenCalledWith(
			'B-tx',
			'cp-b-new'
		);
		expect(collationState.witnesses.map(witness => witness.sourceVersion)).toEqual([
			'cp-a-new',
			'cp-b-new',
		]);
		expect(collationState.witnesses.map(witness => witness.sourceContentHash)).toEqual([
			'sha256:cp-a-new',
			'sha256:cp-b-new',
		]);
		expect(collationState.saveStatus).toBe('unsaved');
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
			createdAt: '2026-03-10T00:00:00.000Z',
			updatedAt: '2026-03-10T00:00:00.000Z',
		});
		gatherWitnessesForSegment.mockResolvedValue({
			witnesses: [
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
			],
			error: null,
		});
		const collationState = await importState();
		collationState.reset();

		const loaded = await collationState.loadCollationById('col-1');

		expect(loaded).toBe(true);
		expect(collationState.ignoreWordBreaks).toBe(true);
		expect(gatherWitnessesForSegment).toHaveBeenCalledWith(
			{ members: ['Romans 1:1'] },
			['A-tx', 'B-tx'],
			{
				ignoreWordBreaks: true,
			}
		);
		expect(collationState.witnesses[0]?.tokens[0]?.original).toBe('κλητος');
	});

	it('delegates projection writes to semantic document persistence', async () => {
		const collationState = await importState();
		collationState.reset();
		await collationState.selectProject('proj-1');
		await vi.advanceTimersByTimeAsync(801);
		vi.clearAllMocks();

		const collationId = await collationState.createNewCollation(
			'Romans 1:1',
			'Romans 1:1',
			'Romans 1:1'
		);
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

	it('persists a renamed segment as the collation display metadata', async () => {
		const collationState = await importState();
		collationState.reset();
		await collationState.loadCollationById('col-1');
		vi.clearAllMocks();

		collationState.setSegmentName('Romans 1:1 (critical text)');
		await collationState.flushPendingSave();

		expect(updateCollationMetadata).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'col-1',
				verseIdentifier: 'Romans 1:1 (critical text)',
			})
		);
	});

	it('persists the semantic document when the collation is saved in Review', async () => {
		const collationState = await importState();
		collationState.reset();
		await collationState.selectProject('proj-1');
		await vi.advanceTimersByTimeAsync(801);
		vi.clearAllMocks();

		const collationId = await collationState.createNewCollation(
			'Romans 1:1',
			'Romans 1:1',
			'Romans 1:1'
		);
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
		expect(collationState.canNavigateTo('review')).toBe(true);
		collationState.nextPhase();
		collationState.nextPhase();
		collationState.nextPhase();
		collationState.nextPhase();
		expect(collationState.phase).toBe('review');
		await vi.advanceTimersByTimeAsync(801);

		expect(saveCollationProjection).not.toHaveBeenCalled();
		expect(saveCollationArtifact).toHaveBeenCalledWith(
			expect.objectContaining({ collationId, artifactType: 'collation_document_v1' })
		);
		expect(updateCollationMetadata).toHaveBeenCalledWith(
			expect.objectContaining({ id: collationId, status: 'complete' })
		);
	});

	describe('flushPendingSave', () => {
		it('returns true without persisting when there are no pending changes', async () => {
			const collationState = await importState();
			collationState.reset();
			await collationState.loadCollationById('col-1');
			await Promise.resolve();
			await Promise.resolve();
			vi.clearAllMocks();

			expect(collationState.saveStatus).toBe('saved');

			const result = await collationState.flushPendingSave();

			expect(result).toBe(true);
			expect(saveCollationArtifact).not.toHaveBeenCalled();
		});

		it('persists pending unsaved state before returning', async () => {
			const collationState = await importState();
			collationState.reset();
			await collationState.loadCollationById('col-1');
			await Promise.resolve();
			await Promise.resolve();
			vi.clearAllMocks();
			saveCollationArtifact.mockResolvedValue('artifact-existing');
			saveCollationProjection.mockResolvedValue(undefined);
			updateCollationMetadata.mockResolvedValue(undefined);

			collationState.selectedVerse = {
				identifier: 'Romans 1:2',
				book: 'Romans',
				chapter: '1',
				verse: '2',
				count: 2,
			};
			expect(collationState.saveStatus).toBe('unsaved');

			const result = await collationState.flushPendingSave();

			expect(result).toBe(true);
			expect(collationState.saveStatus).toBe('saved');
			expect(saveCollationArtifact).toHaveBeenCalledTimes(1);
			expect(updateCollationMetadata).toHaveBeenCalledTimes(1);
		});

		it('awaits an in-flight save instead of starting a concurrent save', async () => {
			const collationState = await importState();
			collationState.reset();
			await collationState.loadCollationById('col-1');
			await Promise.resolve();
			await Promise.resolve();
			vi.clearAllMocks();
			saveCollationProjection.mockResolvedValue(undefined);
			updateCollationMetadata.mockResolvedValue(undefined);

			let resolveSave!: (value: string) => void;
			const savePromise = new Promise<string>(resolve => {
				resolveSave = resolve;
			});
			saveCollationArtifact.mockReturnValue(savePromise);

			collationState.selectedVerse = {
				identifier: 'Romans 1:2',
				book: 'Romans',
				chapter: '1',
				verse: '2',
				count: 2,
			};
			await vi.advanceTimersByTimeAsync(801);

			expect(collationState.saveStatus).toBe('saving');
			let flushResolved = false;
			const flushPromise = collationState.flushPendingSave().then(result => {
				flushResolved = true;
				return result;
			});
			await Promise.resolve();
			await Promise.resolve();

			expect(flushResolved).toBe(false);
			expect(saveCollationArtifact).toHaveBeenCalledTimes(1);

			resolveSave('artifact-existing');
			const result = await flushPromise;

			expect(result).toBe(true);
			expect(flushResolved).toBe(true);
			expect(collationState.saveStatus).toBe('saved');
			expect(saveCollationArtifact).toHaveBeenCalledTimes(1);
		});

		it('returns false when persistence fails', async () => {
			const collationState = await importState();
			collationState.reset();
			await collationState.loadCollationById('col-1');
			await Promise.resolve();
			await Promise.resolve();
			vi.clearAllMocks();
			saveCollationArtifact.mockRejectedValue(new Error('disk full'));
			saveCollationProjection.mockResolvedValue(undefined);
			updateCollationMetadata.mockResolvedValue(undefined);

			collationState.selectedVerse = {
				identifier: 'Romans 1:2',
				book: 'Romans',
				chapter: '1',
				verse: '2',
				count: 2,
			};

			const result = await collationState.flushPendingSave();

			expect(result).toBe(false);
			expect(collationState.saveStatus).toBe('error');
		});
	});
});
