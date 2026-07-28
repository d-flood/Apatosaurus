/**
 * Undo/redo behaviour under the editor's appended transactions.
 *
 * Answers inventory question 5 for ticket 01 of the
 * `refactor-transcription-editor` epic. `LineNumberNormalizer` appends a repair
 * or renumber transaction after most edits; the question was whether those
 * appended transactions fragment or poison the undo stack. They do not — but
 * the initial `setContent` does sit in the history, which is worse.
 *
 * See `.tracker/refactor-transcription-editor/INVENTORY.md`.
 */
import { describe, expect, it } from 'vitest';

import { editorDocument, modelDocumentSnapshot } from './testing/editorFixtures';
import { createTestEditor } from './testing/editorHarnesses.svelte';
import { createColumnSplitTransaction } from './transcriptionEditorStructure';

function shape(editor: any): string[][][] {
	return modelDocumentSnapshot(editor.state.doc);
}

const LOADED = [
	[['a1', 'a2', 'a3', 'a4']],
	[
		['b1', 'b2', 'b3', 'b4'],
		['c1', 'c2', 'c3', 'c4'],
	],
];

const HISTORY_FIXTURE = editorDocument({ pages: editorDocument({}).content.slice(0, 2) });

/** Longer than the history plugin's `newGroupDelay`, so edits become separate steps. */
function newHistoryGroup() {
	return new Promise(resolve => setTimeout(resolve, 600));
}

describe('undo/redo under appended repair and renumber transactions', () => {
	it('undoes a typed character in one step, and redoes it', async () => {
		const editor = createTestEditor({ content: HISTORY_FIXTURE });
		try {
			editor.commands.setTextSelection(4);
			editor.commands.insertContent('X');
			await newHistoryGroup();
			editor.commands.insertContent('Y');
			expect(shape(editor)[0][0][0]).toBe('aXY1');

			editor.commands.undo();
			expect(shape(editor)[0][0][0]).toBe('aX1');
			editor.commands.redo();
			expect(shape(editor)[0][0][0]).toBe('aXY1');
		} finally {
			editor.destroy();
		}
	});

	it('undoes a column split in one step even though repair appended a whole-document replace', async () => {
		const editor = createTestEditor({ content: HISTORY_FIXTURE });
		try {
			editor.commands.setTextSelection(4);
			editor.commands.insertContent('X');
			await newHistoryGroup();

			const columnNode = editor.state.doc.child(0).child(0);
			editor.commands.setTextSelection(3 + columnNode.child(0).nodeSize + 1);
			editor.view.dispatch(createColumnSplitTransaction(editor.state)!);
			expect(shape(editor)[0]).toHaveLength(2);

			// The appended repair transaction is folded into the same history event,
			// so one undo restores the pre-split document exactly.
			editor.commands.undo();
			expect(shape(editor)).toEqual([
				[['aX1', 'a2', 'a3', 'a4']],
				[
					['b1', 'b2', 'b3', 'b4'],
					['c1', 'c2', 'c3', 'c4'],
				],
			]);
		} finally {
			editor.destroy();
		}
	});

	it('undoes an Enter in one step', async () => {
		const editor = createTestEditor({ content: HISTORY_FIXTURE });
		try {
			editor.commands.setTextSelection(4);
			editor.commands.insertContent('X');
			await newHistoryGroup();

			editor.commands.setTextSelection(4);
			(editor as any).view.someProp('handleKeyDown', (fn: any) =>
				fn(
					(editor as any).view,
					new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
				)
			);
			await Promise.resolve();
			expect(shape(editor)[0][0].length).toBeGreaterThan(4);

			editor.commands.undo();
			expect(shape(editor)[0][0]).toEqual(['aX1', 'a2', 'a3', 'a4']);
		} finally {
			editor.destroy();
		}
	});

	it('DEFECT F14: the load itself is undoable — one undo past the first edit empties the manuscript', async () => {
		const editor = createTestEditor({ content: HISTORY_FIXTURE });
		try {
			expect(shape(editor)).toEqual(LOADED);
			// Nothing has been edited, yet there is something to undo.
			expect((editor as any).can().undo()).toBe(true);

			editor.commands.undo();
			expect(shape(editor)).toEqual([]);

			// Redo brings it back, so the loss is recoverable until the next edit
			// clears the redo stack.
			editor.commands.redo();
			expect(shape(editor)).toEqual(LOADED);
		} finally {
			editor.destroy();
		}
	});

	it('DEFECT F14: the first edit is grouped with the load, so one undo wipes the manuscript', async () => {
		const editor = createTestEditor({ content: HISTORY_FIXTURE });
		try {
			// A user who starts typing within `newGroupDelay` of the document
			// appearing gets their first keystroke merged into the same history
			// event as the load.
			editor.commands.setTextSelection(4);
			editor.commands.insertContent('X');
			expect(shape(editor)[0][0][0]).toBe('aX1');

			editor.commands.undo();
			expect(shape(editor)).toEqual([]);
		} finally {
			editor.destroy();
		}
	});

	it('DEFECT F14: after the grouping window the load is still one undo away', async () => {
		const editor = createTestEditor({ content: HISTORY_FIXTURE });
		try {
			await newHistoryGroup();
			editor.commands.setTextSelection(4);
			editor.commands.insertContent('X');
			await newHistoryGroup();

			editor.commands.undo();
			expect(shape(editor)).toEqual(LOADED);
			editor.commands.undo();
			expect(shape(editor)).toEqual([]);
		} finally {
			editor.destroy();
		}
	});
});
