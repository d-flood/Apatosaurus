import catalogJson from './catalog.generated.json';

export type ReferenceEditionSource = 'bundled' | 'user';

export interface ReferenceEditionCatalogEntry {
	id: string;
	title: string;
	attribution: string;
	source: ReferenceEditionSource;
	assetPath?: string;
}

interface ReferenceEditionCatalogManifest {
	generatedAt: string;
	entries: ReferenceEditionCatalogEntry[];
}

const bundledReferenceEditionManifest = catalogJson as ReferenceEditionCatalogManifest;

export function listBundledReferenceEditions(): ReferenceEditionCatalogEntry[] {
	return bundledReferenceEditionManifest.entries.map(entry => ({ ...entry }));
}

export function listUserReferenceEditions(): ReferenceEditionCatalogEntry[] {
	return [];
}

export function listReferenceEditions(): ReferenceEditionCatalogEntry[] {
	return [...listBundledReferenceEditions(), ...listUserReferenceEditions()];
}

export const referenceEditionCatalog = listReferenceEditions();
