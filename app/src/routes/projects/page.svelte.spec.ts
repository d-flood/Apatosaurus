import { page } from '@vitest/browser/context';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const mocks = vi.hoisted(() => ({
	projectStatus: vi.fn(),
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
	importProjectZip: vi.fn(),
	subscribeLocalDbInvalidations: vi.fn(() => vi.fn()),
}));

vi.mock('$lib/project/projects', () => ({ createProjectRecord: vi.fn() }));

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

vi.mock('$lib/backup/location-connections', () => ({ placeProjectInLocation: vi.fn() }));

vi.mock('$lib/backup/sync-service.svelte', () => ({
	syncService: { projectStatus: mocks.projectStatus },
}));

import Page from './+page.svelte';

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
		await expect.element(page.getByRole('combobox', { name: 'Location' })).toHaveValue('desk');
	});
});
