import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { notificationCenter } from '$lib/shell/notification-center.svelte';
import type { CbgmAnalysisMetadata } from '$lib/storage/formats';
import type { CbgmCompletion, CbgmFailure } from './cbgm-scheduler.svelte';

const mocks = vi.hoisted(() => ({
	clearEditingPresence: vi.fn(),
	completeCbgmCoherence: vi.fn(),
	failCbgmCoherence: vi.fn(),
	readCbgmAnalysisCache: vi.fn(),
	readCbgmAnalysisInputTei: vi.fn(),
	setCbgmGlobalStemmaState: vi.fn(),
	writeEditingPresence: vi.fn(),
}));

vi.mock('$lib/db/client', () => ({
	clearEditingPresence: mocks.clearEditingPresence,
	completeCbgmCoherence: mocks.completeCbgmCoherence,
	createCbgmAnalysis: vi.fn(),
	deleteCbgmAnalysis: vi.fn(),
	failCbgmCoherence: mocks.failCbgmCoherence,
	failCbgmGlobalStemma: vi.fn(),
	loadCbgmCollationSnapshots: vi.fn(),
	getProject: vi.fn(),
	readCbgmAnalysisCache: mocks.readCbgmAnalysisCache,
	readCbgmAnalysisInputTei: mocks.readCbgmAnalysisInputTei,
	setCbgmGlobalStemmaState: mocks.setCbgmGlobalStemmaState,
	writeEditingPresence: mocks.writeEditingPresence,
}));

import {
	importNativeResults,
	persistCbgmComputations,
	startGlobalStemma,
} from './cbgm-analysis-runs';

const analysis = {
	id: 'analysis-1',
	project_id: 'project-1',
	name: 'Romans',
	settings: {
		min_extant_units: null,
		min_extant_proportion: 0.5,
		excluded_witnesses: ['P46'],
		classic_rules: false,
		merge_split_readings: false,
		dropped_reading_types: [],
		trivial_reading_types: [],
		included_correctors: [],
	},
} as unknown as CbgmAnalysisMetadata;

function registerHandlers() {
	const handlers: {
		complete?: (result: CbgmCompletion) => Promise<void>;
		fail?: (failure: CbgmFailure) => Promise<void>;
	} = {};
	persistCbgmComputations({
		onComplete: handler => (handlers.complete = handler),
		onFailure: handler => (handlers.fail = handler),
	});
	return handlers;
}

beforeEach(() => {
	vi.clearAllMocks();
	notificationCenter.items = [];
	mocks.completeCbgmCoherence.mockResolvedValue({ id: 'analysis-1', name: 'Romans' });
	mocks.failCbgmCoherence.mockResolvedValue({ id: 'analysis-1', name: 'Romans' });
	mocks.setCbgmGlobalStemmaState.mockResolvedValue(analysis);
	mocks.writeEditingPresence.mockResolvedValue(undefined);
	mocks.clearEditingPresence.mockResolvedValue(undefined);
});

it('upserts the completion notification for that analysis and phase', async () => {
	await registerHandlers().complete?.({
		analysisId: 'analysis-1',
		projectId: 'project-1',
		phase: 'coherence',
		cache: new Uint8Array([1]),
		notifyOs: false,
	});

	expect(notificationCenter.items).toEqual([
		expect.objectContaining({
			id: 'cbgm:analysis-1:coherence',
			message: expect.stringMatching(/Coherence for Romans/),
			tone: 'success',
			actions: [expect.objectContaining({ href: '/cbgm/analysis-1' })],
		}),
	]);
});

it('includes the failure message in the failure notification', async () => {
	await registerHandlers().fail?.({
		analysisId: 'analysis-1',
		projectId: 'project-1',
		phase: 'coherence',
		message: 'Engine ran out of memory.',
		notifyOs: false,
	});

	expect(notificationCenter.items).toEqual([
		expect.objectContaining({
			id: 'cbgm:analysis-1:coherence',
			message: expect.stringContaining('Engine ran out of memory.'),
			tone: 'error',
		}),
	]);
});

it('publishes editing presence when the global stemma is enqueued and clears it on completion', async () => {
	const handlers = registerHandlers();
	const cache = new Uint8Array([1]);
	const stemmaCache = new Uint8Array([1, 2]);
	const enqueue = vi.fn();
	mocks.readCbgmAnalysisCache.mockResolvedValue(cache);

	await startGlobalStemma(analysis, true, { enqueue });

	expect(mocks.setCbgmGlobalStemmaState).toHaveBeenCalledWith(
		'project-1',
		'analysis-1',
		'computing'
	);
	expect(enqueue).toHaveBeenCalledWith({
		analysisId: 'analysis-1',
		projectId: 'project-1',
		phase: 'global-stemma',
		cache,
		settings: expect.objectContaining({
			excludedWitnesses: ['P46'],
			minExtantProportion: 0.5,
		}),
		notifyOs: true,
	});
	expect(mocks.writeEditingPresence).toHaveBeenCalledWith('project-1', 'analysis-1');
	expect(mocks.clearEditingPresence).not.toHaveBeenCalled();

	await handlers.complete?.({
		analysisId: 'analysis-1',
		projectId: 'project-1',
		phase: 'global-stemma',
		cache: stemmaCache,
		notifyOs: false,
	});

	expect(mocks.setCbgmGlobalStemmaState).toHaveBeenLastCalledWith(
		'project-1',
		'analysis-1',
		'ready',
		stemmaCache
	);
	expect(mocks.clearEditingPresence).toHaveBeenCalledWith('project-1', 'analysis-1');
	expect(mocks.writeEditingPresence).toHaveBeenCalledTimes(1);
});

afterEach(() => vi.unstubAllGlobals());

it.each([null, 'digraph G { A -> B; }'])(
	'replaces unfinished global-stemma work with native results (%s)',
	async dot => {
		vi.stubGlobal(
			'Worker',
			class {
				onmessage: ((event: { data: { ok: boolean; result: null } }) => void) | null = null;
				postMessage() {
					queueMicrotask(() => this.onmessage?.({ data: { ok: true, result: null } }));
				}
				terminate() {}
			}
		);
		mocks.readCbgmAnalysisInputTei.mockResolvedValue('<TEI/>');
		const cache = new Uint8Array([1, 2]);
		const cancel = vi.fn(async () => undefined);
		await importNativeResults(
			{ ...analysis, coherence: 'ready', global_stemma: 'computing' },
			{ cache, globalStemmaDot: dot },
			{ cancel }
		);
		expect(cancel).toHaveBeenCalledWith(analysis.id);
		expect(mocks.completeCbgmCoherence).toHaveBeenCalledWith(
			analysis.project_id,
			analysis.id,
			cache
		);
		if (dot === null)
			expect(mocks.setCbgmGlobalStemmaState).toHaveBeenCalledWith(
				analysis.project_id,
				analysis.id,
				'none'
			);
		else
			expect(mocks.setCbgmGlobalStemmaState).toHaveBeenCalledWith(
				analysis.project_id,
				analysis.id,
				'imported-dot',
				undefined,
				dot
			);
		expect(mocks.clearEditingPresence).toHaveBeenCalledWith(analysis.project_id, analysis.id);
	}
);
