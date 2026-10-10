import { readAppSettings } from '$lib/storage/app-settings';
import type { StoreOperationOptions } from '$lib/storage/opfs-store';
import {
	getProjectLocation,
	listProjectPlacements,
	listStorageAccounts,
} from '$lib/storage/project-locations';

export async function effectiveAuthorName(
	projectId: string,
	options: StoreOperationOptions = {}
): Promise<string | null> {
	const placement = (await listProjectPlacements(options)).find(
		candidate => candidate.projectId === projectId
	);
	const location = placement?.locationId
		? await getProjectLocation(placement.locationId, options)
		: null;
	const account = location?.accountId
		? (await listStorageAccounts(options)).find(
				candidate => candidate.id === location.accountId
			)
		: undefined;
	return account?.displayName ?? (await readAppSettings(options)).authorName;
}
