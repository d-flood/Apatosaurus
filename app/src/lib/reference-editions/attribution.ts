import type { ReferenceEditionCatalogEntry } from './catalog';

export function resolveReferenceEditionAttributions(
	editionIds: string[],
	referenceEditions: ReferenceEditionCatalogEntry[]
): string[] {
	const referenceEditionsById = new Map(referenceEditions.map(edition => [edition.id, edition]));
	return editionIds
		.map(editionId => referenceEditionsById.get(editionId)?.attribution)
		.filter((attribution): attribution is string => Boolean(attribution));
}
