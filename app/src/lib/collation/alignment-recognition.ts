import type { AlignmentColumn } from './alignment-snapshot';

export const REALIGN_WARNING =
	'Re-aligning will lose hand alignment edits. Units that cannot be recognized will be listed as orphaned with their decisions. Continue?';

export function recognizeColumns(
	previous: AlignmentColumn[],
	next: AlignmentColumn[],
	witnessIds: string[]
): Map<string, string> {
	function tokenKey(column: AlignmentColumn): string | null {
		const ids = new Set(
			witnessIds.flatMap(witnessId => column.cells.get(witnessId)?.sourceTokenIds ?? [])
		);
		return ids.size > 0 ? JSON.stringify([...ids].sort()) : null;
	}

	const previousByTokens = new Map<string, string[]>();
	for (const column of previous) {
		const key = tokenKey(column);
		if (key === null) continue;
		const ids = previousByTokens.get(key) ?? [];
		ids.push(column.id);
		previousByTokens.set(key, ids);
	}
	const recognized = new Map<string, string>();
	for (const column of next) {
		const key = tokenKey(column);
		const previousId = key === null ? undefined : previousByTokens.get(key)?.shift();
		if (previousId !== undefined) recognized.set(column.id, previousId);
	}
	return recognized;
}
