import { toProseMirror } from '@apatosaurus/tei-transcription';
import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Fragment, type Node as ProseMirrorNode, Slice } from '@tiptap/pm/model';
import { type EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import { importTEIDocument } from '$lib/tei/tei-importer';
import { coerceTranscriptionDocument } from '$lib/transcription/content';
import witness2006Tei from '../../../static/igntp/Romans_Greek_transcriptions/NT_GRC_2006_Rom.xml?raw';
import {
	countUnconfirmedVerses,
	getCurrentMilestoneValues,
	insertMilestoneNode,
	reviewCurrentVerse,
} from './editorCommands';
import { milestoneContextAt } from './schema/transcription-index';
import { prepareManuscriptDocumentEntry } from './structure';

import {
	editorColumn,
	editorDocument,
	editorFramedPage,
	editorPlainPage,
	transcriptionDocument,
} from '$lib/testing/editorFixtures';
import { createTestEditor, mountTranscriptionEditor } from '$lib/testing/editorHarnesses.svelte';

function documentWithLines(lineCount: number) {
	return editorDocument({
		pages: [
			editorPlainPage({
				columns: [
					editorColumn({
						texts: Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`),
					}),
				],
			}),
		],
	});
}

function firstTextEnd(editor: ReturnType<typeof createTestEditor>): number {
	let end = -1;
	editor.state.doc.descendants((node, pos) => {
		if (end !== -1 || !node.isText) return end === -1;
		end = pos + node.nodeSize;
		return false;
	});
	if (end === -1) throw new Error('fixture has no text');
	return end;
}

describe('transcription editor keystroke path', () => {
	it('dispatches exactly one transaction per ordinary typed character', () => {
		const editor = createTestEditor({ content: documentWithLines(100) });
		let transactions = 0;
		editor.on('transaction', () => {
			transactions += 1;
		});

		try {
			let position = firstTextEnd(editor);
			for (let index = 0; index < 20; index += 1) {
				editor.view.dispatch(editor.state.tr.insertText('x', position, position));
				position += 1;
			}

			expect(transactions).toBe(20);
		} finally {
			editor.destroy();
		}
	});
});

function oracleMilestoneContext(doc: ProseMirrorNode, before: number) {
	const result: { book?: string; chapter?: string; verse?: string } = {};
	let fallbackBook: string | undefined;
	let fallbackChapter: string | undefined;
	let seekChapter = true;
	let seekVerse = true;

	function walkBackwards(node: ProseMirrorNode, contentStart: number): boolean {
		let offset = node.content.size;
		for (let index = node.childCount - 1; index >= 0; index -= 1) {
			const child = node.child(index);
			offset -= child.nodeSize;
			const pos = contentStart + offset;
			if (pos >= before) continue;

			if (child.childCount && walkBackwards(child, pos + 1)) return true;

			if (child.type.name === 'book') {
				result.book = child.attrs.book;
				return true;
			}
			if (child.type.name === 'chapter') {
				if (seekChapter) {
					result.chapter = child.attrs.chapter;
					fallbackBook = child.attrs.book;
				}
				seekChapter = false;
				seekVerse = false;
			} else if (child.type.name === 'verse' && seekVerse) {
				result.verse = child.attrs.verse;
				fallbackBook = child.attrs.book;
				fallbackChapter = child.attrs.chapter;
				seekVerse = false;
			}
		}
		return false;
	}

	walkBackwards(doc, 0);
	result.book ??= fallbackBook;
	result.chapter ??= fallbackChapter;
	return result;
}

function oracleUnconfirmedVerseCount(state: EditorState): number {
	const markType = state.schema.marks.unconfirmed;
	let verseIndex = -1;
	const unconfirmed = new Set<number>();
	state.doc.descendants(node => {
		if (node.type.name === 'verse') {
			verseIndex += 1;
			return false;
		}
		if (verseIndex >= 0 && markType.isInSet(node.marks)) unconfirmed.add(verseIndex);
		return undefined;
	});
	return unconfirmed.size;
}

function createRandom(seed: number) {
	return (limit: number) => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed % limit;
	};
}

function milestonePositions(doc: ProseMirrorNode, type: string): number[] {
	const positions: number[] = [];
	doc.descendants((node, pos) => {
		if (node.type.name === type) positions.push(pos);
		return true;
	});
	return positions;
}

function textPositions(doc: ProseMirrorNode): number[] {
	const positions: number[] = [];
	doc.descendants((node, pos) => {
		if (node.isText) positions.push(pos + 1);
		return true;
	});
	return positions;
}

function load2006(): Editor {
	const stored = coerceTranscriptionDocument(importTEIDocument(witness2006Tei))!;
	return createTestEditor({ content: prepareManuscriptDocumentEntry(toProseMirror(stored)).doc });
}

describe('transcription editor incremental cursor context', () => {
	it('matches the full-document walk through edits and cursor moves in witness 2006', () => {
		const editor = load2006();
		const random = createRandom(2006);
		const step = (label: string, run: () => void) => {
			run();
			const { state } = editor;
			const probes = [
				state.selection.from,
				Math.max(0, state.selection.from - 1),
				Math.min(state.doc.content.size, state.selection.from + 1),
				...Array.from({ length: 4 }, () => random(state.doc.content.size + 1)),
			];
			for (const pos of probes) {
				expect(milestoneContextAt(state, pos), `${label} @ ${pos}`).toEqual(
					oracleMilestoneContext(state.doc, pos)
				);
			}
			expect(getCurrentMilestoneValues(editor), label).toEqual(
				oracleMilestoneContext(state.doc, state.selection.from)
			);
			expect(countUnconfirmedVerses(editor), label).toBe(oracleUnconfirmedVerseCount(state));
		};
		const dispatch = (tr: Transaction) => editor.view.dispatch(closeHistory(tr));
		const placeCursor = (pos: number) =>
			dispatch(
				editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos)))
			);
		const typeAt = (pos: number, text: string) => {
			placeCursor(pos);
			for (const character of text) {
				const { from } = editor.state.selection;
				editor.view.dispatch(editor.state.tr.insertText(character, from, from));
			}
		};
		const markUnconfirmed = (from: number, to: number) =>
			dispatch(editor.state.tr.addMark(from, to, editor.schema.marks.unconfirmed.create()));

		try {
			const verses = milestonePositions(editor.state.doc, 'verse');
			const chapters = milestonePositions(editor.state.doc, 'chapter');
			expect(milestonePositions(editor.state.doc, 'book').length).toBeGreaterThan(0);
			expect(verses.length).toBeGreaterThan(100);
			expect(chapters.length).toBeGreaterThan(5);
			step('loaded', () => {});

			const texts = textPositions(editor.state.doc);
			const first = texts[10];
			const middle = texts[Math.floor(texts.length / 2)];
			const last = texts[texts.length - 10];
			step('type on the last page', () => typeAt(last, 'καιεγω'));
			step('type on the middle page', () => typeAt(middle, 'λογος'));
			step('type on the first page', () => typeAt(first, 'αρχη'));

			step('mark verses unconfirmed', () => {
				const verseNow = milestonePositions(editor.state.doc, 'verse');
				markUnconfirmed(verseNow[20] + 1, verseNow[24] - 3);
				markUnconfirmed(
					verseNow[verseNow.length - 3] + 1,
					editor.state.doc.content.size - 5
				);
			});
			step('mark text before the first verse', () => markUnconfirmed(2, 30));
			step('type inside unconfirmed text', () => {
				const verseNow = milestonePositions(editor.state.doc, 'verse');
				typeAt(verseNow[22] + 3, 'ξ');
			});

			step('insert a verse milestone', () => {
				placeCursor(textPositions(editor.state.doc)[Math.floor(texts.length / 3)]);
				expect(insertMilestoneNode(editor, 'verse', '99')).toBe('ok');
			});
			step('insert a chapter milestone', () => {
				placeCursor(textPositions(editor.state.doc)[Math.floor((texts.length * 2) / 3)]);
				expect(insertMilestoneNode(editor, 'chapter', '42')).toBe('ok');
			});
			step('insert a verse inside an unconfirmed verse', () => {
				const verseNow = milestonePositions(editor.state.doc, 'verse');
				placeCursor(verseNow[21] + 4);
				expect(insertMilestoneNode(editor, 'verse', '77')).toBe('ok');
			});
			step('delete a verse milestone', () => {
				const pos = milestonePositions(editor.state.doc, 'verse')[40];
				dispatch(editor.state.tr.delete(pos, pos + 1));
			});
			step('delete an unconfirmed verse milestone', () => {
				const pos = milestonePositions(editor.state.doc, 'verse')[23];
				dispatch(editor.state.tr.delete(pos, pos + 1));
			});
			step('delete a chapter milestone', () => {
				const pos = milestonePositions(editor.state.doc, 'chapter')[3];
				dispatch(editor.state.tr.delete(pos, pos + 1));
			});

			step('paste across pages', () => {
				const doc = editor.state.doc;
				const source = editor.state.doc.resolve(milestonePositions(doc, 'verse')[60]);
				const sourcePage = source.before(1);
				const sourceEnd = doc.resolve(sourcePage + doc.nodeAt(sourcePage)!.nodeSize + 5);
				const slice = doc.slice(source.pos, sourceEnd.pos);
				const { dom } = editor.view.serializeForClipboard(slice);
				const target = doc.resolve(textPositions(doc)[Math.floor(texts.length * 0.8)]);
				const targetPageEnd = target.before(1) + doc.nodeAt(target.before(1))!.nodeSize;
				dispatch(
					editor.state.tr.setSelection(
						TextSelection.create(doc, target.pos, targetPageEnd + 6)
					)
				);
				expect(editor.view.pasteHTML(dom.innerHTML)).toBe(true);
			});
			step('type after the paste', () => {
				const { from } = editor.state.selection;
				typeAt(from, 'ον');
			});

			step('review the current verse', () => {
				const verseNow = milestonePositions(editor.state.doc, 'verse');
				placeCursor(verseNow[verseNow.length - 2] + 2);
				reviewCurrentVerse(editor);
			});
			step('remove part of an unconfirmed run', () => {
				const verseNow = milestonePositions(editor.state.doc, 'verse');
				dispatch(
					editor.state.tr.removeMark(
						verseNow[20] + 1,
						verseNow[21],
						editor.schema.marks.unconfirmed
					)
				);
			});

			for (let index = 0; index < 8; index += 1) {
				step(`undo ${index + 1}`, () => {
					editor.commands.undo();
				});
			}
			for (let index = 0; index < 3; index += 1) {
				step(`redo ${index + 1}`, () => {
					editor.commands.redo();
				});
			}

			for (let index = 0; index < 10; index += 1) {
				step(`cursor move ${index + 1}`, () =>
					placeCursor(random(editor.state.doc.content.size + 1))
				);
			}
		} finally {
			editor.destroy();
		}
	}, 120_000);
});

describe('transcription editor document-entry repair', () => {
	it('repairs missing structural ids when a stored transcription loads', async () => {
		const harness = await mountTranscriptionEditor({ document: transcriptionDocument({}) });
		try {
			const columns = Array.from(harness.container.querySelectorAll<HTMLElement>('.column'));
			const lines = Array.from(harness.container.querySelectorAll<HTMLElement>('.line'));

			expect(columns.length).toBeGreaterThan(0);
			expect(lines.length).toBeGreaterThan(0);
			expect(columns.every(column => Boolean(column.dataset.columnId))).toBe(true);
			expect(lines.every(line => Boolean(line.dataset.lineId))).toBe(true);
		} finally {
			harness.dispose();
		}
	});

	it('repairs a structural page slice at the paste boundary', () => {
		const editor = createTestEditor();
		try {
			const page = editor.schema.nodeFromJSON(
				editorFramedPage({
					texts: [['top'], ['left'], ['center'], ['right'], ['bottom']],
				})
			);
			const unpreparedPage = page.type.create(
				{ ...page.attrs, pageId: null },
				page.content.content.map(column =>
					column.type.create(
						{ ...column.attrs, columnId: null },
						column.content.content.map(line =>
							line.type.create({ ...line.attrs, lineId: null }, line.content)
						)
					)
				)
			);
			const slice = new Slice(Fragment.from(unpreparedPage), 0, 0);
			const transformed = editor.view.someProp('transformPasted', transform =>
				transform(slice, editor.view, false)
			);

			expect(transformed).toBeInstanceOf(Slice);
			const pastedPage = (transformed as Slice).content.firstChild!;
			expect(pastedPage.content.content.map(column => column.attrs.zone)).toEqual([
				'top',
				'left',
				'right',
				'bottom',
				'center',
			]);
			for (const column of pastedPage.content.content) {
				expect(column.attrs.columnId).toEqual(expect.any(String));
				expect(column.firstChild?.attrs.lineId).toEqual(expect.any(String));
			}
		} finally {
			editor.destroy();
		}
	});
});
