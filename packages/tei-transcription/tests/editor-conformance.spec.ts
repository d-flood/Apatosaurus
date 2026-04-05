import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';

import { fromProseMirror, parseTei, serializeTei, toProseMirror } from '../src/index';
import type { ProseMirrorJSON } from '../src/index';
import { validateIgntpXsd } from '../../../test-support/validate-igntp-xsd';

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

function wrapInTei(bodyContent: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader></teiHeader>
  <text><body>${bodyContent}</body></text>
</TEI>`;
}

function lineContent(pm: ProseMirrorJSON): ProseMirrorJSON[] {
	return pm.content?.[0]?.content?.[0]?.content?.[0]?.content || [];
}

function clonePm(pm: ProseMirrorJSON): ProseMirrorJSON {
	return JSON.parse(JSON.stringify(pm)) as ProseMirrorJSON;
}

function compactXml(xml: string): string {
	return xml.replace(/\s+/g, '');
}

describe('editor-path conformance', () => {
	it('round-trips flat wrappers through PM edits and XSD validation', () => {
		const pm = clonePm(
			toProseMirror(
				parseTei(wrapInTei('<pb n="1r"/><cb n="1"/><lb/><foreign xml:lang="la"><w>ab</w><w>cd</w></foreign>'))
			)
		);
		const target = lineContent(pm).find(
			node => node.type === 'text' && node.text === 'ab' && node.marks?.some(mark => mark.type === 'teiSpan')
		);
		expect(target).toBeTruthy();
		target!.text = 'ave';

		const exported = serializeTei(fromProseMirror(pm));
		expect(exported).toContain('<foreign xml:lang="la"><w>ave</w><w>cd</w></foreign>');
		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('round-trips structured wrapper carriers through inspector-style edits and XSD validation', () => {
		const pm = clonePm(
			toProseMirror(
				parseTei(
					wrapInTei('<pb n="1r"/><cb n="1"/><lb/><foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign>')
				)
			)
		);
		const wrapper = lineContent(pm).find(node => node.type === 'teiWrapper');
		expect(wrapper).toBeTruthy();
		wrapper!.attrs = {
			...wrapper!.attrs,
			teiAttrs: {
				...(wrapper!.attrs?.teiAttrs || {}),
				cert: 'medium',
			},
		};

		const exported = serializeTei(fromProseMirror(pm));
		expect(exported).toContain('<foreign xml:lang="la" cert="medium"><w>ab<lb break="no"/>cd</w></foreign>');
		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('round-trips single-witness corrections through PM edits and XSD validation', () => {
		const pm = clonePm(
			toProseMirror(
				parseTei(
					wrapInTei(`
						<pb n="1r"/><cb n="1"/><lb/>
						<app>
							<rdg type="orig" hand="firsthand"><w>alpha</w></rdg>
							<rdg type="corr" hand="corrector"><w>beta</w></rdg>
						</app>
					`)
				)
			)
		);
		const corrected = lineContent(pm).find(
			node => node.type === 'text' && node.marks?.some(mark => mark.type === 'correction')
		);
		expect(corrected).toBeTruthy();
		const correctionMark = corrected!.marks!.find(mark => mark.type === 'correction')!;
		correctionMark.attrs = {
			...correctionMark.attrs,
			corrections: [
				{
					...correctionMark.attrs!.corrections[0],
					content: [{ type: 'text', text: 'gamma' }],
				},
			],
		};

		const exported = serializeTei(fromProseMirror(pm));
		expect(compactXml(exported)).toContain(
			compactXml('<rdg type="corr" hand="corrector"><w>gamma</w></rdg>')
		);
		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('round-trips hand shifts and milestones through PM edits and XSD validation', () => {
		const pm = clonePm(
			toProseMirror(
				parseTei(
					wrapInTei('<pb n="1r"/><cb n="1"/><lb/><w>alpha</w><handShift new="#h2"/><milestone unit="section" n="A"/><w>beta</w>')
				)
			)
		);
		const handShift = lineContent(pm).find(node => node.type === 'handShift');
		const milestone = lineContent(pm).find(node => node.type === 'teiMilestone');
		expect(handShift).toBeTruthy();
		expect(milestone).toBeTruthy();
		handShift!.attrs = { teiAttrs: { ...(handShift!.attrs?.teiAttrs || {}), medium: 'ink' } };
		milestone!.attrs = { teiAttrs: { ...(milestone!.attrs?.teiAttrs || {}), ed: 'NA28' } };

		const exported = serializeTei(fromProseMirror(pm));
		expect(exported).toContain('<handShift new="#h2" medium="ink"/>');
		expect(exported).toContain('<milestone unit="section" n="A" ed="NA28"/>');
		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('round-trips marginalia/formwork through PM edits and XSD validation', () => {
		const pm = clonePm(
			toProseMirror(
				parseTei(
					wrapInTei('<pb n="1r"/><cb n="1"/><lb/><seg type="marginalia" subtype="commentary"><fw place="left">note</fw></seg>')
				)
			)
		);
		const fw = lineContent(pm).find(node => node.type === 'fw');
		expect(fw).toBeTruthy();
		fw!.attrs = {
			...fw!.attrs,
			content: [
				{ type: 'text', text: 'updated note' },
				{
					type: 'correctionNode',
					attrs: {
						corrections: [
							{
								hand: 'corrector2',
								content: [{ type: 'text', text: 'gamma' }],
							},
						],
					},
				},
			],
		};

		const exported = serializeTei(fromProseMirror(pm));
		expect(exported).toContain('<seg type="marginalia" subtype="commentary">');
		expect(exported).toContain('<fw place="left">');
		expect(compactXml(exported)).toContain(compactXml('<w>updated</w><w>note</w>'));
		expect(compactXml(exported)).toContain(
			compactXml('<app><rdg type="orig" hand="firsthand"/><rdg type="corr" hand="corrector2"><w>gamma</w></rdg></app>')
		);
		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('round-trips marginalia line and column breaks plus correction marks through PM edits and XSD validation', () => {
		const pm = clonePm(
			toProseMirror(
				parseTei(
					wrapInTei('<pb n="1r"/><cb n="1"/><lb/><seg type="marginalia" subtype="commentary"><fw place="left"><w>note</w></fw></seg>')
				)
			)
		);
		const fw = lineContent(pm).find(node => node.type === 'fw');
		expect(fw).toBeTruthy();
		fw!.attrs = {
			...fw!.attrs,
			content: [
				{
					type: 'text',
					text: 'alpha',
					marks: [
						{
							type: 'correction',
							attrs: {
								corrections: [{ hand: 'corrector2', content: [{ type: 'text', text: 'beta' }] }],
							},
						},
					],
				},
				{ type: 'columnBreak', attrs: { teiAttrs: { n: '2' } } },
				{ type: 'lineBreak', attrs: { teiAttrs: { n: '1', break: 'no' } } },
				{ type: 'text', text: 'gamma' },
			],
		};

		const exported = serializeTei(fromProseMirror(pm));
		expect(compactXml(exported)).toContain(
			compactXml('<fw place="left"><app><rdg type="orig"><w>alpha</w></rdg><rdg type="corr" hand="corrector2"><w>beta</w></rdg></app><cb n="2"/><lb n="1" break="no"/><w>gamma</w></fw>')
		);
		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('round-trips gap, space, and untranscribed carriers through PM edits and XSD validation', () => {
		const pm = clonePm(
			toProseMirror(
				parseTei(
					wrapInTei(
						'<pb n="1r"/><cb n="1"/><lb/><gap reason="lost-folio" unit="chars" extent="2"/><space extent="1" unit="chars"/><note type="untranscribed" reason="damage" extent="partial"/>'
					)
				)
			)
		);
		const gap = lineContent(pm).find(node => node.type === 'gap');
		const space = lineContent(pm).find(node => node.type === 'space');
		const untranscribed = lineContent(pm).find(node => node.type === 'untranscribed');
		expect(gap).toBeTruthy();
		expect(space).toBeTruthy();
		expect(untranscribed).toBeTruthy();

		gap!.attrs = { ...(gap!.attrs || {}), extent: '3' };
		space!.attrs = { teiAttrs: { ...(space!.attrs?.teiAttrs || {}), extent: '2' } };
		untranscribed!.attrs = { ...(untranscribed!.attrs || {}), reason: 'illegible' };

		const exported = serializeTei(fromProseMirror(pm));
		expect(exported).toContain('<gap reason="lost-folio" unit="chars" extent="3"/>');
		expect(exported).toContain('<space extent="2" unit="chars"/>');
		expect(exported).toContain('<note type="untranscribed" subtype="illegible" n="partial"/>');
		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});
});
