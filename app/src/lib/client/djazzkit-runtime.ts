import {
	checkpointLocalDb,
	ensureLocalDbRuntime,
	resetLocalDb,
} from '$lib/client/db/runtime';

export type MigrationResolutionAction = 'approve' | 'reset' | 'defer';

export const ensureDjazzkitRuntime = ensureLocalDbRuntime;
export const checkpointDjazzkitRuntime = checkpointLocalDb;
export const runtime = { init: ensureLocalDbRuntime };

export async function resolvePendingMigration(
	_action?: MigrationResolutionAction
): Promise<{ applied: boolean; deferred: boolean }> {
	return { applied: true, deferred: false };
}

export function requestHardLocalDbReset(): void {
	void resetLocalDb();
}
