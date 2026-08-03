import { describe, expect, it } from 'vitest';

import {
	listReferenceEditions,
	listUserReferenceEditions,
	type ReferenceEditionCatalogEntry,
} from './catalog';

describe('reference edition catalog', () => {
	it('loads the generated bundled manifest and merges the empty user branch', () => {
		const entries = listReferenceEditions();
		const robinsonPierpont = entries.find(entry => entry.id === 'robinson-pierpont');

		expect(robinsonPierpont).toEqual({
			id: 'robinson-pierpont',
			title: 'Robinson-Pierpont Byzantine Textform',
			attribution:
				'Maurice A. Robinson and William G. Pierpont, The New Testament in the Original Greek: The Byzantine Textform (2018), public domain.',
			source: 'bundled',
			assetPath: '/robinson-pierpont/byz.xml',
		});
		expect(listUserReferenceEditions()).toEqual([]);
		expect(entries.filter(entry => entry.source === 'user')).toEqual([]);
	});

	it('keeps the catalog entry shape explicit for the user branch', () => {
		const entry: ReferenceEditionCatalogEntry = listReferenceEditions()[0];

		expect(entry).toEqual(
			expect.objectContaining({
				id: expect.any(String),
				title: expect.any(String),
				attribution: expect.any(String),
				source: expect.any(String),
			})
		);
	});
});
