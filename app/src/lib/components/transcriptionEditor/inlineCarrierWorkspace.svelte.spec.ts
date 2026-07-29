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
	marginaliaDocument,
	marginaliaLine,
} from '$lib/client/testing/editorFixtures';
import {
	control,
	marginaliaLineElement as lineElementAt,
	mountInlineCarrierWorkspace as mountWorkspace,
	placeCaretAtEndOf,
	tick,
} from '$lib/client/testing/editorHarnesses.svelte';

/** Structural identities stored in the document the workspace emitted. */
function emittedIdentities(content: any) {
	return (content.content ?? []).map((column: any) => ({
		columnId: column.attrs?.columnId,
		lineIds: (column.content ?? []).map((line: any) => line.attrs?.lineId),
	}));
}

function mountedEditor(container: ParentNode) {
	const element = container.querySelector<HTMLElement>(
		'[data-testid="inline-carrier-editor"] .ProseMirror'
	);
	if (!element) throw new Error('no mounted nested editor');
	return (element as any).editor;
}

function selectText(editor: any, text: string) {
	let position = -1;
	editor.state.doc.descendants((node: any, pos: number) => {
		if (position === -1 && node.isText && node.text === text) position = pos;
		return position === -1;
	});
	if (position === -1) throw new Error(`no text node "${text}"`);
	editor.commands.setTextSelection({ from: position, to: position + text.length });
}

function markedText(editor: any, markType: string): string[] {
	const result: string[] = [];
	editor.state.doc.descendants((node: any) => {
		if (node.isText && node.marks.some((mark: any) => mark.type.name === markType)) {
			result.push(node.text);
		}
	});
	return result;
}

function textButton(container: ParentNode, label: string): HTMLButtonElement {
	const result = Array.from(container.querySelectorAll('button')).find(
		button => button.textContent?.trim() === label
	);
	if (!result) throw new Error(`no ${label} button`);
	return result;
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
			const identities = emittedIdentities(latest);
			expect(identities).toHaveLength(2);
			expect(identities.every((column: any) => column.lineIds.length === 4)).toBe(true);
			expect(domShape(harness.container)[1][1]).toContain('b2');
		} finally {
			harness.dispose();
		}
	});

	it('replaceEditorDocument splits a column and assigns identities to both halves', async () => {
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
			const identities = emittedIdentities(latest);
			expect(identities.map((column: any) => column.lineIds.length)).toEqual([2, 3, 4]);
			expect(identities.every((column: any) => Boolean(column.columnId))).toBe(true);
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

	it('syncNormalizedEditorDoc assigns identities to structural nodes', async () => {
		const harness = await mountWorkspace({
			initialContent: {
				type: 'doc',
				content: [
					marginaliaColumn({
						columnId: '',
						lines: [
							marginaliaLine({ text: 'a1', lineId: '' }),
							marginaliaLine({ text: 'a2', lineId: '' }),
						],
					}),
					marginaliaColumn({
						columnId: '',
						lines: [marginaliaLine({ text: 'b1', lineId: '' })],
					}),
				],
			},
			toolbarIdPrefix: 'carrier-normalization-spec',
		});
		try {
			// A change makes it emit the prepared document.
			placeCaretAtEndOf(
				lineElementAt(harness.container, 0, 0).querySelector('.line-content') as HTMLElement
			);
			await tick();
			control(harness.container, 'Toggle word wrap continuation').click();
			await tick();

			const latest = harness.emitted.at(-1) as any;
			const identities = emittedIdentities(latest);
			expect(identities.every((column: any) => Boolean(column.columnId))).toBe(true);
			expect(
				identities.every((column: any) =>
					column.lineIds.every((lineId: unknown) => Boolean(lineId))
				)
			).toBe(true);
		} finally {
			harness.dispose();
		}
	});
});

describe('InlineCarrierWorkspace drawer targets', () => {
	it('applies a correction to the selection the drawer opened for', async () => {
		const corrections = [{ hand: 'corrector', content: [{ type: 'text', text: 'alfa' }] }];
		const harness = await mountWorkspace({
			initialContent: marginaliaDocument({
				columns: [
					marginaliaColumn({
						lines: [
							{
								type: 'marginaliaLine',
								attrs: { lineId: 'line-1' },
								content: [
									{
										type: 'text',
										text: 'alpha',
										marks: [
											{
												type: 'correction',
												attrs: { id: 'alpha-mark', corrections },
											},
										],
									},
									{ type: 'text', text: ' beta' },
								],
							},
						],
					}),
				],
			}),
		});
		try {
			const editor = mountedEditor(harness.container);
			selectText(editor, 'alpha');
			control(harness.container, 'Mark Selection as Corrected').click();
			await tick();
			selectText(editor, ' beta');
			textButton(harness.container, 'Apply to Selection').click();
			await tick();

			expect(markedText(editor, 'correction')).toEqual(['alpha']);
		} finally {
			harness.dispose();
		}
	});

	it('applies an abbreviation to the selection the drawer opened for', async () => {
		const harness = await mountWorkspace({
			initialContent: marginaliaDocument({
				columns: [marginaliaColumn({ texts: ['alpha beta'] })],
			}),
		});
		try {
			const editor = mountedEditor(harness.container);
			selectText(editor, 'alpha beta');
			editor.commands.setTextSelection({
				from: editor.state.selection.from,
				to: editor.state.selection.from + 5,
			});
			control(harness.container, 'Mark Selection as Abbreviation').click();
			await tick();
			editor.commands.setTextSelection({
				from: editor.state.selection.to + 1,
				to: editor.state.selection.to + 5,
			});
			textButton(harness.container, 'Apply').click();
			await tick();

			expect(markedText(editor, 'abbreviation')).toEqual(['alpha']);
		} finally {
			harness.dispose();
		}
	});

	it('removes the correction the drawer opened for after the selection moves', async () => {
		const corrections = [{ hand: 'corrector', content: [{ type: 'text', text: 'fixed' }] }];
		const harness = await mountWorkspace({
			initialContent: marginaliaDocument({
				columns: [
					marginaliaColumn({
						lines: [
							{
								type: 'marginaliaLine',
								attrs: { lineId: 'line-1' },
								content: [
									{
										type: 'text',
										text: 'alpha',
										marks: [
											{
												type: 'correction',
												attrs: { id: 'alpha-mark', corrections },
											},
										],
									},
									{ type: 'text', text: ' ' },
									{
										type: 'text',
										text: 'beta',
										marks: [
											{
												type: 'correction',
												attrs: { id: 'beta-mark', corrections },
											},
										],
									},
								],
							},
						],
					}),
				],
			}),
		});
		try {
			const editor = mountedEditor(harness.container);
			selectText(editor, 'alpha');
			control(harness.container, 'Mark Selection as Corrected').click();
			await tick();
			selectText(editor, 'beta');
			textButton(harness.container, 'Remove All').click();
			await tick();

			expect(markedText(editor, 'correction')).toEqual(['beta']);
		} finally {
			harness.dispose();
		}
	});
});
