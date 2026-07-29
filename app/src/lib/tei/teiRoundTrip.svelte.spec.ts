/**
 * TEI round-trip fidelity, for ticket 01 of the `refactor-transcription-editor`
 * epic (inventory questions 1 and 4).
 *
 * The export path the app actually uses is
 * `exportTEIDocument(fromProseMirror(editor.getJSON()))`, i.e.
 * ProseMirror JSON -> TranscriptionDocument -> toProseMirror -> XML. Everything
 * below drives that path. Assertions tagged DEFECT record losses the inventory
 * marks as wrong. See `.tracker/refactor-transcription-editor/INVENTORY.md`.
 */
import { describe, expect, it } from 'vitest';

import { createTestEditor } from '$lib/client/testing/editorHarnesses.svelte';

import { fromProseMirror, parseTei, serializeTei, toProseMirror } from './tei-transcription';

const SAMPLE_TEI = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader></teiHeader>
  <text><body>
    <pb n="1r" xml:id="p1"/>
    <cb n="C1"/>
    <lb rend="hang"/><w>alpha</w><w>beta</w>
    <lb/><w>gamma</w>
    <cb n="C2"/>
    <lb/><w>delta</w>
    <pb n="1v"/>
    <cb n="C1"/>
    <lb/><w>epsilon</w>
  </body></text>
</TEI>`;

/** The full app export path, minus metadata. */
function exportFromProseMirror(pm: any): string {
	return serializeTei(fromProseMirror(pm));
}

/** `toProseMirror` typed loosely, so a fixture can be poked at any depth. */
function editorJson(tei: string): any {
	return toProseMirror(parseTei(tei)) as any;
}

function columnNode(pm: any, pageIndex: number, columnIndex: number): any {
	return pm.content[pageIndex].content[columnIndex];
}

function lineNode(pm: any, pageIndex: number, columnIndex: number, lineIndex: number): any {
	return columnNode(pm, pageIndex, columnIndex).content[lineIndex];
}

describe('TEI round trip through the ProseMirror adapter', () => {
	it('preserves page, column and line structure and word text', () => {
		const roundTripped = parseTei(exportFromProseMirror(editorJson(SAMPLE_TEI)));

		expect(roundTripped.pages).toHaveLength(2);
		expect(roundTripped.pages[0].columns).toHaveLength(2);
		expect(roundTripped.pages[0].columns[0].lines).toHaveLength(2);
		expect(roundTripped.pages[1].columns[0].lines).toHaveLength(1);

		const text = (page: number, column: number, line: number) =>
			roundTripped.pages[page].columns[column].lines[line].items
				.map((item: any) => (item.type === 'text' ? item.text : ''))
				.join('');
		expect(text(0, 0, 0)).toBe('alphabeta');
		expect(text(0, 0, 1)).toBe('gamma');
		expect(text(0, 1, 0)).toBe('delta');
		expect(text(1, 0, 0)).toBe('epsilon');
	});

	it('is stable across a second round trip', () => {
		const once = exportFromProseMirror(editorJson(SAMPLE_TEI));
		const twice = exportFromProseMirror(editorJson(once));
		expect(twice).toBe(once);
	});

	it('preserves all four page-chrome fw kinds without page attribute mirrors', () => {
		const source = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader></teiHeader><text><body>
  <pb n="1r"/><cb n="C1"/><lb/>
  <fw type="pageNum"><w>12</w></fw>
  <fw type="runTitle"><w>Romans</w></fw>
  <fw type="catchword"><w>grace</w></fw>
  <fw type="sig"><w>A iii</w></fw>
</body></text></TEI>`;
		const pm = editorJson(source);

		expect(pm.content[0].attrs).not.toHaveProperty('pageLabel');
		expect(pm.content[0].attrs).not.toHaveProperty('runningTitle');
		expect(pm.content[0].attrs).not.toHaveProperty('catchword');
		expect(pm.content[0].attrs).not.toHaveProperty('quireSignature');

		const once = exportFromProseMirror(pm);
		expect(exportFromProseMirror(editorJson(once))).toBe(once);
		const exported = parseTei(once);
		const formWork = exported.pages[0].columns[0].lines[0].items.filter(
			(item: any) => item.type === 'fw'
		);
		expect(formWork.map((item: any) => item.attrs.type)).toEqual([
			'pageNum',
			'runTitle',
			'catchword',
			'sig',
		]);
	});

	describe('question 1 — line and column numbers', () => {
		it('does not synthesize @n on line breaks', () => {
			const xml = exportFromProseMirror(editorJson(SAMPLE_TEI));
			const lineBreaks = xml.match(/<lb[^>]*\/>/g) ?? [];
			expect(lineBreaks.length).toBeGreaterThan(0);
			expect(lineBreaks.every(tag => !/\sn=/.test(tag))).toBe(true);
		});

		it('derives line ordinals positionally on import, ignoring any @n on <lb>', () => {
			const document_ = parseTei(`<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader></teiHeader><text><body>
  <pb n="1r"/><cb n="C1"/>
  <lb n="97"/><w>one</w>
  <lb n="98"/><w>two</w>
</body></text></TEI>`);
			expect(document_.pages[0].columns[0].lines.map(line => line.number)).toEqual([1, 2]);
			// The scribe's own numbering survives only as an opaque TEI attribute.
			expect(document_.pages[0].columns[0].lines[0].teiAttrs?.n).toBe('97');
		});

		it('does not synthesize @n on <cb> from its display position', () => {
			const pm = editorJson(SAMPLE_TEI);
			delete columnNode(pm, 0, 0).attrs.teiAttrs;
			delete columnNode(pm, 0, 1).attrs.teiAttrs;

			const xml = exportFromProseMirror(pm);
			const columnBreaks = xml.match(/<cb[^>]*\/>/g) ?? [];
			expect(columnBreaks.slice(0, 2).every(tag => !/\sn=/.test(tag))).toBe(true);
		});

		it('preserves a source @n carried in teiAttrs', () => {
			const pm = editorJson(SAMPLE_TEI);
			columnNode(pm, 0, 0).attrs.teiAttrs = { n: 'scribe-column-alpha' };

			const xml = exportFromProseMirror(pm);

			expect(xml).toContain('<cb n="scribe-column-alpha"');
		});
	});

	describe('question 4 — attributes parsed but never rendered', () => {
		it('exports an editor-set paragraph start to TEI', () => {
			const pm = editorJson(SAMPLE_TEI);
			// This is exactly what `toggleParagraphStart` writes.
			lineNode(pm, 0, 0, 1).attrs['paragraph-start'] = true;

			const xml = exportFromProseMirror(pm);
			const lineBreaks = xml.match(/<lb[^>]*\/>/g) ?? [];
			// The first line came from TEI; the second was flagged in the editor.
			expect(lineBreaks[0]).toContain('rend="hang"');
			expect(lineBreaks[1]).toContain('rend="hang"');

			expect(parseTei(xml).pages[0].columns[0].lines[1].paragraphStart).toBe(true);
		});

		it('DEFECT F13: preserves a word continuing across page and column boundaries', () => {
			const wrappedTei = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader></teiHeader><text><body>
	  <pb n="1r"/><cb n="C1"/><lb/><w>alpha<pb n="1v" break="no"/><cb n="C1" break="no"/><lb/>beta</w>
</body></text></TEI>`;
			const editor = createTestEditor({ content: editorJson(wrappedTei) });

			try {
				const xml = exportFromProseMirror(editor.getJSON());
				expect(xml).toMatch(/<pb(?=[^>]*n="1v")(?=[^>]*break="no")[^>]*\/>/);
				expect(xml).toMatch(/<cb(?=[^>]*n="C1")(?=[^>]*break="no")[^>]*\/>/);
				expect(xml).toMatch(/<lb(?=[^>]*break="no")[^>]*\/>/);
			} finally {
				editor.destroy();
			}
		});

		it('preserves unknown TEI attributes on pb/cb/lb through teiAttrs', () => {
			const xml = exportFromProseMirror(
				editorJson(`<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader></teiHeader><text><body>
  <pb n="1r" facs="#zone1"/><cb n="C1" style="ruled"/><lb corresp="#x"/><w>alpha</w>
</body></text></TEI>`)
			);
			expect(xml).toContain('facs="#zone1"');
			expect(xml).toContain('style="ruled"');
			expect(xml).toContain('corresp="#x"');
		});

		it.each([
			['gap', '<gap reason="lost" unit="chars" extent="2" cert="low" xml:id="g1"/>'],
			[
				'untranscribed note',
				'<note type="untranscribed" subtype="damage" n="partial" resp="#ed" cert="low" xml:id="u1"/>',
			],
		])('preserves all attributes on a %s through a mounted editor', (_label, carrier) => {
			const source = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader></teiHeader><text><body>
  <pb n="1r"/><cb n="C1"/><lb/>${carrier}
</body></text></TEI>`;
			const editor = createTestEditor({ content: editorJson(source) });

			try {
				expect(exportFromProseMirror(editor.getJSON())).toContain(carrier);
			} finally {
				editor.destroy();
			}
		});
	});

	it('keeps an element-only original attached to its apparatus through a mounted editor', () => {
		const source = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader></teiHeader><text><body>
  <pb n="1r"/><cb n="C1"/><lb/>
  <app>
    <rdg type="orig"><gap reason="lost" unit="chars" extent="3" cert="low" xml:id="g1"/></rdg>
    <rdg type="corr" hand="corrector"><w>abc</w></rdg>
  </app>
</body></text></TEI>`;
		const editor = createTestEditor({ content: editorJson(source) });

		try {
			const gap = lineNode(editor.getJSON(), 0, 0, 0).content[0];
			expect(gap.type).toBe('gap');
			expect(gap.marks).toEqual([expect.objectContaining({ type: 'correction' })]);

			const xml = exportFromProseMirror(editor.getJSON());
			expect(xml.match(/<app>/g)).toHaveLength(1);
			expect(xml).toContain(
				'<gap reason="lost" unit="chars" extent="3" cert="low" xml:id="g1"/>'
			);
		} finally {
			editor.destroy();
		}
	});

	/**
	 * Ticket 24 / INVENTORY R1. The selection UI permits a correction over part of
	 * a word and over several words; the fixtures only ever covered a whole single
	 * word. These build the shapes directly as ProseMirror JSON and export them.
	 */
	describe('R1 — corrections on partial and multi-word selections', () => {
		const CORRECTION = {
			type: 'correction',
			attrs: {
				corrections: [{ hand: 'corrector', content: [{ type: 'text', text: 'fixed' }] }],
			},
		};

		function pmLine(content: any[]): any {
			return {
				type: 'manuscript',
				content: [
					{
						type: 'page',
						attrs: { pageName: '1r' },
						content: [
							{
								type: 'column',
								attrs: {},
								content: [{ type: 'line', attrs: {}, content }],
							},
						],
					},
				],
			};
		}

		/** The line's exported content, with boilerplate and pretty-printing removed. */
		function body(xml: string): string {
			return xml
				.replace(/^[\s\S]*<lb\/>\n/, '')
				.replace(/<\/ab>[\s\S]*$/, '')
				.replace(/<ab>\n?/, '')
				.replace(/\n/g, '');
		}

		const marked = (text: string) => ({ type: 'text', text, marks: [CORRECTION] });
		const plain = (text: string) => ({ type: 'text', text });

		it('exports a whole-word correction (the case that already worked)', () => {
			const xml = exportFromProseMirror(pmLine([marked('alpha')]));
			expect(body(xml)).toBe(
				'<app><rdg type="orig"><w>alpha</w></rdg>' +
					'<rdg type="corr" hand="corrector"><w>fixed</w></rdg></app>'
			);
		});

		it('exports a word whose suffix carries the correction', () => {
			const xml = exportFromProseMirror(pmLine([plain('alp'), marked('ha')]));
			expect(xml).toContain('alp');
			expect(body(xml)).toBe(
				'<app><rdg type="orig"><w>alpha</w></rdg>' +
					'<rdg type="corr" hand="corrector"><w>fixed</w></rdg></app>'
			);
		});

		it('exports a word whose middle span carries the correction', () => {
			const xml = exportFromProseMirror(pmLine([plain('al'), marked('ph'), plain('a')]));
			expect(body(xml)).toBe(
				'<app><rdg type="orig"><w>alpha</w></rdg>' +
					'<rdg type="corr" hand="corrector"><w>fixed</w></rdg></app>'
			);
		});

		it('emits exactly one <app> for a correction spanning two words', () => {
			const xml = exportFromProseMirror(
				pmLine([marked('alpha'), plain(' '), marked('beta')])
			);
			expect((xml.match(/<app>/g) ?? []).length).toBe(1);
			expect(body(xml)).toBe(
				'<app><rdg type="orig"><w>alpha</w><w>beta</w></rdg>' +
					'<rdg type="corr" hand="corrector"><w>fixed</w></rdg></app>'
			);
		});

		it('leaves an unmarked neighbouring word alone', () => {
			const xml = exportFromProseMirror(
				pmLine([
					plain('before'),
					plain(' '),
					plain('alp'),
					marked('ha'),
					plain(' '),
					plain('after'),
				])
			);
			expect(body(xml)).toBe(
				'<w>before</w>' +
					'<app><rdg type="orig"><w>alpha</w></rdg>' +
					'<rdg type="corr" hand="corrector"><w>fixed</w></rdg></app>' +
					'<w>after</w>'
			);
		});

		it.each([
			['suffix', [plain('alp'), marked('ha')]],
			['middle', [plain('al'), marked('ph'), plain('a')]],
			['two words', [marked('alpha'), plain(' '), marked('beta')]],
		])('round-trips a %s correction: export, re-import, re-export', (_label, content) => {
			const once = exportFromProseMirror(pmLine(content as any[]));
			const twice = exportFromProseMirror(editorJson(once));
			expect(twice).toBe(once);
		});
	});
});
