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
	getCollationVersionStatus,
	loadCommittedTranscriptionCheckpointPayload,
	gatherWitnessesForVerse,
	prepareWitnessesFromDocument,
	coerceTranscriptionDocument,
} = vi.hoisted(() => ({
	loadCollation: vi.fn(),
	createCollation: vi.fn(),
	saveCollationArtifact: vi.fn(),
	saveCollationProjection: vi.fn(),
	updateCollationMetadata: vi.fn(),
	getProject: vi.fn(),
	createProject: vi.fn(),
	updateProjectMetadata: vi.fn(),
	getCollationVersionStatus: vi.fn(),
	loadCommittedTranscriptionCheckpointPayload: vi.fn(),
	gatherWitnessesForVerse: vi.fn(),
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
	createProject,
	updateProjectMetadata,
	getCollationVersionStatus,
	loadCommittedTranscriptionCheckpointPayload,
}));

vi.mock('./collation-runner', () => ({
	gatherWitnessesForVerse,
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
			createdAt: '2026-03-10T00:00:00.000Z',
			updatedAt: '2026-03-10T00:00:00.000Z',
		});
		gatherWitnessesForVerse.mockResolvedValue([]);
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
		expect(collationState.selectedVerse?.identifier).toBe('Romans 1:1');
		expect(collationState.alignmentLayout).toBe('variation-units');
		expect(collationState.ignoreWordBreaks).toBe(false);
		expect(gatherWitnessesForVerse).not.toHaveBeenCalled();
	}, 30000);

	it('does not automatically refresh changed witnesses on load (pinned witness model)', async () => {
		gatherWitnessesForVerse.mockReturnValue(new Promise(() => {}));
		const collationState = await importState();
		collationState.reset();

		const loaded = await collationState.loadCollationById('col-1');
		await Promise.resolve();
		await Promise.resolve();

		expect(loaded).toBe(true);
		expect(gatherWitnessesForVerse).not.toHaveBeenCalled();
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
