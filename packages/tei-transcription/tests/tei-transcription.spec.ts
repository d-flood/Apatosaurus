import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';

import {
	fromProseMirror,
	parseTei,
	serializePlainText,
	serializeTeiNode,
	serializeTeiNodes,
	serializeTei,
	toProseMirror,
} from '../src/index';
import type { ProseMirrorJSON } from '../src/index';

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

function compactXml(xml: string): string {
	return xml.replace(/\s+/g, '');
}

function buildPmDocument(lineContent: ProseMirrorJSON[]): ProseMirrorJSON {
	return {
		type: 'manuscript',
		content: [
			{
				type: 'page',
				attrs: { pageName: '1r' },
				content: [
					{
						type: 'column',
						attrs: { columnNumber: 1 },
						content: [
							{
								type: 'line',
								attrs: { lineNumber: 1 },
								content: lineContent,
							},
						],
					},
				],
			},
		],
	};
}

function getFormWorkInlineContent(fwNode: any): any[] {
	const content = fwNode?.attrs?.content;
	if (Array.isArray(content)) {
		return content;
	}
	if (!content || !Array.isArray(content.content)) {
		return [];
	}
	return content.content.flatMap((column: any, columnIndex: number) => [
		...(columnIndex > 0 ? [{ type: 'columnBreak', attrs: { teiAttrs: column.attrs?.breakAttrs || {} } }] : []),
		...((column.content || []) as any[]).flatMap((line: any, lineIndex: number) => [
			...(lineIndex > 0 ? [{ type: 'lineBreak', attrs: { teiAttrs: line.attrs?.breakAttrs || {} } }] : []),
			...((line.content || []) as any[]),
		]),
	]);
}

describe('tei-transcription package', () => {
	it('splits embedded whitespace in prose mirror text nodes into word boundaries', () => {
		const doc = fromProseMirror(
			buildPmDocument([
				{
					type: 'text',
					text: 'The  cat sat',
				},
			]),
		);

		expect(doc.pages[0].columns[0].lines[0].items).toEqual([
			{ type: 'text', text: 'The', marks: [] },
			{ type: 'boundary', kind: 'word' },
			{ type: 'text', text: 'cat', marks: [] },
			{ type: 'boundary', kind: 'word' },
			{ type: 'text', text: 'sat', marks: [] },
		]);
	});

	it('drops leading and trailing prose mirror whitespace when normalizing boundaries', () => {
		const doc = fromProseMirror(
			buildPmDocument([
				{
					type: 'text',
					text: '  The cat  ',
				},
			]),
		);

		expect(doc.pages[0].columns[0].lines[0].items).toEqual([
			{ type: 'text', text: 'The', marks: [] },
			{ type: 'boundary', kind: 'word' },
			{ type: 'text', text: 'cat', marks: [] },
		]);
	});

	it('preserves marks when splitting prose mirror text nodes with whitespace', () => {
		const doc = fromProseMirror(
			buildPmDocument([
				{
					type: 'text',
					text: 'κύριος θεος',
					marks: [{ type: 'unclear' }],
				},
			]),
		);

		expect(doc.pages[0].columns[0].lines[0].items).toEqual([
			{ type: 'text', text: 'κύριος', marks: [{ type: 'unclear', attrs: {} }] },
			{ type: 'boundary', kind: 'word' },
			{ type: 'text', text: 'θεος', marks: [{ type: 'unclear', attrs: {} }] },
		]);
	});

	it('splits whitespace inside correction content into inline boundaries', () => {
		const doc = fromProseMirror(
			buildPmDocument([
				{
					type: 'text',
					text: 'word',
					marks: [
						{
							type: 'correction',
							attrs: {
								corrections: [
									{
										hand: 'corrector',
										content: [
											{
												type: 'text',
												text: 'fixed text',
											},
										],
									},
								],
							},
						},
					],
				},
			]),
		);

		const correctionMark = doc.pages[0].columns[0].lines[0].items[0];
		expect(correctionMark).toEqual({
			type: 'text',
			text: 'word',
			marks: [
				{
					type: 'correction',
					attrs: {
						corrections: [
							{
								hand: 'corrector',
								content: [
									{ type: 'text', text: 'fixed', marks: [] },
									{ type: 'boundary', kind: 'word' },
									{ type: 'text', text: 'text', marks: [] },
								],
							},
						],
					},
				},
			],
		});
	});

	it('keeps mixed inline markup within one word without adding boundaries', () => {
		const doc = parseTei(
			wrapInTei('<pb n="1r"/><cb n="1"/><lb/><w>ab<unclear>c</unclear>de</w><w>next</w>')
		);

		const line = doc.pages[0].columns[0].lines[0];
		expect(line.items.filter(item => item.type === 'boundary')).toHaveLength(1);

		const pm = toProseMirror(doc);
		const lineContent = pm.content![0].content![0].content![0].content!;
		const textSequence = lineContent
			.filter(node => node.type === 'text')
			.map(node => node.text);
		expect(textSequence).toEqual(['ab', 'c', 'de', ' ', 'next']);
	});

	it('round-trips prose mirror text with embedded spaces back into explicit boundaries', () => {
		const pm = buildPmDocument([
			{
				type: 'text',
				text: 'The cat',
			},
			{
				type: 'text',
				text: ' sat',
			},
		]);

		const roundTripped = fromProseMirror(toProseMirror(fromProseMirror(pm)));
		expect(roundTripped.pages[0].columns[0].lines[0].items).toEqual([
			{ type: 'text', text: 'The', marks: [] },
			{ type: 'boundary', kind: 'word' },
			{ type: 'text', text: 'cat', marks: [] },
			{ type: 'boundary', kind: 'word' },
			{ type: 'text', text: 'sat', marks: [] },
		]);
	});

	it('does not add an extra boundary after apparatus content', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<app>
				<rdg type="orig" hand="firsthand"><w>word1</w><w>word2</w></rdg>
				<rdg type="corr" hand="corrector"><w>fixed</w></rdg>
			</app><w>after</w>
		`);

		const text = serializePlainText(parseTei(xml));
		expect(text).toContain('++ word1 => corrector: fixed ++ ++ word2 => corrector: fixed ++ after');
		expect(text).not.toContain('  after');
	});

	it('round-trips ligature rend values through prose mirror and TEI export', () => {
		const xml = wrapInTei('<pb n="1r"/><cb n="1"/><lb/><w>η<ex rend="‾">ν</ex></w>');
		const exported = serializeTei(fromProseMirror(toProseMirror(parseTei(xml))));
		const doc = new DOMParser().parseFromString(exported, 'application/xml');
		const ex = doc.getElementsByTagName('ex')[0];
		expect(ex.getAttribute('rend')).toBe('‾');
		expect(ex.textContent).toBe('ν');
	});

	it('serializes plain text with correction-friendly markers', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/><w><supplied source="na28" reason="lacuna">hel</supplied>lo</w>
			<app>
				<rdg type="orig" hand="firsthand"><w>world</w></rdg>
				<rdg type="corr" hand="corrector"><w><unclear>there</unclear></w></rdg>
			</app>
		`);

		const plain = serializePlainText(parseTei(xml));
		expect(plain).toContain('[hel]lo');
		expect(plain).toContain('++ world => corrector: `there` ++');
	});

	it('preserves correction segment metadata and reading rend values on round-trip', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<app>
				<rdg type="orig" hand="firsthand"><w>alpha</w></rdg>
				<rdg type="corr" hand="corrector2" rend="erased">
					<seg type="margin" subtype="pagetop" n="@P1">
						<w>beta</w>
					</seg>
				</rdg>
			</app>
		`);

		const exported = serializeTei(fromProseMirror(toProseMirror(parseTei(xml))));
		const doc = new DOMParser().parseFromString(exported, 'application/xml');
		const corr = Array.from(doc.getElementsByTagName('rdg')).find(
			rdg => rdg.getAttribute('type') === 'corr',
		)!;
		const seg = corr.getElementsByTagName('seg')[0];

		expect(corr.getAttribute('rend')).toBe('erased');
		expect(seg.getAttribute('type')).toBe('margin');
		expect(seg.getAttribute('subtype')).toBe('pagetop');
		expect(seg.getAttribute('n')).toBe('@P1');
		expect(seg.textContent).toContain('beta');
	});

	it('preserves marginal seg/fw structures on round-trip', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<seg type="margin" subtype="pagetop" n="@P1">
				<fw type="runTitle" rend="center"><w>προς</w><w>ρωμαιους</w></fw>
			</seg>
			<w>text</w>
		`);

		const exported = serializeTei(fromProseMirror(toProseMirror(parseTei(xml))));
		const doc = new DOMParser().parseFromString(exported, 'application/xml');
		const seg = doc.getElementsByTagName('seg')[0];
		const fw = doc.getElementsByTagName('fw')[0];

		expect(seg.getAttribute('type')).toBe('margin');
		expect(seg.getAttribute('subtype')).toBe('pagetop');
		expect(seg.getAttribute('n')).toBe('@P1');
		expect(fw.getAttribute('type')).toBe('runTitle');
		expect(fw.getAttribute('rend')).toBe('center');
		expect(fw.textContent?.replace(/\s+/g, ' ').trim()).toBe('προς ρωμαιους');
	});

	it('preserves schema-level fw attrs and wrapping seg attrs on round-trip', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<seg type="margin" subtype="pagetop" place="top" n="@P1" rend="boxed">
				<fw xml:id="fw-1" n="fw.1" type="pageNum" subtype="folio" place="top" hand="#corrector1" rend="center">
					<w>ιβ</w>
				</fw>
			</seg>
			<w>text</w>
		`);

		const exported = serializeTei(fromProseMirror(toProseMirror(parseTei(xml))));
		const doc = new DOMParser().parseFromString(exported, 'application/xml');
		const seg = doc.getElementsByTagName('seg')[0];
		const fw = doc.getElementsByTagName('fw')[0];

		expect(seg.getAttribute('place')).toBe('top');
		expect(seg.getAttribute('rend')).toBe('boxed');
		expect(fw.getAttribute('xml:id')).toBe('fw-1');
		expect(fw.getAttribute('n')).toBe('fw.1');
		expect(fw.getAttribute('type')).toBe('pageNum');
		expect(fw.getAttribute('subtype')).toBe('folio');
		expect(fw.getAttribute('place')).toBe('top');
		expect(fw.getAttribute('hand')).toBe('#corrector1');
		expect(fw.getAttribute('rend')).toBe('center');
	});

	it('preserves schema-level fw attrs like subtype and place on round-trip', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<seg type="margin" subtype="colbottom" place="bottom" n="@P1C1">
				<fw type="sig" subtype="guide" place="bottom" n="sig-1" hand="corrector1" rend="right"><w>ιβ</w></fw>
			</seg>
			<w>text</w>
		`);

		const exported = serializeTei(fromProseMirror(toProseMirror(parseTei(xml))));
		const doc = new DOMParser().parseFromString(exported, 'application/xml');
		const seg = doc.getElementsByTagName('seg')[0];
		const fw = doc.getElementsByTagName('fw')[0];

		expect(seg.getAttribute('subtype')).toBe('colbottom');
		expect(seg.getAttribute('place')).toBe('bottom');
		expect(fw.getAttribute('type')).toBe('sig');
		expect(fw.getAttribute('subtype')).toBe('guide');
		expect(fw.getAttribute('place')).toBe('bottom');
		expect(fw.getAttribute('n')).toBe('sig-1');
		expect(fw.getAttribute('hand')).toBe('corrector1');
		expect(fw.getAttribute('rend')).toBe('right');
		expect(fw.textContent?.trim()).toBe('ιβ');
	});

	it('round-trips flat space and tei-attr marks through prose mirror', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<w>a<damage agent="smudge" degree="low">b</damage><surplus reason="dittography">c</surplus><secl reason="overlap">d</secl>e</w>
			<space extent="2" unit="chars" dim="horizontal"/>
			<w>next</w>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const damageNode = lineContent.find(
			node => node.type === 'text' && node.text === 'b',
		);
		const spaceNode = lineContent.find(node => node.type === 'space');

		expect(damageNode?.marks).toEqual([{ type: 'damage', attrs: { teiAttrs: { agent: 'smudge', degree: 'low' } } }]);
		expect(spaceNode?.attrs).toEqual({
			teiAttrs: { extent: '2', unit: 'chars', dim: 'horizontal' },
		});

		const exported = serializeTei(fromProseMirror(pm));
		const doc = new DOMParser().parseFromString(exported, 'application/xml');
		const damage = doc.getElementsByTagName('damage')[0];
		const surplus = doc.getElementsByTagName('surplus')[0];
		const secl = doc.getElementsByTagName('secl')[0];
		const space = doc.getElementsByTagName('space')[0];

		expect(damage.getAttribute('agent')).toBe('smudge');
		expect(damage.getAttribute('degree')).toBe('low');
		expect(damage.textContent).toBe('b');
		expect(surplus.getAttribute('reason')).toBe('dittography');
		expect(surplus.textContent).toBe('c');
		expect(secl.getAttribute('reason')).toBe('overlap');
		expect(secl.textContent).toBe('d');
		expect(space.getAttribute('extent')).toBe('2');
		expect(space.getAttribute('unit')).toBe('chars');
		expect(space.getAttribute('dim')).toBe('horizontal');
	});

	it('preserves structural break attrs and plain hi markup on round-trip', () => {
		const xml = wrapInTei(`
			<pb n="P261r" type="folio"/>
			<cb n="P261rC1"/>
			<lb n="P261rC1L-01" rend="hang"/>
			<w><hi rend="overline" height="2" hand="corrector">abc</hi></w>
			<lb n="P261rC1L-02" break="no"/>
			<w>def</w>
		`);

		const parsed = parseTei(xml);
		const page = parsed.pages[0];
		const column = page.columns[0];
		const firstLine = column.lines[0];
		const secondLine = column.lines[1];
		const firstText = firstLine.items.find(item => item.type === 'text');

		expect(page.teiAttrs).toMatchObject({ n: 'P261r', type: 'folio' });
		expect(column.teiAttrs).toMatchObject({ n: 'P261rC1' });
		expect(firstLine.teiAttrs).toMatchObject({ n: 'P261rC1L-01', rend: 'hang' });
		expect(secondLine.teiAttrs).toMatchObject({ n: 'P261rC1L-02', break: 'no' });
		expect(firstLine.paragraphStart).toBe(true);
		expect(firstText).toEqual({
			type: 'text',
			text: 'abc',
			marks: [{ type: 'hi', attrs: { rend: 'overline', height: '2', hand: 'corrector' } }],
		});

		const exported = serializeTei(fromProseMirror(toProseMirror(parsed)));
		const doc = new DOMParser().parseFromString(exported, 'application/xml');
		const hi = doc.getElementsByTagName('hi')[0];
		const lbs = Array.from(doc.getElementsByTagName('lb'));
		const pb = doc.getElementsByTagName('pb')[0];
		const cb = doc.getElementsByTagName('cb')[0];

		expect(hi.getAttribute('rend')).toBe('overline');
		expect(hi.getAttribute('height')).toBe('2');
		expect(hi.getAttribute('hand')).toBe('corrector');
		expect(hi.textContent).toBe('abc');
		expect(pb.getAttribute('n')).toBe('P261r');
		expect(cb.getAttribute('n')).toBe('P261rC1');
		expect(lbs[0].getAttribute('n')).toBe('P261rC1L-01');
		expect(lbs[0].getAttribute('rend')).toBe('hang');
		expect(lbs[1].getAttribute('n')).toBe('P261rC1L-02');
		expect(lbs[1].getAttribute('break')).toBe('no');
	});

	it('preserves word and punctuation attrs through prose mirror and TEI export', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<w lemma="λογος" pos="noun" msd="n-s---mn-" join="right" part="I">λογος</w>
			<pc force="strong" unit="sentence" pre="false">.</pc>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const wordNode = lineContent.find(node => node.type === 'text' && node.text === 'λογος');
		const punctNode = lineContent.find(node => node.type === 'text' && node.text === '.');

		expect(wordNode?.marks).toContainEqual({
			type: 'word',
			attrs: {
				teiAttrs: {
					lemma: 'λογος',
					pos: 'noun',
					msd: 'n-s---mn-',
					join: 'right',
					part: 'I',
				},
			},
		});
		expect(punctNode?.marks).toContainEqual({
			type: 'punctuation',
			attrs: { teiAttrs: { force: 'strong', unit: 'sentence', pre: 'false' } },
		});

		const exported = serializeTei(fromProseMirror(pm));
		const doc = new DOMParser().parseFromString(exported, 'application/xml');
		const w = doc.getElementsByTagName('w')[0];
		const pc = doc.getElementsByTagName('pc')[0];

		expect(w.getAttribute('lemma')).toBe('λογος');
		expect(w.getAttribute('pos')).toBe('noun');
		expect(w.getAttribute('msd')).toBe('n-s---mn-');
		expect(w.getAttribute('join')).toBe('right');
		expect(w.getAttribute('part')).toBe('I');
		expect(w.textContent).toBe('λογος');
		expect(pc.getAttribute('force')).toBe('strong');
		expect(pc.getAttribute('unit')).toBe('sentence');
		expect(pc.getAttribute('pre')).toBe('false');
		expect(pc.textContent).toBe('.');
	});

	it('preserves handShift and generic milestone atoms through prose mirror and TEI export', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<w>alpha</w>
			<handShift new="s2" medium="ink"/>
			<milestone unit="section" n="A" ed="NA28"/>
			<w>beta</w>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const handShift = lineContent.find(node => node.type === 'handShift');
		const milestone = lineContent.find(node => node.type === 'teiMilestone');

		expect(handShift?.attrs).toEqual({ teiAttrs: { new: 's2', medium: 'ink' } });
		expect(milestone?.attrs).toEqual({
			teiAttrs: { unit: 'section', n: 'A', ed: 'NA28' },
		});

		const exported = serializeTei(fromProseMirror(pm));
		const doc = new DOMParser().parseFromString(exported, 'application/xml');
		const exportedHandShift = doc.getElementsByTagName('handShift')[0];
		const exportedMilestone = doc.getElementsByTagName('milestone')[0];

		expect(exportedHandShift.getAttribute('new')).toBe('s2');
		expect(exportedHandShift.getAttribute('medium')).toBe('ink');
		expect(exportedMilestone.getAttribute('unit')).toBe('section');
		expect(exportedMilestone.getAttribute('n')).toBe('A');
		expect(exportedMilestone.getAttribute('ed')).toBe('NA28');
	});

	it('preserves supplied and unclear attributes through prose mirror and TEI export', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<w><supplied source="#ed1" reason="lost-folio" cert="low">ab</supplied><unclear cert="medium">c</unclear></w>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const suppliedNode = lineContent.find(node => node.type === 'text' && node.text === 'ab');
		const unclearNode = lineContent.find(node => node.type === 'text' && node.text === 'c');

		expect(suppliedNode?.marks).toContainEqual({
			type: 'lacunose',
			attrs: { teiAttrs: { source: '#ed1', reason: 'lost-folio', cert: 'low' } },
		});
		expect(unclearNode?.marks).toContainEqual({
			type: 'unclear',
			attrs: { teiAttrs: { cert: 'medium' } },
		});

		const exported = serializeTei(fromProseMirror(pm));
		const doc = new DOMParser().parseFromString(exported, 'application/xml');
		const supplied = doc.getElementsByTagName('supplied')[0];
		const unclear = doc.getElementsByTagName('unclear')[0];

		expect(supplied.getAttribute('source')).toBe('#ed1');
		expect(supplied.getAttribute('reason')).toBe('lost-folio');
		expect(supplied.getAttribute('cert')).toBe('low');
		expect(supplied.textContent).toBe('ab');
		expect(unclear.getAttribute('cert')).toBe('medium');
		expect(unclear.textContent).toBe('c');
	});

	it('preserves flat phrase-like inline spans as visible text marks', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<foreign xml:lang="la"><w>ab</w></foreign><name type="person"><w>cd</w></name><term key="t1"><w>ef</w></term>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const foreignNode = lineContent.find(node => node.type === 'text' && node.text === 'ab');
		const nameNode = lineContent.find(node => node.type === 'text' && node.text === 'cd');
		const termNode = lineContent.find(node => node.type === 'text' && node.text === 'ef');

		expect(foreignNode?.marks).toContainEqual({
			type: 'teiSpan',
			attrs: { tag: 'foreign', teiAttrs: { 'xml:lang': 'la' } },
		});
		expect(nameNode?.marks).toContainEqual({
			type: 'teiSpan',
			attrs: { tag: 'name', teiAttrs: { type: 'person' } },
		});
		expect(termNode?.marks).toContainEqual({
			type: 'teiSpan',
			attrs: { tag: 'term', teiAttrs: { key: 't1' } },
		});

		const exported = serializeTei(fromProseMirror(pm));
		expect(exported).toContain('<foreign xml:lang="la"><w>ab</w></foreign>');
		expect(exported).toContain('<name type="person"><w>cd</w></name>');
		expect(exported).toContain('<term key="t1"><w>ef</w></term>');
	});

	it('preserves additional schema phrase-like elements as flat visible text marks', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<gloss xml:lang="en"><w>cd</w></gloss><placeName ref="#rome"><w>ef</w></placeName><objectName type="codex"><w>gh</w></objectName><title type="short"><w>ij</w></title>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const glossNode = lineContent.find(node => node.type === 'text' && node.text === 'cd');
		const placeNode = lineContent.find(node => node.type === 'text' && node.text === 'ef');
		const objectNode = lineContent.find(node => node.type === 'text' && node.text === 'gh');
		const titleNode = lineContent.find(node => node.type === 'text' && node.text === 'ij');

		expect(glossNode?.marks).toContainEqual({
			type: 'teiSpan',
			attrs: { tag: 'gloss', teiAttrs: { 'xml:lang': 'en' } },
		});
		expect(placeNode?.marks).toContainEqual({
			type: 'teiSpan',
			attrs: { tag: 'placeName', teiAttrs: { ref: '#rome' } },
		});
		expect(objectNode?.marks).toContainEqual({
			type: 'teiSpan',
			attrs: { tag: 'objectName', teiAttrs: { type: 'codex' } },
		});
		expect(titleNode?.marks).toContainEqual({
			type: 'teiSpan',
			attrs: { tag: 'title', teiAttrs: { type: 'short' } },
		});

		const exported = serializeTei(fromProseMirror(pm));
		expect(exported).toContain('<gloss xml:lang="en"><w>cd</w></gloss>');
		expect(exported).toContain('<placeName ref="#rome"><w>ef</w></placeName>');
		expect(exported).toContain('<objectName type="codex"><w>gh</w></objectName>');
		expect(exported).toContain('<title type="short"><w>ij</w></title>');
	});

	it('preserves multi-word whole-token wrappers as one outer TEI element', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<foreign xml:lang="la"><w>ab</w><w>cd</w></foreign>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const markedWords = lineContent.filter(
			node =>
				node.type === 'text' &&
				(node.text === 'ab' || node.text === 'cd') &&
				node.marks?.some(mark => mark.type === 'teiSpan' && mark.attrs?.tag === 'foreign')
		);

		expect(markedWords).toHaveLength(2);

		const exported = serializeTei(fromProseMirror(pm));
		expect(exported).toContain('<foreign xml:lang="la"><w>ab</w><w>cd</w></foreign>');
	});

	it('preserves structurally non-flat phrase wrappers as dedicated carrier nodes', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign>
		`);

		const pm = toProseMirror(parseTei(xml));
		const wrapperNode = pm.content![0].content![0].content![0].content!.find(
			node => node.type === 'teiWrapper'
		);

		expect(wrapperNode).toMatchObject({
			type: 'teiWrapper',
			attrs: {
				tag: 'foreign',
				teiAttrs: { 'xml:lang': 'la' },
			},
		});
		expect(JSON.stringify(wrapperNode?.attrs?.children || [])).toContain('"tag":"lb"');

		const exported = serializeTei(fromProseMirror(pm));
		expect(exported).toContain('<foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign>');
	});

	it('preserves non-flat wrapper carriers inside correction content', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<app>
				<rdg type="orig" hand="firsthand"><w>alpha</w></rdg>
				<rdg type="corr" hand="corrector">
					<foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign>
				</rdg>
			</app>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const correctedText = lineContent.find(node => node.type === 'text' && node.text === 'alpha');
		const correctionContent = correctedText?.marks?.[0]?.attrs?.corrections?.[0]?.content || [];
		const wrapperNode = correctionContent.find((node: any) => node.type === 'teiWrapper');

		expect(wrapperNode).toMatchObject({
			type: 'teiWrapper',
			attrs: {
				tag: 'foreign',
				teiAttrs: { 'xml:lang': 'la' },
			},
		});

		const exported = serializeTei(fromProseMirror(pm));
		expect(compactXml(exported)).toContain(
			compactXml(
				'<rdg type="corr" hand="corrector"><foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign></rdg>'
			)
		);
	});

	it('preserves non-flat wrapper carriers inside formwork content', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<seg type="margin" subtype="pagetop">
				<fw type="header"><foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign></fw>
			</seg>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const fwNode = lineContent.find(node => node.type === 'fw');
		const wrapperNode = getFormWorkInlineContent(fwNode).find((node: any) => node.type === 'teiWrapper');

		expect(wrapperNode).toMatchObject({
			type: 'teiWrapper',
			attrs: {
				tag: 'foreign',
				teiAttrs: { 'xml:lang': 'la' },
			},
		});

		const exported = serializeTei(fromProseMirror(pm));
		expect(compactXml(exported)).toContain(
			compactXml(
				'<fw type="header"><foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign></fw>'
			)
		);
	});

	it('preserves correction-only apparatus inside formwork content', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<seg type="margin" subtype="lineright">
				<fw place="margin right">
					<app>
						<rdg type="orig" hand="firsthand"/>
						<rdg type="corr" hand="corrector2"><w>gamma</w></rdg>
					</app>
				</fw>
			</seg>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const fwNode = lineContent.find(node => node.type === 'fw');
		const correctionNode = getFormWorkInlineContent(fwNode).find((node: any) => node.type === 'correctionNode');

		expect(correctionNode?.attrs?.corrections).toMatchObject([
			{
				hand: 'corrector2',
			},
		]);

		const exported = serializeTei(fromProseMirror(pm));
		expect(compactXml(exported)).toContain(
			compactXml(
				'<fw place="margin right"><app><rdg type="orig" hand="firsthand"/><rdg type="corr" hand="corrector2"><w>gamma</w></rdg></app></fw>'
			)
		);
	});

	it('preserves line and column breaks inside formwork content', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<seg type="margin" subtype="lineright">
				<fw place="margin right"><w>alpha</w><cb n="2"/><lb n="1" break="no"/><w>beta</w></fw>
			</seg>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const fwNode = lineContent.find(node => node.type === 'fw');
		const nestedColumnBreak = getFormWorkInlineContent(fwNode).find((node: any) => node.type === 'columnBreak');
		const nestedLineBreak = getFormWorkInlineContent(fwNode).find((node: any) => node.type === 'lineBreak');

		expect(nestedColumnBreak?.attrs?.teiAttrs).toEqual({ n: '2' });
		expect(nestedLineBreak?.attrs?.teiAttrs).toEqual({ n: '1', break: 'no' });

		const exported = serializeTei(fromProseMirror(pm));
		expect(compactXml(exported)).toContain(
			compactXml(
				'<fw place="margin right"><w>alpha</w><cb n="2"/><lb n="1" break="no"/><w>beta</w></fw>'
			)
		);
	});

	it('preserves correction marks with orig content inside formwork content', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<seg type="margin" subtype="lineright">
				<fw place="margin right">
					<app>
						<rdg type="orig" hand="firsthand"><w>alpha</w></rdg>
						<rdg type="corr" hand="corrector2"><w>beta</w></rdg>
					</app>
				</fw>
			</seg>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const fwNode = lineContent.find(node => node.type === 'fw');
		const correctedText = getFormWorkInlineContent(fwNode).find((node: any) => node.type === 'text' && node.text === 'alpha');

		expect(correctedText?.marks?.[0]?.type).toBe('correction');
		expect(correctedText?.marks?.[0]?.attrs?.corrections).toMatchObject([
			{
				hand: 'corrector2',
			},
		]);

		const exported = serializeTei(fromProseMirror(pm));
		expect(compactXml(exported)).toContain(
			compactXml(
				'<fw place="margin right"><app><rdg type="orig"><w>alpha</w></rdg><rdg type="corr" hand="corrector2"><w>beta</w></rdg></app></fw>'
			)
		);
	});

	it('preserves runTitle formwork inside correction readings', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<app>
				<rdg type="orig" hand="firsthand"/>
				<rdg type="corr" hand="corrector1">
					<seg type="margin" subtype="pagetop" n="@P1">
						<fw type="runTitle" rend="center"><w>προς</w><w>ρωμαιους</w></fw>
					</seg>
				</rdg>
			</app>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const correctionNode = lineContent.find(node => node.type === 'correctionNode');
		const fwNode = correctionNode?.attrs?.corrections?.[0]?.content?.find((node: any) => node.type === 'fw');

		expect(correctionNode?.attrs?.corrections?.[0]).toMatchObject({
			position: 'pagetop',
			segmentAttrs: { type: 'margin', subtype: 'pagetop', n: '@P1' },
		});
		expect(fwNode?.attrs).toMatchObject({
			type: 'runTitle',
			rend: 'center',
		});

		const exported = serializeTei(fromProseMirror(pm));
		expect(compactXml(exported)).toContain(
			compactXml(
				'<rdg type="corr" hand="corrector1"><seg type="margin" subtype="pagetop" n="@P1"><fw type="runTitle" rend="center"><w>προς</w><w>ρωμαιους</w></fw></seg></rdg>'
			)
		);
	});

	it('preserves surplus-wrapped apparatus content', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<surplus reason="repetition">
				<app>
					<rdg type="orig" hand="firsthand"><w>alpha</w></rdg>
					<rdg type="corr" hand="corrector"><w>beta</w></rdg>
				</app>
			</surplus>
			<w>gamma</w>
		`);

		const document = parseTei(xml);
		const lineItems = document.pages[0].columns[0].lines[0].items;
		const firstText = lineItems.find(item => item.type === 'text' && item.text === 'alpha');

		expect(firstText).toMatchObject({
			type: 'text',
			text: 'alpha',
			marks: expect.arrayContaining([
				expect.objectContaining({ type: 'surplus' }),
				expect.objectContaining({ type: 'correction' }),
			]),
		});

		const exported = serializeTei(document);
		expect(compactXml(exported)).toContain(compactXml('<surplus reason="repetition">'));
		expect(compactXml(exported)).toContain(
			compactXml('<rdg type="corr" hand="corrector"><w><surplus reason="repetition">beta</surplus></w></rdg>')
		);
	});

	it('round-trips carrier-local page breaks in correction content', () => {
		const document = fromProseMirror(
			buildPmDocument([
				{
					type: 'correctionNode',
					attrs: {
						corrections: [
							{
								hand: 'corrector1',
								content: [
									{ type: 'text', text: 'alpha' },
									{
										type: 'pageBreak',
										attrs: { teiAttrs: { n: '165v', type: 'folio', 'xml:id': 'P165v-1319' } },
									},
									{ type: 'text', text: 'beta' },
								],
							},
						],
					},
				},
			]),
		);

		const exported = serializeTei(document);
		expect(compactXml(exported)).toContain(
			compactXml(
				'<rdg type="corr" hand="corrector1"><w>alpha</w><pb n="165v" type="folio" xml:id="P165v-1319"/><w>beta</w></rdg>'
			)
		);

		const roundTripped = toProseMirror(parseTei(exported));
		const correctionNode = roundTripped.content![0].content![0].content![0].content!.find(
			node => node.type === 'correctionNode'
		);
		expect(correctionNode?.attrs?.corrections?.[0]?.content).toEqual([
			{ type: 'text', text: 'alpha', marks: [] },
			{ type: 'text', text: ' ' },
			{
				type: 'pageBreak',
				attrs: { teiAttrs: { n: '165v', type: 'folio', 'xml:id': 'P165v-1319' } },
			},
			{ type: 'text', text: 'beta', marks: [] },
		]);
	});

	it('preserves nested interjection surplus inside repeated surplus content', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<surplus reason="repetition">
				<w>οι</w><w>γαρ</w>
				<surplus reason="interjection"><w>φησιν</w></surplus>
				<w>ου</w><w>δουλευουσιν</w>
			</surplus>
		`);

		const exported = serializeTei(parseTei(xml));
		expect(compactXml(exported)).toContain(
			compactXml('<surplus reason="interjection">φησιν</surplus>')
		);
		expect(compactXml(exported)).toContain(
			compactXml('<w><surplus reason="repetition">οι</surplus></w>')
		);
	});

	it('preserves recognized TEI atoms as dedicated flat items instead of opaque XML', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<gb n="g1"/>
			<ptr target="#target1" type="crossref"/>
			<media mimeType="image/png" url="https://example.com/image.png"/>
			<note place="margin">see note</note>
			<ellipsis unit="chars" quantity="2"><metamark function="omission"/><supplied reason="lost-folio">ab</supplied></ellipsis>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const atoms = lineContent.filter(node => node.type === 'teiAtom');

		expect(atoms.map(node => node.attrs?.tag)).toEqual(['gb', 'ptr', 'media', 'note', 'ellipsis']);
		expect(atoms[0]?.attrs?.teiAttrs).toEqual({ n: 'g1' });
		expect(atoms[1]?.attrs?.teiAttrs).toEqual({ target: '#target1', type: 'crossref' });
		expect(atoms[2]?.attrs?.teiAttrs).toEqual({
			mimeType: 'image/png',
			url: 'https://example.com/image.png',
		});
		expect(atoms[3]?.attrs?.teiAttrs).toEqual({ place: 'margin' });
		expect(atoms[3]?.attrs?.text).toBe('see note');
		expect(atoms[4]?.attrs?.teiAttrs).toEqual({ unit: 'chars', quantity: '2' });

		const exported = serializeTei(fromProseMirror(pm));
		expect(exported).toContain('<gb n="g1"/>');
		expect(exported).toContain('<ptr target="#target1" type="crossref"/>');
		expect(exported).toContain('<media mimeType="image/png" url="https://example.com/image.png"/>');
		expect(exported).toContain('<note place="margin">see note</note>');
		expect(exported).toContain('<ellipsis unit="chars" quantity="2"><metamark function="omission"/><supplied reason="lost-folio">ab</supplied></ellipsis>');
	});

	it('rejects unsupported nested inline TEI inside words', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<w>a<w xml:id="nested1">b</w>d</w>
		`);

		expect(() => parseTei(xml)).toThrow(/Unsupported TEI element: <w xml:id="nested1">/);
	});

	it('preserves teiHeader and text front/back outside the editable body', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>Custom Title</title></titleStmt>
      <publicationStmt><p>published</p></publicationStmt>
      <sourceDesc><p>source</p></sourceDesc>
    </fileDesc>
  </teiHeader>
  <text>
    <front><head>Front Matter</head></front>
    <body><pb n="1r"/><cb n="1"/><lb/><w>alpha</w></body>
    <back><p>Back Matter</p></back>
  </text>
</TEI>`;

		const exported = serializeTei(parseTei(xml));
		expect(exported).toContain('<teiHeader>');
		expect(exported).toContain('<title>Custom Title</title>');
		expect(exported).toContain('<front><head>Front Matter</head></front>');
		expect(exported).toContain('<back><p>Back Matter</p></back>');
	});

	it('extracts typed metadata from teiHeader and text attributes', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title type="document">A transcription of Romans in 01</title>
        <title type="short" xml:lang="en">Romans</title>
        <respStmt>
          <resp when-iso="2020-10-15">Transcribed by</resp>
          <name type="person">members of the INTF</name>
        </respStmt>
      </titleStmt>
      <publicationStmt><date>13.5.2024</date></publicationStmt>
      <sourceDesc>
        <msDesc>
          <msIdentifier>
            <country>United Kingdom</country>
            <settlement>London</settlement>
            <repository>British Library</repository>
            <idno>MS Add. 43725</idno>
            <msName>Codex 01</msName>
          </msIdentifier>
          <physDesc>
            <objectDesc form="codex">
              <supportDesc material="parchment">
                <support>parchment</support>
                <foliation>ff. 1-230</foliation>
                <condition>fair</condition>
              </supportDesc>
              <layoutDesc>
                <layout columns="2" writtenLines="45">double column</layout>
              </layoutDesc>
            </objectDesc>
            <handDesc>
              <handNote xml:id="firsthand" script="majuscule">first hand</handNote>
              <handNote xml:id="corrector1" script="minuscule">corrector hand</handNote>
            </handDesc>
          </physDesc>
          <msContents>
            <msItemStruct>
              <locus>Rom 1:1-16:27</locus>
              <author>Paul</author>
              <title>Romans</title>
              <note>primary witness</note>
              <textLang>grc</textLang>
            </msItemStruct>
          </msContents>
          <history>
            <origin>
              <origDate when="0400">4th c.</origDate>
              <origPlace>Alexandria</origPlace>
            </origin>
            <provenance>Sinai</provenance>
          </history>
          <additional>
            <surrogates>digital facsimile</surrogates>
          </additional>
        </msDesc>
      </sourceDesc>
    </fileDesc>
    <profileDesc>
      <langUsage><language ident="grc"/></langUsage>
      <handNotes><handNote><listWit><witness xml:id="firsthand"/><witness xml:id="corrector1"/></listWit></handNote></handNotes>
    </profileDesc>
    <encodingDesc n="1.6"/>
    <revisionDesc>
      <change n="2" when="2021-09-20">HH deleted the portion of 1Cor at the end of the transcription.</change>
      <change n="1" when="2020-10-15">Downloaded from NTVMR and initial adjustments in encoding made for inclusion in ECM by Hugh Houghton.</change>
    </revisionDesc>
  </teiHeader>
  <text xml:lang="grc"><body><pb n="1r"/><cb n="1"/><lb/><w>alpha</w></body></text>
</TEI>`;

		const parsed = parseTei(xml);
		expect(parsed.metadata).toEqual({
			title: 'A transcription of Romans in 01',
			transcriber: 'members of the INTF',
			date: '2020-10-15',
			repository: 'British Library',
			settlement: 'London',
			idno: 'MS Add. 43725',
			language: 'grc',
		});
		expect(parsed.header).toEqual({
			titles: [
				{ text: 'A transcription of Romans in 01', type: 'document' },
				{ text: 'Romans', type: 'short', lang: 'en' },
			],
			responsibilities: [
				{
					resp: 'Transcribed by',
					name: 'members of the INTF',
					nameType: 'person',
					when: '2020-10-15',
				},
			],
			msIdentifier: {
				country: 'United Kingdom',
				settlement: 'London',
				repository: 'British Library',
				idno: 'MS Add. 43725',
			},
			msDescription: {
				msName: 'Codex 01',
				objectType: 'codex',
				material: 'parchment',
				origDate: '4th c.',
				origPlace: 'Alexandria',
				foliation: 'ff. 1-230',
				condition: 'fair',
				layouts: [{ columns: '2', writtenLines: '45', text: 'double column' }],
				hands: [
					{ attrs: { 'xml:id': 'firsthand', script: 'majuscule' }, text: 'first hand' },
					{ attrs: { 'xml:id': 'corrector1', script: 'minuscule' }, text: 'corrector hand' },
				],
				contents: [
					{
						locus: 'Rom 1:1-16:27',
						authors: ['Paul'],
						titles: ['Romans'],
						textLang: 'grc',
						notes: ['primary witness'],
					},
				],
				provenance: ['Sinai'],
				surrogates: ['digital facsimile'],
			},
			language: 'grc',
			witnessIds: ['firsthand', 'corrector1'],
			publication: {
				date: '13.5.2024',
			},
			encoding: {
				version: '1.6',
			},
			encodingVersion: '1.6',
			publicationDate: '13.5.2024',
			revisionChanges: [
				{
					n: '2',
					when: '2021-09-20',
					text: 'HH deleted the portion of 1Cor at the end of the transcription.',
				},
				{
					n: '1',
					when: '2020-10-15',
					text: 'Downloaded from NTVMR and initial adjustments in encoding made for inclusion in ECM by Hugh Houghton.',
				},
			],
		});
	});

	it('uses typed document metadata for generated headers when raw teiHeader is absent', () => {
		const document = fromProseMirror(buildPmDocument([{ type: 'text', text: 'alpha' }]));
		document.metadata = {
			title: 'Generated Title',
			transcriber: 'Editor Name',
			date: '2024-01-02',
			repository: 'Repo',
			settlement: 'City',
			idno: 'MS 1',
			language: 'la',
		};
		document.header = {
			titles: [
				{ text: 'Generated Title', type: 'document' },
				{ text: 'Romans', type: 'short', lang: 'en' },
			],
			responsibilities: [
				{
					resp: 'Transcribed by',
					name: 'Editor Name',
					nameType: 'person',
					when: '2024-01-02',
				},
			],
			msIdentifier: {
				country: 'Italy',
				settlement: 'City',
				repository: 'Repo',
				idno: 'MS 1',
			},
			msDescription: {
				msName: 'Codex Test',
				objectType: 'codex',
				material: 'parchment',
				origDate: '4th c.',
				origPlace: 'Alexandria',
				foliation: 'ff. 1-10',
				condition: 'good',
				layouts: [{ columns: '2', writtenLines: '40', text: 'double column' }],
				hands: [{ attrs: { 'xml:id': 'h1', script: 'majuscule' }, text: 'first hand' }],
				contents: [
					{
						locus: 'Rom 1',
						authors: ['Paul'],
						titles: ['Romans'],
						textLang: 'grc',
						notes: ['fragmentary'],
					},
				],
				provenance: ['Sinai'],
				surrogates: ['digital facsimile'],
			},
			language: 'la',
			witnessIds: ['firsthand', 'corrector'],
			encodingVersion: '1.6',
			revisionChanges: [{ n: '1', when: '2024-01-02', text: 'Initial import.' }],
			publicationDate: '2024-01-03',
		};

		const exported = serializeTei(document);
		const doc = new DOMParser().parseFromString(exported, 'application/xml');

		const titles = Array.from(doc.getElementsByTagName('title'));
		expect(titles[0].textContent).toBe('Generated Title');
		expect(titles[1].textContent).toBe('Romans');
		expect(doc.getElementsByTagName('name')[0].textContent).toBe('Editor Name');
		expect(doc.getElementsByTagName('country')[0].textContent).toBe('Italy');
		expect(doc.getElementsByTagName('settlement')[0].textContent).toBe('City');
		expect(doc.getElementsByTagName('repository')[0].textContent).toBe('Repo');
		expect(doc.getElementsByTagName('idno')[0].textContent).toBe('MS 1');
		expect(doc.getElementsByTagName('msName')[0].textContent).toBe('Codex Test');
		expect(doc.getElementsByTagName('objectDesc')[0].getAttribute('form')).toBe('codex');
		expect(doc.getElementsByTagName('supportDesc')[0].getAttribute('material')).toBe('parchment');
		expect(doc.getElementsByTagName('support')[0].textContent).toBe('parchment');
		expect(doc.getElementsByTagName('origDate')[0].textContent).toBe('4th c.');
		expect(doc.getElementsByTagName('origPlace')[0].textContent).toBe('Alexandria');
		expect(doc.getElementsByTagName('foliation')[0].textContent).toBe('ff. 1-10');
		expect(doc.getElementsByTagName('condition')[0].textContent).toBe('good');
		expect(doc.getElementsByTagName('layout')[0].getAttribute('columns')).toBe('2');
		expect(doc.getElementsByTagName('layout')[0].getAttribute('writtenLines')).toBe('40');
		expect(doc.getElementsByTagName('handNote')[0].getAttribute('xml:id')).toBe('h1');
		expect(doc.getElementsByTagName('handNote')[0].textContent).toBe('first hand');
		expect(doc.getElementsByTagName('locus')[0].textContent).toBe('Rom 1');
		expect(doc.getElementsByTagName('author')[0].textContent).toBe('Paul');
		expect(doc.getElementsByTagName('surrogates')[0].textContent).toBe('digital facsimile');
		expect(doc.getElementsByTagName('language')[0].getAttribute('ident')).toBe('la');
		expect(doc.getElementsByTagName('encodingDesc')[0].getAttribute('n')).toBe('1.6');
		expect(Array.from(doc.getElementsByTagName('witness')).map(node => node.getAttribute('xml:id'))).toEqual([
			'firsthand',
			'corrector',
		]);
		expect(doc.getElementsByTagName('change')[0].textContent).toBe('Initial import.');
	});

	it('rejects non-simple apparatus containers that are out of scope for transcription editing', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<app>
				<lem><w>alpha</w></lem>
				<rdgGrp type="split">
					<rdg hand="c1"><w>beta</w></rdg>
				</rdgGrp>
			</app>
		`);

		expect(() => parseTei(xml)).toThrow(/Only single-witness correction-style app\/rdg structures are supported/);
	});

	it('rejects listApp and noteGrp apparatus structures as out of scope', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<listApp type="editorial">
				<app type="variant">
					<lem wit="#A"><w>alpha</w></lem>
					<rdg hand="c1" wit="#B"><w>beta</w></rdg>
					<noteGrp>
						<note place="margin">see margin</note>
					</noteGrp>
				</app>
			</listApp>
		`);

		expect(() => parseTei(xml)).toThrow(/Multi-witness apparatus is out of scope/);
	});

	it('preserves empty single-witness alt readings from IGNTP-style apparatus', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<app>
				<rdg type="orig" hand="firsthand"><w>εν</w><w>ρωμη</w></rdg>
				<rdg type="alt" hand="corrector"/>
			</app>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const correctedText = lineContent.find(
			node => node.type === 'text' && node.marks?.some(mark => mark.type === 'correction'),
		);

		expect(correctedText).toBeTruthy();
		const correctionMark = correctedText!.marks!.find(mark => mark.type === 'correction')!;
		expect(correctionMark.attrs?.corrections).toEqual([
			{
				hand: 'corrector',
				content: [],
				readingAttrs: { type: 'alt' },
			},
		]);

		const exported = serializeTei(parseTei(xml));
		expect(compactXml(exported)).toContain(
			compactXml('<rdg type="alt" hand="corrector"></rdg>'),
		);
		expect(exported.match(/<rdg type="alt" hand="corrector">/g)).toHaveLength(2);
	});

	it('round-trips mixed corr and alt readings from 1739-style apparatus', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<app>
				<rdg type="orig" hand="firsthand"><w>και</w><w>ελπιζει</w></rdg>
				<rdg type="corr" hand="corrector"><w>και</w><w>υπομενει</w></rdg>
				<rdg type="alt" hand="corrector"><w>ελπιζει</w></rdg>
			</app>
		`);

		const exported = serializeTei(parseTei(xml));
		expect(compactXml(exported)).toContain(
			compactXml('<rdg type="corr" hand="corrector"><w>και</w><w>υπομενει</w></rdg>'),
		);
		expect(compactXml(exported)).toContain(
			compactXml('<rdg type="alt" hand="corrector"><w>ελπιζει</w></rdg>'),
		);
		expect(exported.match(/<app>/g)).toHaveLength(2);
	});

	it('preserves TEI, text, and body attrs plus ordered text-level resources and globals', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0" version="5.0" xml:id="doc1">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>Custom Title</title></titleStmt>
      <publicationStmt><p>published</p></publicationStmt>
      <sourceDesc><p>source</p></sourceDesc>
    </fileDesc>
  </teiHeader>
  <facsimile><surfaceGrp><surface xml:id="s1"/></surfaceGrp></facsimile>
  <text type="transcription" xml:lang="grc">
    <milestone unit="preface" n="p0"/>
    <front xml:id="front1"><head>Front Matter</head></front>
    <milestone unit="preface" n="p1"/>
    <body ana="#body-1"><pb n="1r"/><cb n="1"/><lb/><w>alpha</w></body>
    <milestone unit="appendix" n="p2"/>
    <back xml:id="back1"><p>Back Matter</p></back>
    <milestone unit="tail" n="p3"/>
  </text>
</TEI>`;

		const parsed = parseTei(xml);
		expect(parsed.teiAttrs).toMatchObject({ version: '5.0', 'xml:id': 'doc1' });
		expect(parsed.textAttrs).toMatchObject({ type: 'transcription', 'xml:lang': 'grc' });
		expect(parsed.bodyAttrs).toMatchObject({ ana: '#body-1' });
		expect(parsed.resourceNodes?.[0]?.tag).toBe('facsimile');
		expect(serializeTeiNodes(parsed.textLeading)).toEqual(['<milestone unit="preface" n="p0"/>']);
		expect(serializeTeiNodes(parsed.textBetweenFrontBody)).toEqual([
			'<milestone unit="preface" n="p1"/>',
		]);
		expect(serializeTeiNodes(parsed.textBetweenBodyBack)).toEqual([
			'<milestone unit="appendix" n="p2"/>',
		]);
		expect(serializeTeiNodes(parsed.textTrailing)).toEqual([
			'<milestone unit="tail" n="p3"/>',
		]);
		expect(serializeTeiNode(parsed.front!)).toContain('<front xml:id="front1">');
		expect(serializeTeiNode(parsed.back!)).toContain('<back xml:id="back1">');

		const exported = serializeTei(parsed);
		const doc = new DOMParser().parseFromString(exported, 'application/xml');
		const tei = doc.getElementsByTagName('TEI')[0];
		const text = doc.getElementsByTagName('text')[0];
		const body = doc.getElementsByTagName('body')[0];
		const front = doc.getElementsByTagName('front')[0];
		const back = doc.getElementsByTagName('back')[0];
		const facsimile = doc.getElementsByTagName('facsimile')[0];
		const milestones = Array.from(doc.getElementsByTagName('milestone'));

		expect(tei.getAttribute('version')).toBe('5.0');
		expect(tei.getAttribute('xml:id')).toBe('doc1');
		expect(text.getAttribute('type')).toBe('transcription');
		expect(text.getAttribute('xml:lang')).toBe('grc');
		expect(body.getAttribute('ana')).toBe('#body-1');
		expect(front.getAttribute('xml:id')).toBe('front1');
		expect(back.getAttribute('xml:id')).toBe('back1');
		expect(facsimile.getElementsByTagName('surface')[0].getAttribute('xml:id')).toBe('s1');
		expect(milestones.map(node => node.getAttribute('n'))).toEqual(['p0', 'p1', 'p2', 'p3']);
	});

	it('preserves modification and transposition families with flat spans and action atoms', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<w>a<mod type="add">b</mod><metamark function="transposition" target="#tr1">x</metamark>c</w>
			<undo target="#mod1"/>
			<redo target="#mod1"/>
			<retrace cert="low"><w>clarified</w></retrace>
			<substJoin target="#mod1 #mod2"/>
			<listTranspose>
				<transpose>
					<ptr target="#seg1"/>
					<ptr target="#seg2"/>
				</transpose>
			</listTranspose>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const editorialActions = lineContent.filter(node => node.type === 'editorialAction');
		const metamarkNode = lineContent.find(
			node =>
				node.type === 'text' &&
				node.text === 'x' &&
				node.marks?.some(mark => mark.type === 'teiSpan' && mark.attrs?.tag === 'metamark')
		);
		const modNode = lineContent.find(
			node =>
				node.type === 'text' &&
				node.text === 'b' &&
				node.marks?.some(mark => mark.type === 'teiSpan' && mark.attrs?.tag === 'mod')
		);
		const retraceNode = lineContent.find(
			node =>
				node.type === 'text' &&
				node.text === 'clarified' &&
				node.marks?.some(mark => mark.type === 'teiSpan' && mark.attrs?.tag === 'retrace')
		);

		expect(editorialActions.map(node => node.attrs?.tag)).toEqual([
			'undo',
			'redo',
			'substJoin',
			'listTranspose',
		]);
		expect(metamarkNode).toBeTruthy();
		expect(modNode).toBeTruthy();
		expect(retraceNode).toBeTruthy();
		expect(editorialActions[0].attrs?.structure).toMatchObject({
			kind: 'undo',
			targets: ['#mod1'],
		});
		expect(editorialActions[2].attrs?.structure).toMatchObject({
			kind: 'substJoin',
			targets: ['#mod1', '#mod2'],
		});
		expect(editorialActions[3].attrs?.structure).toMatchObject({
			kind: 'listTranspose',
			items: [{ kind: 'transpose', targets: ['#seg1', '#seg2'] }],
		});

		const exported = serializeTei(fromProseMirror(pm));
		expect(exported).toContain('<mod type="add">b</mod>');
		expect(exported).toContain('<metamark function="transposition" target="#tr1">x</metamark>');
		expect(exported).toContain('<undo target="#mod1"/>');
		expect(exported).toContain('<redo target="#mod1"/>');
		expect(exported).toContain('<retrace cert="low"><w>clarified</w></retrace>');
		expect(exported).toContain('<substJoin target="#mod1 #mod2"/>');
		expect(exported).toContain('<listTranspose>');
		expect(exported).toContain('<transpose>');
	});

	it('preserves empty flat-span editorial elements instead of dropping them', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<metamark function="insertion" target="#mod1"/>
			<w>alpha</w>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const metamarkNode = lineContent.find(
			node =>
				node.type === 'metamark' &&
				node.attrs?.teiAttrs?.function === 'insertion'
		);

		expect(metamarkNode).toBeTruthy();
		expect(metamarkNode?.attrs?.teiAttrs).toMatchObject({
			function: 'insertion',
			target: '#mod1',
		});

		const exported = serializeTei(fromProseMirror(pm));
		expect(exported).toContain('<metamark function="insertion" target="#mod1"/>');
	});

	it('preserves empty word-inline metamark atoms inside a word', () => {
		const xml = wrapInTei(`
			<pb n="1r"/>
			<cb n="1"/>
			<lb/>
			<w>a<metamark function="insertion" target="#mod1"/>b</w>
		`);

		const pm = toProseMirror(parseTei(xml));
		const lineContent = pm.content![0].content![0].content![0].content!;
		const metamarkNode = lineContent.find(
			node =>
				node.type === 'metamark' &&
				node.attrs?.wordInline === true
		);

		expect(metamarkNode).toBeTruthy();

		const exported = serializeTei(fromProseMirror(pm));
		expect(exported).toContain('<w>a<metamark function="insertion" target="#mod1"/>b</w>');
	});
});

describe('frame zones', () => {
	it('ignores formatting whitespace around inline page and column breaks inside a word', () => {
		const tei = wrapInTei(`
<pb n="58v" type="folio"/>
<cb n="P58vC1"/>
<lb/>
<ab>
	<w>δω
		<pb n="59r" type="folio" break="no"/>
		<cb n="P59rC1"/>
		<lb/>ρεαν</w>
</ab>
`);

		const doc = parseTei(tei);
		expect(doc.pages).toHaveLength(2);
		expect(doc.pages[1].id).toBe('59r');
		expect(doc.pages[1].columns).toHaveLength(1);
		expect(doc.pages[1].columns[0].lines).toHaveLength(1);
		expect(doc.pages[1].columns[0].lines[0].items).toMatchObject([
			{ type: 'text', text: 'ρεαν' },
		]);
	});

	it('parses cb type="frame" subtype into column zone', () => {
		const tei = wrapInTei(`
<pb n="1r" type="folio"/>
<cb n="1" type="frame" subtype="center"/>
<lb/><ab n="1.1"><w>λογος</w></ab>
<cb n="2" type="frame" subtype="top"/>
<lb/><ab><w>commentary</w></ab>
`);
		const doc = parseTei(tei);
		expect(doc.pages).toHaveLength(1);
		expect(doc.pages[0].columns).toHaveLength(2);
		expect(doc.pages[0].columns[0].zone).toBe('center');
		expect(doc.pages[0].columns[1].zone).toBe('top');
	});

	it('does not set zone for non-frame cb types', () => {
		const tei = wrapInTei(`
<pb n="1r" type="folio"/>
<cb n="1"/>
<lb/><ab><w>text</w></ab>
<cb n="2" type="other" subtype="center"/>
<lb/><ab><w>more</w></ab>
`);
		const doc = parseTei(tei);
		expect(doc.pages[0].columns[0].zone).toBeUndefined();
		expect(doc.pages[0].columns[1].zone).toBeUndefined();
	});

	it('round-trips frame zones through parse → PM → serialize', () => {
		const tei = wrapInTei(`
<pb n="1r" type="folio"/>
<cb n="1" type="frame" subtype="top"/>
<lb/><ab><w>top</w></ab>
<cb n="2" type="frame" subtype="left"/>
<lb/><ab><w>left</w></ab>
<cb n="3" type="frame" subtype="center"/>
<lb/><ab><w>center</w></ab>
<cb n="4" type="frame" subtype="right"/>
<lb/><ab><w>right</w></ab>
<cb n="5" type="frame" subtype="bottom"/>
<lb/><ab><w>bottom</w></ab>
`);
		const doc = parseTei(tei);
		const pm = toProseMirror(doc);

		// Verify PM columns have zone attrs
		const columns = pm.content![0].content!;
		expect(columns[0].attrs?.zone).toBe('top');
		expect(columns[1].attrs?.zone).toBe('left');
		expect(columns[2].attrs?.zone).toBe('center');
		expect(columns[3].attrs?.zone).toBe('right');
		expect(columns[4].attrs?.zone).toBe('bottom');

		// Round-trip back to document
		const roundTripped = fromProseMirror(pm);
		expect(roundTripped.pages[0].columns[0].zone).toBe('top');
		expect(roundTripped.pages[0].columns[2].zone).toBe('center');
		expect(roundTripped.pages[0].columns[4].zone).toBe('bottom');

		// Serialize and verify TEI output
		const exported = serializeTei(roundTripped);
		expect(exported).toContain('type="frame" subtype="top"');
		expect(exported).toContain('type="frame" subtype="center"');
		expect(exported).toContain('type="frame" subtype="bottom"');
	});

	it('handles partial frame layouts (center + top only)', () => {
		const tei = wrapInTei(`
<pb n="1r" type="folio"/>
<cb n="1" type="frame" subtype="center"/>
<lb/><ab><w>text</w></ab>
<cb n="2" type="frame" subtype="top"/>
<lb/><ab><w>note</w></ab>
`);
		const doc = parseTei(tei);
		expect(doc.pages[0].columns).toHaveLength(2);
		expect(doc.pages[0].columns[0].zone).toBe('center');
		expect(doc.pages[0].columns[1].zone).toBe('top');

		const exported = serializeTei(doc);
		expect(exported).toContain('type="frame" subtype="center"');
		expect(exported).toContain('type="frame" subtype="top"');
		expect(exported).not.toContain('subtype="left"');
	});

	it('does not emit type/subtype on cb for columns without zone', () => {
		const tei = wrapInTei(`
<pb n="1r" type="folio"/>
<cb n="1"/>
<lb/><ab><w>text</w></ab>
`);
		const doc = parseTei(tei);
		const exported = serializeTei(doc);
		expect(exported).not.toContain('type="frame"');
		expect(exported).not.toContain('subtype=');
	});
});
