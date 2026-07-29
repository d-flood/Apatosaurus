import { describe, expect, it, vi } from 'vitest';

import {
	control,
	createTestEditor,
	lineElement,
	mountTranscriptionEditor,
	placeCaretAtEndOf,
	tick,
} from '$lib/client/testing/editorHarnesses.svelte';

import { getSelectedTranscriptionQuote } from './editorInteractions';

describe('ticket 15 identifier mappings', () => {
	it('exports a paragraph start toggled in the mounted editor', async () => {
		const harness = await mountTranscriptionEditor();
		let exportedBlob: Blob | undefined;
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
			if (blob instanceof Blob) exportedBlob = blob;
			return 'blob:paragraph-start-export';
		});
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

		try {
			placeCaretAtEndOf(
				lineElement(harness.container, 2, 0, 1).querySelector('.line-content') as HTMLElement
			);
			await tick();
			control(harness.container, 'Toggle paragraph start').click();
			await tick();

			control(harness.container, 'Export as TEI XML').click();
			await tick();
			expect(exportedBlob).toBeDefined();
			const xml = await exportedBlob!.text();
			const lineBreaks = xml.match(/<lb[^>]*\/>/g) ?? [];
			expect(lineBreaks.filter(tag => tag.includes('rend="hang"'))).toHaveLength(1);
		} finally {
			createObjectURL.mockRestore();
			revokeObjectURL.mockRestore();
			harness.dispose();
		}
	});

	it('carries the containing page name in a selection quote', () => {
		const editor = createTestEditor();
		let textPosition = -1;
		editor.state.doc.descendants((node, position) => {
			if (textPosition !== -1) return false;
			if (node.isText && node.text === 'a1') textPosition = position;
			return true;
		});
		expect(textPosition).toBeGreaterThan(-1);
		editor.commands.updateAttributes('page', { pageName: 'folio 1r' });
		editor.commands.setTextSelection({ from: textPosition, to: textPosition + 2 });

		expect(getSelectedTranscriptionQuote(editor)).toMatchObject({
			text: 'a1',
			pageId: 'page-1',
			pageName: 'folio 1r',
			pageOrder: 1,
		});
		editor.destroy();
	});
});
