import type { ProjectOption } from '$lib/db/repositories/projects';
import { isNotBackedUp } from '$lib/backup/sync-status';
import {
	isPlacedProject,
	type ProjectLocation,
	type ProjectPlacement,
	type StorageAccount,
} from '$lib/storage/project-locations';

export interface ProjectLocationGroup {
	id: string;
	location: ProjectLocation | null;
	label: string;
	owner: string | null;
	signedOut: boolean;
	projects: ProjectOption[];
}

export function groupProjectsByLocation(
	projects: readonly ProjectOption[],
	placements: readonly ProjectPlacement[],
	locations: readonly ProjectLocation[],
	accounts: readonly StorageAccount[]
): ProjectLocationGroup[] {
	const locationIdByProject = new Map(
		placements
			.filter(isPlacedProject)
			.map(placement => [placement.projectId, placement.locationId])
	);
	const browserOnly: ProjectLocationGroup = {
		id: 'browser-only',
		location: null,
		label: 'Not backed up',
		owner: null,
		signedOut: false,
		projects: [],
	};
	const attention: ProjectLocationGroup = {
		...browserOnly,
		id: 'unplaced-attention',
		label: 'Needs attention',
		projects: [],
	};
	const groups = new Map<string, ProjectLocationGroup>(
		locations.map(location => {
			const account = accounts.find(candidate => candidate.id === location.accountId);
			const signedOut = location.accountId !== null && !account?.signedIn;
			const owner = location.accountId === null ? 'This computer' : (account?.email ?? null);
			return [
				location.id,
				{
					id: location.id,
					location,
					label: location.displayPath,
					owner: signedOut ? `Signed out · ${account?.email ?? 'account'}` : owner,
					signedOut,
					projects: [],
				},
			];
		})
	);
	for (const project of projects) {
		const locationId = locationIdByProject.get(project.id);
		const placement = placements.find(candidate => candidate.projectId === project.id);
		const fallback = isNotBackedUp(placement) ? browserOnly : attention;
		(groups.get(locationId ?? '') ?? fallback).projects.push(project);
	}
	return [browserOnly, attention, ...groups.values()].filter(group => group.projects.length > 0);
}
