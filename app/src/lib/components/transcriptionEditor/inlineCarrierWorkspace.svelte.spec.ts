/**
 * Characterization tests for the nested carrier editor's document plumbing —
 * `replaceEditorDocument`, `syncNormalizedEditorDoc` and `emitContent` —
 * executed against a multi-column, multi-line marginalia document.
 *
 * Written for ticket 01 of the `refactor-transcription-editor` epic. These
 * three functions are component-private, so the component is mounted and driven
 * through its real toolbar rather than re-implemented.
 *
 * See `.tracker/refactor-transcription-editor/INVENTORY.md`, finding F25.
 */
import { describe, expect, it } from 'vitest';

import {
	domMarginaliaSnapshot as domShape,
	marginaliaColumn,
	marginaliaLine,
} from '$lib/client/testing/editorFixtures';
import {
	control,
	marginaliaLineElement as lineElementAt,
	mountInlineCarrierWorkspace as mountWorkspace,
	placeCaretAtEndOf,
	tick,
} from '$lib/client/testing/editorHarnesses.svelte';

/** column/line numbers as stored in the document the workspace emitted. */
function emittedNumbers(content: any): Array<{ column: number; lines: number[] }> {
	return (content.content ?? []).map((column: any) => ({
		column: column.attrs?.columnNumber,
		lines: (column.content ?? []).map((line: any) => line.attrs?.lineNumber),
	}));
}

describe('InlineCarrierWorkspace document plumbing', () => {
	it('renders a multi-column marginalia document and emits nothing until it changes', async () => {
		const harness = await mountWorkspace();
		try {
			expect(domShape(harness.container)).toEqual([
				['a1', 'a2', 'a3', 'a4'],
				['b1', 'b2', 'b3', 'b4'],
			]);
			expect(harness.emitted).toHaveLength(0);
		} finally {
			harness.dispose();
		}
	});

	it('emitContent reports the whole nested document on every change', async () => {
		const harness = await mountWorkspace();
		try {
			placeCaretAtEndOf(
				lineElementAt(harness.container, 1, 1).querySelector('.line-content') as HTMLElement
			);
			await tick();

			// Any insertion routes through `emitContent`.
			const trigger = harness.container.querySelector(
				'[popovertarget$="popover-untranscribed"]'
			) as HTMLElement;
			trigger.click();
			await tick();
			const panel = harness.container.querySelector(
				'[id$="popover-untranscribed"]'
			) as HTMLElement;
			(panel.querySelectorAll('button')[0] as HTMLButtonElement).click();
			await tick();

			expect(harness.emitted.length).toBeGreaterThan(0);
			const latest = harness.emitted.at(-1) as any;
			expect(latest.type).toBe('doc');
			expect(emittedNumbers(latest)).toEqual([
				{ column: 1, lines: [1, 2, 3, 4] },
				{ column: 2, lines: [1, 2, 3, 4] },
			]);
			expect(domShape(harness.container)[1][1]).toContain('b2');
		} finally {
			harness.dispose();
		}
	});

	it('replaceEditorDocument splits a column and renumbers both halves', async () => {
		const harness = await mountWorkspace();
		try {
			placeCaretAtEndOf(
				lineElementAt(harness.container, 0, 1).querySelector('.line-content') as HTMLElement
			);
			await tick();

			const splitButton = control(harness.container, 'Split Into New Column');
			expect((splitButton as HTMLButtonElement).disabled).toBe(false);
			splitButton.click();
			await tick();

			expect(domShape(harness.container)).toEqual([
				['a1', 'a2'],
				['', 'a3', 'a4'],
				['b1', 'b2', 'b3', 'b4'],
			]);

			const latest = harness.emitted.at(-1) as any;
			expect(emittedNumbers(latest)).toEqual([
				{ column: 1, lines: [1, 2] },
				{ column: 2, lines: [1, 2, 3] },
				{ column: 3, lines: [1, 2, 3, 4] },
			]);
		} finally {
			harness.dispose();
		}
	});

	it('replaceEditorDocument toggles wrapped on the current line only', async () => {
		const harness = await mountWorkspace();
		try {
			placeCaretAtEndOf(
				lineElementAt(harness.container, 1, 2).querySelector('.line-content') as HTMLElement
			);
			await tick();

			control(harness.container, 'Toggle word wrap continuation').click();
			await tick();

			const latest = harness.emitted.at(-1) as any;
			const wrapped = latest.content.flatMap((column: any) =>
				column.content.map((line: any) => Boolean(line.attrs?.wrapped))
			);
			expect(wrapped).toEqual([false, false, false, false, false, false, true, false]);
			expect(domShape(harness.container)).toEqual([
				['a1', 'a2', 'a3', 'a4'],
				['b1', 'b2', 'b3', 'b4'],
			]);
		} finally {
			harness.dispose();
		}
	});

	it('syncNormalizedEditorDoc renumbers a document that arrives with wrong numbers', async () => {
		const harness = await mountWorkspace({
			initialContent: {
				type: 'doc',
				content: [
					marginaliaColumn({
						columnNumber: 9,
						lines: [
							marginaliaLine({ text: 'a1', lineNumber: 40 }),
							marginaliaLine({ text: 'a2', lineNumber: 41 }),
						],
					}),
					marginaliaColumn({
						columnNumber: 12,
						lines: [marginaliaLine({ text: 'b1', lineNumber: 7 })],
					}),
				],
			},
			toolbarIdPrefix: 'carrier-normalization-spec',
		});
		try {
			// The workspace renumbers on mount, before the editor is created, so the
			// rendered gutter already reads 1, 2 / 1.
			const gutters = Array.from(harness.container.querySelectorAll('.marginalia-line')).map(
				element => element.firstElementChild?.textContent
			);
			expect(gutters).toEqual(['1.', '2.', '1.']);

			// A change makes it emit the renumbered document.
			placeCaretAtEndOf(
				lineElementAt(harness.container, 0, 0).querySelector('.line-content') as HTMLElement
			);
			await tick();
			control(harness.container, 'Toggle word wrap continuation').click();
			await tick();

			const latest = harness.emitted.at(-1) as any;
			expect(emittedNumbers(latest)).toEqual([
				{ column: 1, lines: [1, 2] },
				{ column: 2, lines: [1] },
			]);
		} finally {
			harness.dispose();
		}
	});
});
