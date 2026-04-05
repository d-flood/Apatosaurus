import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';

import { serializeTeiNode, serializeTeiNodes } from '@apatopwa/tei-transcription';
import { importTEI, importTEIDocument } from './tei-importer';

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

function wrapInTEI(bodyContent: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
	<teiHeader></teiHeader>
	<text><body>${bodyContent}</body></text>
</TEI>`;
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

describe('TEI importer wrapper', () => {
	it('imports structural page, column, and line nodes', () => {
		const result = importTEI(wrapInTEI('<pb n="1r"/><cb n="1"/><lb/><w>hello</w>'));

		expect(result.type).toBe('manuscript');
		expect(result.content).toHaveLength(1);
		expect(result.content![0]).toMatchObject({
			type: 'page',
			attrs: { pageName: '1r' },
		});
		expect(result.content![0].content![0]).toMatchObject({
			type: 'column',
			attrs: { columnNumber: 1 },
		});
		expect(result.content![0].content![0].content![0]).toMatchObject({
			type: 'line',
			attrs: { lineNumber: 1 },
		});
	});

	it('keeps mixed markup inside one word without adding spaces between letters', () => {
		const result = importTEI(
			wrapInTEI('<pb n="1r"/><cb n="1"/><lb/><w>ab<unclear>c</unclear>de</w><w>next</w>')
		);

		const line = result.content![0].content![0].content![0];
		const textNodes = line.content!.filter(node => node.type === 'text');
		expect(textNodes.map(node => node.text)).toEqual(['ab', 'c', 'de', ' ', 'next']);
	});

	it('preserves wrapped words across lines without inserting a boundary', () => {
		const result = importTEI(
			wrapInTEI('<pb n="1r"/><cb n="1"/><lb/><w>part1<lb break="no"/>part2</w>')
		);

		const column = result.content![0].content![0];
		expect(column.content).toHaveLength(2);
		expect(column.content![0].attrs?.wrapped).toBeUndefined();
		expect(column.content![1].attrs?.wrapped).toBe(true);
		expect(column.content![0].content![0].text).toBe('part1');
		expect(column.content![1].content![0].text).toBe('part2');
	});

	it('keeps apparatus words separated without adding an extra trailing space node', () => {
		const result = importTEI(
			wrapInTEI(`
				<pb n="1r"/><cb n="1"/><lb/>
				<app>
					<rdg type="orig" hand="firsthand"><w>word1</w><w>word2</w></rdg>
					<rdg type="corr" hand="corrector"><w>fixed</w></rdg>
				</app><w>after</w>
			`)
		);

		const line = result.content![0].content![0].content![0];
		const textNodes = line.content!.filter(node => node.type === 'text');
		expect(textNodes.map(node => node.text)).toEqual(['word1', ' ', 'word2', ' ', 'after']);
	});

	it('imports schema-level fw attrs and wrapping seg attrs onto the fw carrier', () => {
		const result = importTEI(
			wrapInTEI(`
				<pb n="1r"/><cb n="1"/><lb/>
				<seg type="margin" subtype="pagetop" place="top" n="@P1" rend="boxed">
					<fw xml:id="fw-1" n="fw.1" type="pageNum" subtype="folio" place="top" hand="#corrector1" rend="center">
						<w>ιβ</w>
					</fw>
				</seg>
			`)
		);

		const line = result.content![0].content![0].content![0];
		const fw = line.content!.find(node => node.type === 'fw')!;

		expect(fw.attrs).toMatchObject({
			type: 'pageNum',
			subtype: 'folio',
			place: 'top',
			hand: '#corrector1',
			n: 'fw.1',
			rend: 'center',
			segType: 'margin',
			segSubtype: 'pagetop',
			segPlace: 'top',
			segN: '@P1',
			segRend: 'boxed',
		});
		expect(fw.attrs?.teiAttrs).toMatchObject({ 'xml:id': 'fw-1', type: 'pageNum' });
		expect(fw.attrs?.segAttrs).toMatchObject({ type: 'margin', subtype: 'pagetop' });
	});

	it('imports canonical document-level TEI attrs and preserved text globals', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0" version="5.0" xml:id="doc1">
	<teiHeader></teiHeader>
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

		const document = importTEIDocument(xml);

		expect(document.teiAttrs).toMatchObject({ version: '5.0', 'xml:id': 'doc1' });
		expect(document.textAttrs).toMatchObject({ type: 'transcription', 'xml:lang': 'grc' });
		expect(document.bodyAttrs).toMatchObject({ ana: '#body-1' });
		expect(serializeTeiNodes(document.textLeading)).toEqual(['<milestone unit="preface" n="p0"/>']);
		expect(serializeTeiNodes(document.textBetweenFrontBody)).toEqual([
			'<milestone unit="preface" n="p1"/>',
		]);
		expect(serializeTeiNodes(document.textBetweenBodyBack)).toEqual([
			'<milestone unit="appendix" n="p2"/>',
		]);
		expect(serializeTeiNodes(document.textTrailing)).toEqual([
			'<milestone unit="tail" n="p3"/>',
		]);
		expect(serializeTeiNode(document.front!)).toContain('<front xml:id="front1">');
		expect(serializeTeiNode(document.back!)).toContain('<back xml:id="back1">');
	});

	it('imports typed header metadata onto the canonical document', () => {
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
		<revisionDesc><change n="1" when="2020-10-15">Imported.</change></revisionDesc>
	</teiHeader>
	<text xml:lang="grc"><body><pb n="1r"/><cb n="1"/><lb/><w>alpha</w></body></text>
</TEI>`;

		const document = importTEIDocument(xml);

		expect(document.metadata).toEqual({
			title: 'A transcription of Romans in 01',
			transcriber: 'members of the INTF',
			date: '2020-10-15',
			repository: 'British Library',
			settlement: 'London',
			idno: 'MS Add. 43725',
			language: 'grc',
		});
		expect(document.header).toEqual({
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
			encoding: {
				version: '1.6',
			},
			encodingVersion: '1.6',
			revisionChanges: [{ n: '1', when: '2020-10-15', text: 'Imported.' }],
		});
	});

	it('imports supplied attrs and flat phrase-like inline spans as visible marks', () => {
		const result = importTEI(
			wrapInTEI(
				'<pb n="1r"/><cb n="1"/><lb/><w><supplied source="#ed1" reason="lost-folio">ab</supplied></w><foreign xml:lang="la"><w>cd</w></foreign>'
			)
		);

		const line = result.content![0].content![0].content![0];
		const textNodes = line.content!.filter(node => node.type === 'text');
		const suppliedNode = textNodes.find(node => node.text === 'ab');
		const foreignNode = textNodes.find(node => node.text === 'cd');

		expect(suppliedNode).toMatchObject({
			type: 'text',
			text: 'ab',
			marks: [{ type: 'lacunose', attrs: { teiAttrs: { source: '#ed1', reason: 'lost-folio' } } }],
		});
		expect(foreignNode).toMatchObject({
			type: 'text',
			text: 'cd',
			marks: [{ type: 'teiSpan', attrs: { tag: 'foreign', teiAttrs: { 'xml:lang': 'la' } } }],
		});
	});

	it('imports additional schema phrase-like inline spans as visible marks', () => {
		const result = importTEI(
			wrapInTEI(
				'<pb n="1r"/><cb n="1"/><lb/><gloss xml:lang="en"><w>cd</w></gloss><placeName ref="#rome"><w>ef</w></placeName><objectName type="codex"><w>gh</w></objectName><title type="short"><w>ij</w></title>'
			)
		);

		const line = result.content![0].content![0].content![0];
		const textNodes = line.content!.filter(node => node.type === 'text');
		const glossNode = textNodes.find(node => node.text === 'cd');
		const placeNode = textNodes.find(node => node.text === 'ef');
		const objectNode = textNodes.find(node => node.text === 'gh');
		const titleNode = textNodes.find(node => node.text === 'ij');

		expect(glossNode).toMatchObject({
			type: 'text',
			text: 'cd',
			marks: [{ type: 'teiSpan', attrs: { tag: 'gloss', teiAttrs: { 'xml:lang': 'en' } } }],
		});
		expect(placeNode).toMatchObject({
			type: 'text',
			text: 'ef',
			marks: [{ type: 'teiSpan', attrs: { tag: 'placeName', teiAttrs: { ref: '#rome' } } }],
		});
		expect(objectNode).toMatchObject({
			type: 'text',
			text: 'gh',
			marks: [{ type: 'teiSpan', attrs: { tag: 'objectName', teiAttrs: { type: 'codex' } } }],
		});
		expect(titleNode).toMatchObject({
			type: 'text',
			text: 'ij',
			marks: [{ type: 'teiSpan', attrs: { tag: 'title', teiAttrs: { type: 'short' } } }],
		});
	});

	it('imports multi-word whole-token wrappers as flat marks on each word', () => {
		const result = importTEI(
			wrapInTEI('<pb n="1r"/><cb n="1"/><lb/><foreign xml:lang="la"><w>ab</w><w>cd</w></foreign>')
		);

		const line = result.content![0].content![0].content![0];
		const markedWords = line.content!.filter(
			node =>
				node.type === 'text' &&
				(node.text === 'ab' || node.text === 'cd') &&
				node.marks?.some(mark => mark.type === 'teiSpan' && mark.attrs?.tag === 'foreign')
		);

		expect(markedWords).toHaveLength(2);
	});

	it('imports structurally non-flat phrase wrappers as dedicated carrier nodes', () => {
		const result = importTEI(
			wrapInTEI('<pb n="1r"/><cb n="1"/><lb/><foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign>')
		);

		const line = result.content![0].content![0].content![0];
		const wrapper = line.content!.find(node => node.type === 'teiWrapper');

		expect(wrapper).toMatchObject({
			type: 'teiWrapper',
			attrs: {
				tag: 'foreign',
				teiAttrs: { 'xml:lang': 'la' },
			},
		});
		expect(JSON.stringify(wrapper?.attrs?.children || [])).toContain('"tag":"lb"');
	});

	it('imports structured wrapper carriers inside correction and fw content', () => {
		const result = importTEI(
			wrapInTEI(`
				<pb n="1r"/><cb n="1"/><lb/>
				<app>
					<rdg type="orig" hand="firsthand"><w>alpha</w></rdg>
					<rdg type="corr" hand="corrector"><foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign></rdg>
				</app>
				<seg type="margin"><fw type="header"><foreign xml:lang="la"><w>ef<lb break="no"/>gh</w></foreign></fw></seg>
			`)
		);

		const line = result.content![0].content![0].content![0];
		const correctedText = line.content!.find(node => node.type === 'text' && node.text === 'alpha');
		const correctionWrapper = correctedText?.marks?.[0]?.attrs?.corrections?.[0]?.content?.find(
			(node: any) => node.type === 'teiWrapper'
		);
		const fwNode = line.content!.find(node => node.type === 'fw');
		const fwWrapper = getFormWorkInlineContent(fwNode).find((node: any) => node.type === 'teiWrapper');

		expect(correctionWrapper?.attrs?.tag).toBe('foreign');
		expect(fwWrapper?.attrs?.tag).toBe('foreign');
	});

	it('imports recognized TEI atoms as dedicated flat nodes', () => {
		const result = importTEI(
			wrapInTEI(`
				<pb n="1r"/><cb n="1"/><lb/>
				<gb n="g1"/>
				<ptr target="#target1" type="crossref"/>
				<media mimeType="image/png" url="https://example.com/image.png"/>
				<note place="margin">see note</note>
				<ellipsis unit="chars" quantity="2"><metamark function="omission"/><supplied reason="lost-folio">ab</supplied></ellipsis>
			`)
		);

		const line = result.content![0].content![0].content![0];
		const atoms = line.content!.filter(node => node.type === 'teiAtom');

		expect(atoms.map(node => node.attrs?.tag)).toEqual(['gb', 'ptr', 'media', 'note', 'ellipsis']);
		expect(atoms[3]?.attrs?.text).toBe('see note');
		expect(atoms[4]?.attrs?.teiAttrs).toEqual({ unit: 'chars', quantity: '2' });
	});

	it('rejects non-simple apparatus markup that is out of scope for transcription editing', () => {
		expect(() =>
			importTEI(
			wrapInTEI(`
				<pb n="1r"/><cb n="1"/><lb/>
				<app type="variant">
					<lem wit="#A"><w>alpha</w></lem>
					<rdgGrp type="split">
						<rdg hand="c1" wit="#B"><w>beta</w></rdg>
					</rdgGrp>
				</app>
			`)
			)
		).toThrow(/Only single-witness correction-style app\/rdg structures are supported/);
	});

	it('imports modification spans and editorial actions without collapsing them to opaque nodes', () => {
		const result = importTEI(
			wrapInTEI(`
				<pb n="1r"/><cb n="1"/><lb/>
				<w>a<mod type="add">b</mod>c</w>
				<undo target="#mod1"/>
				<listTranspose><transpose><ptr target="#seg1"/><ptr target="#seg2"/></transpose></listTranspose>
			`)
		);

		const line = result.content![0].content![0].content![0];
		const modNode = line.content!.find(
			node =>
				node.type === 'text' &&
				node.text === 'b' &&
				node.marks?.some(mark => mark.type === 'teiSpan' && mark.attrs?.tag === 'mod')
		);
		const actions = line.content!.filter(node => node.type === 'editorialAction');

		expect(modNode).toBeTruthy();
		expect(actions).toHaveLength(2);
		expect(actions[0]).toMatchObject({
			type: 'editorialAction',
			attrs: {
				tag: 'undo',
				structure: { kind: 'undo', targets: ['#mod1'] },
			},
		});
		expect(actions[1]).toMatchObject({
			type: 'editorialAction',
			attrs: {
				tag: 'listTranspose',
				structure: {
					kind: 'listTranspose',
					items: [{ kind: 'transpose', targets: ['#seg1', '#seg2'] }],
				},
			},
		});
	});

	it('imports standalone and word-inline metamark atoms', () => {
		const result = importTEI(
			wrapInTEI(`
				<pb n="1r"/><cb n="1"/><lb/>
				<metamark function="insertion" target="#mod1"/>
				<w>a<metamark function="insertion" target="#mod2"/>b</w>
			`)
		);

		const line = result.content![0].content![0].content![0];
		const metamarks = line.content!.filter(node => node.type === 'metamark');

		expect(metamarks).toHaveLength(2);
		expect(metamarks[0]).toMatchObject({
			type: 'metamark',
			attrs: {
				teiAttrs: { function: 'insertion', target: '#mod1' },
				wordInline: false,
			},
		});
		expect(metamarks[1]).toMatchObject({
			type: 'metamark',
			attrs: {
				teiAttrs: { function: 'insertion', target: '#mod2' },
				wordInline: true,
			},
		});
	});
});
