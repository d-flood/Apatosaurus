import { page } from '@vitest/browser/context';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const mocks = vi.hoisted(() => ({
	listProjects: vi.fn(),
	listTranscriptionSummaries: vi.fn(),
	listCollationsWithProjectNames: vi.fn(),
	warmListeners: [] as Array<(progress: unknown) => void>,
}));

vi.mock('$lib/client/capabilities', () => ({
	checkStoragePersistence: vi.fn(async () => ({
		status: 'granted',
		persisted: true,
		canRequest: false,
	})),
	getStorageEstimate: vi.fn(async () => ({
		usage: 1,
		quota: 100,
		usageRatio: 0.01,
		isNearQuota: false,
	})),
	shouldShowDurabilityWarning: vi.fn(() => false),
}));

vi.mock('$lib/client/db/client', () => ({
	deriveProjectBackupSummary: vi.fn(),
	getCollationVersionStatus: vi.fn(),
	getProjectTranscriptionStatusForOwnedTranscription: vi.fn(),
	listCollationsWithProjectNames: mocks.listCollationsWithProjectNames,
	listProjects: mocks.listProjects,
	listTranscriptionSummaries: mocks.listTranscriptionSummaries,
	subscribeLocalDbInvalidations: vi.fn(() => vi.fn()),
}));

vi.mock('$lib/client/db/runtime', () => ({
	ensureLocalDbRuntime: vi.fn(),
}));

vi.mock('$lib/client/store', () => ({
	listSyncTargets: vi.fn(async () => []),
}));

vi.mock('$lib/client/sw-registration', () => ({
	onCacheWarmProgress: vi.fn((listener: (progress: unknown) => void) => {
		mocks.warmListeners.push(listener);
		return vi.fn();
	}),
}));

import Page from './+page.svelte';

describe('/+page.svelte dashboard', () => {
	it('promotes creation in the resolved project when there is no recent work', async () => {
		mocks.listProjects.mockResolvedValue([
			{
				id: 'project-1',
				storageSlug: 'project-1',
				name: 'Romans',
				description: '',
				createdAt: '2026-07-01T00:00:00.000Z',
				updatedAt: '2026-07-18T00:00:00.000Z',
			},
		]);
		mocks.listTranscriptionSummaries.mockResolvedValue([]);
		mocks.listCollationsWithProjectNames.mockResolvedValue([]);

		render(Page);

		await expect.element(page.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: 'New Transcription in Romans' }))
			.toHaveAttribute('href', '/transcription/new?projectId=project-1');
	});

	it('raises offline attention only for failure or quota exhaustion', async () => {
		mocks.listProjects.mockResolvedValue([
			{
				id: 'project-1',
				storageSlug: 'project-1',
				name: 'Romans',
				description: '',
				createdAt: '2026-07-01T00:00:00.000Z',
				updatedAt: '2026-07-18T00:00:00.000Z',
			},
		]);
		mocks.listTranscriptionSummaries.mockResolvedValue([]);
		mocks.listCollationsWithProjectNames.mockResolvedValue([]);
		render(Page);
		const listener = mocks.warmListeners.at(-1);

		listener?.({
			tier: 'routes',
			state: 'skipped',
			completed: 0,
			total: 30,
			bytesCached: null,
			reason: 'save-data',
		});
		await expect
			.element(page.getByRole('link', { name: 'Review offline readiness' }))
			.not.toBeInTheDocument();

		listener?.({
			tier: 'routes',
			state: 'failed',
			completed: 0,
			total: 30,
			bytesCached: null,
			reason: 'network-error',
		});
		await expect
			.element(page.getByRole('link', { name: 'Review offline readiness' }))
			.toHaveAttribute('href', '/data');

		listener?.({
			tier: 'routes',
			state: 'skipped',
			completed: 0,
			total: 30,
			bytesCached: null,
			reason: 'quota',
		});
		await expect
			.element(page.getByRole('heading', { name: 'Offline preparation needs storage' }))
			.toBeInTheDocument();
	});
});
