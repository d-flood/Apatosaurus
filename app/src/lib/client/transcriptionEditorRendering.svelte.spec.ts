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
import { generateHTML } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { editorDocument } from './testing/editorFixtures';
import { createTestEditor } from './testing/editorHarnesses.svelte';
import { getCorrectionRenderExtensions } from './transcriptionEditorSchema';

type Json = Record<string, any>;

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

	it('DEFECT F19: `lacunose` and `unclear` drop their teiAttrs on render', () => {
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
				// The node still holds them...
				let stored: unknown = null;
				editor.state.doc.descendants((node: any) => {
					for (const mark of node.marks || []) {
						if (mark.type.name === markType) stored = mark.attrs.teiAttrs;
					}
					return true;
				});
				expect(stored).toEqual({ reason: 'lost', cert: 'low' });

				// ...but `renderHTML` reads `HTMLAttributes.teiAttrs`, which never
				// exists — the rendered attribute is `data-tei-attrs`. The explicit
				// key is written after the spread, so it overwrites the correct value
				// with `{}`. Anything that goes out through HTML (clipboard, the
				// correction preview) loses the attributes.
				expect(editor.getHTML()).toContain('data-tei-attrs="{}"');
			} finally {
				editor.destroy();
			}
		}
	});

	it('DEFECT F20: correction, correctionNode and abbreviation mint a new id on every render', () => {
		const content = [
			markedText('alpha', 'correction', {
				corrections: [{ hand: 'm2', content: [{ type: 'text', text: 'beta' }] }],
			}),
		];
		const first = generateHTML(
			{ type: 'doc', content },
			getCorrectionRenderExtensions() as any
		);
		const second = generateHTML(
			{ type: 'doc', content },
			getCorrectionRenderExtensions() as any
		);

		const idOf = (html: string) => html.match(/data-mark-id="([^"]+)"/)?.[1];
		expect(idOf(first)).toBeTruthy();
		// `renderHTML` falls back to `nanoid(8)` when the id attribute is null, so
		// it is not a pure function of the node. Two renders of identical content
		// produce different HTML, which defeats any diffing or caching downstream.
		expect(idOf(second)).not.toBe(idOf(first));
	});

	it('DEFECT F21: the correction and abbreviation marks render a block <div> inside a <p class="line">', () => {
		const editor = createTestEditor({
			content: editorDocument({
				interestingLineContent: [
					markedText('alpha', 'correction', {
						id: 'fixed',
						corrections: [{ hand: 'm2', content: [{ type: 'text', text: 'beta' }] }],
					}),
				],
			}),
		});
		try {
			// An inline mark must render an inline element. `<div>` is not valid
			// inside `<p>`; it survives only because ProseMirror builds the tree with
			// createElement rather than by parsing markup. It also means the mark
			// cannot participate in the line's inline layout.
			const tooltip = editor.view.dom.querySelector('div.tooltip')!;
			const line = tooltip.closest('p.line');
			expect(line).not.toBeNull();
			expect(getComputedStyle(tooltip).display).not.toBe('inline');
		} finally {
			editor.destroy();
		}
	});

	it('DEFECT F22: Page.renderHTML computes hasFrameZones once and never re-runs it', () => {
		const editor = createTestEditor({
			content: editorDocument({ interestingLineContent: [{ type: 'text', text: 'alpha' }] }),
		});
		try {
			const page = editor.view.dom.querySelector('.page')!;
			expect(page.querySelector('.frame-grid')).toBeNull();

			// Give the page's only column a zone. `renderHTML` is not re-run when a
			// child changes, so the container class stays `flex gap-4`.
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
			expect(editor.view.dom.querySelector('.frame-grid')).toBeNull();
		} finally {
			editor.destroy();
		}
	});
});
