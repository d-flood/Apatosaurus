import { deriveProjectBackupSummary } from '$lib/client/db/client';
import { listSyncTargets, type SyncTargetRecord } from '$lib/client/store';
import { LOCAL_FOLDER_ROOT_FOLDER_ID } from './providers/local-folder-provider';
import type { ProjectBackupSummary, SyncProjectContext } from './sync-manager';

export type ProjectBackupOverviewStatus =
	'local-only' | 'blocked' | 'pending' | 'backed-up' | 'unavailable';

export interface ProjectBackupOverview {
	projectId: string;
	status: ProjectBackupOverviewStatus;
	targets: SyncTargetRecord[];
	selectedTarget: SyncTargetRecord | null;
	context: SyncProjectContext | null;
	summary: ProjectBackupSummary | null;
	error: unknown | null;
}

export async function loadProjectBackupOverviews(
	projectIds: readonly string[]
): Promise<Record<string, ProjectBackupOverview>> {
	if (projectIds.length === 0) return {};

	let allTargets: SyncTargetRecord[];
	try {
		allTargets = await listSyncTargets();
	} catch (error) {
		return Object.fromEntries(
			projectIds.map(projectId => [
				projectId,
				{
					projectId,
					status: 'unavailable',
					targets: [],
					selectedTarget: null,
					context: null,
					summary: null,
					error,
				} satisfies ProjectBackupOverview,
			])
		);
	}
	const entries = await Promise.all(
		projectIds.map(async projectId => {
			const targets = allTargets.filter(target => target.projectId === projectId);
			const selectedTarget = targets.find(target => target.enabled) ?? targets[0] ?? null;
			if (!selectedTarget) {
				return [
					projectId,
					{
						projectId,
						status: 'local-only',
						targets,
						selectedTarget: null,
						context: null,
						summary: null,
						error: null,
					},
				] as const;
			}

			const context: SyncProjectContext = {
				projectId,
				connectionId: selectedTarget.targetId,
				cloudFolderId: LOCAL_FOLDER_ROOT_FOLDER_ID,
				cloudFolderPath: '',
			};
			try {
				const summary = await deriveProjectBackupSummary(context);
				return [
					projectId,
					{
						projectId,
						status:
							summary.blockingItems.length > 0
								? 'blocked'
								: summary.pendingItems.length > 0 || summary.tombstones.length > 0
									? 'pending'
									: 'backed-up',
						targets,
						selectedTarget,
						context,
						summary,
						error: null,
					},
				] as const;
			} catch (error) {
				return [
					projectId,
					{
						projectId,
						status: 'unavailable',
						targets,
						selectedTarget,
						context,
						summary: null,
						error,
					},
				] as const;
			}
		})
	);
	return Object.fromEntries(entries);
}
