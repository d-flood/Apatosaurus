import { DOMParser } from '@xmldom/xmldom';
import { beforeAll, describe, expect, it } from 'vitest';

import { fromProseMirror, parseTei, serializeTei, toProseMirror } from '../src/index';

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

function wrapInTei(body: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader></teiHeader><text><body>${body}</body></text></TEI>`;
}

function firstFormWork(pm: any): any {
	return pm.content[0].content[0].content[0].content.find((node: any) => node.type === 'fw');
}

describe('formwork ProseMirror content', () => {
	it('stores parsed fw children as node content rather than an attribute', () => {
		const pm = toProseMirror(
			parseTei(
				wrapInTei(
					'<pb n="1r"/><cb n="1"/><lb/><fw type="header"><foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign></fw>'
				)
			)
		);
		const fw = firstFormWork(pm);

		expect(fw.attrs).not.toHaveProperty('content');
		expect(fw.content).toEqual([
			expect.objectContaining({
				type: 'teiWrapper',
				attrs: expect.objectContaining({ tag: 'foreign' }),
			}),
		]);
	});

	it('still exports a legacy fw content attribute during migration', () => {
		const pm = toProseMirror(
			parseTei(wrapInTei('<pb n="1r"/><cb n="1"/><lb/><fw type="header"><w>old</w></fw>'))
		) as any;
		const fw = firstFormWork(pm);
		fw.attrs.content = {
			type: 'doc',
			content: [
				{
					type: 'marginaliaColumn',
					content: [
						{
							type: 'marginaliaLine',
							content: [{ type: 'text', text: 'old' }],
						},
					],
				},
			],
		};
		delete fw.content;
		expect(fw.attrs.content.content[0].content[0].content[0].text).toBe('old');
		const document = fromProseMirror(pm);
		expect((document.pages[0].columns[0].lines[0].items[0] as any).content).toEqual([
			expect.objectContaining({ type: 'text', text: 'old' }),
		]);

		expect(serializeTei(document).replace(/\s+/g, '')).toContain(
			'<fwtype="header"><w>old</w></fw>'
		);
	});
});
