import { page } from '@vitest/browser/context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const mocks = vi.hoisted(() => ({
	listProjectLocations: vi.fn(),
	listProjectPlacements: vi.fn(),
	listStorageAccounts: vi.fn(),
	moveProject: vi.fn(),
	deleteProject: vi.fn(),
	removeProjectFromDevice: vi.fn(),
	dismissPlacementNotice: vi.fn(),
}));

vi.mock('$lib/db/client', () => ({
	exportProjectZip: vi.fn(),
	forkProject: vi.fn(),
	subscribeLocalDbInvalidations: vi.fn(() => vi.fn()),
}));

vi.mock('$lib/db/runtime', () => ({ ensureLocalDbRuntime: vi.fn() }));

vi.mock('$lib/backup/location-connections', () => ({
	completeAccountSignIn: vi.fn(),
	dismissPlacementNotice: mocks.dismissPlacementNotice,
	removeProjectFromDevice: mocks.removeProjectFromDevice,
}));

vi.mock('$lib/storage/project-locations', () => ({
	listProjectLocations: mocks.listProjectLocations,
	listProjectPlacements: mocks.listProjectPlacements,
	listStorageAccounts: mocks.listStorageAccounts,
}));

vi.mock('$lib/shell/download-blob', () => ({ downloadZipArchive: vi.fn() }));

vi.mock('$lib/storage/backup-metadata', () => ({
	getProjectBackupMetadata: vi.fn(() => ({ lastExportedAt: null })),
	recordProjectZipExport: vi.fn(),
}));

vi.mock('$lib/backup/sync-service.svelte', () => ({
	syncService: {
		moveProject: mocks.moveProject,
		deleteProject: mocks.deleteProject,
		projectStatus: vi.fn(() => ({ state: 'synced' })),
	},
}));

vi.mock('$lib/backup/project-zip-export', () => ({
	projectBackupCapabilityMessage: vi.fn(() => ({ message: '' })),
}));

import ProjectLocationPanel from './ProjectLocationPanel.svelte';

const personal = {
	id: 'location-1',
	accountId: null,
	kind: 'device',
	rootFolderId: '.',
	displayPath: 'Shared Folder',
};
const team = { ...personal, id: 'location-2', kind: 'team', displayPath: 'Dropbox/Lab' };

describe('ProjectLocationPanel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listProjectLocations.mockResolvedValue([personal, team]);
		mocks.listProjectPlacements.mockResolvedValue([
			{
				projectId: 'project-1',
				locationId: 'location-1',
				folderName: 'project-1',
				needsLocationChoice: false,
			},
		]);
		mocks.listStorageAccounts.mockResolvedValue([]);
	});

	it('shows where the project lives, Move and zip export, and nothing about commit status', async () => {
		render(ProjectLocationPanel, { projectId: 'project-1' });

		await expect
			.element(page.getByTestId('project-location'))
			.toHaveTextContent('Shared Folder');
		await expect
			.element(page.getByRole('button', { name: 'Move', exact: true }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Export project zip' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('combobox', { name: 'Move to' }))
			.toHaveTextContent('Dropbox/Lab');
		expect(page.getByText(/Last synced|Last version|Last committed/).elements()).toHaveLength(
			0
		);
		await expect.element(page.getByText('All changes synced')).toBeInTheDocument();
		expect(page.getByRole('button', { name: 'Sync now' }).elements()).toHaveLength(0);
	});

	it('moves a browser-only project into a location without asking to confirm', async () => {
		mocks.listProjectPlacements.mockResolvedValue([]);
		render(ProjectLocationPanel, { projectId: 'project-1' });

		await expect.element(page.getByText('This browser only')).toBeInTheDocument();
		await expect.element(page.getByText('Not backed up').first()).toBeInTheDocument();
		await page.getByRole('button', { name: 'Move', exact: true }).click();

		expect(mocks.moveProject).toHaveBeenCalledWith('project-1', 'location-1');
	});

	it('offers sign-in in place of Add a location for a browser-only project with no account', async () => {
		mocks.listProjectLocations.mockResolvedValue([]);
		mocks.listProjectPlacements.mockResolvedValue([]);
		render(ProjectLocationPanel, { projectId: 'project-1' });

		await expect
			.element(page.getByRole('button', { name: 'Sign in with Google Drive' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Sign in with Dropbox' }))
			.toBeInTheDocument();
		expect(page.getByRole('link', { name: 'Add a location' }).elements()).toHaveLength(0);
	});

	it('keeps the Move picker for a browser-only project once an account is signed in', async () => {
		mocks.listProjectPlacements.mockResolvedValue([]);
		mocks.listStorageAccounts.mockResolvedValue([
			{
				id: 'account-1',
				provider: 'dropbox',
				displayName: 'Ada',
				email: 'ada@example.org',
				grantedScopes: [],
				signedIn: true,
			},
		]);
		render(ProjectLocationPanel, { projectId: 'project-1' });

		await expect
			.element(page.getByRole('combobox', { name: 'Move to' }))
			.toHaveTextContent('Shared Folder');
		await expect.element(page.getByText('Not backed up').first()).toBeInTheDocument();
		expect(page.getByRole('button', { name: /^Sign in with/ }).elements()).toHaveLength(0);
	});

	it('says who moved the project and when until dismissed', async () => {
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
		render(ProjectLocationPanel, { projectId: 'project-1' });

		await expect
			.element(page.getByTestId('project-moved-notice'))
			.toHaveTextContent(/Moved by Ada on .*Dropbox\/Lab/);
		await expect.element(page.getByText('This browser only')).toBeInTheDocument();
		expect(page.getByText('Not backed up').elements()).toHaveLength(0);
		await page.getByRole('button', { name: 'Dismiss' }).click();

		expect(mocks.dismissPlacementNotice).toHaveBeenCalledWith('project-1');
	});

	it('names the team location and says the delete is for everyone, offering Remove from this device', async () => {
		mocks.listProjectPlacements.mockResolvedValue([
			{
				projectId: 'project-1',
				locationId: 'location-2',
				folderName: 'project-1',
				needsLocationChoice: false,
			},
		]);
		const onRemoved = vi.fn();
		render(ProjectLocationPanel, { projectId: 'project-1', onRemoved });

		await expect.element(page.getByTestId('project-location')).toHaveTextContent('Dropbox/Lab');
		await page.getByRole('button', { name: 'Delete project' }).click();

		const dialog = page.getByRole('dialog', { name: 'Delete project' });
		await expect
			.element(dialog.getByTestId('delete-project-message'))
			.toHaveTextContent(/for everyone in the team location Dropbox\/Lab/);
		await dialog.getByRole('button', { name: 'Remove from this device' }).click();

		expect(mocks.removeProjectFromDevice).toHaveBeenCalledWith('project-1');
		expect(mocks.deleteProject).not.toHaveBeenCalled();
		expect(onRemoved).toHaveBeenCalled();
	});

	it('deletes for everyone from the team confirmation', async () => {
		mocks.listProjectPlacements.mockResolvedValue([
			{
				projectId: 'project-1',
				locationId: 'location-2',
				folderName: 'project-1',
				needsLocationChoice: false,
			},
		]);
		render(ProjectLocationPanel, { projectId: 'project-1' });

		await expect.element(page.getByTestId('project-location')).toHaveTextContent('Dropbox/Lab');
		await page.getByRole('button', { name: 'Delete project' }).click();
		await page
			.getByRole('dialog', { name: 'Delete project' })
			.getByRole('button', { name: 'Delete for everyone' })
			.click();

		expect(mocks.deleteProject).toHaveBeenCalledWith('project-1');
	});

	it('keeps the personal delete confirmation free of "for everyone"', async () => {
		render(ProjectLocationPanel, { projectId: 'project-1' });

		await expect
			.element(page.getByTestId('project-location'))
			.toHaveTextContent('Shared Folder');
		await page.getByRole('button', { name: 'Delete project' }).click();

		const message = page.getByTestId('delete-project-message');
		await expect.element(message).toHaveTextContent(/Shared Folder/);
		await expect.element(message).not.toHaveTextContent(/for everyone/);
	});
});
