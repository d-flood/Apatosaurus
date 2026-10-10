import { listPendingUploadPaths } from '$lib/db/client';
import {
	isPlacedProject,
	listProjectLocations,
	listProjectPlacements,
	type PlacedProject,
	type ProjectLocation,
} from '$lib/storage/project-locations';

import { placementSyncContext, type SyncProjectContext } from './backup-status';

export type ProjectBackupOverviewStatus = 'local-only' | 'pending' | 'backed-up' | 'unavailable';

export interface ProjectBackupOverview {
	projectId: string;
	status: ProjectBackupOverviewStatus;
	placement: PlacedProject | null;
	location: ProjectLocation | null;
	context: SyncProjectContext | null;
	pendingPaths: string[] | null;
	error: unknown | null;
}

export async function loadProjectBackupOverviews(
	projectIds: readonly string[]
): Promise<Record<string, ProjectBackupOverview>> {
	if (projectIds.length === 0) return {};

	let placements: PlacedProject[];
	let locations: ProjectLocation[];
	try {
		[placements, locations] = await Promise.all([
			listProjectPlacements().then(all => all.filter(isPlacedProject)),
			listProjectLocations(),
		]);
	} catch (error) {
		return Object.fromEntries(
			projectIds.map(projectId => [
				projectId,
				{
					projectId,
					status: 'unavailable',
					placement: null,
					location: null,
					context: null,
					pendingPaths: null,
					error,
				} satisfies ProjectBackupOverview,
			])
		);
	}
	const entries = await Promise.all(
		projectIds.map(async (projectId): Promise<[string, ProjectBackupOverview]> => {
			const placement = placements.find(candidate => candidate.projectId === projectId);
			const location = locations.find(candidate => candidate.id === placement?.locationId);
			if (!placement || !location) {
				return [
					projectId,
					{
						projectId,
						status: 'local-only',
						placement: null,
						location: null,
						context: null,
						pendingPaths: null,
						error: null,
					},
				];
			}

			const context = placementSyncContext(placement);
			const base = { projectId, placement, location, context };
			try {
				const pendingPaths = await listPendingUploadPaths(context);
				return [
					projectId,
					{
						...base,
						status: pendingPaths.length > 0 ? 'pending' : 'backed-up',
						pendingPaths,
						error: null,
					},
				];
			} catch (error) {
				return [projectId, { ...base, status: 'unavailable', pendingPaths: null, error }];
			}
		})
	);
	return Object.fromEntries(entries);
}
