import { describe, expect, it } from 'vitest';

import { getEditor } from './transcriptionEditorSchema';
import {
	createColumnSplitTransaction,
	repairManuscriptStructureJson,
} from './transcriptionEditorStructure';

function createTestEditor(initialContent: Record<string, any>) {
	const element = document.createElement('div');
	const bubbleMenu = document.createElement('div');
	const editor = getEditor(element, bubbleMenu);
	editor.commands.setContent(initialContent as any, { emitUpdate: false });
	return editor;
}

describe('transcriptionEditorStructure', () => {
	it('repairs empty columns and wraps stray page children into valid columns and lines', () => {
		const result = repairManuscriptStructureJson({
			type: 'manuscript',
			content: [
				{
					type: 'page',
					attrs: { pageId: 'page-1' },
					content: [
						{ type: 'column', attrs: { columnNumber: 9 }, content: [] },
						{
							type: 'line',
							attrs: { lineNumber: 11 },
							content: [{ type: 'text', text: 'orphan line' }],
						},
						{
							type: 'column',
							attrs: { columnNumber: 12 },
							content: [{ type: 'text', text: 'wrapped text' }],
						},
					],
				},
			],
		});

		expect(result.repaired).toBe(true);
		expect(result.issues.length).toBeGreaterThan(0);

		const page = result.doc.content[0];
		expect(page.content).toHaveLength(3);
		expect(page.content[0].attrs.columnNumber).toBe(1);
		expect(page.content[0].content).toEqual([{ type: 'line', attrs: { lineNumber: 1 }, content: [] }]);
		expect(page.content[1].attrs.columnNumber).toBe(2);
		expect(page.content[1].content[0].content[0].text).toBe('orphan line');
		expect(page.content[2].attrs.columnNumber).toBe(3);
		expect(page.content[2].content[0].content[0].text).toBe('wrapped text');
	});

	it('splits the current column by splitting the current line instead of cutting raw column content', () => {
		const editor = createTestEditor({
			type: 'manuscript',
			content: [
				{
					type: 'page',
					attrs: { pageId: 'page-1' },
					content: [
						{
							type: 'column',
							attrs: { columnNumber: 1 },
							content: [
								{
									type: 'line',
									attrs: { lineNumber: 1, lineId: 'line-1', 'paragraph-start': true },
									content: [{ type: 'text', text: 'alpha beta' }],
								},
								{
									type: 'line',
									attrs: { lineNumber: 2, lineId: 'line-2' },
									content: [{ type: 'text', text: 'gamma' }],
								},
							],
						},
					],
				},
			],
		});

		try {
			let firstTextPos: number | null = null;
			editor.state.doc.descendants((node, pos) => {
				if (!node.isText || firstTextPos !== null) return true;
				firstTextPos = pos;
				return false;
			});
			expect(firstTextPos).not.toBeNull();
			if (firstTextPos === null) throw new Error('first text position not found');

			editor.commands.setTextSelection(firstTextPos + 6);
			const tr = createColumnSplitTransaction(editor.state);
			expect(tr).not.toBeNull();

			const nextState = editor.state.apply(tr!);
			const page = nextState.doc.toJSON().content[0];
			expect(page.content).toHaveLength(2);
			expect(page.content[0].content[0].content[0].text).toBe('alpha ');
			expect(page.content[1].content[0].content[0].text).toBe('beta');
			expect(page.content[1].content[1].content[0].text).toBe('gamma');
			expect(page.content[1].content[0].attrs['paragraph-start']).toBe(false);
		} finally {
			editor.destroy();
		}
	});

	it('keeps the original frame-zone on the first column and leaves the new column unzoned', () => {
		const editor = createTestEditor({
			type: 'manuscript',
			content: [
				{
					type: 'page',
					attrs: { pageId: 'page-1' },
					content: [
						{
							type: 'column',
							attrs: { columnNumber: 1, zone: 'center' },
							content: [
								{
									type: 'line',
									attrs: { lineNumber: 1 },
									content: [{ type: 'text', text: 'abcd' }],
								},
							],
						},
					],
				},
			],
		});

		try {
			let firstTextPos: number | null = null;
			editor.state.doc.descendants((node, pos) => {
				if (!node.isText || firstTextPos !== null) return true;
				firstTextPos = pos;
				return false;
			});
			expect(firstTextPos).not.toBeNull();
			if (firstTextPos === null) throw new Error('first text position not found');

			editor.commands.setTextSelection(firstTextPos + 2);
			const tr = createColumnSplitTransaction(editor.state);
			expect(tr).not.toBeNull();

			const page = editor.state.apply(tr!).doc.toJSON().content[0];
			expect(page.content[0].attrs.zone).toBe('center');
			expect(page.content[1].attrs.zone).toBeNull();
		} finally {
			editor.destroy();
		}
	});
});
