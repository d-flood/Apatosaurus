/**
 * The save path for the editor's document, exercised end to end.
 *
 * Ticket 08 of the `refactor-transcription-editor` epic (SPEC.md § D6,
 * INVENTORY.md F36): the editor's own Enter-on-a-blank-line command produced a
 * line that `fromProseMirror` -> `normalizeDocument` deleted again, so autosave
 * persisted a document without it. These tests run the real Enter keybinding
 * and then the real autosave conversion and store round trip.
 */
import { describe, expect, it } from 'vitest';

import { fromProseMirror, type TranscriptionDocument } from '$lib/tei/tei-transcription';

import { editorPlainPage, modelDocumentSnapshot } from '../testing/editorFixtures';
import { createTestEditor } from '../testing/editorHarnesses.svelte';
import { coerceTranscriptionDocument, serializeTranscriptionDocument } from './content';

function blankLineFixture() {
	return {
		type: 'manuscript',
		content: [editorPlainPage({ pageId: 'p', texts: [['alpha', '', 'beta', '']] })],
	};
}

/** Position just inside the start of the Nth line of page 0, column 0. */
function lineStart(doc: any, lineIndex: number): number {
	const columnNode = doc.child(0).child(0);
	let linePos = 1 + 1;
	for (let index = 0; index < lineIndex; index += 1) {
		linePos += columnNode.child(index).nodeSize;
	}
	return linePos + 1;
}

function pressEnter(editor: any): boolean {
	return editor.view.someProp('handleKeyDown', (fn: any) =>
		fn(editor.view, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
	);
}

/** What autosave does with the editor's JSON before it reaches the store. */
function saveAndReload(editorJson: unknown): TranscriptionDocument {
	const converted = fromProseMirror(editorJson as any);
	const stored = coerceTranscriptionDocument(serializeTranscriptionDocument(converted));
	if (!stored) throw new Error('stored document did not round trip');
	return stored;
}

function storedLineTexts(document_: TranscriptionDocument): string[] {
	return modelDocumentSnapshot(document_)[0][0];
}

describe('the transcription save path', () => {
	it('keeps blank lines the user typed, wherever they sit in the column', () => {
		const editor = createTestEditor({ content: blankLineFixture() as any, attach: true });
		try {
			const stored = saveAndReload(editor.getJSON());

			expect(storedLineTexts(stored)).toEqual(['alpha', '', 'beta', '']);
			expect(stored.pages[0].columns[0].lines.map(line => line.number)).toEqual([1, 2, 3, 4]);
		} finally {
			editor.destroy();
		}
	});

	it('keeps the line the Enter keybinding inserts on a blank line', async () => {
		const editor = createTestEditor({ content: blankLineFixture() as any, attach: true });
		try {
			editor.commands.setTextSelection(lineStart(editor.state.doc, 1));
			expect(pressEnter(editor)).toBe(true);
			// The Enter handler finishes placing the caret in a microtask.
			await Promise.resolve();
			await Promise.resolve();
			expect(modelDocumentSnapshot(editor.state.doc)[0][0]).toEqual([
				'alpha',
				'',
				'',
				'beta',
				'',
			]);

			const stored = saveAndReload(editor.getJSON());

			expect(storedLineTexts(stored)).toEqual(['alpha', '', '', 'beta', '']);
			expect(stored.pages[0].columns[0].lines.map(line => line.number)).toEqual([
				1, 2, 3, 4, 5,
			]);
		} finally {
			editor.destroy();
		}
	});

	it('still guarantees one line per column and one column per page', () => {
		const stored = coerceTranscriptionDocument({
			type: 'transcriptionDocument',
			pages: [
				{ type: 'page', id: '1r', columns: [{ type: 'column', number: 1, lines: [] }] },
				{ type: 'page', id: '1v', columns: [] },
			],
		});

		expect(stored?.pages[0].columns[0].lines).toHaveLength(1);
		expect(stored?.pages[1].columns).toHaveLength(1);
	});
});
