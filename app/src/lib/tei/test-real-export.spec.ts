import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exportTEI } from './tei-exporter';
import { importTEI } from './tei-importer';
import { validateIgntpXsd } from '../../../../test-support/validate-igntp-xsd';

beforeAll(() => {
	if (typeof globalThis.DOMParser === 'undefined') {
		(globalThis as any).DOMParser = DOMParser;
	}
	if (typeof globalThis.Node === 'undefined') {
		class TestNode {}
		Object.assign(TestNode, {
			ELEMENT_NODE: 1,
			TEXT_NODE: 3,
			CDATA_SECTION_NODE: 4,
			PROCESSING_INSTRUCTION_NODE: 7,
			COMMENT_NODE: 8,
			DOCUMENT_NODE: 9,
			DOCUMENT_TYPE_NODE: 10,
			DOCUMENT_FRAGMENT_NODE: 11,
		});
		(globalThis as any).Node = TestNode;
	}
});

function parse(xml: string): Document {
	return new DOMParser().parseFromString(xml, 'application/xml');
}

const fixturesDir = fileURLToPath(new URL('.', import.meta.url));

function readTeiFixture(name: string): string {
	return readFileSync(join(fixturesDir, name), 'utf8');
}

function readStaticIgntpFixture(relativePath: string): string {
	return readFileSync(join(fixturesDir, '../../../static/igntp', relativePath), 'utf8');
}

describe('real TEI wrapper integration', () => {
	it('imports and re-exports the P118 fixture as valid XML', () => {
		const xml = readTeiFixture('NT_GRC_P118_Rom.xml');
		const exported = exportTEI(importTEI(xml) as any);
		const doc = parse(exported);

		expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
		expect(() => validateIgntpXsd(exported)).not.toThrow();
		expect(doc.getElementsByTagName('pb').length).toBeGreaterThan(0);
		expect(doc.getElementsByTagName('w').length).toBeGreaterThan(0);
		expect(doc.getElementsByTagName('supplied').length).toBeGreaterThan(0);
	});

	it('preserves apparatus and line breaks in the 01 Romans fixture', () => {
		const xml = readTeiFixture('NT_GRC_01_Rom.xml');
		const imported = importTEI(xml);
		const exported = exportTEI(imported as any);
		const doc = parse(exported);

		expect(imported.content!.length).toBeGreaterThan(0);
		expect(() => validateIgntpXsd(exported)).not.toThrow();
		expect(doc.getElementsByTagName('app').length).toBeGreaterThan(0);
		expect(doc.getElementsByTagName('fw').length).toBeGreaterThan(0);
		expect(doc.getElementsByTagName('lb').length).toBeGreaterThan(0);
	});

	it('does not introduce suspicious embedded spaces into fixture words', () => {
		const xml = readTeiFixture('NT_GRC_P118_Rom.xml');
		const imported = importTEI(xml);
		const textNodes: string[] = [];

		const walk = (node: any) => {
			if (!node || typeof node !== 'object') return;
			if (Array.isArray(node)) {
				node.forEach(walk);
				return;
			}
			if (node.type === 'text' && typeof node.text === 'string') {
				textNodes.push(node.text);
			}
			if (node.content) walk(node.content);
		};

		walk(imported);
		expect(textNodes.some(text => /\S\s\S/.test(text))).toBe(false);
	});

	it('keeps L60 folio 59r as a single imported column', () => {
		const xml = readStaticIgntpFixture('Romans_Greek_transcriptions/NT_GRC_L60_Rom.xml');
		const imported = importTEI(xml);
		const page59r = imported.content?.find(node => node.attrs?.pageName === '59r');

		expect(page59r).toBeTruthy();
		expect(page59r?.content).toHaveLength(1);
		expect(page59r?.content?.[0].attrs?.columnNumber).toBe(1);
		expect(page59r?.content?.[0].content?.[0].attrs?.lineNumber).toBe(1);
		expect(page59r?.content?.[0].content?.[0].content?.[0]).toMatchObject({
			type: 'text',
			text: 'ρεαν',
		});
	});
});
