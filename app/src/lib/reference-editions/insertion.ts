import type { Editor } from '@tiptap/core';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { lineItemsToProseMirror, type LineItem, type TextMark } from '$lib/tei/tei-transcription';

import { extractRange, type ParsedReferenceEdition } from './source';

const REFERENCE_EDITION_SEED_META = 'referenceEditionSeed';

export function insertReferenceEditionRange(
	editor: Editor | null,
	source: ParsedReferenceEdition,
	startPosition: number,
	endPosition: number
): boolean {
	if (!editor) return false;

	const items = markReferenceEditionItems(extractRange(source, startPosition, endPosition));
	const nodes = lineItemsToProseMirror(items).map(node => editor.state.schema.nodeFromJSON(node));
	if (nodes.length === 0) return false;

	const { state, view } = editor;
	const { selection } = state;
	if (selection.from !== selection.to) return false;
	let insideLine = false;
	for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
		if (selection.$from.node(depth).type.name === 'line') {
			insideLine = true;
			break;
		}
	}

	let transaction: Transaction;
	if (!insideLine) {
		if (state.doc.childCount !== 0) return false;

		const line = state.schema.nodes.line.create(null, nodes);
		const column = state.schema.nodes.column.create(null, [line]);
		const page = state.schema.nodes.page.create(null, [column]);
		transaction = state.tr.replaceWith(0, state.doc.content.size, page);

		let lineEnd: number | null = null;
		transaction.doc.descendants((node, position) => {
			if (lineEnd !== null || node.type.name !== 'line') return;
			lineEnd = position + node.nodeSize - 1;
			return false;
		});
		if (lineEnd !== null) {
			transaction.setSelection(TextSelection.near(transaction.doc.resolve(lineEnd)));
		}
	} else {
		transaction = state.tr.replaceWith(selection.from, selection.from, nodes);
	}

	transaction.setMeta(REFERENCE_EDITION_SEED_META, true).scrollIntoView();
	view.dispatch(transaction);
	editor.commands.focus();
	return true;
}

function markReferenceEditionItems(items: LineItem[]): LineItem[] {
	return items.map(item => {
		if (item.type === 'text') {
			return {
				...item,
				marks: addUnconfirmedMark(item.marks),
			};
		}
		if (item.type === 'fw') {
			return {
				...item,
				content: markInlineItems(item.content),
			};
		}
		if (item.type === 'correctionOnly') {
			return {
				...item,
				corrections: item.corrections.map(correction => ({
					...correction,
					content: markInlineItems(correction.content),
				})),
			};
		}
		if (item.type === 'teiAtom' || item.type === 'teiWrapper') {
			return {
				...item,
				marks: addUnconfirmedMark(item.marks),
			};
		}
		return item;
	});
}

function markInlineItems<T extends Array<any>>(items: T): T {
	return items.map(item => {
		if (item.type === 'text') {
			return { ...item, marks: addUnconfirmedMark(item.marks) };
		}
		if (item.type === 'fw') {
			return { ...item, content: markInlineItems(item.content) };
		}
		if (item.type === 'correctionOnly') {
			return {
				...item,
				corrections: item.corrections.map((correction: any) => ({
					...correction,
					content: markInlineItems(correction.content),
				})),
			};
		}
		if (item.type === 'teiAtom' || item.type === 'teiWrapper') {
			return { ...item, marks: addUnconfirmedMark(item.marks) };
		}
		return item;
	}) as T;
}

function addUnconfirmedMark(marks: TextMark[] | undefined): TextMark[] {
	if (marks?.some(mark => mark.type === 'unconfirmed')) return [...marks];
	return [...(marks || []), { type: 'unconfirmed' }];
}
