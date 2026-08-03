export type ReferenceEditionSource = 'bundled' | 'user';

export interface ReferenceEditionCatalogEntry {
	id: string;
	title: string;
	attribution: string;
	source: ReferenceEditionSource;
	assetPath?: string;
}

const BUNDLED_REFERENCE_EDITIONS: ReferenceEditionCatalogEntry[] = [
	{
		id: 'robinson-pierpont',
		title: 'Robinson-Pierpont Byzantine Textform',
		attribution:
			'Maurice A. Robinson and William G. Pierpont, The New Testament in the Original Greek: The Byzantine Textform (2018), public domain.',
		source: 'bundled',
		assetPath: '/robinson-pierpont/byz.xml',
	},
];

export function listBundledReferenceEditions(): ReferenceEditionCatalogEntry[] {
	return BUNDLED_REFERENCE_EDITIONS.map(entry => ({ ...entry }));
}

export function listUserReferenceEditions(): ReferenceEditionCatalogEntry[] {
	return [];
}

export function listReferenceEditions(): ReferenceEditionCatalogEntry[] {
	return [...listBundledReferenceEditions(), ...listUserReferenceEditions()];
}

export const referenceEditionCatalog = listReferenceEditions();
