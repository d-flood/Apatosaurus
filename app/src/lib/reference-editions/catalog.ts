import catalogJson from './catalog.generated.json';

export type ReferenceEditionSource = 'bundled' | 'user';

export interface ReferenceEditionCatalogEntry {
	id: string;
	title: string;
	attribution: string;
	source: ReferenceEditionSource;
	assetPath?: string;
	storePath?: string;
}

interface ReferenceEditionCatalogManifest {
	generatedAt: string;
	entries: ReferenceEditionCatalogEntry[];
}

const bundledReferenceEditionManifest = catalogJson as ReferenceEditionCatalogManifest;

export function listBundledReferenceEditions(): ReferenceEditionCatalogEntry[] {
	return bundledReferenceEditionManifest.entries.map(entry => ({ ...entry }));
}

export function listUserReferenceEditions(
	entries: ReferenceEditionCatalogEntry[] = []
): ReferenceEditionCatalogEntry[] {
	return entries.filter(entry => entry.source === 'user').map(entry => ({ ...entry }));
}

export function listReferenceEditions(
	userEntries: ReferenceEditionCatalogEntry[] = []
): ReferenceEditionCatalogEntry[] {
	return [...listBundledReferenceEditions(), ...listUserReferenceEditions(userEntries)];
}

export const referenceEditionCatalog = listReferenceEditions();
