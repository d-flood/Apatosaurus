import type { CbgmCurrentCollationHashes } from '$lib/db/repositories/cbgm-analyses';
import type { CbgmAnalysisMetadata } from '$lib/storage/formats';

export type CbgmAnalysisCollationStatus = {
	changed: string[];
	deleted: string[];
	unavailable: string[];
};

export function analysisStaleness(
	analysis: CbgmAnalysisMetadata,
	currentHashes: ReadonlyMap<string, string>
): { changed: string[]; deleted: string[] } {
	const changed: string[] = [];
	const deleted: string[] = [];
	for (const { collation_id, content_hash } of analysis.collations) {
		const current = currentHashes.get(collation_id);
		if (current === undefined) deleted.push(collation_id);
		else if (current !== content_hash) changed.push(collation_id);
	}
	return { changed, deleted };
}

export function analysisCollationStatus(
	analysis: CbgmAnalysisMetadata,
	current: CbgmCurrentCollationHashes
): CbgmAnalysisCollationStatus {
	const unavailable = analysis.collations
		.map(collation => collation.collation_id)
		.filter(id => current.unavailable.includes(id));
	const readable = analysis.collations.filter(
		collation => !unavailable.includes(collation.collation_id)
	);
	return {
		...analysisStaleness(
			{ ...analysis, collations: readable },
			new Map(Object.entries(current.hashes))
		),
		unavailable,
	};
}
