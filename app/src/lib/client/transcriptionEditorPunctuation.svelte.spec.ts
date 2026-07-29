/**
 * Punctuation typed in the editor, for ticket 09 of the `refactor-transcription-editor`
 * epic (SPEC.md § D5 / § B2, INVENTORY.md F35).
 *
 * Everything here starts from **editor state**, not from TEI. The existing
 * punctuation coverage in `packages/tei-transcription/tests/tei-transcription.spec.ts`
 * ("preserves word and punctuation attrs through prose mirror and TEI export")
 * starts from TEI, where the parser appends a word boundary that `pm-adapter`
 * turns into a space — so an *imported* `<pc>` sits in its own word group and
 * the serializer never sees the shape the editor produces. A round-trip suite
 * that starts from TEI is structurally blind to D5.
 *
 * The export assertions below were the defect: `exportWord` saw a punctuation
 * mark on any node in the group, emitted only the marked nodes, and returned,
 * so the word beside the punctuation was discarded. They now assert the word
 * survives, and that a typed period and an imported one export identically.
 */
import { userEvent } from '@vitest/browser/context';
import { NodeSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import { exportTEI } from '../tei/tei-exporter';
import { fromProseMirror, parseTei, serializeTei, toProseMirror } from '../tei/tei-transcription';
import { editorColumn, editorDocument, editorLine, editorPlainPage } from './testing/editorFixtures';
import {
	createTestEditor,
	lineElement,
	mountTranscriptionEditor,
	placeCaretAtEndOf,
	tick,
} from './testing/editorHarnesses.svelte';

type Json = Record<string, any>;

/** A one-page, one-column, one-line document whose only line holds `content`. */
function documentWithLineContent(content: Json[]): Json {
	return editorDocument({
		pages: [
			editorPlainPage({
				columns: [editorColumn({ lines: [editorLine({ content })] })],
			}),
		],
	});
}

function firstLineContent(json: Json): Json[] {
	return json.content[0].content[0].content[0].content ?? [];
}

/** Position just inside the end of the first `line` node. */
function endOfFirstLine(editor: any): number {
	let found: number | null = null;
	editor.state.doc.descendants((node: any, pos: number) => {
		if (found !== null) return false;
		if (node.type.name === 'line') {
			found = pos + node.nodeSize - 1;
			return false;
		}
		return true;
	});
	if (found === null) throw new Error('no line node');
	return found;
}

/**
 * Applies `tr` the way ProseMirror does and reports every transaction that came
 * out, so an `appendTransaction` from the punctuation plugin is directly
 * observable: one transaction means the plugin stayed quiet.
 */
function applyAndCountTransactions(editor: any, build: (tr: any) => any): number {
	const state = editor.state;
	const { transactions } = state.applyTransaction(build(state.tr));
	return transactions.length;
}

/** The serialized content of the first `<ab>` in an exported TEI document. */
function firstAbXml(xml: string): string {
	const ab = new DOMParser()
		.parseFromString(xml, 'application/xml')
		.getElementsByTagName('ab')[0];
	if (!ab) throw new Error('no <ab> in exported TEI');
	return Array.from(ab.childNodes)
		.map(child => new XMLSerializer().serializeToString(child))
		.join('')
		.replace(/ xmlns="[^"]*"/g, '')
		// The serializer pretty-prints one element per line; the line breaks are
		// formatting, not content.
		.replace(/\n\s*/g, '')
		.trim();
}

function exportFirstAb(editor: any): string {
	return firstAbXml(serializeTei(fromProseMirror(editor.getJSON() as any)));
}

const TYPED_PERIOD_SHAPE = [
	{ type: 'text', text: 'alpha' },
	{ type: 'text', marks: [{ type: 'punctuation', attrs: { teiAttrs: {} } }], text: '.' },
];

describe('PunctuationHighlighter', () => {
	it('preserves a carrier node selection when punctuation is added elsewhere', () => {
		const editor = createTestEditor(
			documentWithLineContent([
				{ type: 'gap' },
				{ type: 'text', text: ' alpha' },
			])
		);
		let gapPosition = -1;
		editor.state.doc.descendants((node, position) => {
			if (gapPosition === -1 && node.type.name === 'gap') gapPosition = position;
		});
		try {
			editor.commands.setNodeSelection(gapPosition);
			editor.view.dispatch(editor.state.tr.insertText('.', endOfFirstLine(editor)));

			expect(editor.state.selection).toBeInstanceOf(NodeSelection);
			expect((editor.state.selection as NodeSelection).node.type.name).toBe('gap');
		} finally {
			editor.destroy();
		}
	});

	it('marks a period typed after a word, leaving the word unmarked', () => {
		const editor = createTestEditor(documentWithLineContent([{ type: 'text', text: 'alpha' }]));
		editor.commands.focus('end');
		editor.commands.insertContent('.');

		expect(firstLineContent(editor.getJSON())).toEqual(TYPED_PERIOD_SHAPE);
	});

	it('marks every punctuation character in a run', () => {
		const editor = createTestEditor(documentWithLineContent([{ type: 'text', text: 'alpha' }]));
		editor.commands.focus('end');
		editor.commands.insertContent('.,;beta');

		expect(firstLineContent(editor.getJSON())).toEqual([
			{ type: 'text', text: 'alpha' },
			{ type: 'text', marks: [{ type: 'punctuation', attrs: { teiAttrs: {} } }], text: '.,;' },
			{ type: 'text', text: 'beta' },
		]);
	});

	it('marks punctuation in the middle of a word without splitting the rest', () => {
		const editor = createTestEditor(documentWithLineContent([{ type: 'text', text: 'co' }]));
		editor.commands.focus('end');
		editor.commands.insertContent('-operative');

		expect(firstLineContent(editor.getJSON())).toEqual([
			{ type: 'text', text: 'co' },
			{ type: 'text', marks: [{ type: 'punctuation', attrs: { teiAttrs: {} } }], text: '-' },
			{ type: 'text', text: 'operative' },
		]);
	});

	it('appends a transaction the first time a punctuation character appears', () => {
		const editor = createTestEditor(documentWithLineContent([{ type: 'text', text: 'alpha' }]));

		const count = applyAndCountTransactions(editor, tr =>
			tr.insertText('.', endOfFirstLine(editor))
		);

		expect(count).toBe(2);
	});

	it('appends no second transaction over punctuation that already carries the mark', () => {
		const editor = createTestEditor(documentWithLineContent(TYPED_PERIOD_SHAPE));

		const count = applyAndCountTransactions(editor, tr =>
			tr.insertText('X', endOfFirstLine(editor))
		);

		expect(count).toBe(1);
	});

	it('appends no second transaction when a marked node holds several punctuation characters', () => {
		const editor = createTestEditor(
			documentWithLineContent([
				{
					type: 'text',
					marks: [{ type: 'punctuation', attrs: { teiAttrs: {} } }],
					text: '.,;',
				},
			])
		);

		const count = applyAndCountTransactions(editor, tr =>
			tr.insertText('X', endOfFirstLine(editor))
		);

		expect(count).toBe(1);
	});

	it('re-running over an already-marked document leaves it byte-identical', () => {
		const editor = createTestEditor(documentWithLineContent([{ type: 'text', text: 'alpha' }]));
		editor.commands.focus('end');
		editor.commands.insertContent('.');
		const afterFirstPass = JSON.stringify(editor.getJSON());

		// A doc-changing edit that introduces no new punctuation re-runs the full
		// scan over the marked period; it must neither re-mark nor re-split it.
		editor.commands.focus('start');
		editor.commands.insertContent('X');
		const withPrefix = JSON.stringify(editor.getJSON());

		expect(withPrefix).toBe(afterFirstPass.replace('"alpha"', '"Xalpha"'));
	});

	it('preserves punctuation teiAttrs carried in from TEI rather than re-marking them', () => {
		const editor = createTestEditor(
			documentWithLineContent([
				{ type: 'text', text: 'alpha' },
				{ type: 'text', text: ' ' },
				{
					type: 'text',
					marks: [
						{ type: 'punctuation', attrs: { teiAttrs: { force: 'strong', unit: 'sentence' } } },
					],
					text: '.',
				},
			])
		);
		editor.commands.focus('start');
		editor.commands.insertContent('X');

		const marks = firstLineContent(editor.getJSON()).at(-1)?.marks;
		expect(marks).toEqual([
			{ type: 'punctuation', attrs: { teiAttrs: { force: 'strong', unit: 'sentence' } } },
		]);
	});
});

describe('typed punctuation reaching TEI export', () => {
	const IMPORTED_TEI = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader></teiHeader>
  <text><body>
    <pb n="1r"/>
    <cb n="1"/>
    <lb/>
    <w>alpha</w>
    <pc>.</pc>
  </body></text>
</TEI>`;

	it('exports a word and its period when the period came in from TEI', () => {
		expect(firstAbXml(serializeTei(fromProseMirror(toProseMirror(parseTei(IMPORTED_TEI)) as any))))
			.toBe('<w>alpha</w><pc>.</pc>');
	});

	it('exports a period typed after a word exactly as the imported equivalent does', () => {
		const editor = createTestEditor(documentWithLineContent([{ type: 'text', text: 'alpha' }]));
		editor.commands.focus('end');
		editor.commands.insertContent('.');

		expect(exportFirstAb(editor)).toBe('<w>alpha</w><pc>.</pc>');
		expect(exportFirstAb(editor)).toBe(
			firstAbXml(serializeTei(fromProseMirror(toProseMirror(parseTei(IMPORTED_TEI)) as any)))
		);
	});

	it('exports punctuation typed inside a word without losing either half', () => {
		const editor = createTestEditor(documentWithLineContent([{ type: 'text', text: 'co' }]));
		editor.commands.focus('end');
		editor.commands.insertContent('-operative');

		expect(exportFirstAb(editor)).toBe('<w>co</w><pc>-</pc><w>operative</w>');
	});

	it('exports two punctuation marks in a row without losing the word', () => {
		const editor = createTestEditor(documentWithLineContent([{ type: 'text', text: 'alpha' }]));
		editor.commands.focus('end');
		editor.commands.insertContent('.,');

		expect(exportFirstAb(editor)).toBe('<w>alpha</w><pc>.,</pc>');
	});

	it('keeps punctuation teiAttrs on a period typed after a word', () => {
		const editor = createTestEditor(
			documentWithLineContent([
				{ type: 'text', text: 'alpha' },
				{
					type: 'text',
					marks: [{ type: 'punctuation', attrs: { teiAttrs: { force: 'strong' } } }],
					text: '.',
				},
			])
		);

		expect(exportFirstAb(editor)).toBe('<w>alpha</w><pc force="strong">.</pc>');
	});

	it('exports a word that follows typed punctuation on the same line', () => {
		const editor = createTestEditor(documentWithLineContent([{ type: 'text', text: 'alpha' }]));
		editor.commands.focus('end');
		editor.commands.insertContent('.beta');

		expect(exportFirstAb(editor)).toBe('<w>alpha</w><pc>.</pc><w>beta</w>');
	});
});

describe('typed punctuation from a mounted editor', () => {
	it('keeps the word when a period is typed into the real component and exported', async () => {
		const harness = await mountTranscriptionEditor();
		try {
			const line = lineElement(harness.container, 0, 0, 0);
			const content = line.querySelector('.line-content') as HTMLElement;
			await userEvent.click(content);
			placeCaretAtEndOf(content);
			await tick();
			await userEvent.keyboard('.');
			await tick();

			// The keystroke reached the editor and the highlighter marked it.
			expect(content.innerHTML).toBe(
				'a1<span data-tei-attrs="{}" class="punctuation">.</span>'
			);

			const editor = (harness.container.querySelector('.ProseMirror') as any).editor;
			// The fixture's first column holds four lines, so the `<ab>` continues
			// past the edited one; what matters is that `a1` is still there.
			expect(firstAbXml(exportTEI(editor.getJSON()))).toMatch(
				/^<w>a1<\/w><pc>\.<\/pc><lb\/><w>a2<\/w>/
			);
		} finally {
			harness.dispose();
		}
	});
});
