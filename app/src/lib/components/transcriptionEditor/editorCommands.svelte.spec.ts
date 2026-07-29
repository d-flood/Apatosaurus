/**
 * Characterization tests for everything exported from `editorCommands.ts`,
 * executed against a multi-line, multi-column, multi-page fixture.
 *
 * Written for ticket 01 of the `refactor-transcription-editor` epic. The
 * existing `toolbar-insertions` spec drives some of these through the toolbar
 * on a one-line document; this one calls them directly on a document where a
 * position error is visible. Assertions tagged DEFECT record behaviour the
 * inventory marks as wrong.
 *
 * See `.tracker/refactor-transcription-editor/INVENTORY.md`.
 */
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import {
	editorColumn,
	editorDocument,
	editorLine,
	editorPlainPage,
} from '$lib/client/testing/editorFixtures';
import { createTestEditor } from '$lib/client/testing/editorHarnesses.svelte';

import {
	COMMON_ABBREVIATION_TYPES,
	buildCorrectionNodeAttrs,
	buildEditorNoteAttrs,
	buildGapAttrs,
	buildHandShiftAttrs,
	buildMetamarkAttrs,
	buildSpaceAttrs,
	buildTeiMilestoneAttrs,
	describeMetamarkTarget,
	getCurrentMilestoneValues,
	getMetamarkInsertContext,
	insertContentNode,
	insertMetamarkForSelection,
	insertMilestoneNode,
	insertSelectableCarrierNode,
	summarizeTeiAtomAttrs,
	syncPageFormWorkToContainingPage,
	toggleEditorMark,
	updateNodeAttrs,
} from './editorCommands';

type Json = Record<string, any>;

const EDITOR_COMMAND_FIXTURE = editorDocument({
	pages: [
		editorPlainPage({
			pageId: 'page-1',
			pageName: '1r',
			columns: [
				editorColumn({
					lines: [
						editorLine({
							content: [
								{ type: 'book', attrs: { book: 'Mark' } },
								{ type: 'chapter', attrs: { book: 'Mark', chapter: '1' } },
								{
									type: 'verse',
									attrs: { book: 'Mark', chapter: '1', verse: '1' },
								},
								{ type: 'text', text: 'alpha' },
							],
						}),
						editorLine({ text: 'beta', lineId: 'line-2', lineNumber: 2 }),
						editorLine({ text: 'gamma', lineId: 'line-3', lineNumber: 3 }),
						editorLine({ text: 'delta', lineId: 'line-4', lineNumber: 4 }),
					],
				}),
			],
		}),
		...editorDocument({}).content.slice(1),
	],
});

/** Position of the first text node whose text equals `value`. */
function findText(editor: any, value: string): number {
	let position = -1;
	editor.state.doc.descendants((node: any, pos: number) => {
		if (position !== -1) return false;
		if (node.isText && node.text === value) position = pos;
		return true;
	});
	if (position === -1) throw new Error(`no text node "${value}"`);
	return position;
}

function selectText(editor: any, value: string) {
	const from = findText(editor, value);
	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(editor.state.doc, from, from + value.length)
		)
	);
}

function caretAfter(editor: any, value: string) {
	const from = findText(editor, value);
	editor.view.dispatch(
		editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from + value.length))
	);
}

function countNodes(editor: any, typeName: string): number {
	let total = 0;
	editor.state.doc.descendants((node: any) => {
		if (node.type.name === typeName) total += 1;
		return true;
	});
	return total;
}

function firstNodeOfType(editor: any, typeName: string): { node: any; pos: number } {
	let found: { node: any; pos: number } | null = null;
	editor.state.doc.descendants((node: any, pos: number) => {
		if (found) return false;
		if (node.type.name === typeName) found = { node, pos };
		return true;
	});
	if (!found) throw new Error(`no ${typeName} node`);
	return found;
}

function documentText(editor: any): string[] {
	const lines: string[] = [];
	editor.state.doc.descendants((node: any) => {
		if (node.type.name !== 'line') return true;
		lines.push(node.textContent);
		return false;
	});
	return lines;
}

describe('editorCommands pure builders', () => {
	it('buildGapAttrs, buildSpaceAttrs, buildHandShiftAttrs, buildTeiMilestoneAttrs', () => {
		expect(buildGapAttrs('illegible', 'chars', '3')).toEqual({
			reason: 'illegible',
			unit: 'chars',
			extent: '3',
		});
		expect(buildSpaceAttrs(' lines ', ' 2 ')).toEqual({
			teiAttrs: { unit: 'lines', extent: '2' },
		});
		expect(buildSpaceAttrs('', '')).toEqual({ teiAttrs: {} });

		expect(buildHandShiftAttrs('hand2', 'ink')).toEqual({
			teiAttrs: { new: '#hand2', medium: 'ink' },
		});
		expect(buildHandShiftAttrs('#hand2', '')).toEqual({ teiAttrs: { new: '#hand2' } });
		expect(buildHandShiftAttrs('   ', 'ink')).toBeNull();

		expect(buildTeiMilestoneAttrs('para', '5', '')).toEqual({
			teiAttrs: { unit: 'para', n: '5' },
		});
		expect(buildTeiMilestoneAttrs('', '', '')).toBeNull();
	});

	it('buildEditorNoteAttrs builds a self-consistent teiAtom payload', () => {
		expect(buildEditorNoteAttrs('editorial', '   ')).toBeNull();
		const attrs = buildEditorNoteAttrs(' ', 'A note about the hand')!;
		expect(attrs.tag).toBe('note');
		expect(attrs.teiAttrs).toEqual({ type: 'editorial' });
		expect(attrs.summary).toBe('note:editorial:A note about the hand');
		expect(attrs.teiNode.children[0].text).toBe('A note about the hand');
	});

	it('summarizeTeiAtomAttrs covers each special-cased tag', () => {
		expect(summarizeTeiAtomAttrs('gb', { n: '4' }, '')).toBe('gb:4');
		expect(summarizeTeiAtomAttrs('gb', {}, '')).toBe('gb');
		expect(summarizeTeiAtomAttrs('ptr', { target: '#x' }, '')).toBe('#x');
		expect(summarizeTeiAtomAttrs('ptr', {}, '')).toBe('ptr');
		expect(summarizeTeiAtomAttrs('media', { url: 'a.png' }, '')).toBe('a.png');
		expect(summarizeTeiAtomAttrs('note', { type: 'crit' }, ' spaced   out ')).toBe(
			'note:crit:spaced out'
		);
		expect(summarizeTeiAtomAttrs('ellipsis', {}, '...')).toBe('ellipsis:...');
		expect(summarizeTeiAtomAttrs('seg', {}, 'ignored')).toBe('seg');
	});

	it('buildMetamarkAttrs and describeMetamarkTarget', () => {
		expect(buildMetamarkAttrs('  ')).toBeNull();
		expect(buildMetamarkAttrs('transposition', '#a #b', '2 linked elements')).toEqual({
			summary: 'metamark:transposition',
			teiAttrs: { function: 'transposition', target: '#a #b' },
			targetLabel: '2 linked elements',
			wordInline: false,
		});

		expect(describeMetamarkTarget({ targetLabel: 'Selected text' })).toBe('Selected text');
		expect(describeMetamarkTarget({ teiAttrs: { target: '#a #b #c' } })).toBe(
			'3 linked elements'
		);
		expect(describeMetamarkTarget({ teiAttrs: { target: '#a' } })).toBe('1 linked element');
		expect(describeMetamarkTarget(null)).toBe('Text-bearing mark');
	});

	it('buildCorrectionNodeAttrs starts empty', () => {
		expect(buildCorrectionNodeAttrs()).toEqual({ corrections: [] });
	});

	it('COMMON_ABBREVIATION_TYPES lists the abbreviation kinds the mark accepts', () => {
		expect([...COMMON_ABBREVIATION_TYPES]).toEqual([
			'nomSac',
			'ligature',
			'symbol',
			'abbreviation',
			'suspension',
			'contraction',
		]);
	});
});

describe('editorCommands against a multi-page fixture', () => {
	it('toggleEditorMark applies and removes a mark on the selected range only', () => {
		const editor = createTestEditor({ content: EDITOR_COMMAND_FIXTURE });
		try {
			selectText(editor, 'c3');
			expect(toggleEditorMark(editor, 'lacunose')).toBe(true);

			let marked: string[] = [];
			editor.state.doc.descendants((node: any) => {
				if (node.isText && node.marks.some((m: any) => m.type.name === 'lacunose')) {
					marked.push(node.text);
				}
				return true;
			});
			expect(marked).toEqual(['c3']);

			selectText(editor, 'c3');
			toggleEditorMark(editor, 'lacunose');
			marked = [];
			editor.state.doc.descendants((node: any) => {
				if (node.isText && node.marks.some((m: any) => m.type.name === 'lacunose')) {
					marked.push(node.text);
				}
				return true;
			});
			expect(marked).toEqual([]);

			expect(toggleEditorMark(null, 'lacunose')).toBe(false);
		} finally {
			editor.destroy();
		}
	});

	it('insertContentNode inserts at the caret without disturbing other lines', () => {
		const editor = createTestEditor({ content: EDITOR_COMMAND_FIXTURE });
		try {
			caretAfter(editor, 'b2');
			expect(insertContentNode(editor, 'gap', buildGapAttrs('illegible', 'chars', '3'))).toBe(
				true
			);
			expect(countNodes(editor, 'gap')).toBe(1);
			expect(documentText(editor)).toEqual([
				'alpha',
				'beta',
				'gamma',
				'delta',
				'b1',
				'b2',
				'b3',
				'b4',
				'c1',
				'c2',
				'c3',
				'c4',
				'd1',
				'd2',
				'd3',
				'd4',
			]);
			expect(insertContentNode(null, 'gap', {})).toBe(false);
		} finally {
			editor.destroy();
		}
	});

	it('insertSelectableCarrierNode selects the node it inserted', () => {
		const editor = createTestEditor({ content: EDITOR_COMMAND_FIXTURE });
		try {
			caretAfter(editor, 'c2');
			expect(
				insertSelectableCarrierNode(editor, 'space', buildSpaceAttrs('lines', '2'))
			).toBe(true);

			expect(editor.state.selection).toBeInstanceOf(NodeSelection);
			expect((editor.state.selection as NodeSelection).node.type.name).toBe('space');
			expect(countNodes(editor, 'space')).toBe(1);
			expect(insertSelectableCarrierNode(editor, 'nope', {})).toBe(false);
		} finally {
			editor.destroy();
		}
	});

	it('insertSelectableCarrierNode inserts after — not over — an already selected inline node', () => {
		const editor = createTestEditor({ content: EDITOR_COMMAND_FIXTURE });
		try {
			caretAfter(editor, 'c2');
			insertSelectableCarrierNode(editor, 'space', buildSpaceAttrs('lines', '2'));
			expect(editor.state.selection).toBeInstanceOf(NodeSelection);

			insertSelectableCarrierNode(editor, 'gap', buildGapAttrs('illegible', 'chars', '1'));
			expect(countNodes(editor, 'space')).toBe(1);
			expect(countNodes(editor, 'gap')).toBe(1);
			expect((editor.state.selection as NodeSelection).node.type.name).toBe('gap');
		} finally {
			editor.destroy();
		}
	});

	it('updateNodeAttrs merges attributes at the given position', () => {
		const editor = createTestEditor({ content: EDITOR_COMMAND_FIXTURE });
		try {
			caretAfter(editor, 'd2');
			insertSelectableCarrierNode(editor, 'gap', buildGapAttrs('illegible', 'chars', '3'));
			const { pos } = firstNodeOfType(editor, 'gap');

			expect(updateNodeAttrs(editor, pos, { reason: 'lost' })).toBe(true);
			const updated = editor.state.doc.nodeAt(pos)!;
			expect(updated.attrs).toMatchObject({ reason: 'lost', unit: 'chars', extent: '3' });

			// A position inside the document that holds no node fails cleanly.
			expect(updateNodeAttrs(editor, pos + 1, { reason: 'x' })).toBe(false);
			expect(updateNodeAttrs(null, pos, {})).toBe(false);

			// DEFECT F18: a position past the end of the document throws instead.
			// The inspector caches `selectedTeiNode.pos` and passes it back here, so
			// a stale position taken before a deletion crashes the command.
			expect(() =>
				updateNodeAttrs(editor, editor.state.doc.content.size + 5, { reason: 'x' })
			).toThrow(/outside of fragment/);
		} finally {
			editor.destroy();
		}
	});

	it('syncPageFormWorkToContainingPage copies a page label onto the page that contains it', () => {
		const editor = createTestEditor({ content: EDITOR_COMMAND_FIXTURE });
		try {
			// Put the fw node on page 3 so a page-scan bug would be visible.
			caretAfter(editor, 'd1');
			insertSelectableCarrierNode(editor, 'fw', {
				type: 'pageNum',
				place: 'top-centre',
				content: [{ type: 'text', text: 'fol. 2r' }],
			});
			const { pos } = firstNodeOfType(editor, 'fw');

			expect(
				updateNodeAttrs(
					editor,
					pos,
					{ content: [{ type: 'text', text: 'fol. 2r' }] },
					syncPageFormWorkToContainingPage
				)
			).toBe(true);

			const pageLabels: unknown[] = [];
			editor.state.doc.forEach((pageNode: any) => pageLabels.push(pageNode.attrs.pageLabel));
			expect(pageLabels).toEqual([null, null, 'fol. 2r']);
		} finally {
			editor.destroy();
		}
	});

	it('getCurrentMilestoneValues reads the nearest preceding milestones', () => {
		const editor = createTestEditor({ content: EDITOR_COMMAND_FIXTURE });
		try {
			caretAfter(editor, 'c3');
			expect(getCurrentMilestoneValues(editor)).toEqual({
				book: 'Mark',
				chapter: '1',
				verse: '1',
			});
			expect(getCurrentMilestoneValues(null)).toEqual({});
		} finally {
			editor.destroy();
		}
	});

	it('does not carry chapter or verse context across a book boundary', () => {
		const editor = createTestEditor({
			content: editorDocument({
				pages: [
					editorPlainPage({
						columns: [
							editorColumn({
								lines: [
									editorLine({
										content: [
											{ type: 'book', attrs: { book: 'Mark' } },
											{ type: 'chapter', attrs: { book: 'Mark', chapter: '1' } },
											{
												type: 'verse',
												attrs: { book: 'Mark', chapter: '1', verse: '1' },
											},
											{ type: 'book', attrs: { book: 'Luke' } },
											{ type: 'text', text: 'alpha' },
										],
									}),
								],
							}),
						],
					}),
				],
			}),
		});
		try {
			caretAfter(editor, 'alpha');
			expect(getCurrentMilestoneValues(editor)).toEqual({ book: 'Luke' });
			expect(insertMilestoneNode(editor, 'verse', '1')).toBe('missing-chapter');
			expect(countNodes(editor, 'verse')).toBe(1);

			expect(insertMilestoneNode(editor, 'chapter', '2')).toBe('ok');
			expect(insertMilestoneNode(editor, 'verse', '1')).toBe('ok');
			expect(getCurrentMilestoneValues(editor)).toEqual({
				book: 'Luke',
				chapter: '2',
				verse: '1',
			});
			const verseBooks: string[] = [];
			editor.state.doc.descendants((node: any) => {
				if (node.type.name === 'verse') verseBooks.push(node.attrs.book);
				return true;
			});
			expect(verseBooks).toEqual(['Mark', 'Luke']);

			expect(insertMilestoneNode(editor, 'chapter', '3')).toBe('ok');
			expect(getCurrentMilestoneValues(editor)).toEqual({ book: 'Luke', chapter: '3' });
		} finally {
			editor.destroy();
		}
	});

	it('insertMilestoneNode enforces book -> chapter -> verse ordering', () => {
		const editor = createTestEditor({ content: EDITOR_COMMAND_FIXTURE });
		try {
			caretAfter(editor, 'd3');
			expect(insertMilestoneNode(editor, 'verse', '9')).toBe('ok');
			expect(insertMilestoneNode(editor, 'chapter', '2')).toBe('ok');
			expect(insertMilestoneNode(editor, 'book', 'Luke')).toBe('ok');
			expect(insertMilestoneNode(editor, 'book', '')).toBe('invalid');
			expect(insertMilestoneNode(null, 'book', 'Luke')).toBe('invalid');

			// On a document with no milestones at all, the ordering rules bite.
			const bare = createTestEditor({ content: editorDocument({}) });
			try {
				expect(insertMilestoneNode(bare, 'chapter', '1')).toBe('missing-book');
				expect(insertMilestoneNode(bare, 'verse', '1')).toBe('missing-chapter');
			} finally {
				bare.destroy();
			}
		} finally {
			editor.destroy();
		}
	});

	it('getMetamarkInsertContext distinguishes a text selection from a selected editorial action', () => {
		const editor = createTestEditor({ content: EDITOR_COMMAND_FIXTURE });
		try {
			caretAfter(editor, 'b1');
			expect(getMetamarkInsertContext(editor)).toBeNull();
			expect(getMetamarkInsertContext(null)).toBeNull();

			selectText(editor, 'b2');
			expect(getMetamarkInsertContext(editor)).toEqual({
				kind: 'text-selection',
				targetLabel: 'Selected text',
			});

			caretAfter(editor, 'b3');
			insertSelectableCarrierNode(editor, 'editorialAction', {
				tag: 'undo',
				summary: 'undo: #mod1',
				structure: { kind: 'undo', targets: ['#mod1'] },
			});
			expect(getMetamarkInsertContext(editor)).toEqual({
				kind: 'editorial-action',
				targetValue: '#mod1',
				targetLabel: 'Selected undo',
			});
		} finally {
			editor.destroy();
		}
	});

	it('DEFECT F17: insertMetamarkForSelection produces two different representations of a metamark', () => {
		const editor = createTestEditor({ content: EDITOR_COMMAND_FIXTURE });
		try {
			// Over a text selection it becomes a `teiSpan` mark tagged "metamark".
			selectText(editor, 'b2');
			expect(insertMetamarkForSelection(editor, 'transposition')).toBe(true);
			expect(countNodes(editor, 'metamark')).toBe(0);
			let spanTags: string[] = [];
			editor.state.doc.descendants((node: any) => {
				for (const mark of node.marks || []) {
					if (mark.type.name === 'teiSpan') spanTags.push(mark.attrs.tag);
				}
				return true;
			});
			expect(spanTags).toEqual(['metamark']);

			// Over a selected editorial action it becomes a `metamark` *node*.
			caretAfter(editor, 'b3');
			insertSelectableCarrierNode(editor, 'editorialAction', {
				tag: 'undo',
				summary: 'undo: #mod1',
				structure: { kind: 'undo', targets: ['#mod1'] },
			});
			expect(insertMetamarkForSelection(editor, 'transposition')).toBe(true);
			expect(countNodes(editor, 'metamark')).toBe(1);

			// With no usable selection it silently does nothing.
			caretAfter(editor, 'd4');
			expect(insertMetamarkForSelection(editor, 'transposition')).toBe(false);
			expect(insertMetamarkForSelection(editor, '   ')).toBe(false);
			expect(insertMetamarkForSelection(null, 'x')).toBe(false);
		} finally {
			editor.destroy();
		}
	});
});
