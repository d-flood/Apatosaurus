import { readFile } from 'node:fs/promises';

import { DOMParser } from '@xmldom/xmldom';
import { beforeAll, describe, expect, it } from 'vitest';

import { importTEIDocument } from '$lib/tei/tei-importer';
import { createReferenceEditionSource, listUnits } from './source';

beforeAll(() => {
	if (typeof globalThis.DOMParser === 'undefined') {
		globalThis.DOMParser = DOMParser as typeof globalThis.DOMParser;
	}
	if (typeof globalThis.Node === 'undefined') {
		globalThis.Node = {
			ELEMENT_NODE: 1,
			TEXT_NODE: 3,
		} as typeof globalThis.Node;
	}
});

describe('bundled Robinson-Pierpont reference edition', () => {
	it('parses the checked-in asset through the shared TEI importer', async () => {
		const xml = await readFile(
			new URL('../../../static/robinson-pierpont/byz.xml', import.meta.url),
			'utf8'
		);
		const source = createReferenceEditionSource(importTEIDocument(xml));
		const units = listUnits(source);

		expect(units).toHaveLength(7953);
		expect(units[0]?.label).toEqual({ book: 'B01', chapter: 'B01K1', verse: 'B01K1V1' });
		expect(units.at(-1)?.label).toEqual({ book: 'B27', chapter: 'B27K22', verse: 'B27K22V21' });
	});
}, 30_000);
