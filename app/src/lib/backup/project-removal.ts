import type { Kysely } from 'kysely';
import type { Database } from '$lib/db/types.generated';
import { projectFolder } from '$lib/storage/layout';
import {
	deleteDirectory,
	withDocumentStoreWriterLock,
	type StoreOperationOptions,
} from '$lib/storage/opfs-store';
import {
	addRemovedProjects,
	deleteProjectPlacements,
	type PlacedProject,
} from '$lib/storage/project-locations';
import { placementSyncContext } from './backup-status';
import { listPendingUploadPaths } from './sync-manager';

export type ProjectRemovalResult = { ok: true } | { ok: false; pendingProjectIds: string[] };

/** Local only: writes no tombstone and never touches the location. */
export async function removeProjectsFromDevice(
	db: Kysely<Database>,
	placements: readonly PlacedProject[],
	storeOptions: StoreOperationOptions = {}
): Promise<ProjectRemovalResult> {
	return withDocumentStoreWriterLock(async lockedOptions => {
		const pendingProjectIds: string[] = [];
		for (const placement of placements) {
			const pendingPaths = await listPendingUploadPaths(
				db,
				placementSyncContext(placement),
				lockedOptions
			);
			if (pendingPaths.length > 0) pendingProjectIds.push(placement.projectId);
		}
		if (pendingProjectIds.length > 0) return { ok: false, pendingProjectIds };
		for (const { projectId } of placements) {
			await deleteLocalCopy(db, projectId, lockedOptions);
		}
		await addRemovedProjects(
			placements.map(({ locationId, projectId, folderName }) => ({
				locationId,
				projectId,
				folderName,
			})),
			lockedOptions
		);
		await deleteProjectPlacements(
			placements.map(placement => placement.projectId),
			lockedOptions
		);
		return { ok: true };
	}, storeOptions);
}

/** Deletes the local copy whatever is pending; the caller has already retired the location's folder. */
export async function deleteProjectLocally(
	db: Kysely<Database>,
	projectId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	await withDocumentStoreWriterLock(async lockedOptions => {
		await deleteLocalCopy(db, projectId, lockedOptions);
		await deleteProjectPlacements([projectId], lockedOptions);
	}, storeOptions);
}

async function deleteLocalCopy(
	db: Kysely<Database>,
	projectId: string,
	lockedOptions: StoreOperationOptions
): Promise<void> {
	const project = await db
		.selectFrom('projects')
		.select('storage_slug')
		.where('id', '=', projectId)
		.executeTakeFirst();
	if (!project) return;
	await deleteDirectory(projectFolder(project.storage_slug), {
		...lockedOptions,
		recursive: true,
	});
	await db.transaction().execute(async trx => {
		await trx
			.deleteFrom('sync_file_fingerprints')
			.where('project_id', '=', projectId)
			.execute();
		await trx.deleteFrom('projects').where('id', '=', projectId).execute();
	});
}
