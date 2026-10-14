import { page } from '@vitest/browser/context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';

const mocks = vi.hoisted(() => ({
	requestPersistence: vi.fn(),
	requestCacheWarmNow: vi.fn(),
	getOfflineCacheSize: vi.fn(async () => 1536),
	getCorpusCacheEntryCount: vi.fn(async () => 0),
	releaseCorpusCache: vi.fn(async () => undefined),
	exportAllProjectsZip: vi.fn(),
	restoreReferenceEditionsArchive: vi.fn(),
	downloadZipArchive: vi.fn(),
	inspectUserReferenceEditions: vi.fn(async () => ({
		editions: [] as Array<{ id: string }>,
		invalidPaths: [] as string[],
	})),
	getStorageEstimate: vi.fn(async () => ({
		usage: null as number | null,
		quota: null as number | null,
		usageRatio: null as number | null,
		isNearQuota: false,
	})),
	warmListeners: [] as Array<(progress: unknown) => void>,
	listProjectLocations: vi.fn(async () => [] as unknown[]),
	addDeviceLocation: vi.fn(async () => undefined),
	listStorageAccounts: vi.fn(async () => [] as unknown[]),
	signOutAccount: vi.fn(async () => undefined),
	beginSignIn: vi.fn(),
	googleTeamLocations: false,
	listProjects: vi.fn(async () => [] as import('$lib/db/repositories/projects').ProjectOption[]),
	listProjectPlacements: vi.fn(
		async () => [] as import('$lib/storage/project-locations').ProjectPlacement[]
	),
}));

vi.mock('$lib/shell/capabilities', () => ({
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

vi.mock('$lib/shell/sw-registration', () => ({
	getCorpusCacheEntryCount: mocks.getCorpusCacheEntryCount,
	getOfflineCacheSize: mocks.getOfflineCacheSize,
	onCacheWarmProgress: vi.fn((listener: (progress: unknown) => void) => {
		mocks.warmListeners.push(listener);
		return vi.fn();
	}),
	requestCacheWarmNow: mocks.requestCacheWarmNow,
	releaseCorpusCache: mocks.releaseCorpusCache,
}));

vi.mock('$lib/db/client', () => ({
	listProjects: mocks.listProjects,
	listPendingUploadPaths: vi.fn(),
	exportAllProjectsZip: mocks.exportAllProjectsZip,
	restoreReferenceEditionsArchive: mocks.restoreReferenceEditionsArchive,
	rebuildLocalIndex: vi.fn(),
	restoreOrphanPrimary: vi.fn(),
	subscribeLocalDbInvalidations: vi.fn(() => vi.fn()),
}));

vi.mock('$lib/db/runtime', () => ({ ensureLocalDbRuntime: vi.fn() }));
vi.mock('$lib/shell/download-blob', () => ({ downloadZipArchive: mocks.downloadZipArchive }));
vi.mock('$lib/storage/project-locations', () => ({
	isPlacedProject: vi.fn(() => true),
	listProjectLocations: mocks.listProjectLocations,
	listProjectPlacements: mocks.listProjectPlacements,
	listStorageAccounts: mocks.listStorageAccounts,
}));
vi.mock('$lib/storage/app-settings', () => ({
	readAppSettings: vi.fn(async () => ({ authorName: null })),
	saveAppSettings: vi.fn(async () => undefined),
}));
vi.mock('$lib/storage/device-identity', () => ({
	readDeviceIdentity: vi.fn(async () => ({
		deviceId: 'device-1',
		deviceName: 'Chrome on Linux',
	})),
	saveDeviceName: vi.fn(),
}));
vi.mock('$lib/backup/location-connections', () => ({
	addDeviceLocation: mocks.addDeviceLocation,
	addTeamLocation: vi.fn(),
	browseTeamFolders: vi.fn(),
	completeAccountSignIn: vi.fn(),
	inspectGoogleTeamFolder: vi.fn(),
	reconnectDeviceLocation: vi.fn(),
	signOutAccount: mocks.signOutAccount,
}));
vi.mock('$lib/backup/storage-account-auth', async importOriginal => ({
	...(await importOriginal<typeof import('$lib/backup/storage-account-auth')>()),
	beginSignIn: mocks.beginSignIn,
}));
vi.mock('$lib/backup/google-team-locations', async importOriginal => {
	const actual = await importOriginal<typeof import('$lib/backup/google-team-locations')>();
	return {
		...actual,
		teamLocationAccounts: (accounts: Parameters<typeof actual.teamLocationAccounts>[0]) =>
			actual.teamLocationAccounts(accounts, mocks.googleTeamLocations),
	};
});
vi.mock('$lib/backup/sync-service.svelte', () => ({
	syncService: { reconnectProjectIds: [], projectStatus: () => ({ state: 'synced' }) },
}));
vi.mock('$lib/reference-editions/user-reference-editions', () => ({
	inspectUserReferenceEditions: mocks.inspectUserReferenceEditions,
}));
vi.mock('$lib/storage/backup-metadata', () => ({
	recordProjectZipExport: vi.fn(),
}));
vi.mock('$lib/backup/providers/local-folder-provider', () => ({
	LOCAL_FOLDER_ROOT_FOLDER_ID: 'root',
}));

import Page from './+page.svelte';
import * as capabilities from '$lib/shell/capabilities';

async function openAdvanced() {
	await page.getByText('Advanced', { exact: true }).click();
}

function headingTexts(headings: Iterable<Element>): string[] {
	return [...headings].map(heading => heading.textContent?.trim() ?? '');
}

describe('/data layout', () => {
	afterEach(() => {
		history.replaceState(null, '', location.pathname + location.search);
	});

	it('leads with storage accounts, sync status and export, and keeps device controls in a closed Advanced', async () => {
		const { container } = render(Page);
		await expect.element(page.getByRole('heading', { name: 'Storage accounts' })).toBeVisible();

		const advanced = container.querySelector<HTMLDetailsElement>('details#advanced')!;
		expect(advanced.open).toBe(false);
		const headings = [...container.querySelectorAll('h2')];
		expect(headingTexts(headings.filter(heading => !advanced.contains(heading)))).toEqual([
			'Keep your projects safe',
			'Storage accounts',
			'Project Sync Status',
			'Whole-Account Export',
		]);
		expect(headingTexts(headings.filter(heading => advanced.contains(heading)))).toEqual([
			'Folder on this computer',
			'Offline Readiness',
			'Storage Durability',
			'Local Storage',
			'This device',
			'Your name',
			'Repair Database',
		]);
		expect(
			[...advanced.querySelectorAll('button')]
				.find(button => button.textContent?.trim() === 'Repair database')
				?.checkVisibility()
		).toBe(false);

		await openAdvanced();
		await expect.element(page.getByRole('button', { name: 'Repair database' })).toBeVisible();
	});

	it('opens Advanced when the page loads at #advanced', async () => {
		history.replaceState(null, '', '#advanced');
		render(Page);

		await expect.element(page.getByRole('button', { name: 'Repair database' })).toBeVisible();
	});

	it('opens Advanced on a hash change to #advanced', async () => {
		const { container } = render(Page);
		await expect.element(page.getByRole('heading', { name: 'Storage accounts' })).toBeVisible();
		expect(container.querySelector<HTMLDetailsElement>('details#advanced')!.open).toBe(false);

		location.hash = 'advanced';

		await expect.element(page.getByRole('button', { name: 'Repair database' })).toBeVisible();
	});
});

describe('/data locations', () => {
	beforeEach(async () => {
		const actual =
			await vi.importActual<typeof import('$lib/shell/capabilities')>(
				'$lib/shell/capabilities'
			);
		vi.mocked(capabilities.isLocalFolderProviderSupported).mockImplementation(
			actual.isLocalFolderProviderSupported
		);
		return () => {
			vi.mocked(capabilities.isLocalFolderProviderSupported).mockImplementation(() => false);
			vi.unstubAllGlobals();
		};
	});

	it('offers a folder on this computer when the directory picker exists', async () => {
		vi.stubGlobal('showDirectoryPicker', vi.fn());
		render(Page);
		await openAdvanced();

		const add = page.getByRole('button', { name: 'Add folder on this computer' });
		await expect.element(add).toBeInTheDocument();
		await add.click();
		expect(mocks.addDeviceLocation).toHaveBeenCalledOnce();
	});

	it('signs out keeping projects by default, and shows a refused removal', async () => {
		mocks.listStorageAccounts.mockResolvedValue([
			{
				id: 'dbid:a',
				provider: 'dropbox',
				displayName: 'Ada',
				email: 'ada@example.org',
				grantedScopes: [],
				signedIn: true,
			},
		]);
		mocks.signOutAccount.mockRejectedValueOnce(
			new Error('Changes are still waiting to upload in Romans.')
		);
		render(Page);

		await page.getByRole('button', { name: 'Sign out' }).click();
		const keep = page.getByRole('radio', { name: /Keep on this device/ });
		const remove = page.getByRole('radio', { name: /Remove from this device/ });
		await expect.element(keep).toBeChecked();
		await remove.click();
		await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click();
		expect(mocks.signOutAccount).toHaveBeenLastCalledWith('dbid:a', true);
		await expect
			.element(page.getByRole('alert').getByText(/waiting to upload in Romans/))
			.toBeInTheDocument();

		await keep.click();
		await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click();
		expect(mocks.signOutAccount).toHaveBeenLastCalledWith('dbid:a', false);
		mocks.listStorageAccounts.mockResolvedValue([]);
	});

	it('offers Google in Add team location only with the flag on, and asks for drive once', async () => {
		const google = {
			id: 'google:1',
			provider: 'google',
			displayName: 'Ada',
			email: 'ada@example.org',
			grantedScopes: ['https://www.googleapis.com/auth/drive.file'],
			signedIn: true,
		};
		mocks.listStorageAccounts.mockResolvedValue([google]);
		render(Page);

		await expect.element(page.getByText('Ada', { exact: true })).toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Add team location' }))
			.not.toBeInTheDocument();
		cleanup();

		mocks.googleTeamLocations = true;
		render(Page);
		await page.getByRole('button', { name: 'Add team location' }).click();
		await page.getByRole('button', { name: 'Continue to Google' }).click();

		expect(mocks.beginSignIn).toHaveBeenCalledWith('google', {
			scopes: 'drive',
			loginHint: 'ada@example.org',
			returnTo: '/data',
		});
		cleanup();

		mocks.beginSignIn.mockClear();
		mocks.listStorageAccounts.mockResolvedValue([
			{ ...google, grantedScopes: ['https://www.googleapis.com/auth/drive'] },
		]);
		render(Page);
		await page.getByRole('button', { name: 'Add team location' }).click();
		await expect.element(page.getByRole('button', { name: 'Choose folder' })).toBeVisible();
		await expect.element(page.getByText(/ask once for access/)).not.toBeInTheDocument();
		expect(mocks.beginSignIn).not.toHaveBeenCalled();
		mocks.googleTeamLocations = false;
		mocks.listStorageAccounts.mockResolvedValue([]);
	});

	it('does not render the folder option without the directory picker', async () => {
		vi.stubGlobal('showDirectoryPicker', undefined);
		render(Page);
		await openAdvanced();

		await expect
			.element(page.getByRole('heading', { name: 'Folder on this computer' }))
			.toBeVisible();
		await expect.element(page.getByText('No folders yet.')).toBeVisible();
		expect(
			page.getByRole('button', { name: 'Add folder on this computer' }).elements()
		).toHaveLength(0);
	});
});

describe('/data persistence request', () => {
	beforeEach(() => {
		mocks.getCorpusCacheEntryCount.mockResolvedValue(0);
		mocks.inspectUserReferenceEditions.mockResolvedValue({ editions: [], invalidPaths: [] });
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
		await openAdvanced();

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
		await openAdvanced();

		await expect
			.element(page.getByRole('heading', { name: 'Offline Readiness' }))
			.toBeInTheDocument();
		await expect.element(page.getByText('Ready for offline startup')).toBeInTheDocument();
		await expect.element(page.getByText('Shell only')).toBeInTheDocument();
		await expect.element(page.getByText('1.5 KB')).toBeInTheDocument();
	});

	it('shows route warm progress and allows immediate preparation', async () => {
		render(Page);
		await openAdvanced();
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
		await openAdvanced();
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
		await openAdvanced();

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
		await openAdvanced();

		await page.getByRole('button', { name: 'Download reference editions' }).click();

		await expect
			.element(page.getByRole('status'))
			.toHaveTextContent('Not enough browser storage');
		expect(mocks.requestCacheWarmNow).not.toHaveBeenCalledWith('corpus');
	});

	it('shows corpus progress, resumes after a partial download, and releases only its cache', async () => {
		mocks.getCorpusCacheEntryCount.mockResolvedValueOnce(12);
		render(Page);
		await openAdvanced();
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

	it('downloads the reference-edition sidecar from the existing whole-account export control', async () => {
		mocks.inspectUserReferenceEditions.mockResolvedValue({
			editions: [{ id: 'user-one' }],
			invalidPaths: [],
		});
		mocks.exportAllProjectsZip.mockResolvedValue({
			archives: [],
			invalidProjects: [],
			exportedAt: '2026-08-03T12:00:00.000Z',
			referenceEditionsArchive: {
				fileName: 'reference-editions-2026-08-03.zip',
				bytes: new Uint8Array([1, 2, 3]),
				entryPaths: ['reference-editions/user-one.json'],
			},
		});
		render(Page);

		await page.getByRole('button', { name: 'Export all projects' }).click();

		expect(mocks.downloadZipArchive).toHaveBeenCalledWith(
			'reference-editions-2026-08-03.zip',
			new Uint8Array([1, 2, 3])
		);
	});

	it('restores a reference-edition archive through the account UI and refreshes the catalog', async () => {
		mocks.restoreReferenceEditionsArchive.mockResolvedValue({ restored: 1, skipped: 0 });
		mocks.inspectUserReferenceEditions
			.mockResolvedValueOnce({ editions: [], invalidPaths: [] })
			.mockResolvedValueOnce({ editions: [{ id: 'user-restored' }], invalidPaths: [] });
		render(Page);

		await page
			.getByLabelText(/Restore editions/)
			.upload(new File([new Uint8Array([1, 2, 3])], 'reference-editions.zip'));

		await expect
			.element(page.getByRole('status'))
			.toHaveTextContent('1 available in the catalog');
		expect(mocks.restoreReferenceEditionsArchive).toHaveBeenCalledOnce();
		expect(mocks.restoreReferenceEditionsArchive.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array);
	});

	it('surfaces corrupt editions without hiding usable page data', async () => {
		mocks.inspectUserReferenceEditions.mockResolvedValue({
			editions: [{ id: 'user-valid' }],
			invalidPaths: ['app/reference-editions/user-corrupt.json'],
		});
		render(Page);

		await expect
			.element(page.getByRole('alert'))
			.toHaveTextContent('1 stored reference edition is corrupt');
		await expect
			.element(page.getByRole('button', { name: 'Export all projects' }))
			.toBeEnabled();
	});
});

describe('/data storage warnings', () => {
	beforeEach(() => {
		mocks.listProjects.mockResolvedValue([
			{
				id: 'romans',
				name: 'Romans',
				storageSlug: 'romans',
				description: '',
				createdAt: '2026-10-01',
				updatedAt: '2026-10-01',
			},
		]);
		vi.mocked(capabilities.shouldShowDurabilityWarning).mockImplementation(
			input => input.hasUserData
		);
	});
	afterEach(() => {
		mocks.listProjects.mockResolvedValue([]);
		mocks.listProjectPlacements.mockResolvedValue([]);
		vi.mocked(capabilities.shouldShowDurabilityWarning).mockImplementation(() => false);
	});

	it.each(['cloud', 'device', 'moved', 'deleted', 'browser-only'])(
		'warns about cleanup only for browser-only work, with %s placement',
		async kind => {
			mocks.listProjectPlacements.mockResolvedValue([
				{
					projectId: 'romans',
					locationId: kind === 'cloud' || kind === 'device' ? kind : null,
					folderName: kind === 'cloud' || kind === 'device' ? 'romans' : null,
					needsLocationChoice: false,
					...(kind === 'moved'
						? {
								moved: {
									movedAt: '2026-10-01',
									movedBy: 'Ada',
									destinationLabel: 'Dropbox',
								},
							}
						: {}),
					...(kind === 'deleted'
						? { deleted: { deletedAt: '2026-10-01', deletedBy: 'Ada' } }
						: {}),
				},
			]);
			render(Page);
			await expect.element(page.getByRole('link', { name: 'Romans' })).toBeVisible();
			await openAdvanced();
			const warning = page.getByText("Storage isn't persistent", { exact: true });
			if (kind === 'browser-only') await expect.element(warning).toBeVisible();
			else await expect.element(warning).not.toBeInTheDocument();
		}
	);

	it('names device storage when quota runs low even for backed-up work', async () => {
		mocks.listProjectPlacements.mockResolvedValue([
			{
				projectId: 'romans',
				locationId: 'cloud',
				folderName: 'romans',
				needsLocationChoice: false,
			},
		]);
		mocks.getStorageEstimate.mockResolvedValue({
			usage: 95,
			quota: 100,
			usageRatio: 0.95,
			isNearQuota: true,
		});
		render(Page);
		await expect.element(page.getByRole('link', { name: 'Romans' })).toBeVisible();
		await openAdvanced();
		await expect
			.element(page.getByText('Storage on this device is nearly full.', { exact: false }))
			.toBeVisible();
	});
});
