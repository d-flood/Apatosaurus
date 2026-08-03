import type { Editor } from '@tiptap/core';
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
	if (!insideLine) return false;
	const transaction = state.tr
		.replaceWith(selection.from, selection.from, nodes)
		.setMeta(REFERENCE_EDITION_SEED_META, true)
		.scrollIntoView();
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
