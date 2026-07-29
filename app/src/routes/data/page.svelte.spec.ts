import { page } from '@vitest/browser/context';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const mocks = vi.hoisted(() => ({
	requestPersistence: vi.fn(),
}));

vi.mock('$lib/client/capabilities', () => ({
	checkStoragePersistence: vi.fn(async () => ({
		status: 'denied',
		persisted: false,
		canRequest: true,
	})),
	formatStorageBytes: vi.fn(() => 'Unavailable'),
	getInstallCapabilityReport: vi.fn(() => ({ isInstalled: false, installSupported: false })),
	getStorageEstimate: vi.fn(async () => ({
		usage: null,
		quota: null,
		usageRatio: null,
		isNearQuota: false,
	})),
	isLocalFolderProviderSupported: vi.fn(() => false),
	isOpfsSupported: vi.fn(() => true),
	requestPersistentStorageForMeaningfulWrite: mocks.requestPersistence,
	shouldShowDurabilityWarning: vi.fn(() => false),
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
});
