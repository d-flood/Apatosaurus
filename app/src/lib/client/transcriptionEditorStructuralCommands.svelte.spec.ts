/**
 * Characterization tests for the hand-built structural transactions.
 *
 * Written for ticket 01 of the `refactor-transcription-editor` epic. Every
 * assertion here records *observed* behaviour against a non-degenerate fixture
 * (multi-line columns, multi-column pages, multi-page documents), including
 * behaviour the inventory marks as defective. Where an assertion locks in a
 * defect it is tagged with its inventory identifier (F<n>) and the word
 * DEFECT, so the ticket that fixes it knows exactly which expectation to flip.
 *
 * See `.tracker/refactor-transcription-editor/INVENTORY.md`.
 */
import { describe, expect, it } from 'vitest';

import {
	editorColumn,
	editorDocument,
	editorFramedPage,
	editorLine,
	editorPlainPage,
	modelDocumentSnapshot,
	type EditorJson,
} from './testing/editorFixtures';
import { createTestEditor } from './testing/editorHarnesses.svelte';
import {
	createColumnSplitTransaction,
	createEmptyLineInsertTransaction,
	createLineSplitTransaction,
	findLineStartPositionById,
	repairManuscriptStructureJson,
} from './transcriptionEditorStructure';

type Json = EditorJson;

const multiPageFixture = () => editorDocument({});
const framedPageFixture = () =>
	editorDocument({ pages: [editorFramedPage({ pageId: 'framed-1', pageName: '3r' })] });
const snapshotLines = modelDocumentSnapshot;

function columnAttrs(doc: any, pageIndex: number): Json[] {
	const attrs: Json[] = [];
	doc.child(pageIndex).forEach((columnNode: any) => {
		if (columnNode.type.name !== 'column') return;
		attrs.push(columnNode.attrs);
	});
	return attrs;
}

/** Position just inside the start of the Nth line of the given page/column. */
function lineStart(doc: any, pageIndex: number, columnIndex: number, lineIndex: number): number {
	let pagePos = 0;
	for (let index = 0; index < pageIndex; index += 1) {
		pagePos += doc.child(index).nodeSize;
	}

	const pageNode = doc.child(pageIndex);
	let columnPos = pagePos + 1;
	for (let index = 0; index < columnIndex; index += 1) {
		columnPos += pageNode.child(index).nodeSize;
	}

	const columnNode = pageNode.child(columnIndex);
	let linePos = columnPos + 1;
	for (let index = 0; index < lineIndex; index += 1) {
		linePos += columnNode.child(index).nodeSize;
	}

	return linePos + 1;
}

function selectAt(editor: any, position: number) {
	editor.commands.setTextSelection(position);
}

describe('structural transactions against a multi-line, multi-column, multi-page fixture', () => {
	describe('createLineSplitTransaction', () => {
		it('DEFECT F1: replaces one line with the whole column, duplicating every other line', () => {
			const editor = createTestEditor(multiPageFixture());
			try {
				// Cursor inside "b2", the second of four lines in page 2 column 1.
				const start = lineStart(editor.state.doc, 1, 0, 1);
				selectAt(editor, start + 1);

				const tr = createLineSplitTransaction(editor.state);
				expect(tr).not.toBeNull();
				editor.view.dispatch(tr!);

				// Wanted: ['b1', 'b', '2', 'b3', 'b4'].
				expect(snapshotLines(editor.state.doc)[1][0]).toEqual([
					'b1',
					'b1',
					'b',
					'2',
					'b3',
					'b4',
					'b3',
					'b4',
				]);
			} finally {
				editor.destroy();
			}
		});

		it('is correct only when the column holds a single line', () => {
			const editor = createTestEditor({
				type: 'manuscript',
				content: [
					editorPlainPage({
						pageId: 'p',
						columns: [editorColumn({ lines: [editorLine({ text: 'solo' })] })],
					}),
				],
			});
			try {
				const start = lineStart(editor.state.doc, 0, 0, 0);
				selectAt(editor, start + 2);
				const tr = createLineSplitTransaction(editor.state);
				expect(tr).not.toBeNull();
				editor.view.dispatch(tr!);
				expect(snapshotLines(editor.state.doc)[0][0]).toEqual(['so', 'lo']);
			} finally {
				editor.destroy();
			}
		});
	});

	describe('createEmptyLineInsertTransaction', () => {
		it('inserts exactly one empty line after the current empty line, leaving siblings intact', () => {
			const editor = createTestEditor({
				type: 'manuscript',
				content: [
					editorPlainPage({
						pageId: 'p',
						texts: [['e1', '', 'e3', 'e4']],
					}),
				],
			});
			try {
				const start = lineStart(editor.state.doc, 0, 0, 1);
				selectAt(editor, start);
				const tr = createEmptyLineInsertTransaction(editor.state);
				expect(tr).not.toBeNull();
				editor.view.dispatch(tr!);
				expect(snapshotLines(editor.state.doc)[0][0]).toEqual(['e1', '', '', 'e3', 'e4']);
			} finally {
				editor.destroy();
			}
		});

		it('declines when the current line has content, so Enter falls through to the split path', () => {
			const editor = createTestEditor(multiPageFixture());
			try {
				selectAt(editor, lineStart(editor.state.doc, 1, 1, 2) + 1);
				expect(createEmptyLineInsertTransaction(editor.state)).toBeNull();
			} finally {
				editor.destroy();
			}
		});
	});

	describe('createColumnSplitTransaction', () => {
		it('splits the current column in two without disturbing other pages', () => {
			const editor = createTestEditor(multiPageFixture());
			try {
				// Cursor inside "b3" — third of four lines, page 2 column 1.
				selectAt(editor, lineStart(editor.state.doc, 1, 0, 2) + 1);
				const tr = createColumnSplitTransaction(editor.state);
				expect(tr).not.toBeNull();
				editor.view.dispatch(tr!);

				const snapshot = snapshotLines(editor.state.doc);
				expect(snapshot[0]).toEqual([['a1', 'a2', 'a3', 'a4']]);
				expect(snapshot[2]).toEqual([['d1', 'd2', 'd3', 'd4']]);
				expect(snapshot[1]).toEqual([
					['b1', 'b2', 'b'],
					['3', 'b4'],
					['c1', 'c2', 'c3', 'c4'],
				]);
			} finally {
				editor.destroy();
			}
		});

		it('DEFECT F2: numbers the new column from the document-wide maximum, so every split triggers a whole-document repair', () => {
			const editor = createTestEditor(multiPageFixture());
			try {
				// Split page 1's only column. Page 2 already has columns 1 and 2, so
				// the document-wide maximum is 2 and the new column is numbered 3
				// even though it is the second column of page 1.
				selectAt(editor, lineStart(editor.state.doc, 0, 0, 1) + 1);
				const tr = createColumnSplitTransaction(editor.state);
				expect(tr).not.toBeNull();

				const raw: number[] = [];
				tr!.doc
					.child(0)
					.forEach((columnNode: any) => raw.push(columnNode.attrs.columnNumber));
				// What the command itself produces. Wanted: [1, 2].
				expect(raw).toEqual([1, 3]);

				editor.view.dispatch(tr!);

				// `LineNumberNormalizer.appendTransaction` notices that repair would
				// change the document and answers with `replaceWith(0, doc.size, …)`.
				// The number comes out right, at the cost of replacing the entire
				// document on every column split.
				const settled = columnAttrs(editor.state.doc, 0).map(attrs => attrs.columnNumber);
				expect(settled).toEqual([1, 2]);
			} finally {
				editor.destroy();
			}
		});

		it('DEFECT F3: drops zone and teiAttrs from the second half of a framed-page column', () => {
			const editor = createTestEditor(framedPageFixture());
			try {
				// Split the "center" zone column (index 2).
				selectAt(editor, lineStart(editor.state.doc, 0, 2, 0) + 1);
				const tr = createColumnSplitTransaction(editor.state);
				expect(tr).not.toBeNull();
				editor.view.dispatch(tr!);

				const attrs = columnAttrs(editor.state.doc, 0);
				expect(attrs[2].zone).toBe('center');
				expect(attrs[2].teiAttrs).toEqual({ rend: 'center' });
				// The new column loses both, so it stops being a frame zone at all.
				expect(attrs[3].zone).toBeNull();
				expect(attrs[3].teiAttrs).toEqual({});
			} finally {
				editor.destroy();
			}
		});

		it('DEFECT F4: the raw split output is what repair rejects; the settled document is clean', () => {
			const editor = createTestEditor(multiPageFixture());
			try {
				selectAt(editor, lineStart(editor.state.doc, 0, 0, 1) + 1);
				const tr = createColumnSplitTransaction(editor.state)!;

				// Repair renumbers columns positionally, so the split's own output is
				// always "invalid" by repair's standard.
				expect(repairManuscriptStructureJson(tr.doc.toJSON()).repaired).toBe(true);

				editor.view.dispatch(tr);

				// After the appended repair transaction there is nothing left to fix —
				// evidence that the repair really did run on the keystroke path.
				expect(repairManuscriptStructureJson(editor.state.doc.toJSON()).repaired).toBe(
					false
				);
			} finally {
				editor.destroy();
			}
		});
	});

	describe('findLineStartPositionById', () => {
		it('DEFECT F7: line ids are absent until the first document change', () => {
			const editor = createTestEditor(editorDocument({ nodeIds: false }));
			try {
				const ids: unknown[] = [];
				editor.state.doc.descendants((node: any) => {
					if (node.type.name !== 'line') return true;
					ids.push(node.attrs.lineId);
					return false;
				});
				expect(ids).toHaveLength(16);
				// `LineNumberNormalizer` only runs from `appendTransaction`, so a
				// document that is loaded and never edited has no line identity at
				// all and `findLineStartPositionById` cannot address any of it.
				expect(ids).toEqual(Array(16).fill(null));

				editor.commands.setTextSelection(lineStart(editor.state.doc, 0, 0, 0));
				editor.commands.insertContent('x');

				const idsAfterEdit: unknown[] = [];
				editor.state.doc.descendants((node: any) => {
					if (node.type.name !== 'line') return true;
					idsAfterEdit.push(node.attrs.lineId);
					return false;
				});
				expect(idsAfterEdit.every(id => typeof id === 'string' && id.length > 0)).toBe(
					true
				);
			} finally {
				editor.destroy();
			}
		});

		it('resolves a line id in the middle of a multi-page document', () => {
			const editor = createTestEditor(multiPageFixture());
			try {
				// Force the normalizer to assign ids.
				editor.commands.setTextSelection(lineStart(editor.state.doc, 0, 0, 0));
				editor.commands.insertContent('x');

				const doc = editor.state.doc;
				let target: { id: string; pos: number } | null = null;
				let seen = 0;
				doc.descendants((node: any, pos: number) => {
					if (node.type.name !== 'line') return true;
					seen += 1;
					if (seen === 7) target = { id: node.attrs.lineId, pos };
					return false;
				});
				expect(target).not.toBeNull();
				expect(findLineStartPositionById(doc, target!.id)).toBe(target!.pos + 1);
			} finally {
				editor.destroy();
			}
		});

		it('returns null for an absent id and for a nullish id', () => {
			const editor = createTestEditor(multiPageFixture());
			try {
				expect(
					findLineStartPositionById(editor.state.doc, 'line-does-not-exist')
				).toBeNull();
				expect(findLineStartPositionById(editor.state.doc, null)).toBeNull();
				expect(findLineStartPositionById(editor.state.doc, undefined)).toBeNull();
				expect(findLineStartPositionById(editor.state.doc, '')).toBeNull();
			} finally {
				editor.destroy();
			}
		});

		it('DEFECT F5: returns the LAST match when ids are duplicated, and never stops early', () => {
			const editor = createTestEditor({
				type: 'manuscript',
				content: [
					editorPlainPage({
						pageId: 'p',
						columns: [
							editorColumn({
								columnId: 'col-dup',
								lines: [
									editorLine({ text: 'dup-a', lineId: 'shared', lineNumber: 1 }),
									editorLine({ text: 'mid', lineId: 'unique', lineNumber: 2 }),
									editorLine({ text: 'dup-b', lineId: 'shared', lineNumber: 3 }),
								],
							}),
						],
					}),
				],
			});
			try {
				const doc = editor.state.doc;
				const positions: number[] = [];
				doc.descendants((node: any, pos: number) => {
					if (node.type.name !== 'line') return true;
					if (node.attrs.lineId === 'shared') positions.push(pos + 1);
					return false;
				});
				expect(positions).toHaveLength(2);
				// A search that stopped at the first hit would return positions[0].
				expect(findLineStartPositionById(doc, 'shared')).toBe(positions[1]);
			} finally {
				editor.destroy();
			}
		});
	});

	describe('the Enter keybinding end to end', () => {
		function pressEnter(editor: any): boolean {
			return editor.view.someProp('handleKeyDown', (fn: any) =>
				fn(editor.view, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
			);
		}

		it('DEFECT F1: pressing Enter mid-line in a four-line column duplicates lines', async () => {
			const editor = createTestEditor(multiPageFixture());
			try {
				selectAt(editor, lineStart(editor.state.doc, 0, 0, 1) + 1);
				expect(snapshotLines(editor.state.doc)[0][0]).toEqual(['a1', 'a2', 'a3', 'a4']);

				expect(pressEnter(editor)).toBe(true);
				await Promise.resolve();

				// Wanted: ['a1', 'a', '2', 'a3', 'a4'].
				expect(snapshotLines(editor.state.doc)[0][0]).toEqual([
					'a1',
					'a1',
					'a',
					'2',
					'a3',
					'a4',
					'a3',
					'a4',
				]);
			} finally {
				editor.destroy();
			}
		});

		it('DEFECT F11: the Enter handler writes the selection a second time, asynchronously', async () => {
			const editor = createTestEditor(multiPageFixture());
			try {
				selectAt(editor, lineStart(editor.state.doc, 0, 0, 1) + 1);
				pressEnter(editor);

				// The transaction the handler dispatched already set the selection.
				const synchronous = editor.state.selection.from;
				await Promise.resolve();
				await Promise.resolve();
				const afterMicrotask = editor.state.selection.from;

				// A second, unrelated selection write lands one microtask later, from
				// outside any transaction. Anything that reads the selection in
				// between — a `selectionUpdate` subscriber, the status bar, the
				// inspector — sees a position that is about to move.
				expect(afterMicrotask).not.toBe(synchronous);

				// Nothing cancels the microtask, so tearing the editor down between
				// the dispatch and the callback throws inside `editor.chain()`.
				expect(typeof (editor as any).chain).toBe('function');
			} finally {
				editor.destroy();
				await Promise.resolve();
			}
		});
	});
});
