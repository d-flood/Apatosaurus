import type { ReferenceEditionCatalogEntry } from './catalog';

export function resolveReferenceEditionAttributions(
	editionIds: string[],
	referenceEditions: ReferenceEditionCatalogEntry[],
	persistedAttributions: Record<string, string> = {}
): string[] {
	const referenceEditionsById = new Map(referenceEditions.map(edition => [edition.id, edition]));
	return editionIds.map(editionId => {
		const attribution =
			persistedAttributions[editionId]?.trim() ||
			referenceEditionsById.get(editionId)?.attribution.trim();
		if (!attribution) {
			throw new Error(
				`Attribution for required reference edition ${editionId} is unavailable.`
			);
		}
		return attribution;
	});
}
