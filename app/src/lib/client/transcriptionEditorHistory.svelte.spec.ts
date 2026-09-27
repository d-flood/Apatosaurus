import { describe, expect, it } from 'vitest';

import { initializeEditorContent } from './editorContentInitialization';
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

	it('F14: the load is not undoable — a freshly opened transcription has an empty history', async () => {
		const editor = createTestEditor({ content: HISTORY_FIXTURE });
		try {
			expect(shape(editor)).toEqual(LOADED);
			expect((editor as any).can().undo()).toBe(false);

			editor.commands.undo();
			expect(shape(editor)).toEqual(LOADED);

			editor.commands.redo();
			expect(shape(editor)).toEqual(LOADED);
		} finally {
			editor.destroy();
		}
	});

	it('F14: the first edit is its own history event even inside the grouping window', async () => {
		const editor = createTestEditor({ content: HISTORY_FIXTURE });
		try {
			editor.commands.setTextSelection(4);
			editor.commands.insertContent('X');
			expect(shape(editor)[0][0][0]).toBe('aX1');

			editor.commands.undo();
			expect(shape(editor)).toEqual(LOADED);
		} finally {
			editor.destroy();
		}
	});

	it('F14: after the grouping window one undo removes the edit and there is nothing behind it', async () => {
		const editor = createTestEditor({ content: HISTORY_FIXTURE });
		try {
			await newHistoryGroup();
			editor.commands.setTextSelection(4);
			editor.commands.insertContent('X');
			await newHistoryGroup();

			editor.commands.undo();
			expect(shape(editor)).toEqual(LOADED);
			expect((editor as any).can().undo()).toBe(false);
			editor.commands.undo();
			expect(shape(editor)).toEqual(LOADED);
		} finally {
			editor.destroy();
		}
	});
});

describe('initializeEditorContent init-only invariant', () => {
	it('still refuses a second initialization of the same editor', () => {
		const editor = createTestEditor({ content: HISTORY_FIXTURE });
		try {
			expect(() => initializeEditorContent(editor, HISTORY_FIXTURE as any)).toThrow(
				/init-only/
			);
			expect(shape(editor)).toEqual(LOADED);
		} finally {
			editor.destroy();
		}
	});
});
