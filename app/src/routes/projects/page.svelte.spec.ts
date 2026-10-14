import { page } from '@vitest/browser/context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const mocks = vi.hoisted(() => ({
	projectStatus: vi.fn<(projectId: string) => object>(() => ({ state: 'synced' })),
	createProjectRecord: vi.fn(),
	importProjectZip: vi.fn(),
	placeProjectInLocation: vi.fn(),
}));

function project(id: string, name: string) {
	return {
		id,
		storageSlug: id,
		name,
		description: '',
		createdAt: '2026-07-01T00:00:00.000Z',
		updatedAt: '2026-07-18T00:00:00.000Z',
	};
}

vi.mock('$lib/db/client', () => ({
	listProjects: vi.fn(async () => [
		project('loose', 'Loose Notes'),
		project('romans', 'Romans'),
		project('galatians', 'Galatians'),
		project('acts', 'Acts'),
	]),
	importProjectZip: mocks.importProjectZip,
	subscribeLocalDbInvalidations: vi.fn(() => vi.fn()),
}));

vi.mock('$lib/project/projects', () => ({ createProjectRecord: mocks.createProjectRecord }));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/db/runtime', () => ({ ensureLocalDbRuntime: vi.fn() }));

vi.mock('$lib/storage/project-locations', async importOriginal => ({
	...(await importOriginal<typeof import('$lib/storage/project-locations')>()),
	listProjectPlacements: vi.fn(async () => [
		{
			projectId: 'romans',
			locationId: 'desk',
			folderName: 'romans',
			needsLocationChoice: false,
		},
		{
			projectId: 'galatians',
			locationId: 'lab',
			folderName: 'galatians',
			needsLocationChoice: false,
		},
		{ projectId: 'acts', locationId: 'lab', folderName: 'acts', needsLocationChoice: false },
	]),
	listProjectLocations: vi.fn(async () => [
		{ id: 'desk', accountId: null, kind: 'device', rootFolderId: '.', displayPath: 'Desk' },
		{
			id: 'lab',
			accountId: 'account-1',
			kind: 'team',
			rootFolderId: 'root',
			displayPath: 'Lab/Apatosaurus',
		},
	]),
	listStorageAccounts: vi.fn(async () => [
		{
			id: 'account-1',
			provider: 'dropbox',
			displayName: 'Ada',
			email: 'ada@example.org',
			grantedScopes: [],
			signedIn: true,
		},
	]),
}));

vi.mock('$lib/backup/project-backup-overview', () => ({
	loadProjectBackupOverviews: vi.fn(async () => ({})),
}));

vi.mock('$lib/backup/location-connections', () => ({
	completeAccountSignIn: vi.fn(),
	placeProjectInLocation: mocks.placeProjectInLocation,
}));

vi.mock('$lib/backup/sync-service.svelte', () => ({
	syncService: { projectStatus: mocks.projectStatus },
}));

import { listProjectLocations } from '$lib/storage/project-locations';
import Page from './+page.svelte';

const driveLocation = {
	id: 'drive',
	accountId: 'account-1',
	kind: 'personal' as const,
	rootFolderId: 'root',
	displayPath: 'Google Drive/Apatosaurus',
};

function chooseZip() {
	const input = document.querySelector('input[type="file"]') as HTMLInputElement;
	Object.defineProperty(input, 'files', {
		configurable: true,
		value: [new File(['zip'], 'project.zip', { type: 'application/zip' })],
	});
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('/projects grouped by location', () => {
	it('sorts projects into location groups, each with its aggregate marker', async () => {
		mocks.projectStatus.mockImplementation((projectId: string) =>
			projectId === 'acts'
				? { state: 'needs-attention', reason: 'reconnect' }
				: projectId === 'loose'
					? { state: 'saved-on-device', reason: 'browser-only' }
					: projectId === 'galatians'
						? { state: 'saved-on-device', reason: 'uploading' }
						: { state: 'synced' }
		);

		render(Page);

		const browserOnly = page.getByRole('region', { name: 'Not backed up' });
		const desk = page.getByRole('region', { name: 'Desk' });
		const lab = page.getByRole('region', { name: 'Lab/Apatosaurus' });

		await expect
			.element(browserOnly.getByRole('heading', { name: 'Loose Notes' }))
			.toBeVisible();
		await expect.element(desk.getByRole('heading', { name: 'Romans' })).toBeVisible();
		await expect.element(desk.getByText('This computer')).toBeVisible();
		await expect.element(desk.getByText('Synced', { exact: true }).first()).toBeVisible();
		await expect.element(lab.getByRole('heading', { name: 'Galatians' })).toBeVisible();
		await expect.element(lab.getByRole('heading', { name: 'Acts' })).toBeVisible();
		await expect.element(lab.getByText('ada@example.org')).toBeVisible();
		await expect.element(lab.getByText('Needs attention · Reconnect storage')).toBeVisible();
		await expect.element(lab.getByText('Saved on this device', { exact: true })).toBeVisible();
		await expect
			.element(browserOnly.getByText(/Synced|Needs attention/))
			.not.toBeInTheDocument();
		await expect
			.element(browserOnly.getByRole('heading', { name: 'Not backed up' }))
			.toBeVisible();
		await expect
			.element(browserOnly.getByText('Not backed up', { exact: true }).last())
			.toBeVisible();
		await expect.element(browserOnly.getByText('Saved on this device')).not.toBeInTheDocument();
		await expect
			.element(page.getByRole('combobox', { name: 'Location' }).first())
			.toHaveValue('desk');
	});
});

describe('/projects destination', () => {
	beforeEach(() => {
		mocks.placeProjectInLocation.mockClear();
		localStorage.clear();
	});

	it('names the only location read-only and places created and imported projects there', async () => {
		vi.mocked(listProjectLocations).mockResolvedValueOnce([driveLocation]);
		mocks.createProjectRecord.mockResolvedValueOnce('created');
		mocks.importProjectZip.mockResolvedValueOnce({
			ok: true,
			projectId: 'imported',
			mode: 'created',
			quarantinedFiles: [],
		});

		render(Page);

		const line = page.getByText('Saves to Google Drive · Apatosaurus');
		await expect.element(line.first()).toBeVisible();
		await expect.element(line.last()).toBeVisible();
		await expect
			.element(page.getByRole('combobox', { name: 'Location' }))
			.not.toBeInTheDocument();

		await page.getByPlaceholder('New project name').fill('Philemon');
		await page.getByRole('button', { name: 'Create', exact: true }).click();
		await vi.waitFor(() =>
			expect(mocks.placeProjectInLocation).toHaveBeenCalledWith('created', 'drive')
		);

		chooseZip();
		await vi.waitFor(() =>
			expect(mocks.placeProjectInLocation).toHaveBeenCalledWith('imported', 'drive')
		);
		expect(localStorage.getItem('lastUsedLocationId')).toBe('drive');
	});

	it('creates a browser-only project with a note when there is no location', async () => {
		vi.mocked(listProjectLocations).mockResolvedValueOnce([]);
		mocks.createProjectRecord.mockResolvedValueOnce('created');

		render(Page);

		await expect
			.element(
				page
					.getByText(
						'Saves only in this browser · Sign in with Google Drive or Dropbox to back up'
					)
					.first()
			)
			.toBeVisible();
		await page.getByPlaceholder('New project name').fill('Philemon');
		await page.getByRole('button', { name: 'Create', exact: true }).click();
		await vi.waitFor(() => expect(mocks.createProjectRecord).toHaveBeenCalled());
		expect(mocks.placeProjectInLocation).not.toHaveBeenCalled();
	});

	it('keeps the existing placement when an import replaces a project', async () => {
		vi.mocked(listProjectLocations).mockResolvedValueOnce([driveLocation]);
		mocks.importProjectZip
			.mockResolvedValueOnce({
				ok: false,
				projectId: 'romans',
				mode: 'created',
				quarantinedFiles: [],
				collision: {
					projectId: 'romans',
					localUpdatedAt: '2026-07-08T00:00:00.000Z',
					importedUpdatedAt: '2026-07-07T00:00:00.000Z',
				},
			})
			.mockResolvedValueOnce({
				ok: true,
				projectId: 'romans',
				mode: 'replaced',
				quarantinedFiles: [],
			});

		render(Page);

		await expect
			.element(page.getByText('Saves to Google Drive · Apatosaurus').last())
			.toBeVisible();
		chooseZip();
		await page.getByRole('button', { name: 'Replace local project' }).click();
		await expect
			.element(page.getByText('Imported the project successfully.'))
			.toBeInTheDocument();
		expect(mocks.importProjectZip).toHaveBeenLastCalledWith(expect.any(Uint8Array), 'replace');
		expect(mocks.placeProjectInLocation).not.toHaveBeenCalled();
	});
});
