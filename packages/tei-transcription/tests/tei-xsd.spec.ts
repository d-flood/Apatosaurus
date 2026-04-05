import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	parseTei,
	serializeTei,
	fromProseMirror,
	toProseMirror,
	type ProseMirrorJSON,
} from '../src/index';
import { validateIgntpXsd } from '../../../test-support/validate-igntp-xsd';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

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

function compactXml(xml: string): string {
	return xml.replace(/\s+/g, '');
}

describe('IGNTP XSD validation', () => {
	it('validates exported TEI from a minimal prose mirror document', () => {
		const document = fromProseMirror(
			buildPmDocument([
				{ type: 'text', text: 'alpha' },
				{ type: 'text', text: ' ' },
				{ type: 'text', text: 'beta' },
			]),
		);
		const xml = serializeTei(document);

		expect(() => validateIgntpXsd(xml)).not.toThrow();
	});

	it('validates exported TEI with flat space nodes and marked word segments', () => {
		const document = fromProseMirror(
			buildPmDocument([
				{ type: 'text', text: 'a' },
				{
					type: 'text',
					text: 'b',
					marks: [{ type: 'damage', attrs: { teiAttrs: { agent: 'smudge', degree: 'low' } } }],
				},
				{
					type: 'text',
					text: 'c',
					marks: [{ type: 'surplus', attrs: { teiAttrs: { reason: 'dittography' } } }],
				},
				{
					type: 'text',
					text: 'd',
					marks: [{ type: 'secl', attrs: { teiAttrs: { reason: 'overlap' } } }],
				},
				{ type: 'space', attrs: { teiAttrs: { extent: '2', unit: 'chars', dim: 'horizontal' } } },
				{ type: 'text', text: 'next' },
			]),
		);
		const xml = serializeTei(document);

		expect(() => validateIgntpXsd(xml)).not.toThrow();
	});

	it('validates exported TEI with structural break attrs and generic hi marks', () => {
		const document = fromProseMirror({
			type: 'manuscript',
			content: [
				{
					type: 'page',
					attrs: { pageName: 'P261r', teiAttrs: { n: 'P261r', type: 'folio' } },
					content: [
						{
							type: 'column',
							attrs: { columnNumber: 1, teiAttrs: { n: 'P261rC1' } },
							content: [
								{
									type: 'line',
									attrs: {
										lineNumber: 1,
										'paragraph-start': true,
										teiAttrs: { n: 'P261rC1L-01', rend: 'hang' },
									},
									content: [
										{
											type: 'text',
											text: 'abc',
											marks: [{ type: 'hi', attrs: { teiAttrs: { rend: 'overline', height: '2' } } }],
										},
									],
								},
							],
						},
					],
				},
			],
		});
		const xml = serializeTei(document);

		expect(() => validateIgntpXsd(xml)).not.toThrow();
	});

	it('validates exported TEI with word and punctuation attrs preserved on marks', () => {
		const document = fromProseMirror(
			buildPmDocument([
				{
					type: 'text',
					text: 'λογος',
					marks: [
						{
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
						},
					],
				},
				{
					type: 'text',
					text: '.',
					marks: [
						{
							type: 'punctuation',
							attrs: { teiAttrs: { force: 'strong', unit: 'sentence', pre: 'false' } },
						},
					],
				},
			]),
		);
		const xml = serializeTei(document);

		expect(() => validateIgntpXsd(xml)).not.toThrow();
	});

	it('validates exported TEI with handShift and generic milestone atoms', () => {
		const document = fromProseMirror(
			buildPmDocument([
				{ type: 'text', text: 'alpha' },
				{ type: 'handShift', attrs: { teiAttrs: { new: 's2', medium: 'ink' } } },
				{ type: 'teiMilestone', attrs: { teiAttrs: { unit: 'section', n: 'A', ed: 'NA28' } } },
				{ type: 'text', text: 'beta' },
			]),
		);
		const xml = serializeTei(document);

		expect(() => validateIgntpXsd(xml)).not.toThrow();
	});

	it('validates exported TEI with supplied attrs and flat phrase-like span marks', () => {
		const document = fromProseMirror(
			buildPmDocument([
				{
					type: 'text',
					text: 'ab',
					marks: [
						{
							type: 'lacunose',
							attrs: { teiAttrs: { source: '#ed1', reason: 'lost-folio', cert: 'low' } },
						},
						{
							type: 'teiSpan',
							attrs: { tag: 'foreign', teiAttrs: { 'xml:lang': 'la' } },
						},
					],
				},
				{
					type: 'text',
					text: 'c',
					marks: [{ type: 'unclear', attrs: { teiAttrs: { cert: 'medium' } } }],
				},
			]),
		);
		const xml = serializeTei(document);

		expect(() => validateIgntpXsd(xml)).not.toThrow();
	});

	it('validates exported TEI with additional schema phrase-like span marks', () => {
		const document = fromProseMirror(
			buildPmDocument([
				{
					type: 'text',
					text: 'cd',
					marks: [{ type: 'teiSpan', attrs: { tag: 'gloss', teiAttrs: { 'xml:lang': 'en' } } }],
				},
				{ type: 'text', text: ' ' },
				{
					type: 'text',
					text: 'ef',
					marks: [{ type: 'teiSpan', attrs: { tag: 'placeName', teiAttrs: { ref: '#rome' } } }],
				},
				{ type: 'text', text: ' ' },
				{
					type: 'text',
					text: 'gh',
					marks: [{ type: 'teiSpan', attrs: { tag: 'objectName', teiAttrs: { type: 'codex' } } }],
				},
				{ type: 'text', text: ' ' },
				{
					type: 'text',
					text: 'ij',
					marks: [{ type: 'teiSpan', attrs: { tag: 'title', teiAttrs: { type: 'short' } } }],
				},
			]),
		);
		const xml = serializeTei(document);

		expect(() => validateIgntpXsd(xml)).not.toThrow();
	});

	it('validates exported TEI with multi-word whole-token wrapper spans', () => {
		const document = fromProseMirror(
			buildPmDocument([
				{
					type: 'text',
					text: 'ab',
					marks: [{ type: 'teiSpan', attrs: { tag: 'foreign', teiAttrs: { 'xml:lang': 'la' } } }],
				},
				{ type: 'text', text: ' ' },
				{
					type: 'text',
					text: 'cd',
					marks: [{ type: 'teiSpan', attrs: { tag: 'foreign', teiAttrs: { 'xml:lang': 'la' } } }],
				},
			]),
		);
		const xml = serializeTei(document);

		expect(xml).toContain('<foreign xml:lang="la"><w>ab</w><w>cd</w></foreign>');
		expect(() => validateIgntpXsd(xml)).not.toThrow();
	});

	it('validates exported TEI with structured non-flat wrapper carriers', () => {
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
    <body><pb n="1r"/><cb n="1"/><lb/><foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign></body>
  </text>
</TEI>`;
		const document = fromProseMirror(toProseMirror(parseTei(xml)));
		const exported = serializeTei(document);

		expect(exported).toContain('<foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign>');
		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('validates exported TEI with structured wrapper carriers inside corrections and fw', () => {
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
    <body>
      <pb n="1r"/><cb n="1"/><lb/>
      <app>
        <rdg type="orig" hand="firsthand"><w>alpha</w></rdg>
        <rdg type="corr" hand="corrector"><foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign></rdg>
      </app>
      <seg type="margin"><fw type="header"><foreign xml:lang="la"><w>ef<lb break="no"/>gh</w></foreign></fw></seg>
    </body>
  </text>
</TEI>`;
		const document = fromProseMirror(toProseMirror(parseTei(xml)));
		const exported = serializeTei(document);

		expect(compactXml(exported)).toContain(
			compactXml(
				'<rdg type="corr" hand="corrector"><foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign></rdg>'
			)
		);
		expect(compactXml(exported)).toContain(
			compactXml(
				'<fw type="header"><foreign xml:lang="la"><w>ef<lb break="no"/>gh</w></foreign></fw>'
			)
		);
		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('validates exported TEI with marginalia line and column breaks plus correction marks', () => {
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
    <body>
      <pb n="1r"/><cb n="1"/><lb/>
      <seg type="margin" subtype="lineright">
        <fw place="margin right">
          <app>
            <rdg type="orig" hand="firsthand"><w>alpha</w></rdg>
            <rdg type="corr" hand="corrector2"><w>beta</w></rdg>
          </app>
          <cb n="2"/>
          <lb n="1" break="no"/>
          <w>gamma</w>
        </fw>
      </seg>
    </body>
  </text>
</TEI>`;
		const document = fromProseMirror(toProseMirror(parseTei(xml)));
		const exported = serializeTei(document);

		expect(compactXml(exported)).toContain(
			compactXml(
				'<fw place="margin right"><app><rdg type="orig"><w>alpha</w></rdg><rdg type="corr" hand="corrector2"><w>beta</w></rdg></app><cb n="2"/><lb n="1" break="no"/><w>gamma</w></fw>'
			)
		);
		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('validates exported TEI with recognized flat TEI atoms', () => {
		const document = fromProseMirror(
			buildPmDocument([
				{
					type: 'teiAtom',
					attrs: {
						tag: 'gb',
						summary: 'gb:g1',
						teiNode: { type: 'element', tag: 'gb', attrs: { n: 'g1' } },
						teiAttrs: { n: 'g1' },
					},
				},
				{
					type: 'teiAtom',
					attrs: {
						tag: 'ptr',
						summary: '#target1',
						teiNode: {
							type: 'element',
							tag: 'ptr',
							attrs: { target: '#target1', type: 'crossref' },
						},
						teiAttrs: { target: '#target1', type: 'crossref' },
					},
				},
				{
					type: 'teiAtom',
					attrs: {
						tag: 'media',
						summary: 'image/png',
						teiNode: {
							type: 'element',
							tag: 'media',
							attrs: { mimeType: 'image/png', url: 'https://example.com/image.png' },
						},
						teiAttrs: { mimeType: 'image/png', url: 'https://example.com/image.png' },
					},
				},
				{
					type: 'teiAtom',
					attrs: {
						tag: 'note',
						summary: 'note:see note',
						teiNode: {
							type: 'element',
							tag: 'note',
							attrs: { place: 'margin' },
							children: [{ type: 'text', text: 'see note' }],
						},
						teiAttrs: { place: 'margin' },
						text: 'see note',
					},
				},
				{
					type: 'teiAtom',
					attrs: {
						tag: 'ellipsis',
						summary: 'ellipsis:ab',
						teiNode: {
							type: 'element',
							tag: 'ellipsis',
							attrs: { unit: 'chars', quantity: '2' },
							children: [
								{
									type: 'element',
									tag: 'metamark',
									attrs: { function: 'omission' },
								},
								{
									type: 'element',
									tag: 'supplied',
									attrs: { reason: 'lost-folio' },
									children: [{ type: 'text', text: 'ab' }],
								},
							],
						},
						teiAttrs: { unit: 'chars', quantity: '2' },
						text: 'ab',
					},
				},
			]),
		);
		const xml = serializeTei(document);

		expect(() => validateIgntpXsd(xml)).not.toThrow();
	});

	it('validates generated headers with typed manuscript description content', () => {
		const document = fromProseMirror(buildPmDocument([{ type: 'text', text: 'alpha' }]));
		document.teiHeader = undefined;
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
			encodingVersion: '1.6',
			revisionChanges: [{ n: '1', when: '2024-01-02', text: 'Initial import.' }],
			publicationDate: '2024-01-03',
		};

		const xml = serializeTei(document);

		expect(() => validateIgntpXsd(xml)).not.toThrow();
	});

	it('validates exported TEI with flat modification spans and editorial action atoms', () => {
		const document = fromProseMirror(
			buildPmDocument([
				{ type: 'text', text: 'a' },
				{
					type: 'text',
					text: 'b',
					marks: [{ type: 'teiSpan', attrs: { tag: 'mod', teiAttrs: { type: 'add' } } }],
				},
				{ type: 'text', text: 'c' },
				{
					type: 'editorialAction',
					attrs: {
						tag: 'undo',
						summary: 'undo: #mod1',
						structure: { kind: 'undo', targets: ['#mod1'] },
					},
				},
				{
					type: 'editorialAction',
					attrs: {
						tag: 'listTranspose',
						summary: 'listTranspose (1 entries)',
						structure: {
							kind: 'listTranspose',
							items: [{ kind: 'transpose', targets: ['#seg1', '#seg2'] }],
						},
					},
				},
			]),
		);
		const xml = serializeTei(document);

		expect(() => validateIgntpXsd(xml)).not.toThrow();
	});

	it('validates round-tripped TEI with preserved header and unsupported inline markup', () => {
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
    <body><pb n="1r"/><cb n="1"/><lb/><w>a<gb n="g1"/>d</w></body>
    <back><p>Back Matter</p></back>
  </text>
</TEI>`;
		const exported = serializeTei(parseTei(xml));

		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('rejects non-simple apparatus that is out of scope for transcription editing', () => {
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
    <body>
      <pb n="1r"/><cb n="1"/><lb/>
      <app>
        <lem><w>alpha</w></lem>
        <rdgGrp type="split"><rdg hand="c1"><w>beta</w></rdg></rdgGrp>
      </app>
    </body>
  </text>
</TEI>`;
		expect(() => parseTei(xml)).toThrow(/Only single-witness correction-style app\/rdg structures are supported/);
	});

	it('rejects listApp and noteGrp apparatus that belong to a broader apparatus workflow', () => {
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
    <body>
      <pb n="1r"/><cb n="1"/><lb/>
      <listApp type="editorial">
        <app type="variant" loc="Rom1.1">
          <lem wit="#A"><w>alpha</w></lem>
          <rdg hand="c1" wit="#B"><w>beta</w></rdg>
          <noteGrp>
            <note place="margin">see margin</note>
          </noteGrp>
        </app>
      </listApp>
    </body>
  </text>
</TEI>`;
		expect(() => parseTei(xml)).toThrow(/Multi-witness apparatus is out of scope/);
	});

	it('validates round-tripped TEI with preserved root/text/body attrs and ordered text globals', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0" version="5.0" xml:id="doc1">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>Custom Title</title></titleStmt>
      <publicationStmt><p>published</p></publicationStmt>
      <sourceDesc><p>source</p></sourceDesc>
    </fileDesc>
  </teiHeader>
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
		const exported = serializeTei(parseTei(xml));

		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('validates round-tripped TEI with preserved header and resource families outside the typed AST', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title>Preserved Title</title>
        <funder>IGNTP</funder>
        <sponsor><name type="org">ITSEE</name></sponsor>
      </titleStmt>
      <editionStmt>
        <edition n="1.0">Edition text <date when-iso="2024-01-01">2024</date></edition>
      </editionStmt>
      <publicationStmt>
        <publisher><name type="org">IGNTP</name></publisher>
        <availability><licence target="https://example.org/licence">CC BY</licence></availability>
      </publicationStmt>
      <notesStmt><note type="editorial">header note</note></notesStmt>
      <sourceDesc>
        <msDesc>
          <msIdentifier>
            <country>United Kingdom</country>
            <settlement>London</settlement>
            <repository>British Library</repository>
            <idno>MS 1</idno>
            <altIdentifier type="former"><idno>Alt 1</idno><note>old shelfmark</note></altIdentifier>
          </msIdentifier>
          <physDesc>
            <decoDesc><decoNote type="ink">red initials</decoNote></decoDesc>
          </physDesc>
          <additional><listBibl><bibl>Catalogue entry</bibl></listBibl></additional>
          <msPart xml:id="part1">
            <msIdentifier><idno>Part 1</idno></msIdentifier>
            <history><origin>rebound</origin></history>
          </msPart>
        </msDesc>
      </sourceDesc>
    </fileDesc>
    <encodingDesc><schemaRef key="igntp" url="https://example.org/schema"/></encodingDesc>
  </teiHeader>
  <facsimile><media mimeType="image/jpeg" url="https://example.org/facsimile.jpg"/></facsimile>
  <standOff><listRelation><p>related witnesses</p></listRelation></standOff>
  <sourceDoc><media mimeType="image/jpeg" url="https://example.org/source.jpg"/></sourceDoc>
  <text>
    <front><p>Front Matter</p></front>
    <body><pb n="1r"/><cb n="1"/><lb/><w>alpha</w></body>
    <back><p>Back Matter</p></back>
  </text>
</TEI>`;
		const exported = serializeTei(parseTei(xml));

		expect(exported).toContain('<funder>IGNTP</funder>');
		expect(exported).toContain('<notesStmt><note type="editorial">header note</note></notesStmt>');
		expect(exported).toContain('<altIdentifier type="former"><idno>Alt 1</idno><note>old shelfmark</note></altIdentifier>');
		expect(exported).toContain('<decoDesc><decoNote type="ink">red initials</decoNote></decoDesc>');
		expect(exported).toContain('<facsimile><media mimeType="image/jpeg" url="https://example.org/facsimile.jpg"/></facsimile>');
		expect(exported).toContain('<standOff><listRelation><p>related witnesses</p></listRelation></standOff>');
		expect(exported).toContain('<sourceDoc><media mimeType="image/jpeg" url="https://example.org/source.jpg"/></sourceDoc>');
		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('validates round-tripped TEI with preserved modification and transposition families', () => {
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
    <body>
      <pb n="1r"/><cb n="1"/><lb/>
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
    </body>
  </text>
</TEI>`;
		const exported = serializeTei(parseTei(xml));

		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('validates round-tripped TEI with empty metamark preservation', () => {
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
    <body>
      <pb n="1r"/><cb n="1"/><lb/>
      <metamark function="insertion" target="#mod1"/>
      <w>alpha</w>
    </body>
  </text>
</TEI>`;
		const exported = serializeTei(parseTei(xml));

		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('validates round-tripped TEI with empty word-inline metamark preservation', () => {
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
    <body>
      <pb n="1r"/><cb n="1"/><lb/>
      <w>a<metamark function="insertion" target="#mod1"/>b</w>
    </body>
  </text>
</TEI>`;
		const exported = serializeTei(parseTei(xml));

		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('validates the round-tripped 01 Romans fixture against the IGNTP XSD', () => {
		const xml = readFileSync(
			join(repoRoot, 'app', 'src', 'lib', 'tei', 'NT_GRC_01_Rom.xml'),
			'utf8',
		);
		const exported = serializeTei(parseTei(xml));

		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('validates the round-tripped 1739 Romans IGNTP fixture with alt apparatus against the IGNTP XSD', () => {
		const xml = readFileSync(
			join(
				repoRoot,
				'app',
				'static',
				'igntp',
				'Romans_Greek_transcriptions',
				'NT_GRC_1739_Rom.xml',
			),
			'utf8',
		);
		const exported = serializeTei(parseTei(xml));

		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('validates the round-tripped 06 Romans IGNTP fixture with correction-local formwork against the IGNTP XSD', () => {
		const xml = readFileSync(
			join(
				repoRoot,
				'app',
				'static',
				'igntp',
				'Romans_Greek_transcriptions',
				'NT_GRC_06_Rom.xml',
			),
			'utf8',
		);
		const exported = serializeTei(parseTei(xml));

		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('validates the round-tripped 104 Romans IGNTP fixture with surplus-wrapped apparatus against the IGNTP XSD', () => {
		const xml = readFileSync(
			join(
				repoRoot,
				'app',
				'static',
				'igntp',
				'Romans_Greek_transcriptions',
				'NT_GRC_104_Rom.xml',
			),
			'utf8',
		);
		const exported = serializeTei(parseTei(xml));

		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('validates the round-tripped 1319 Romans IGNTP fixture with page breaks inside apparatus against the IGNTP XSD', () => {
		const xml = readFileSync(
			join(
				repoRoot,
				'app',
				'static',
				'igntp',
				'Romans_Greek_transcriptions',
				'NT_GRC_1319_Rom.xml',
			),
			'utf8',
		);
		const exported = serializeTei(parseTei(xml));

		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});

	it('validates the round-tripped 1969 Romans IGNTP fixture with nested interjection surplus against the IGNTP XSD', () => {
		const xml = readFileSync(
			join(
				repoRoot,
				'app',
				'static',
				'igntp',
				'Romans_Greek_transcriptions',
				'NT_GRC_1969_Rom.xml',
			),
			'utf8',
		);
		const exported = serializeTei(parseTei(xml));

		expect(() => validateIgntpXsd(exported)).not.toThrow();
	});
});
