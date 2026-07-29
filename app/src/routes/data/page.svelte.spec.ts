import { page } from '@vitest/browser/context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const mocks = vi.hoisted(() => ({
	requestPersistence: vi.fn(),
	requestCacheWarmNow: vi.fn(),
	getOfflineCacheSize: vi.fn(async () => 1536),
	getCorpusCacheEntryCount: vi.fn(async () => 0),
	releaseCorpusCache: vi.fn(async () => undefined),
	getStorageEstimate: vi.fn(async () => ({
		usage: null as number | null,
		quota: null as number | null,
		usageRatio: null as number | null,
		isNearQuota: false,
	})),
	warmListeners: [] as Array<(progress: unknown) => void>,
}));

vi.mock('$lib/client/capabilities', () => ({
	checkStoragePersistence: vi.fn(async () => ({
		status: 'denied',
		persisted: false,
		canRequest: true,
	})),
	formatStorageBytes: vi.fn((value: number | null) => {
		if (value === 1536) return '1.5 KB';
		if (value === 44 * 1024 * 1024) return '44 MB';
		return 'Unavailable';
	}),
	getInstallCapabilityReport: vi.fn(() => ({ isInstalled: false, installSupported: false })),
	getStorageEstimate: mocks.getStorageEstimate,
	isLocalFolderProviderSupported: vi.fn(() => false),
	isOpfsSupported: vi.fn(() => true),
	requestPersistentStorageForMeaningfulWrite: mocks.requestPersistence,
	shouldShowDurabilityWarning: vi.fn(() => false),
}));

vi.mock('$lib/client/sw-registration', () => ({
	getCorpusCacheEntryCount: mocks.getCorpusCacheEntryCount,
	getOfflineCacheSize: mocks.getOfflineCacheSize,
	onCacheWarmProgress: vi.fn((listener: (progress: unknown) => void) => {
		mocks.warmListeners.push(listener);
		return vi.fn();
	}),
	requestCacheWarmNow: mocks.requestCacheWarmNow,
	releaseCorpusCache: mocks.releaseCorpusCache,
}));

vi.mock('$lib/client/collation/project-collation', () => ({
	listProjects: vi.fn(async () => []),
}));

vi.mock('$lib/client/db/client', () => ({
	deriveProjectBackupSummary: vi.fn(),
	exportAllProjectsZip: vi.fn(),
	rebuildLocalIndex: vi.fn(),
	restoreOrphanPrimary: vi.fn(),
	subscribeLocalDbInvalidations: vi.fn(() => vi.fn()),
}));

vi.mock('$lib/client/db/runtime', () => ({ ensureLocalDbRuntime: vi.fn() }));
vi.mock('$lib/client/download-blob', () => ({ downloadZipArchive: vi.fn() }));
vi.mock('$lib/client/store', () => ({
	listSyncTargets: vi.fn(async () => []),
	recordProjectZipExport: vi.fn(),
}));
vi.mock('$lib/client/sync/providers/local-folder-provider', () => ({
	LOCAL_FOLDER_ROOT_FOLDER_ID: 'root',
}));

import Page from './+page.svelte';

describe('/data persistence request', () => {
	beforeEach(() => {
		mocks.getCorpusCacheEntryCount.mockResolvedValue(0);
		mocks.getStorageEstimate.mockResolvedValue({
			usage: null,
			quota: null,
			usageRatio: null,
			isNearQuota: false,
		});
	});
	it('explains when the browser silently denies persistent storage', async () => {
		mocks.requestPersistence.mockResolvedValue({
			status: 'denied',
			persisted: false,
			canRequest: true,
		});
		render(Page);

		const requestButton = page.getByRole('button', { name: 'Request persistent storage' });
		await expect.element(requestButton).toBeInTheDocument();
		await requestButton.click();

		await expect
			.element(page.getByRole('status'))
			.toHaveTextContent('This browser did not grant persistent storage.');
		await expect.element(requestButton).not.toBeInTheDocument();
		expect(mocks.requestPersistence).toHaveBeenCalledOnce();
	});

	it('shows shell-only readiness before progress arrives and reports cache usage', async () => {
		render(Page);

		await expect
			.element(page.getByRole('heading', { name: 'Offline Readiness' }))
			.toBeInTheDocument();
		await expect.element(page.getByText('Ready for offline startup')).toBeInTheDocument();
		await expect.element(page.getByText('Shell only')).toBeInTheDocument();
		await expect.element(page.getByText('1.5 KB')).toBeInTheDocument();
	});

	it('shows route warm progress and allows immediate preparation', async () => {
		render(Page);
		await page.getByRole('button', { name: 'Prepare for offline now' }).click();
		expect(mocks.requestCacheWarmNow).toHaveBeenCalledWith('routes');

		mocks.warmListeners.at(-1)?.({
			tier: 'routes',
			state: 'warming',
			completed: 12,
			total: 30,
			bytesCached: null,
		});

		await expect.element(page.getByText('Warming now: 12 of 30')).toBeInTheDocument();
	});

	it('explains a metered-connection skip and offers the same retry action after failure', async () => {
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
			.element(page.getByText('Shell only; skipped on a metered connection'))
			.toBeInTheDocument();

		listener?.({
			tier: 'routes',
			state: 'failed',
			completed: 0,
			total: 30,
			bytesCached: null,
			reason: 'network-error',
		});
		await expect.element(page.getByText('Offline preparation failed')).toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Prepare for offline now' }))
			.toBeInTheDocument();
	});

	it('offers the approximate corpus size and derives opt-in state from cache contents', async () => {
		mocks.getCorpusCacheEntryCount.mockResolvedValueOnce(0);
		render(Page);

		await expect.element(page.getByText('Approximately 44 MB')).toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Download reference editions' }))
			.toBeInTheDocument();
		expect(mocks.getCorpusCacheEntryCount).toHaveBeenCalled();
	});

	it('refuses corpus preparation when the download cannot fit', async () => {
		mocks.getStorageEstimate.mockResolvedValue({
			usage: 60 * 1024 * 1024,
			quota: 100 * 1024 * 1024,
			usageRatio: 0.6,
			isNearQuota: false,
		});
		render(Page);

		await page.getByRole('button', { name: 'Download reference editions' }).click();

		await expect
			.element(page.getByRole('status'))
			.toHaveTextContent('not enough browser storage');
		expect(mocks.requestCacheWarmNow).not.toHaveBeenCalledWith('corpus');
	});

	it('shows corpus progress, resumes after a partial download, and releases only its cache', async () => {
		mocks.getCorpusCacheEntryCount.mockResolvedValueOnce(12);
		render(Page);
		await expect
			.element(page.getByRole('button', { name: 'Release reference editions' }))
			.toBeInTheDocument();

		mocks.warmListeners.at(-1)?.({
			tier: 'corpus',
			state: 'partial',
			completed: 12,
			total: 30,
			bytesCached: null,
			reason: 'network-error',
		});
		await expect.element(page.getByText('Download incomplete: 12 of 30')).toBeInTheDocument();
		await page.getByRole('button', { name: 'Retry reference edition download' }).click();
		expect(mocks.requestCacheWarmNow).toHaveBeenCalledWith('corpus');

		await page.getByRole('button', { name: 'Release reference editions' }).click();
		expect(mocks.releaseCorpusCache).toHaveBeenCalledOnce();
		await expect
			.element(page.getByRole('button', { name: 'Download reference editions' }))
			.toBeInTheDocument();
	});
});
