import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTei, serializeTei } from '../src/index';

const transcriptions = join(
	fileURLToPath(new URL('.', import.meta.url)),
	'../../../app/static/igntp/Romans_Greek_transcriptions'
);

beforeAll(() => {
	if (typeof globalThis.DOMParser === 'undefined') {
		(globalThis as any).DOMParser = DOMParser;
	}
	if (typeof globalThis.Node === 'undefined') {
		(globalThis as any).Node = Object.assign(class {}, {
			ELEMENT_NODE: 1,
			TEXT_NODE: 3,
			CDATA_SECTION_NODE: 4,
			PROCESSING_INSTRUCTION_NODE: 7,
			COMMENT_NODE: 8,
			DOCUMENT_NODE: 9,
			DOCUMENT_TYPE_NODE: 10,
			DOCUMENT_FRAGMENT_NODE: 11,
		});
	}
});

const parse = (xml: string) => JSON.parse(JSON.stringify(parseTei(xml)));

// Export writes each page id as xml:id so ids stay stable; that attribute is the one intended addition.
function withoutPageIdAttrs(document: any) {
	return {
		...document,
		pages: document.pages.map(({ teiAttrs, ...page }: any) => {
			const { 'xml:id': id, ...rest } = teiAttrs ?? {};
			const attrs = id === page.pageId ? rest : { ...rest, 'xml:id': id };
			return Object.keys(attrs).length > 0 ? { ...page, teiAttrs: attrs } : page;
		}),
	};
}

const files = process.env.IGNTP_ROUND_TRIP_ALL
	? readdirSync(transcriptions).filter(file => file.endsWith('.xml'))
	: ['02', '04', '0150', '1319', '1739', '1909', 'L60', 'L1126', 'P46'].map(
			witness => `NT_GRC_${witness}_Rom.xml`
		);

describe('IGNTP round trip', () => {
	it.each(files)(
		'parses its own TEI export of %s back to the same document',
		file => {
			const document = parse(readFileSync(join(transcriptions, file), 'utf8'));
			expect(withoutPageIdAttrs(parse(serializeTei(document)))).toEqual(
				withoutPageIdAttrs(document)
			);
		},
		60_000
	);
});
