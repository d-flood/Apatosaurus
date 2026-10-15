import { beforeEach, expect, it, vi } from 'vitest';

import { notificationCenter } from '$lib/shell/notification-center.svelte';
import type { CbgmCompletion, CbgmFailure } from './cbgm-scheduler.svelte';

const mocks = vi.hoisted(() => ({
	completeCbgmCoherence: vi.fn(),
	failCbgmCoherence: vi.fn(),
}));

vi.mock('$lib/db/client', () => ({
	completeCbgmCoherence: mocks.completeCbgmCoherence,
	createCbgmAnalysis: vi.fn(),
	deleteCbgmAnalysis: vi.fn(),
	failCbgmCoherence: mocks.failCbgmCoherence,
	findCbgmAnalysis: vi.fn(),
	loadCbgmCollationSnapshots: vi.fn(),
}));

import { persistCbgmComputations } from './cbgm-analysis-runs';

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
	notificationCenter.items = [];
	mocks.completeCbgmCoherence.mockResolvedValue({ id: 'analysis-1', name: 'Romans' });
	mocks.failCbgmCoherence.mockResolvedValue({ id: 'analysis-1', name: 'Romans' });
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
