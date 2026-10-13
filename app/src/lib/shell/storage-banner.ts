import { isNotBackedUp } from '$lib/backup/sync-status';
import {
	isPlacedProject,
	type ProjectLocation,
	type ProjectPlacement,
	type StorageAccount,
} from '$lib/storage/project-locations';

const STORAGE_BANNER_DISMISSED_KEY = 'storageBannerDismissed';

export type StorageBanner =
	| { kind: 'signed-out'; account: StorageAccount }
	| { kind: 'reconnect'; account: StorageAccount }
	| { kind: 'sign-in'; count: number }
	| null;

export function deriveStorageBanner(input: {
	placements: readonly ProjectPlacement[];
	projectIds: readonly string[];
	locations: readonly ProjectLocation[];
	accounts: readonly StorageAccount[];
	reconnectAccountIds: ReadonlySet<string>;
	dismissed: boolean;
}): StorageBanner {
	const placementFor = (projectId: string) =>
		input.placements.find(placement => placement.projectId === projectId);
	const accountIdsWithProjects = new Set(
		input.projectIds.flatMap(projectId => {
			const placement = placementFor(projectId);
			if (!placement || !isPlacedProject(placement)) return [];
			const location = input.locations.find(
				candidate => candidate.id === placement.locationId
			);
			return location?.accountId ? [location.accountId] : [];
		})
	);

	const signedOut = input.accounts.find(
		account => !account.signedIn && accountIdsWithProjects.has(account.id)
	);
	if (signedOut) return { kind: 'signed-out', account: signedOut };

	const reconnect = input.accounts.find(
		account => account.signedIn && input.reconnectAccountIds.has(account.id)
	);
	if (reconnect) return { kind: 'reconnect', account: reconnect };

	const count = input.projectIds.filter(projectId =>
		isNotBackedUp(placementFor(projectId))
	).length;
	if (count === 0 || input.dismissed || input.accounts.some(account => account.signedIn))
		return null;
	return { kind: 'sign-in', count };
}

export function readStorageBannerDismissed(): boolean {
	try {
		return globalThis.sessionStorage?.getItem(STORAGE_BANNER_DISMISSED_KEY) === 'true';
	} catch {
		return false;
	}
}

export function recordStorageBannerDismissed(): void {
	try {
		globalThis.sessionStorage?.setItem(STORAGE_BANNER_DISMISSED_KEY, 'true');
	} catch {
		return;
	}
}
