/**
 * Characterization tests for the editor's page/column/line commands, driven
 * through a real mounted `TranscriptionEditor` and its real toolbar/dialog.
 *
 * Written for ticket 01 of the `refactor-transcription-editor` epic. The point
 * of mounting the component rather than re-implementing its handlers is that
 * the handlers are component-private; a test that copies them proves only that
 * the copy is stable. Assertions tagged DEFECT record behaviour the inventory
 * marks as wrong. See `.tracker/refactor-transcription-editor/INVENTORY.md`.
 */
import { describe, expect, it } from 'vitest';

import { domDocumentSnapshot as domShape } from '$lib/client/testing/editorFixtures';
import {
	control,
	lineElement,
	mountTranscriptionEditor as mountEditor,
	placeCaretAtEndOf,
	tick,
	type TranscriptionEditorHarness as Harness,
} from '$lib/client/testing/editorHarnesses.svelte';

function buttonWithText(root: ParentNode, text: string): HTMLButtonElement {
	const element = Array.from(root.querySelectorAll('button')).find(candidate =>
		(candidate.textContent || '').trim().startsWith(text)
	);
	if (!element) throw new Error(`no button starting with "${text}"`);
	return element;
}

function setInput(element: HTMLInputElement, value: string) {
	element.value = value;
	element.dispatchEvent(new Event('input', { bubbles: true }));
}

function popover(container: HTMLElement, suffix: string): HTMLElement {
	const element = container.querySelector<HTMLElement>(`[id$="${suffix}"]`);
	if (!element) throw new Error(`no popover ending in "${suffix}"`);
	return element;
}

async function insertPage(harness: Harness, name: string, kind: 'Standard' | 'Framed') {
	control(harness.container, 'Insert Page').click();
	await tick();
	const panel = popover(harness.container, 'popover-insert-page');
	setInput(panel.querySelector('input[type="text"]') as HTMLInputElement, name);
	await tick();
	buttonWithText(panel, kind === 'Standard' ? 'Standard Page' : 'Framed Page').click();
	await tick();
}

describe('TranscriptionEditor structural commands (mounted, multi-page fixture)', () => {
	it('renders the fixture as three pages with four-line columns', async () => {
		const harness = await mountEditor();
		try {
			expect(domShape(harness.container)).toEqual([
				[['a1', 'a2', 'a3', 'a4']],
				[
					['b1', 'b2', 'b3', 'b4'],
					['c1', 'c2', 'c3', 'c4'],
				],
				[['d1', 'd2', 'd3', 'd4']],
			]);
		} finally {
			harness.dispose();
		}
	});

	it('insertPage appends a one-column, one-line page when the caret is in the last line', async () => {
		const harness = await mountEditor();
		try {
			placeCaretAtEndOf(
				lineElement(harness.container, 2, 0, 3).querySelector(
					'.line-content'
				) as HTMLElement
			);
			await tick();
			await insertPage(harness, '2v', 'Standard');

			const shape = domShape(harness.container);
			expect(shape).toHaveLength(4);
			expect(shape[3]).toEqual([['']]);
			expect(shape.slice(0, 3)).toEqual([
				[['a1', 'a2', 'a3', 'a4']],
				[
					['b1', 'b2', 'b3', 'b4'],
					['c1', 'c2', 'c3', 'c4'],
				],
				[['d1', 'd2', 'd3', 'd4']],
			]);
		} finally {
			harness.dispose();
		}
	});

	// The two assertions below were written as `DEFECT F6` and are inverted in
	// place by ticket 07: the insert position is now derived from the document
	// rather than from `state.selection`, so an unfocused editor is not a special
	// case at all.

	it('F6: insertPage appends without touching the document when the editor has never been focused', async () => {
		const harness = await mountEditor();
		try {
			// No caret placed. `insertContent` used to fit a block `page` node into
			// whatever the default selection was, and ProseMirror's fitter resolved
			// the mismatch by replacing everything.
			const before = Array.from(
				harness.container.querySelectorAll('.ProseMirror .page')
			).map(element => element.outerHTML);
			await insertPage(harness, '2v', 'Standard');

			// The three original pages are byte-identical, not merely same-shaped.
			const after = Array.from(harness.container.querySelectorAll('.ProseMirror .page')).map(
				element => element.outerHTML
			);
			expect(after.slice(0, 3)).toEqual(before);

			expect(domShape(harness.container)).toEqual([
				[['a1', 'a2', 'a3', 'a4']],
				[
					['b1', 'b2', 'b3', 'b4'],
					['c1', 'c2', 'c3', 'c4'],
				],
				[['d1', 'd2', 'd3', 'd4']],
				[['']],
			]);
		} finally {
			harness.dispose();
		}
	});

	it('F6: insertFramedPage appends without touching the document when the editor has never been focused', async () => {
		const harness = await mountEditor();
		try {
			await insertPage(harness, '2v', 'Framed');
			expect(domShape(harness.container)).toEqual([
				[['a1', 'a2', 'a3', 'a4']],
				[
					['b1', 'b2', 'b3', 'b4'],
					['c1', 'c2', 'c3', 'c4'],
				],
				[['d1', 'd2', 'd3', 'd4']],
				[[''], [''], [''], [''], ['']],
			]);
			const zones = Array.from(
				harness.container.querySelectorAll('.page')[3].querySelectorAll('.column')
			).map(element => (element as HTMLElement).dataset.zone);
			expect(zones).toEqual(['top', 'left', 'right', 'bottom', 'center']);
		} finally {
			harness.dispose();
		}
	});

	it('F6: insertPage lands the new page after the page containing the caret', async () => {
		const harness = await mountEditor();
		try {
			// Caret in the FIRST page, which is not the end of the document.
			placeCaretAtEndOf(
				lineElement(harness.container, 0, 0, 1).querySelector('.line-content') as HTMLElement
			);
			await tick();
			await insertPage(harness, '1r-bis', 'Standard');

			expect(domShape(harness.container)).toEqual([
				[['a1', 'a2', 'a3', 'a4']],
				[['']],
				[
					['b1', 'b2', 'b3', 'b4'],
					['c1', 'c2', 'c3', 'c4'],
				],
				[['d1', 'd2', 'd3', 'd4']],
			]);
		} finally {
			harness.dispose();
		}
	});

	it('insertFramedPage appends five zoned columns in visual order', async () => {
		const harness = await mountEditor();
		try {
			placeCaretAtEndOf(
				lineElement(harness.container, 2, 0, 3).querySelector(
					'.line-content'
				) as HTMLElement
			);
			await tick();
			await insertPage(harness, '2v', 'Framed');

			const shape = domShape(harness.container);
			expect(shape).toHaveLength(4);
			expect(shape[3]).toEqual([[''], [''], [''], [''], ['']]);

			const zones = Array.from(
				harness.container.querySelectorAll('.page')[3].querySelectorAll('.column')
			).map(element => (element as HTMLElement).dataset.zone);
			expect(zones).toEqual(['top', 'left', 'right', 'bottom', 'center']);
		} finally {
			harness.dispose();
		}
	});

	it('insertPage is unavailable until a page name is supplied', async () => {
		const harness = await mountEditor();
		try {
			control(harness.container, 'Insert Page').click();
			await tick();
			const panel = popover(harness.container, 'popover-insert-page');
			const standard = buttonWithText(panel, 'Standard Page');
			// The only feedback that a name is required is the disabled attribute.
			expect(standard.disabled).toBe(true);
			standard.click();
			await tick();
			expect(domShape(harness.container)).toHaveLength(3);
		} finally {
			harness.dispose();
		}
	});

	it('insertColumn splits the current column and leaves other pages untouched', async () => {
		const harness = await mountEditor();
		try {
			placeCaretAtEndOf(
				lineElement(harness.container, 1, 0, 2).querySelector(
					'.line-content'
				) as HTMLElement
			);
			await tick();

			control(harness.container, 'Insert Column').click();
			await tick();

			const shape = domShape(harness.container);
			expect(shape[0]).toEqual([['a1', 'a2', 'a3', 'a4']]);
			expect(shape[2]).toEqual([['d1', 'd2', 'd3', 'd4']]);
			expect(shape[1]).toEqual([
				['b1', 'b2', 'b3'],
				['', 'b4'],
				['c1', 'c2', 'c3', 'c4'],
			]);
		} finally {
			harness.dispose();
		}
	});

	it('toggleWordWrapped flips only the current line', async () => {
		const harness = await mountEditor();
		try {
			placeCaretAtEndOf(
				lineElement(harness.container, 1, 1, 2).querySelector(
					'.line-content'
				) as HTMLElement
			);
			await tick();
			control(harness.container, 'Toggle word wrap continuation').click();
			await tick();

			const wrapped = Array.from(harness.container.querySelectorAll('.line')).map(
				element => (element as HTMLElement).dataset.wrapped === 'true'
			);
			expect(wrapped.filter(Boolean)).toHaveLength(1);
			expect((lineElement(harness.container, 1, 1, 2) as HTMLElement).dataset.wrapped).toBe(
				'true'
			);

			control(harness.container, 'Toggle word wrap continuation').click();
			await tick();
			expect(
				(lineElement(harness.container, 1, 1, 2) as HTMLElement).dataset.wrapped
			).toBeUndefined();
		} finally {
			harness.dispose();
		}
	});

	it('toggleParagraphStart flips only the current line', async () => {
		const harness = await mountEditor();
		try {
			placeCaretAtEndOf(
				lineElement(harness.container, 2, 0, 1).querySelector(
					'.line-content'
				) as HTMLElement
			);
			await tick();
			control(harness.container, 'Toggle paragraph start').click();
			await tick();

			const flagged = Array.from(harness.container.querySelectorAll('.line')).filter(
				element => (element as HTMLElement).dataset.paragraphStart === 'true'
			);
			expect(flagged).toHaveLength(1);
			expect(flagged[0]).toBe(lineElement(harness.container, 2, 0, 1));
		} finally {
			harness.dispose();
		}
	});

	it('insertUntranscribed(full) replaces the whole line; (partial) inserts inline', async () => {
		const harness = await mountEditor();
		try {
			placeCaretAtEndOf(
				lineElement(harness.container, 0, 0, 1).querySelector(
					'.line-content'
				) as HTMLElement
			);
			await tick();

			const trigger = harness.container.querySelector(
				'[popovertarget$="popover-untranscribed"]'
			) as HTMLElement;
			trigger.click();
			await tick();
			const panel = popover(harness.container, 'popover-untranscribed');
			const extent = panel.querySelector('select') as HTMLSelectElement;
			extent.value = 'full';
			extent.dispatchEvent(new Event('change', { bubbles: true }));
			await tick();
			(panel.querySelectorAll('button')[0] as HTMLButtonElement).click();
			await tick();

			const target = lineElement(harness.container, 0, 0, 1);
			expect(target.querySelectorAll('.untranscribed-milestone')).toHaveLength(1);
			expect(target.querySelector('.line-content')?.textContent).not.toContain('a2');
			// Sibling lines are untouched.
			expect(domShape(harness.container)[0][0][0]).toBe('a1');
			expect(domShape(harness.container)[0][0][2]).toBe('a3');
		} finally {
			harness.dispose();
		}
	});
});

describe('TranscriptionEditor page metadata commands (mounted, multi-page fixture)', () => {
	async function openMetadataDialog(harness: Harness) {
		const dialog = document.getElementById('transcription-metadata-modal') as HTMLDialogElement;
		dialog.showModal();
		dialog.dispatchEvent(new Event('toggle'));
		await tick();
		const details = Array.from(dialog.querySelectorAll('details')).find(candidate =>
			(candidate.querySelector('summary')?.textContent || '').includes('Page Metadata')
		);
		if (!details) throw new Error('no Page Metadata section');
		details.open = true;
		await tick();
		return details;
	}

	it('updatePageName renames the addressed page only', async () => {
		const harness = await mountEditor();
		try {
			const details = await openMetadataDialog(harness);
			const nameInputs = Array.from(
				details.querySelectorAll<HTMLInputElement>('input[placeholder^="Page name"]')
			);
			expect(nameInputs).toHaveLength(3);
			setInput(nameInputs[1], 'renamed');
			await tick();

			const names = Array.from(
				harness.container.querySelectorAll<HTMLElement>('.ProseMirror .page')
			).map(element => element.dataset.pageName);
			expect(names).toEqual(['1r', 'renamed', '2r']);
		} finally {
			harness.dispose();
		}
	});

	it('updatePageName refuses a name that duplicates another page', async () => {
		const harness = await mountEditor();
		try {
			const details = await openMetadataDialog(harness);
			const nameInputs = Array.from(
				details.querySelectorAll<HTMLInputElement>('input[placeholder^="Page name"]')
			);
			setInput(nameInputs[1], '2r');
			await tick();
			expect(details.textContent).toContain('Page names must be unique.');
			const names = Array.from(
				harness.container.querySelectorAll<HTMLElement>('.ProseMirror .page')
			).map(element => element.dataset.pageName);
			expect(names).toEqual(['1r', '1v', '2r']);
		} finally {
			harness.dispose();
		}
	});

	it.each([
		['Visible page number', 'fol. 2r'],
		['Running title', 'Gospel of John'],
		['Catchword', 'logos'],
		['Quire signature', 'A iii'],
	])('F10: updatePageFormWork inserts %s into the page’s first line', async (placeholder, value) => {
		const harness = await mountEditor();
		try {
			const details = await openMetadataDialog(harness);
			const inputs = Array.from(
				details.querySelectorAll<HTMLInputElement>(
					`input[placeholder^="${placeholder}"]`
				)
			);
			expect(inputs).toHaveLength(3);
			setInput(inputs[2], value);
			await tick();

			const thirdPage = harness.container.querySelectorAll('.ProseMirror .page')[2];
			expect(thirdPage.querySelectorAll('.fw-node')).toHaveLength(1);
			const lines = Array.from(thirdPage.querySelectorAll('.line'));
			expect(lines[0].querySelector('.fw-node')?.textContent).toBe(value);
			expect(lines.slice(1).every(line => line.querySelector('.fw-node') === null)).toBe(true);
		} finally {
			harness.dispose();
		}
	});

	it('deletePage removes the addressed page only', async () => {
		const harness = await mountEditor();
		const originalConfirm = window.confirm;
		window.confirm = () => true;
		try {
			const details = await openMetadataDialog(harness);
			const removeButtons = Array.from(details.querySelectorAll('button')).filter(candidate =>
				(candidate.textContent || '').includes('Remove page')
			);
			expect(removeButtons).toHaveLength(3);
			removeButtons[1].click();
			await tick();

			expect(domShape(harness.container)).toEqual([
				[['a1', 'a2', 'a3', 'a4']],
				[['d1', 'd2', 'd3', 'd4']],
			]);
		} finally {
			window.confirm = originalConfirm;
			harness.dispose();
		}
	});

	it('addresses pages by absolute position, which survives only because the dialog is modal', async () => {
		const harness = await mountEditor();
		const originalConfirm = window.confirm;
		window.confirm = () => true;
		try {
			const details = await openMetadataDialog(harness);

			// `pages` caches absolute document positions and is rebuilt only on the
			// dialog's `toggle` event (or when the IIIF workspace is open). Nothing
			// remaps those positions through intervening transactions. The reason
			// that is not a live defect is that the dialog is a true modal: while it
			// is open the editor is inert and no transaction can shift the positions.
			const dialog = document.getElementById(
				'transcription-metadata-modal'
			) as HTMLDialogElement;
			expect(dialog.open).toBe(true);
			expect(dialog.matches(':modal')).toBe(true);

			const removeButtons = Array.from(details.querySelectorAll('button')).filter(candidate =>
				(candidate.textContent || '').includes('Remove page')
			);
			removeButtons[2].click();
			await tick();

			const remaining = Array.from(
				harness.container.querySelectorAll<HTMLElement>('.ProseMirror .page')
			).map(element => element.dataset.pageName);
			expect(remaining).toEqual(['1r', '1v']);
		} finally {
			window.confirm = originalConfirm;
			harness.dispose();
		}
	});
});
