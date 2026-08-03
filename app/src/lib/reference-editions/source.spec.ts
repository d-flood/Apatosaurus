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
			<div type="book" n="book.opaque">
				<div type="chapter" n="book.opaque.chapter.9">
					<ab n="chapter.9.verse.1"><w>alpha</w></ab>
					<ab n="chapter.9.verse.2"><w>beta</w></ab>
				</div>
			</div>
		`);

		expect(listUnits(source).map(unit => unit.label)).toEqual([
			{ book: 'book.opaque', chapter: 'book.opaque.chapter.9', verse: 'chapter.9.verse.1' },
			{ book: 'book.opaque', chapter: 'book.opaque.chapter.9', verse: 'chapter.9.verse.2' },
		]);
		expect(extractRange(source, 0, 0).filter(item => item.type === 'milestone')).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ sourceLabel: 'book.opaque' }),
				expect.objectContaining({ sourceLabel: 'book.opaque.chapter.9' }),
				expect.objectContaining({ sourceLabel: 'chapter.9.verse.1' }),
			])
		);
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

	it('removes breaks recursively from nested formwork atom and wrapper content', () => {
		const source = parseEdition(`
			<pb n="one"/><div type="book" n="b"><div type="chapter" n="c">
				<ab n="v1">
					<fw type="header">
						<note place="margin"><pb n="nested"/><cb n="nested"/><lb/>atom text</note>
						<foreign xml:lang="la"><w>wrapped<lb break="no"/>text</w></foreign>
					</fw>
				</ab>
			</div></div>
		`);

		const content = extractRange(source, 0, 0);
		const formwork = content.find(item => item.type === 'fw');

		expect(formwork).toEqual(
			expect.objectContaining({
				type: 'fw',
				content: expect.arrayContaining([
					expect.objectContaining({ type: 'teiAtom' }),
					expect.objectContaining({ type: 'teiWrapper' }),
				]),
			})
		);
		expect(JSON.stringify(content)).not.toMatch(/"tag":"(?:pb|cb|lb)"/);
		expect(JSON.stringify(content)).not.toMatch(/"type":"(?:pageBreak|columnBreak|lineBreak)"/);
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
