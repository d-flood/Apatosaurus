import { expect, it } from 'vitest';
import type { ProjectOption } from '$lib/db/repositories/projects';
import type { ProjectPlacement } from '$lib/storage/project-locations';
import { groupProjectsByLocation } from './project-location-groups';

it('groups only not-backed-up projects under Not backed up, excluding stale copies', () => {
	const projects: ProjectOption[] = ['new', 'alpha', 'moved', 'deleted', 'folder'].map(id => ({
		id,
		name: id,
		storageSlug: id,
		description: '',
		createdAt: '2026-10-01',
		updatedAt: '2026-10-01',
	}));
	const placements: ProjectPlacement[] = [
		{ projectId: 'alpha', locationId: null, folderName: null, needsLocationChoice: true },
		{
			projectId: 'moved',
			locationId: null,
			folderName: null,
			needsLocationChoice: false,
			moved: { movedAt: '2026-10-01', movedBy: 'Ada', destinationLabel: 'Dropbox' },
		},
		{
			projectId: 'deleted',
			locationId: null,
			folderName: null,
			needsLocationChoice: false,
			deleted: { deletedAt: '2026-10-01', deletedBy: 'Ada' },
		},
		{
			projectId: 'folder',
			locationId: 'desk',
			folderName: 'folder',
			needsLocationChoice: false,
		},
	];
	const groups = groupProjectsByLocation(
		projects,
		placements,
		[{ id: 'desk', accountId: null, kind: 'device', rootFolderId: '.', displayPath: 'Desk' }],
		[]
	);
	expect(groups.map(group => [group.label, group.projects.map(project => project.id)])).toEqual([
		['Not backed up', ['new', 'alpha']],
		['Needs attention', ['moved', 'deleted']],
		['Desk', ['folder']],
	]);
});
