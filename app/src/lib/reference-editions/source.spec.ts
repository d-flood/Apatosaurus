import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';

import { importTEIDocument } from '$lib/tei/tei-importer';
import { createReferenceEditionSource, extractRange, listUnits } from './source';

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

function parseEdition(body: string) {
	return createReferenceEditionSource(
		importTEIDocument(`<?xml version="1.0" encoding="UTF-8"?>
			<TEI xmlns="http://www.tei-c.org/ns/1.0">
				<teiHeader></teiHeader>
				<text><body>${body}</body></text>
			</TEI>`)
	);
}

describe('reference edition source', () => {
	it('lists addressable units in document order with opaque milestone labels', () => {
		const source = parseEdition(`
			<pb n="one"/><cb n="A"/><lb/>
			<div type="book" n="book-opaque">
				<div type="chapter" n="chapter-opaque">
					<ab n="verse-opaque-1"><w>alpha</w></ab>
					<ab n="verse-opaque-2"><w>beta</w></ab>
				</div>
			</div>
		`);

		expect(listUnits(source).map(unit => unit.label)).toEqual([
			{ book: 'book-opaque', chapter: 'chapter-opaque', verse: 'verse-opaque-1' },
			{ book: 'book-opaque', chapter: 'chapter-opaque', verse: 'verse-opaque-2' },
		]);
	});

	it('extracts an equal start and end as exactly one unit', () => {
		const source = parseEdition(`
			<pb n="one"/><div type="book" n="b"><div type="chapter" n="c">
				<ab n="v1"><w>alpha</w></ab>
				<ab n="v2"><w>beta</w></ab>
			</div></div>
		`);

		expect(
			extractRange(source, 1, 1)
				.filter(item => item.type === 'text')
				.map(item => item.text)
		).toEqual(['beta']);
	});

	it('flattens source layout breaks without emitting break items', () => {
		const source = parseEdition(`
			<pb n="one"/><cb n="A"/><lb/>
			<div type="book" n="b"><div type="chapter" n="c">
				<ab n="v1"><w>alpha</w></ab>
				<pb n="two"/><cb n="B"/><lb/>
				<ab n="v2"><w>beta</w></ab>
			</div></div>
		`);

		const content = extractRange(source, 0, 1);
		expect(
			content.filter(item => ['pageBreak', 'columnBreak', 'lineBreak'].includes(item.type))
		).toEqual([]);
		expect(content.filter(item => item.type === 'text').map(item => item.text)).toEqual([
			'alpha',
			'beta',
		]);
	});

	it('rejects sources without milestones and accepts repeated references positionally', () => {
		expect(() => parseEdition('<pb n="one"/><w>plain</w>')).toThrow(/milestone/i);

		const source = parseEdition(`
			<pb n="one"/>
			<ab n="same"><w>first</w></ab>
			<ab n="same"><w>second</w></ab>
		`);

		expect(listUnits(source)).toHaveLength(2);
		expect(
			extractRange(source, 0, 0)
				.filter(item => item.type === 'text')
				.map(item => item.text)
		).toEqual(['first']);
		expect(
			extractRange(source, 1, 1)
				.filter(item => item.type === 'text')
				.map(item => item.text)
		).toEqual(['second']);
	});
});
