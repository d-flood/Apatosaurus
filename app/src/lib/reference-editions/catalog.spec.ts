import { describe, expect, it } from 'vitest';

import {
	listReferenceEditions,
	listUserReferenceEditions,
	type ReferenceEditionCatalogEntry,
} from './catalog';

describe('reference edition catalog', () => {
	it('merges the bundled catalog with the empty user branch', () => {
		const entries = listReferenceEditions();
		const robinsonPierpont = entries.find(entry => entry.id === 'robinson-pierpont');

		expect(robinsonPierpont).toMatchObject({
			source: 'bundled',
			assetPath: '/robinson-pierpont/byz.xml',
		});
		expect(robinsonPierpont?.attribution).toEqual(expect.any(String));
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
