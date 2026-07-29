/**
 * What `renderHTML` actually emits, for ticket 01 of the
 * `refactor-transcription-editor` epic.
 *
 * `renderHTML` is not only the view: it is also the clipboard serializer and
 * the input to `renderCorrectionContent`'s `generateHTML`, and `parseHTML` is
 * expected to invert it. These tests check that round trip. Assertions tagged
 * DEFECT record behaviour the inventory marks as wrong.
 *
 * See `.tracker/refactor-transcription-editor/INVENTORY.md`.
 */
import { Editor, generateHTML } from '@tiptap/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { editorDocument } from './testing/editorFixtures';
import { createTestEditor } from './testing/editorHarnesses.svelte';
import { getCorrectionRenderExtensions } from './transcriptionEditorSchema';

type Json = Record<string, any>;

beforeAll(async () => {
	const css = (await import('../../app.css?inline')).default as string;
	const style = document.createElement('style');
	style.textContent = css;
	document.head.appendChild(style);
});

function markedText(text: string, markType: string, attrs: Json): Json {
	return { type: 'text', text, marks: [{ type: markType, attrs }] };
}

describe('renderHTML round trip', () => {
	it('keeps teiAttrs on marks that read them from the mark, not from HTMLAttributes', () => {
		const editor = createTestEditor({
			content: editorDocument({
				interestingLineContent: [
					markedText('alpha', 'damage', { teiAttrs: { agent: 'water' } }),
				],
			}),
		});
		try {
			const html = editor.getHTML();
			expect(html).toContain('data-tei-attrs="{&quot;agent&quot;:&quot;water&quot;}"');
		} finally {
			editor.destroy();
		}
	});

	it('keeps `lacunose` and `unclear` teiAttrs through HTML serialization and parsing', () => {
		for (const markType of ['lacunose', 'unclear']) {
			const editor = createTestEditor({
				content: editorDocument({
					interestingLineContent: [
						markedText('alpha', markType, {
							teiAttrs: { reason: 'lost', cert: 'low' },
						}),
					],
				}),
			});
			try {
				const html = editor.getHTML();
				expect(html).toContain(
					'data-tei-attrs="{&quot;reason&quot;:&quot;lost&quot;,&quot;cert&quot;:&quot;low&quot;}"'
				);

				const parsedEditor = createTestEditor({ content: html as any });
				let stored: unknown = null;
				parsedEditor.state.doc.descendants((node: any) => {
					const mark = node.marks.find((candidate: any) => candidate.type.name === markType);
					if (mark) stored = mark.attrs.teiAttrs;
				});
				expect(stored).toEqual({ reason: 'lost', cert: 'low' });
				parsedEditor.destroy();
			} finally {
				editor.destroy();
			}
		}
	});

	it('renders correction, correctionNode and abbreviation deterministically', () => {
		const corrections = [{ hand: 'm2', content: [{ type: 'text', text: 'beta' }] }];
		const documents = [
			{
				type: 'correctionDoc',
				content: [markedText('alpha', 'correction', { corrections })],
			},
			{
				type: 'correctionDoc',
				content: [{ type: 'correctionNode', attrs: { corrections } }],
			},
			{
				type: 'correctionDoc',
				content: [markedText('alpha', 'abbreviation', { type: 'nomSac', expansion: 'alpha' })],
			},
		];

		for (const document of documents) {
			const first = generateHTML(document, getCorrectionRenderExtensions() as any);
			const second = generateHTML(document, getCorrectionRenderExtensions() as any);
			expect(second).toBe(first);
			expect(first).not.toMatch(/data-(?:mark|node)-id=/);
		}
	});

	it('parses the rendered correction, correctionNode and abbreviation forms without changing them', () => {
		const corrections = [{ hand: 'm2', content: [{ type: 'text', text: 'beta' }] }];
		const documents = [
			{
				type: 'correctionDoc',
				content: [markedText('alpha', 'correction', { id: 'correction-1', corrections })],
			},
			{
				type: 'correctionDoc',
				content: [{ type: 'correctionNode', attrs: { id: 'node-1', corrections } }],
			},
			{
				type: 'correctionDoc',
				content: [
					markedText('alpha', 'abbreviation', {
						id: 'abbreviation-1',
						type: 'nomSac',
						expansion: 'alpha',
					}),
				],
			},
		];

		for (const document of documents) {
			const html = generateHTML(document, getCorrectionRenderExtensions() as any);
			const editor = new Editor({
				extensions: getCorrectionRenderExtensions() as any,
				content: html,
			});
			try {
				expect(editor.getHTML()).toBe(html);
			} finally {
				editor.destroy();
			}
		}
	});

	it('renders correction and abbreviation tooltips inline with neighbouring words', () => {
		for (const [markType, attrs] of [
			[
				'correction',
				{
					id: 'correction-id',
					corrections: [{ hand: 'm2', content: [{ type: 'text', text: 'beta' }] }],
				},
			],
			['abbreviation', { id: 'abbreviation-id', type: 'nomSac', expansion: 'alpha' }],
		] as const) {
			const editor = createTestEditor({
				content: editorDocument({
					interestingLineContent: [
						{ type: 'text', text: 'before ' },
						markedText('alpha', markType, attrs),
						{ type: 'text', text: ' after' },
					],
				}),
			});
			document.body.appendChild(editor.view.dom);
			try {
				const tooltip = editor.view.dom.querySelector<HTMLElement>(`.${markType}.tooltip`)!;
				expect(tooltip.tagName).toBe('SPAN');
				expect(getComputedStyle(tooltip).display).toBe('inline');

				const lineContent = tooltip.closest('.line-content')!;
				const neighbour = lineContent.firstChild!;
				const range = document.createRange();
				range.selectNode(neighbour);
				expect(Math.round(tooltip.getBoundingClientRect().top)).toBe(
					Math.round(range.getBoundingClientRect().top)
				);
			} finally {
				editor.view.dom.remove();
				editor.destroy();
			}
		}
	});

	it('lets CSS activate frame layout when a rendered column gains a zone', () => {
		const editor = createTestEditor({
			content: editorDocument({ interestingLineContent: [{ type: 'text', text: 'alpha' }] }),
		});
		try {
			const page = editor.view.dom.querySelector('.page')!;
			expect(page.querySelector('.frame-grid')).not.toBeNull();
			expect(page.querySelector('.frame-grid:has(> .column[data-zone])')).toBeNull();

			let columnPos = -1;
			editor.state.doc.descendants((node: any, pos: number) => {
				if (node.type.name === 'column' && columnPos === -1) columnPos = pos;
				return true;
			});
			editor.view.dispatch(
				editor.state.tr.setNodeMarkup(columnPos, undefined, {
					...editor.state.doc.nodeAt(columnPos)!.attrs,
					zone: 'center',
				})
			);

			expect(editor.view.dom.querySelector('.column[data-zone="center"]')).not.toBeNull();
			expect(page.querySelector('.frame-grid:has(> .column[data-zone])')).not.toBeNull();
		} finally {
			editor.destroy();
		}
	});
});
