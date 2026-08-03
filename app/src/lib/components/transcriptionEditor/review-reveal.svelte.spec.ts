import { describe, expect, it, beforeEach } from 'vitest';
import { userEvent } from '@vitest/browser/context';
import { vi } from 'vitest';

import type { TranscriptionDocument } from '$lib/tei/tei-transcription';
import {
	control,
	mountTranscriptionEditor,
	placeCaretAtEndOf,
	tick,
} from '$lib/client/testing/editorHarnesses.svelte';

function markedText(text: string) {
	return {
		type: 'text' as const,
		text,
		marks: [{ type: 'unconfirmed' as const, attrs: {} }],
	};
}

function plainText(text: string) {
	return { type: 'text' as const, text };
}

function verse(number: string) {
	return {
		type: 'milestone' as const,
		kind: 'verse' as const,
		attrs: { book: 'John', chapter: '1', verse: number },
	};
}

function markedVersesDocument(secondVerseMarked = true): TranscriptionDocument {
	return {
		type: 'transcriptionDocument',
		pages: [
			{
				type: 'page',
				id: '1r',
				pageId: 'page-1',
				columns: [
					{
						type: 'column',
						number: 1,
						lines: [
							{
								type: 'line',
								number: 1,
								items: [
									{
										type: 'milestone',
										kind: 'book',
										attrs: { book: 'John' },
									},
									{
										type: 'milestone',
										kind: 'chapter',
										attrs: { book: 'John', chapter: '1' },
									},
									verse('1'),
									markedText('alpha'),
									{ type: 'boundary', kind: 'word' },
									plainText('middle'),
									{ type: 'boundary', kind: 'word' },
									markedText('gamma'),
									{ type: 'boundary', kind: 'word' },
									verse('2'),
									secondVerseMarked ? markedText('delta') : plainText('delta'),
								],
							},
						],
					},
				],
			},
		],
	};
}

function buttonByText(container: ParentNode, text: string): HTMLButtonElement {
	const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
		candidate => candidate.textContent?.trim() === text
	);
	if (!button) throw new Error(`Missing button: ${text}`);
	return button;
}

function placeCaretInText(container: ParentNode, text: string) {
	const element = Array.from(container.querySelectorAll<HTMLElement>('.unconfirmed')).find(
		candidate => candidate.textContent === text
	);
	if (!element) throw new Error(`Missing marked text: ${text}`);
	placeCaretAtEndOf(element);
}

function placeCaretAfterText(container: ParentNode, text: string) {
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let node: Node | null = walker.nextNode();
	while (node) {
		const nodeText = node.textContent || '';
		const textStart = nodeText.indexOf(text);
		if (textStart >= 0) {
			const range = document.createRange();
			range.setStart(node, textStart + text.length);
			range.collapse(true);
			const selection = window.getSelection();
			if (!selection) throw new Error('No selection');
			selection.removeAllRanges();
			selection.addRange(range);
			(container.querySelector('.ProseMirror') as HTMLElement | null)?.focus();
			return;
		}
		node = walker.nextNode();
	}
	throw new Error(`Missing text: ${text}`);
}

async function exportXml(container: ParentNode): Promise<string> {
	let blob: Blob | undefined;
	const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(value => {
		blob = value as Blob;
		return 'blob:review-reveal';
	});
	const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

	try {
		control(container, 'Export as TEI XML').click();
		await tick();
		if (!blob) throw new Error('Export did not create a Blob');
		return await blob.text();
	} finally {
		createObjectURL.mockRestore();
		revokeObjectURL.mockRestore();
	}
}

describe('unconfirmed verse review and export', () => {
	beforeEach(() => {
		localStorage.removeItem('markVisibility');
	});

	it('reviews only the current verse and leaves its adjacent verse unconfirmed', async () => {
		const harness = await mountTranscriptionEditor({
			document: markedVersesDocument(),
			id: 'review-current-verse',
		});
		try {
			placeCaretInText(harness.container, 'alpha');
			await tick();
			control(harness.container, 'Review current verse').click();
			await tick();

			const xml = await exportXml(harness.container);
			expect(xml).not.toContain('type="unconfirmed">alpha');
			expect(xml).not.toContain('type="unconfirmed">gamma');
			expect(xml).toContain('type="unconfirmed">delta');
		} finally {
			harness.dispose();
		}
	});

	it('keeps a reviewed verse clear after editing inside it', async () => {
		const harness = await mountTranscriptionEditor({
			document: markedVersesDocument(),
			id: 'review-edit-verse',
		});
		try {
			placeCaretInText(harness.container, 'alpha');
			await tick();
			control(harness.container, 'Review current verse').click();
			await tick();
			placeCaretAfterText(harness.container, 'alpha');
			await userEvent.keyboard(' edited');

			const xml = await exportXml(harness.container);
			expect(xml).not.toContain('type="unconfirmed">alpha');
			expect(xml).not.toContain('type="unconfirmed">edited');
			expect(xml).toContain('type="unconfirmed">delta');
		} finally {
			harness.dispose();
		}
	});

	it('counts verses rather than separate unconfirmed runs', async () => {
		const harness = await mountTranscriptionEditor({
			document: markedVersesDocument(),
			id: 'count-unconfirmed-verses',
		});
		try {
			await expect
				.element(
					harness.container.querySelector('[data-testid="unconfirmed-verse-count"]')!
				)
				.toHaveTextContent('2 verses unconfirmed');

			placeCaretInText(harness.container, 'alpha');
			await tick();
			control(harness.container, 'Review current verse').click();
			await expect
				.element(
					harness.container.querySelector('[data-testid="unconfirmed-verse-count"]')!
				)
				.toHaveTextContent('1 verse unconfirmed');
		} finally {
			harness.dispose();
		}
	});

	it('hiding unconfirmed text changes neither the document nor its export', async () => {
		const harness = await mountTranscriptionEditor({
			document: markedVersesDocument(),
			id: 'toggle-unconfirmed-visibility',
		});
		try {
			const before = await exportXml(harness.container);
			buttonByText(harness.container, 'Layers').click();
			await tick();
			const checkbox = Array.from(harness.container.querySelectorAll('label'))
				.find(label => label.textContent?.includes('Unconfirmed Text'))
				?.querySelector('input') as HTMLInputElement | null;
			if (!checkbox) throw new Error('Missing unconfirmed visibility checkbox');
			checkbox.click();
			await tick();

			expect(harness.container.querySelector('.hide-unconfirmed')).not.toBeNull();
			expect(harness.container.querySelector('.unconfirmed')?.textContent).toBe('alpha');
			expect(
				harness.container.querySelector('[data-testid="unconfirmed-verse-count"]')
					?.textContent
			).toContain('2 verses unconfirmed');
			expect(await exportXml(harness.container)).toBe(before);
		} finally {
			harness.dispose();
		}
	});

	it('warns about unconfirmed verses while still producing the export file', async () => {
		const harness = await mountTranscriptionEditor({
			document: markedVersesDocument(false),
			id: 'warn-unconfirmed-export',
		});
		try {
			const xml = await exportXml(harness.container);
			await expect
				.element(
					harness.container.querySelector('[data-testid="unconfirmed-export-warning"]')!
				)
				.toHaveTextContent('1 verse unconfirmed');
			expect(xml).toContain('type="unconfirmed">alpha');
		} finally {
			harness.dispose();
		}
	});
});
