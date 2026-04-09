import { describe, expect, it } from 'vitest';

import { getEditor } from './transcriptionEditorSchema';
import {
	createEmptyLineInsertTransaction,
	createColumnSplitTransaction,
	createLineSplitTransaction,
	findLineStartPositionById,
	LINE_SPLIT_TARGET_LINE_ID_META,
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
		expect(page.content[0].content).toEqual([{ type: 'line', attrs: { lineNumber: 1 } }]);
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
									attrs: {
										lineNumber: 1,
										lineId: 'line-1',
										'paragraph-start': true,
									},
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

	it('does not reorder framed page columns during repair', () => {
		const result = repairManuscriptStructureJson({
			type: 'manuscript',
			content: [
				{
					type: 'page',
					attrs: { pageId: 'page-1' },
					content: [
						{
							type: 'column',
							attrs: { columnNumber: 1, zone: 'center' },
							content: [{ type: 'line', attrs: { lineNumber: 1 }, content: [] }],
						},
						{
							type: 'column',
							attrs: { columnNumber: 2, zone: 'top' },
							content: [{ type: 'line', attrs: { lineNumber: 1 }, content: [] }],
						},
						{
							type: 'column',
							attrs: { columnNumber: 3, zone: 'right' },
							content: [{ type: 'line', attrs: { lineNumber: 1 }, content: [] }],
						},
						{
							type: 'column',
							attrs: { columnNumber: 4, zone: 'bottom' },
							content: [{ type: 'line', attrs: { lineNumber: 1 }, content: [] }],
						},
						{
							type: 'column',
							attrs: { columnNumber: 5, zone: 'left' },
							content: [{ type: 'line', attrs: { lineNumber: 1 }, content: [] }],
						},
					],
				},
			],
		});

		expect(result.doc.content[0].content.map((column: any) => column.attrs.zone)).toEqual([
			'center',
			'top',
			'right',
			'bottom',
			'left',
		]);
		expect(result.issues.some(issue => issue.includes('reordered framed page columns'))).toBe(
			false
		);
	});

	it('can normalize framed page columns into visual order and assign stable ids on load', () => {
		const result = repairManuscriptStructureJson(
			{
				type: 'manuscript',
				content: [
					{
						type: 'page',
						attrs: { pageId: 'page-1' },
						content: [
							{
								type: 'column',
								attrs: { columnNumber: 1, zone: 'center' },
								content: [{ type: 'line', attrs: { lineNumber: 1 }, content: [] }],
							},
							{
								type: 'column',
								attrs: { columnNumber: 2, zone: 'top' },
								content: [{ type: 'line', attrs: { lineNumber: 1 }, content: [] }],
							},
							{
								type: 'column',
								attrs: { columnNumber: 3, zone: 'right' },
								content: [{ type: 'line', attrs: { lineNumber: 1 }, content: [] }],
							},
							{
								type: 'column',
								attrs: { columnNumber: 4, zone: 'bottom' },
								content: [{ type: 'line', attrs: { lineNumber: 1 }, content: [] }],
							},
							{
								type: 'column',
								attrs: { columnNumber: 5, zone: 'left' },
								content: [{ type: 'line', attrs: { lineNumber: 1 }, content: [] }],
							},
						],
					},
				],
			},
			{
				framedPageZoneOrder: 'visual',
				ensureNodeIds: true,
			}
		);

		expect(result.doc.content[0].content.map((column: any) => column.attrs.zone)).toEqual([
			'top',
			'left',
			'right',
			'bottom',
			'center',
		]);
		for (const column of result.doc.content[0].content) {
			expect(column.attrs.columnId).toEqual(expect.any(String));
			expect(column.content[0].attrs.lineId).toEqual(expect.any(String));
		}
	});

	it('keeps selection in the active framed-page column after a text edit', () => {
		const editor = createTestEditor({
			type: 'manuscript',
			content: [
				{
					type: 'page',
					attrs: { pageId: 'page-1' },
					content: [
						{
							type: 'column',
							attrs: { columnNumber: 1, zone: 'top', columnId: 'col-top' },
							content: [
								{
									type: 'line',
									attrs: { lineNumber: 1, lineId: 'line-top' },
									content: [{ type: 'text', text: 'top text' }],
								},
							],
						},
						{
							type: 'column',
							attrs: { columnNumber: 2, zone: 'center', columnId: 'col-center' },
							content: [
								{
									type: 'line',
									attrs: { lineNumber: 1, lineId: 'line-center' },
									content: [{ type: 'text', text: 'center text' }],
								},
							],
						},
						{
							type: 'column',
							attrs: { columnNumber: 3, zone: 'bottom', columnId: 'col-bottom' },
							content: [
								{
									type: 'line',
									attrs: { lineNumber: 1, lineId: 'line-bottom' },
									content: [{ type: 'text', text: 'bottom text' }],
								},
							],
						},
					],
				},
			],
		});

		try {
			let centerTextPos: number | null = null;
			editor.state.doc.descendants((node, pos) => {
				if (node.isText && node.text === 'center text' && centerTextPos === null) {
					centerTextPos = pos;
					return false;
				}
				return true;
			});
			expect(centerTextPos).not.toBeNull();
			if (centerTextPos === null) throw new Error('center text position not found');

			editor.commands.setTextSelection(centerTextPos + 3);
			editor.commands.insertContent('X');

			const resolved = editor.state.selection.$from;
			let selectedColumnDepth = -1;
			for (let depth = resolved.depth; depth >= 0; depth--) {
				if (resolved.node(depth).type.name === 'column') {
					selectedColumnDepth = depth;
					break;
				}
			}

			expect(selectedColumnDepth).toBeGreaterThan(-1);
			if (selectedColumnDepth < 0) throw new Error('selected column not found');
			const json = editor.getJSON() as any;
			expect(resolved.node(selectedColumnDepth).attrs.zone).toBe('center');
			expect(json.content[0].content[1].content[0].content[0].text).toBe('cenXter text');
		} finally {
			editor.destroy();
		}
	});

	it('keeps selection in place when a text edit triggers line normalization elsewhere in the document', () => {
		const editor = createTestEditor({
			type: 'manuscript',
			content: [
				{
					type: 'page',
					attrs: { pageId: 'page-1' },
					content: [
						{
							type: 'column',
							attrs: { columnNumber: 1, zone: 'top' },
							content: [
								{
									type: 'line',
									attrs: { lineNumber: 1 },
									content: [{ type: 'text', text: 'alpha' }],
								},
							],
						},
					],
				},
				{
					type: 'page',
					attrs: { pageId: 'page-2' },
					content: [
						{
							type: 'column',
							attrs: { columnNumber: 1, zone: 'bottom' },
							content: [
								{
									type: 'line',
									attrs: { lineNumber: 1 },
									content: [{ type: 'text', text: 'omega' }],
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
				if (node.isText && node.text === 'alpha' && firstTextPos === null) {
					firstTextPos = pos;
					return false;
				}
				return true;
			});
			expect(firstTextPos).not.toBeNull();
			if (firstTextPos === null) throw new Error('first text position not found');

			editor.commands.setTextSelection(firstTextPos + 2);
			editor.commands.insertContent('X');

			const resolved = editor.state.selection.$from;
			let selectedPageDepth = -1;
			let selectedColumnDepth = -1;
			for (let depth = resolved.depth; depth >= 0; depth--) {
				if (selectedColumnDepth === -1 && resolved.node(depth).type.name === 'column') {
					selectedColumnDepth = depth;
				}
				if (resolved.node(depth).type.name === 'page') {
					selectedPageDepth = depth;
					break;
				}
			}

			expect(selectedPageDepth).toBeGreaterThan(-1);
			expect(selectedColumnDepth).toBeGreaterThan(-1);
			if (selectedPageDepth < 0 || selectedColumnDepth < 0) {
				throw new Error('selected page or column not found');
			}

			expect(resolved.node(selectedPageDepth).attrs.pageId).toBe('page-1');
			expect(resolved.node(selectedColumnDepth).attrs.zone).toBe('top');
		} finally {
			editor.destroy();
		}
	});

	it('splits the current line in place and keeps selection in the same column', () => {
		const editor = createTestEditor({
			type: 'manuscript',
			content: [
				{
					type: 'page',
					attrs: { pageId: 'page-1' },
					content: [
						{
							type: 'column',
							attrs: { columnNumber: 1, zone: 'right', columnId: 'col-right' },
							content: [
								{
									type: 'line',
									attrs: { lineNumber: 1, lineId: 'line-1' },
									content: [{ type: 'text', text: 'alpha beta' }],
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
			const tr = createLineSplitTransaction(editor.state);
			expect(tr).not.toBeNull();

			const nextState = editor.state.apply(tr!);
			const column = nextState.doc.toJSON().content[0].content[0];
			const targetLineId = tr!.getMeta(LINE_SPLIT_TARGET_LINE_ID_META) as string | undefined;
			expect(column.attrs.zone).toBe('right');
			expect(column.content).toHaveLength(2);
			expect(column.content[0].content[0].text).toBe('alpha ');
			expect(column.content[1].content[0].text).toBe('beta');
			expect(targetLineId).toBe(column.content[1].attrs.lineId);
			expect(findLineStartPositionById(nextState.doc, targetLineId)).not.toBeNull();

			const resolved = nextState.selection.$from;
			let selectedColumnDepth = -1;
			for (let depth = resolved.depth; depth >= 0; depth--) {
				if (resolved.node(depth).type.name === 'column') {
					selectedColumnDepth = depth;
					break;
				}
			}

			expect(selectedColumnDepth).toBeGreaterThan(-1);
			expect(resolved.node(selectedColumnDepth).attrs.zone).toBe('right');
		} finally {
			editor.destroy();
		}
	});

	it('splitting an already empty line inserts only one new empty line', () => {
		const editor = createTestEditor({
			type: 'manuscript',
			content: [
				{
					type: 'page',
					attrs: { pageId: 'page-1' },
					content: [
						{
							type: 'column',
							attrs: { columnNumber: 1, zone: 'top', columnId: 'col-top' },
							content: [{ type: 'line', attrs: { lineNumber: 1, lineId: 'line-1' } }],
						},
					],
				},
			],
		});

		try {
			const firstLinePos = findLineStartPositionById(editor.state.doc, 'line-1');
			expect(firstLinePos).not.toBeNull();
			if (firstLinePos === null) throw new Error('first line position not found');

			editor.commands.setTextSelection(firstLinePos);
			const first = createLineSplitTransaction(editor.state);
			expect(first).not.toBeNull();
			editor.view.dispatch(first!);

			const secondLineId = first!.getMeta(LINE_SPLIT_TARGET_LINE_ID_META) as
				| string
				| undefined;
			expect(secondLineId).toEqual(expect.any(String));
			const secondLinePos = findLineStartPositionById(editor.state.doc, secondLineId);
			expect(secondLinePos).not.toBeNull();
			if (secondLinePos === null) throw new Error('second line position not found');

			editor.commands.setTextSelection(secondLinePos);
			const second = createEmptyLineInsertTransaction(editor.state);
			expect(second).not.toBeNull();
			const nextState = editor.state.apply(second!);

			const lines = nextState.doc.toJSON().content[0].content[0].content;
			expect(lines).toHaveLength(3);
			expect(lines.map((line: any) => line.attrs.lineNumber)).toEqual([1, 2, 3]);
		} finally {
			editor.destroy();
		}
	});
});
