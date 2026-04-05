import { beforeAll, describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';

import { exportTEI, exportTEIDocument } from './tei-exporter';
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

function parseTEI(xml: string): Document {
	return new DOMParser().parseFromString(xml, 'application/xml');
}

function compactXml(xml: string): string {
	return xml.replace(/\s+/g, '');
}

describe('TEI exporter wrapper', () => {
	it('exports simple words as separate TEI words', () => {
		const pmJSON = {
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
									content: [
										{ type: 'text', text: 'hello' },
										{ type: 'text', text: ' ' },
										{ type: 'text', text: 'world' },
									],
								},
							],
						},
					],
				},
			],
		};

		const doc = parseTEI(exportTEI(pmJSON as any));
		const words = doc.getElementsByTagName('w');
		expect(words).toHaveLength(2);
		expect(words[0].textContent).toBe('hello');
		expect(words[1].textContent).toBe('world');
	});

	it('exports correction marks as apparatus readings', () => {
		const pmJSON = {
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
									content: [
										{
											type: 'text',
											text: 'original',
											marks: [
												{
													type: 'correction',
													attrs: {
														corrections: [
															{
																hand: 'corrector',
																content: [{ type: 'text', text: 'corrected' }],
															},
														],
													},
												},
											],
										},
									],
								},
							],
						},
					],
				},
			],
		};

		const doc = parseTEI(exportTEI(pmJSON as any));
		const rdgs = Array.from(doc.getElementsByTagName('rdg'));
		expect(rdgs).toHaveLength(2);
		const origText = rdgs.find(rdg => rdg.getAttribute('type') === 'orig')?.textContent || '';
		const corrText = rdgs.find(rdg => rdg.getAttribute('type') === 'corr')?.textContent || '';
		expect(origText.includes('original')).toBe(true);
		expect(corrText.includes('corrected')).toBe(true);
	});

	it('exports ligature content as <ex> and preserves the rend value on round-trip', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
	<teiHeader></teiHeader>
	<text><body><pb n="1r"/><cb n="1"/><lb/><w>προφητω<ex rend="‾">ν</ex></w></body></text>
</TEI>`;

		const doc = parseTEI(exportTEI(importTEI(xml) as any));
		const ex = doc.getElementsByTagName('ex')[0];
		expect(ex.getAttribute('rend')).toBe('‾');
		expect(ex.textContent).toBe('ν');
	});

	it('round-trips wrapped words across lines', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
	<teiHeader></teiHeader>
	<text><body><pb n="1r"/><cb n="1"/><lb/><w>part1<lb break="no"/>part2</w></body></text>
</TEI>`;

		const doc = parseTEI(exportTEI(importTEI(xml) as any));
		const lbs = doc.getElementsByTagName('lb');
		expect(lbs).toHaveLength(2);
		expect(lbs[1].getAttribute('break')).toBe('no');
	});

	it('round-trips schema-level fw attrs and wrapping seg attrs through the app wrapper', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
	<teiHeader></teiHeader>
	<text><body>
		<pb n="1r"/><cb n="1"/><lb/>
		<seg type="margin" subtype="pagetop" place="top" n="@P1" rend="boxed">
			<fw xml:id="fw-1" n="fw.1" type="pageNum" subtype="folio" place="top" hand="#corrector1" rend="center"><w>ιβ</w></fw>
		</seg>
		<w>text</w>
	</body></text>
</TEI>`;

		const doc = parseTEI(exportTEI(importTEI(xml) as any));
		const seg = doc.getElementsByTagName('seg')[0];
		const fw = doc.getElementsByTagName('fw')[0];

		expect(seg.getAttribute('place')).toBe('top');
		expect(seg.getAttribute('rend')).toBe('boxed');
		expect(fw.getAttribute('xml:id')).toBe('fw-1');
		expect(fw.getAttribute('type')).toBe('pageNum');
		expect(fw.getAttribute('subtype')).toBe('folio');
		expect(fw.getAttribute('place')).toBe('top');
		expect(fw.getAttribute('hand')).toBe('#corrector1');
	});

	it('exports canonical document-level attrs and preserved text globals', () => {
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
		const doc = parseTEI(exportTEIDocument(document));
		const tei = doc.getElementsByTagName('TEI')[0];
		const text = doc.getElementsByTagName('text')[0];
		const body = doc.getElementsByTagName('body')[0];
		const milestones = Array.from(doc.getElementsByTagName('milestone'));

		expect(tei.getAttribute('version')).toBe('5.0');
		expect(tei.getAttribute('xml:id')).toBe('doc1');
		expect(text.getAttribute('type')).toBe('transcription');
		expect(text.getAttribute('xml:lang')).toBe('grc');
		expect(body.getAttribute('ana')).toBe('#body-1');
		expect(doc.getElementsByTagName('front')[0].getAttribute('xml:id')).toBe('front1');
		expect(doc.getElementsByTagName('back')[0].getAttribute('xml:id')).toBe('back1');
		expect(milestones.map(node => node.getAttribute('n'))).toEqual(['p0', 'p1', 'p2', 'p3']);
	});

	it('uses canonical document metadata when exporting without an explicit teiHeader tree', () => {
		const document = importTEIDocument(
			`<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
	<teiHeader></teiHeader>
	<text><body><pb n="1r"/><cb n="1"/><lb/><w>alpha</w></body></text>
</TEI>`
		);
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

		const doc = parseTEI(exportTEIDocument(document));

		expect(Array.from(doc.getElementsByTagName('titleStmt')[0].getElementsByTagName('title')).map(node => node.textContent)).toEqual([
			'Generated Title',
			'Romans',
		]);
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

	it('round-trips preserved header and resource families through the document wrapper API', () => {
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
					<physDesc><decoDesc><decoNote type="ink">red initials</decoNote></decoDesc></physDesc>
					<additional><listBibl><bibl>Catalogue entry</bibl></listBibl></additional>
				</msDesc>
			</sourceDesc>
		</fileDesc>
		<encodingDesc><schemaRef key="igntp" url="https://example.org/schema"/></encodingDesc>
	</teiHeader>
	<facsimile><media mimeType="image/jpeg" url="https://example.org/facsimile.jpg"/></facsimile>
	<standOff><listRelation><p>related witnesses</p></listRelation></standOff>
	<sourceDoc><media mimeType="image/jpeg" url="https://example.org/source.jpg"/></sourceDoc>
	<text><body><pb n="1r"/><cb n="1"/><lb/><w>alpha</w></body></text>
</TEI>`;

		const document = importTEIDocument(xml);
		const exported = exportTEIDocument(document);

		expect(exported).toContain('<funder>IGNTP</funder>');
		expect(exported).toContain('<notesStmt><note type="editorial">header note</note></notesStmt>');
		expect(exported).toContain('<altIdentifier type="former"><idno>Alt 1</idno><note>old shelfmark</note></altIdentifier>');
		expect(exported).toContain('<decoDesc><decoNote type="ink">red initials</decoNote></decoDesc>');
		expect(exported).toContain('<facsimile><media mimeType="image/jpeg" url="https://example.org/facsimile.jpg"/></facsimile>');
		expect(exported).toContain('<standOff><listRelation><p>related witnesses</p></listRelation></standOff>');
		expect(exported).toContain('<sourceDoc><media mimeType="image/jpeg" url="https://example.org/source.jpg"/></sourceDoc>');
	});

	it('exports supplied attrs and flat phrase-like inline spans', () => {
		const pmJSON = {
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
									content: [
										{
											type: 'text',
											text: 'ab',
											marks: [
												{
													type: 'lacunose',
													attrs: { teiAttrs: { source: '#ed1', reason: 'lost-folio' } },
												},
											],
										},
										{ type: 'text', text: ' ' },
										{
											type: 'text',
											text: 'cd',
											marks: [
												{
													type: 'teiSpan',
													attrs: { tag: 'foreign', teiAttrs: { 'xml:lang': 'la' } },
												},
											],
										},
									],
								},
							],
						},
					],
				},
			],
		};

		const doc = parseTEI(exportTEI(pmJSON as any));
		const supplied = doc.getElementsByTagName('supplied')[0];
		const foreign = doc.getElementsByTagName('foreign')[0];

		expect(supplied.getAttribute('source')).toBe('#ed1');
		expect(supplied.getAttribute('reason')).toBe('lost-folio');
		expect(supplied.textContent).toBe('ab');
		expect(foreign.getAttribute('xml:lang')).toBe('la');
		expect(foreign.getElementsByTagName('w')[0].textContent).toBe('cd');
	});

	it('exports additional schema phrase-like inline spans', () => {
		const pmJSON = {
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
									content: [
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
									],
								},
							],
						},
					],
				},
			],
		};

		const doc = parseTEI(exportTEI(pmJSON as any));

		expect(doc.getElementsByTagName('gloss')[0].getAttribute('xml:lang')).toBe('en');
		expect(doc.getElementsByTagName('gloss')[0].getElementsByTagName('w')[0].textContent).toBe('cd');
		expect(doc.getElementsByTagName('placeName')[0].getAttribute('ref')).toBe('#rome');
		expect(doc.getElementsByTagName('placeName')[0].getElementsByTagName('w')[0].textContent).toBe('ef');
		expect(doc.getElementsByTagName('objectName')[0].getAttribute('type')).toBe('codex');
		expect(doc.getElementsByTagName('objectName')[0].getElementsByTagName('w')[0].textContent).toBe('gh');
		const bodyTitle = Array.from(doc.getElementsByTagName('title')).find(
			node => node.getAttribute('type') === 'short' && node.getElementsByTagName('w')[0]?.textContent === 'ij'
		);
		expect(bodyTitle).toBeTruthy();
	});

	it('exports multi-word whole-token wrappers as one outer element', () => {
		const pmJSON = {
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
									content: [
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
									],
								},
							],
						},
					],
				},
			],
		};

		const xml = exportTEI(pmJSON as any);
		expect(xml).toContain('<foreign xml:lang="la"><w>ab</w><w>cd</w></foreign>');
	});

	it('exports structured non-flat wrapper carriers back to their original TEI shape', () => {
		const pmJSON = {
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
									content: [
										{
											type: 'teiWrapper',
											attrs: {
												tag: 'foreign',
												summary: '<foreign> abcd',
												teiAttrs: { 'xml:lang': 'la' },
												children: [
													{
														type: 'element',
														tag: 'w',
														children: [
															{ type: 'text', text: 'ab' },
															{ type: 'element', tag: 'lb', attrs: { break: 'no' } },
															{ type: 'text', text: 'cd' },
														],
													},
												],
											},
										},
									],
								},
							],
						},
					],
				},
			],
		};

		const xml = exportTEI(pmJSON as any);
		expect(xml).toContain('<foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign>');
	});

	it('exports structured wrapper carriers inside correction and fw content', () => {
		const pmJSON = {
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
									content: [
										{
											type: 'text',
											text: 'alpha',
											marks: [
												{
													type: 'correction',
													attrs: {
														corrections: [
															{
																hand: 'corrector',
																content: [
																	{
																		type: 'teiWrapper',
																		attrs: {
																			tag: 'foreign',
																			summary: '<foreign> abcd',
																			teiAttrs: { 'xml:lang': 'la' },
																			children: [
																				{
																					type: 'element',
																					tag: 'w',
																					children: [
																						{ type: 'text', text: 'ab' },
																						{ type: 'element', tag: 'lb', attrs: { break: 'no' } },
																						{ type: 'text', text: 'cd' },
																					],
																				},
																			],
																		},
																	},
																],
															},
														],
													},
												},
											],
										},
										{
											type: 'fw',
											attrs: {
												type: 'header',
												content: [
													{
														type: 'teiWrapper',
														attrs: {
															tag: 'foreign',
															summary: '<foreign> efgh',
															teiAttrs: { 'xml:lang': 'la' },
															children: [
																{
																	type: 'element',
																	tag: 'w',
																	children: [
																		{ type: 'text', text: 'ef' },
																		{ type: 'element', tag: 'lb', attrs: { break: 'no' } },
																		{ type: 'text', text: 'gh' },
																	],
																},
															],
														},
													},
												],
											},
										},
									],
								},
							],
						},
					],
				},
			],
		};

		const xml = exportTEI(pmJSON as any);
		expect(compactXml(xml)).toContain(
			compactXml(
				'<rdg type="corr" hand="corrector"><foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign></rdg>'
			)
		);
		expect(compactXml(xml)).toContain(
			compactXml(
				'<fw type="header"><foreign xml:lang="la"><w>ef<lb break="no"/>gh</w></foreign></fw>'
			)
		);
	});

	it('exports recognized TEI atoms as dedicated flat nodes', () => {
		const pmJSON = {
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
									content: [
										{ type: 'teiAtom', attrs: { tag: 'gb', summary: 'gb:g1', xml: '<gb n="g1"/>', teiAttrs: { n: 'g1' } } },
										{ type: 'teiAtom', attrs: { tag: 'ptr', summary: '#target1', xml: '<ptr target=\"#target1\" type=\"crossref\"/>', teiAttrs: { target: '#target1', type: 'crossref' } } },
										{ type: 'teiAtom', attrs: { tag: 'media', summary: 'image/png', xml: '<media mimeType=\"image/png\" url=\"https://example.com/image.png\"/>', teiAttrs: { mimeType: 'image/png', url: 'https://example.com/image.png' } } },
										{ type: 'teiAtom', attrs: { tag: 'note', summary: 'note:see note', xml: '<note place=\"margin\">see note</note>', teiAttrs: { place: 'margin' }, text: 'see note' } },
										{ type: 'teiAtom', attrs: { tag: 'ellipsis', summary: 'ellipsis:ab', xml: '<ellipsis unit=\"chars\" quantity=\"2\"><metamark function=\"omission\"/><supplied reason=\"lost-folio\">ab</supplied></ellipsis>', teiAttrs: { unit: 'chars', quantity: '2' }, text: 'ab' } },
									],
								},
							],
						},
					],
				},
			],
		};

		const doc = parseTEI(exportTEI(pmJSON as any));
		expect(doc.getElementsByTagName('gb')[0].getAttribute('n')).toBe('g1');
		expect(doc.getElementsByTagName('ptr')[0].getAttribute('target')).toBe('#target1');
		expect(doc.getElementsByTagName('media')[0].getAttribute('mimeType')).toBe('image/png');
		expect(doc.getElementsByTagName('note')[0].textContent).toBe('see note');
		expect(doc.getElementsByTagName('ellipsis')[0].getAttribute('unit')).toBe('chars');
	});

	it('exports modification spans and editorial action atoms', () => {
		const pmJSON = {
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
									content: [
										{ type: 'text', text: 'a' },
										{
											type: 'text',
											text: 'b',
											marks: [
												{
													type: 'teiSpan',
													attrs: { tag: 'mod', teiAttrs: { type: 'add' } },
												},
											],
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
									],
								},
							],
						},
					],
				},
			],
		};

		const doc = parseTEI(exportTEI(pmJSON as any));
		const mod = doc.getElementsByTagName('mod')[0];
		const undo = doc.getElementsByTagName('undo')[0];

		expect(mod.getAttribute('type')).toBe('add');
		expect(mod.textContent).toBe('b');
		expect(undo.getAttribute('target')).toBe('#mod1');
	});

	it('exports standalone and word-inline metamark atoms', () => {
		const pmJSON = {
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
									content: [
										{
											type: 'metamark',
											attrs: {
												summary: 'insertion #mod1',
												teiAttrs: { function: 'insertion', target: '#mod1' },
												xml: '<metamark function="insertion" target="#mod1"/>',
											},
										},
										{ type: 'text', text: 'a' },
										{
											type: 'metamark',
											attrs: {
												summary: 'insertion #mod2',
												teiAttrs: { function: 'insertion', target: '#mod2' },
												xml: '<metamark function="insertion" target="#mod2"/>',
												wordInline: true,
											},
										},
										{ type: 'text', text: 'b' },
									],
								},
							],
						},
					],
				},
			],
		};

		const doc = parseTEI(exportTEI(pmJSON as any));
		const metamarks = Array.from(doc.getElementsByTagName('metamark'));

		expect(metamarks).toHaveLength(2);
		expect(metamarks[0].getAttribute('target')).toBe('#mod1');
		expect(metamarks[1].getAttribute('target')).toBe('#mod2');
		expect(doc.getElementsByTagName('w')[0].textContent).toBe('ab');
	});
});
