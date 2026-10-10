import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlacedProject, ProjectLocation } from '$lib/storage/project-locations';

const mocks = vi.hoisted(() => ({
	listPendingUploadPaths: vi.fn(),
	listProjectPlacements: vi.fn(),
	listProjectLocations: vi.fn(),
}));

vi.mock('$lib/db/client', () => ({
	listPendingUploadPaths: mocks.listPendingUploadPaths,
}));

vi.mock('$lib/storage/project-locations', async importOriginal => ({
	...(await importOriginal<typeof import('$lib/storage/project-locations')>()),
	listProjectPlacements: mocks.listProjectPlacements,
	listProjectLocations: mocks.listProjectLocations,
}));

import { loadProjectBackupOverviews } from './project-backup-overview';

const location: ProjectLocation = {
	id: 'location-1',
	accountId: null,
	kind: 'device',
	rootFolderId: '.',
	displayPath: 'Shared Folder',
};

describe('project backup overview', () => {
	beforeEach(() => {
		mocks.listPendingUploadPaths.mockReset();
		mocks.listProjectPlacements.mockReset();
		mocks.listProjectLocations.mockReset().mockResolvedValue([location]);
	});

	it('builds the sync context from the project placement subfolder', async () => {
		const placed = placement({ folderName: 'project-slug' });
		mocks.listProjectPlacements.mockResolvedValue([placed]);
		mocks.listPendingUploadPaths.mockResolvedValue([]);

		const result = await loadProjectBackupOverviews(['project-1']);

		const context = {
			projectId: 'project-1',
			connectionId: 'location-1',
			cloudFolderId: 'project-slug',
			cloudFolderPath: 'project-slug',
		};
		expect(result['project-1']).toEqual({
			projectId: 'project-1',
			status: 'backed-up',
			placement: placed,
			location,
			context,
			pendingPaths: [],
			error: null,
		});
		expect(mocks.listPendingUploadPaths).toHaveBeenCalledWith(context);
	});

	it('treats browser-only placements awaiting a location choice as local-only', async () => {
		mocks.listProjectPlacements.mockResolvedValue([
			{
				projectId: 'project-1',
				locationId: null,
				folderName: null,
				needsLocationChoice: true,
			},
		]);

		const result = await loadProjectBackupOverviews(['project-1']);

		expect(result['project-1']).toMatchObject({ status: 'local-only', placement: null });
		expect(mocks.listPendingUploadPaths).not.toHaveBeenCalled();
	});

	it('returns only local-only, pending, and backed-up semantic states from local data', async () => {
		mocks.listProjectPlacements.mockResolvedValue([
			placement({ projectId: 'pending' }),
			placement({ projectId: 'backed-up' }),
		]);
		mocks.listPendingUploadPaths.mockImplementation(async context =>
			context.projectId === 'pending' ? ['transcriptions/pt-1.json'] : []
		);

		const result = await loadProjectBackupOverviews(['local-only', 'pending', 'backed-up']);

		expect(
			Object.fromEntries(
				Object.entries(result).map(([id, overview]) => [id, overview.status])
			)
		).toEqual({
			'local-only': 'local-only',
			pending: 'pending',
			'backed-up': 'backed-up',
		});
	});

	it('isolates summary failures by project and reads the placement file once for a bulk load', async () => {
		mocks.listProjectPlacements.mockResolvedValue([
			placement({ projectId: 'available' }),
			placement({ projectId: 'unavailable' }),
		]);
		mocks.listPendingUploadPaths.mockImplementation(async context => {
			if (context.projectId === 'unavailable') throw new Error('local summary failed');
			return [];
		});

		const result = await loadProjectBackupOverviews(['available', 'unavailable', 'local-only']);

		expect(result.available.status).toBe('backed-up');
		expect(result.unavailable).toMatchObject({
			projectId: 'unavailable',
			status: 'unavailable',
			placement: { projectId: 'unavailable' },
			pendingPaths: null,
		});
		expect(result.unavailable.error).toEqual(new Error('local summary failed'));
		expect(result['local-only'].status).toBe('local-only');
		expect(mocks.listProjectPlacements).toHaveBeenCalledOnce();
	});

	it('returns unavailable results when the placement file cannot be read', async () => {
		const error = new Error('placements are corrupt');
		mocks.listProjectPlacements.mockRejectedValue(error);

		const result = await loadProjectBackupOverviews(['project-1']);

		expect(result).toEqual({
			'project-1': {
				projectId: 'project-1',
				status: 'unavailable',
				placement: null,
				location: null,
				context: null,
				pendingPaths: null,
				error,
			},
		});
		expect(mocks.listPendingUploadPaths).not.toHaveBeenCalled();
	});
});

function placement(overrides: Partial<PlacedProject> = {}): PlacedProject {
	return {
		projectId: 'project-1',
		locationId: 'location-1',
		folderName: 'project-1',
		needsLocationChoice: false,
		...overrides,
	};
}
