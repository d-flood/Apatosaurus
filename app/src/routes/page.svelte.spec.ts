import { page } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const mocks = vi.hoisted(() => ({
	listProjects: vi.fn(),
	listTranscriptionSummaries: vi.fn(),
	listCollationsWithProjectNames: vi.fn(),
	listConflictCopies: vi.fn(async () => [] as unknown[]),
	listProjectIdsWithContent: vi.fn(async () => [] as string[]),
	listProjectPlacements: vi.fn(async () => [] as unknown[]),
	dismissPlacementNotice: vi.fn(),
	shouldShowDurabilityWarning: vi.fn(() => false),
	getStorageEstimate: vi.fn(async () => ({
		usage: 1,
		quota: 100,
		usageRatio: 0.01,
		isNearQuota: false,
	})),
	warmListeners: [] as Array<(progress: unknown) => void>,
}));

vi.mock('$lib/shell/capabilities', () => ({
	checkStoragePersistence: vi.fn(async () => ({
		status: 'granted',
		persisted: true,
		canRequest: false,
	})),
	getStorageEstimate: mocks.getStorageEstimate,
	isLocalFolderProviderSupported: vi.fn(() => true),
	shouldShowDurabilityWarning: mocks.shouldShowDurabilityWarning,
}));

vi.mock('$lib/db/client', () => ({
	listPendingUploadPaths: vi.fn(),
	getProjectTranscriptionStatusForOwnedTranscription: vi.fn(),
	listCollationsWithProjectNames: mocks.listCollationsWithProjectNames,
	listConflictCopies: mocks.listConflictCopies,
	listProjectIdsWithContent: mocks.listProjectIdsWithContent,
	listProjects: mocks.listProjects,
	listTranscriptionSummaries: mocks.listTranscriptionSummaries,
	subscribeLocalDbInvalidations: vi.fn(() => vi.fn()),
}));

vi.mock('$lib/db/runtime', () => ({
	ensureLocalDbRuntime: vi.fn(),
}));

vi.mock('$lib/storage/project-locations', () => ({
	isPlacedProject: vi.fn(() => true),
	listProjectLocations: vi.fn(async () => []),
	listProjectPlacements: mocks.listProjectPlacements,
}));

vi.mock('$lib/backup/location-connections', () => ({
	dismissPlacementNotice: mocks.dismissPlacementNotice,
}));

vi.mock('$lib/shell/sw-registration', () => ({
	onCacheWarmProgress: vi.fn((listener: (progress: unknown) => void) => {
		mocks.warmListeners.push(listener);
		return vi.fn();
	}),
}));

import Page from './+page.svelte';

describe('/+page.svelte dashboard', () => {
	afterEach(() => {
		mocks.shouldShowDurabilityWarning.mockReset();
		mocks.getStorageEstimate.mockReset();
	});

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

	it('lists each conflict copy as an attention item linking to reconcile', async () => {
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
		mocks.listConflictCopies.mockResolvedValue([
			{
				kind: 'transcription',
				copyId: 'tx-copy',
				originId: 'tx-1',
				projectId: 'project-1',
				title: 'Witness 01',
				author: 'User B',
				createdAt: '2026-07-18T10:00:00.000Z',
			},
		]);

		render(Page);

		await expect
			.element(
				page.getByRole('heading', { name: /^Conflict copy of Witness 01 from User B · / })
			)
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: 'Reconcile' }))
			.toHaveAttribute('href', '/projects/project-1/conflicts/tx-copy');
	});

	it('asks once where an alpha folder project lives, and keeps it in this browser on request', async () => {
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
		mocks.listConflictCopies.mockResolvedValue([]);
		mocks.listProjectPlacements.mockResolvedValue([
			{
				projectId: 'project-1',
				locationId: null,
				folderName: null,
				needsLocationChoice: true,
			},
		]);

		render(Page);

		await expect
			.element(page.getByRole('heading', { name: 'Choose where this project lives' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: 'Move Romans' }))
			.toHaveAttribute('href', '/projects/project-1/location');
		await page.getByRole('button', { name: 'Keep in this browser' }).click();
		expect(mocks.dismissPlacementNotice).toHaveBeenCalledWith('project-1');
	});

	it('says who moved a project and when until dismissed', async () => {
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
		mocks.listConflictCopies.mockResolvedValue([]);
		mocks.listProjectPlacements.mockResolvedValue([
			{
				projectId: 'project-1',
				locationId: null,
				folderName: null,
				needsLocationChoice: false,
				moved: {
					movedAt: '2026-10-03T12:00:00.000Z',
					movedBy: 'Ada',
					destinationLabel: 'Dropbox/Lab',
				},
			},
		]);

		render(Page);

		await expect
			.element(page.getByTestId('dashboard-attention'))
			.toHaveTextContent(/Romans moved.*Moved by Ada on .* to Dropbox\/Lab/);
		await page.getByRole('button', { name: 'Dismiss' }).click();
		expect(mocks.dismissPlacementNotice).toHaveBeenCalledWith('project-1');
	});

	it('warns about browser cleanup only while a project is not backed up', async () => {
		mocks.shouldShowDurabilityWarning.mockReturnValue(true);
		mocks.getStorageEstimate.mockResolvedValue({
			usage: 99,
			quota: 100,
			usageRatio: 0.99,
			isNearQuota: true,
		});
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
		mocks.listConflictCopies.mockResolvedValue([]);
		mocks.listProjectPlacements.mockResolvedValue([
			{
				projectId: 'project-1',
				locationId: 'location-1',
				folderName: 'project-1',
				needsLocationChoice: false,
			},
		]);

		const view = render(Page);

		await expect
			.element(page.getByRole('heading', { name: 'Storage on this device is nearly full' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: 'Review storage usage' }))
			.toHaveAttribute('href', '/data#advanced');
		await expect
			.element(page.getByRole('heading', { name: 'Protect local work from browser cleanup' }))
			.not.toBeInTheDocument();

		view.unmount();
		mocks.listProjectPlacements.mockResolvedValue([]);
		render(Page);

		await expect
			.element(page.getByRole('heading', { name: 'Protect local work from browser cleanup' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: 'Review storage durability' }))
			.toHaveAttribute('href', '/data#advanced');
	});
});
