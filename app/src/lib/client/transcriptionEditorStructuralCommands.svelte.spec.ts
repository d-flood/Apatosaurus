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
	prepareManuscriptDocumentEntry,
	repairManuscriptStructureJson,
} from './transcriptionEditorStructure';
import { findFirstDescendantPosition } from './proseMirrorNodeLookup';

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
		it('replaces only the split line in a multi-line column', () => {
			const editor = createTestEditor(multiPageFixture());
			try {
				// Cursor inside "b2", the second of four lines in page 2 column 1.
				const start = lineStart(editor.state.doc, 1, 0, 1);
				selectAt(editor, start + 1);

				const tr = createLineSplitTransaction(editor.state);
				expect(tr).not.toBeNull();
				editor.view.dispatch(tr!);

				expect(snapshotLines(editor.state.doc)[1][0]).toEqual(['b1', 'b', '2', 'b3', 'b4']);
			} finally {
				editor.destroy();
			}
		});

		it('splits the only line in a single-line column', () => {
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
				const firstPageBefore = editor.state.doc.child(0).toJSON();
				const thirdPageBefore = editor.state.doc.child(2).toJSON();
				// Cursor inside "b3" — third of four lines, page 2 column 1.
				selectAt(editor, lineStart(editor.state.doc, 1, 0, 2) + 1);
				const tr = createColumnSplitTransaction(editor.state);
				expect(tr).not.toBeNull();
				expect(tr!.selection.from).toBe(lineStart(tr!.doc, 1, 1, 0));
				editor.view.dispatch(tr!);
				expect(editor.state.selection.from).toBe(lineStart(editor.state.doc, 1, 1, 0));

				const snapshot = snapshotLines(editor.state.doc);
				expect(editor.state.doc.child(0).toJSON()).toEqual(firstPageBefore);
				expect(editor.state.doc.child(2).toJSON()).toEqual(thirdPageBefore);
				expect(snapshot[1]).toEqual([
					['b1', 'b2', 'b'],
					['3', 'b4'],
					['c1', 'c2', 'c3', 'c4'],
				]);
			} finally {
				editor.destroy();
			}
		});

		it('derives the new column position without storing an ordinal', () => {
			const editor = createTestEditor(multiPageFixture());
			try {
				// Split page 1's only column. Page 2 already has columns 1 and 2.
				selectAt(editor, lineStart(editor.state.doc, 0, 0, 1) + 1);
				const tr = createColumnSplitTransaction(editor.state);
				expect(tr).not.toBeNull();

				expect(tr!.doc.child(0).childCount).toBe(2);

				editor.view.dispatch(tr!);

				expect(editor.state.doc.child(0).childCount).toBe(2);
				expect(columnAttrs(editor.state.doc, 0).every(attrs => attrs.columnId)).toBe(true);
			} finally {
				editor.destroy();
			}
		});

		it('preserves TEI attributes without duplicating identities or frame zones', () => {
			const fixture = framedPageFixture();
			fixture.content[0].content[2].attrs.teiAttrs['xml:id'] = 'center-column';
			const editor = createTestEditor(fixture);
			try {
				// Split the "center" zone column (index 2).
				selectAt(editor, lineStart(editor.state.doc, 0, 2, 0) + 1);
				const tr = createColumnSplitTransaction(editor.state);
				expect(tr).not.toBeNull();
				editor.view.dispatch(tr!);

				const attrs = columnAttrs(editor.state.doc, 0);
				expect(attrs[2].zone).toBe('center');
				expect(attrs[2].teiAttrs).toEqual({ rend: 'center', 'xml:id': 'center-column' });
				expect(attrs[3].zone).toBeNull();
				expect(attrs[3].columnId).not.toBe(attrs[2].columnId);
				expect(attrs[3].teiAttrs).toEqual({ rend: 'center' });
				const splitLines = editor.state.doc.child(0).child(3);
				const splitLineIds: string[] = [];
				splitLines.forEach(line => splitLineIds.push(line.attrs.lineId));
				expect(splitLineIds.every(Boolean)).toBe(true);
				expect(new Set(splitLineIds).size).toBe(splitLineIds.length);
			} finally {
				editor.destroy();
			}
		});

		it('produces a document that does not need structural repair', () => {
			const editor = createTestEditor(multiPageFixture());
			try {
				selectAt(editor, lineStart(editor.state.doc, 0, 0, 1) + 1);
				const tr = createColumnSplitTransaction(editor.state)!;

				expect(repairManuscriptStructureJson(tr.doc.toJSON()).repaired).toBe(false);

				editor.view.dispatch(tr);

				expect(repairManuscriptStructureJson(editor.state.doc.toJSON()).repaired).toBe(
					false
				);
			} finally {
				editor.destroy();
			}
		});
	});

	describe('findLineStartPositionById', () => {
		it('F7: line ids are assigned when the document enters the editor', () => {
			const prepared = prepareManuscriptDocumentEntry(editorDocument({ nodeIds: false }));
			const editor = createTestEditor(prepared.doc);
			try {
				const ids: unknown[] = [];
				editor.state.doc.descendants((node: any) => {
					if (node.type.name !== 'line') return true;
					ids.push(node.attrs.lineId);
					return false;
				});
				expect(ids).toHaveLength(16);
				expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
			} finally {
				editor.destroy();
			}
		});

		it('resolves a line id in the middle of a multi-page document', () => {
			const editor = createTestEditor(multiPageFixture());
			try {
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

		it('F5: returns the first match when ids are duplicated and stops the walk there', () => {
			const editor = createTestEditor({
				type: 'manuscript',
				content: [
					editorPlainPage({
						pageId: 'p',
						columns: [
							editorColumn({
								columnId: 'col-dup',
								lines: [
									editorLine({ text: 'dup-a', lineId: 'shared' }),
									editorLine({ text: 'mid', lineId: 'unique' }),
									editorLine({ text: 'dup-b', lineId: 'shared' }),
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
				expect(findLineStartPositionById(doc, 'shared')).toBe(positions[0]);

				const visited: string[] = [];
				expect(
					findFirstDescendantPosition(doc, node => {
						visited.push(node.type.name);
						return node.type.name === 'line' && node.attrs.lineId === 'shared';
					})
				).toBe(positions[0] - 1);
				expect(visited).toEqual(['page', 'column', 'line']);
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

		it('pressing Enter mid-line in a four-line column splits only that line', async () => {
			const editor = createTestEditor(multiPageFixture());
			try {
				selectAt(editor, lineStart(editor.state.doc, 0, 0, 1) + 1);
				expect(snapshotLines(editor.state.doc)[0][0]).toEqual(['a1', 'a2', 'a3', 'a4']);

				expect(pressEnter(editor)).toBe(true);
				await Promise.resolve();

				expect(snapshotLines(editor.state.doc)[0][0]).toEqual(['a1', 'a', '2', 'a3', 'a4']);
			} finally {
				editor.destroy();
			}
		});

		it('keeps the transaction selection authoritative after Enter', async () => {
			const editor = createTestEditor(multiPageFixture());
			try {
				selectAt(editor, lineStart(editor.state.doc, 0, 0, 1) + 1);
				pressEnter(editor);

				// The transaction the handler dispatched already set the selection.
				const synchronous = editor.state.selection.from;
				await Promise.resolve();
				await Promise.resolve();
				const afterMicrotask = editor.state.selection.from;

				expect(afterMicrotask).toBe(synchronous);
			} finally {
				editor.destroy();
			}
		});
	});
});
