import type { Editor } from '@tiptap/core';
import { nanoid } from 'nanoid';

import type { TranscriptionSelectionQuote } from '$lib/client/iiif/types';

import type { Correction } from './types';

export interface SelectedCarrierNode {
	pos: number;
	type: string;
	attrs: Record<string, any>;
}

export interface AbbreviationDraft {
	type: string;
	expansion: string;
	rend: string;
}

export interface TextMarkTarget {
	from: number;
	to: number;
	text: string;
	markType: 'correction' | 'abbreviation';
	markId: string | null;
	markAttrs: Record<string, any> | null;
}

interface PageSelectionContext {
	pageId: string;
	pageName: string | null;
	pageOrder: number;
}

export const DEFAULT_INSPECTOR_CARRIER_TYPES = [
	'correctionNode',
	'editorialAction',
	'metamark',
	'teiAtom',
	'teiWrapper',
	'handShift',
	'teiMilestone',
	'gap',
	'space',
	'untranscribed',
	'fw',
] as const;

export const NESTED_INSPECTOR_CARRIER_TYPES = [
	'book',
	'chapter',
	'verse',
	...DEFAULT_INSPECTOR_CARRIER_TYPES,
] as const;

export const DEFAULT_ABBREVIATION_DRAFT: AbbreviationDraft = {
	type: 'nomSac',
	expansion: '',
	rend: '¯',
};

function getSelectionRange(editor: Editor | null): { from: number; to: number } | null {
	if (!editor) return null;
	const { from, to } = editor.state.selection;
	if (from === to) return null;
	return { from, to };
}

function captureMarkTarget(
	editor: Editor,
	range: { from: number; to: number },
	markType: TextMarkTarget['markType']
): TextMarkTarget {
	let markAttrs: Record<string, any> | null = null;
	editor.state.doc.nodesBetween(range.from, range.to, node => {
		const mark = node.marks?.find(current => current.type.name === markType);
		if (!mark) return true;
		markAttrs = mark.attrs;
		return false;
	});
	const capturedAttrs = markAttrs as Record<string, any> | null;

	return {
		...range,
		text: editor.state.doc.textBetween(range.from, range.to),
		markType,
		markId: typeof capturedAttrs?.id === 'string' ? capturedAttrs.id : null,
		markAttrs: capturedAttrs,
	};
}

function resolveMarkTarget(
	editor: Editor,
	target: TextMarkTarget | null,
	requireMark: boolean
): { from: number; to: number } | null {
	if (!target) return null;
	if (target.markId) {
		let from: number | null = null;
		let to: number | null = null;
		editor.state.doc.descendants((node, pos) => {
			if (!node.isText) return true;
			const matches = node.marks.some(
				mark => mark.type.name === target.markType && mark.attrs.id === target.markId
			);
			if (!matches) return true;
			from = from === null ? pos : Math.min(from, pos);
			to = to === null ? pos + node.nodeSize : Math.max(to, pos + node.nodeSize);
			return true;
		});
		return from === null || to === null ? null : { from, to };
	}

	if (target.to > editor.state.doc.content.size) return null;
	if (editor.state.doc.textBetween(target.from, target.to) !== target.text) return null;
	if (requireMark) {
		if (!target.markAttrs) return null;
		let matchingMark = false;
		editor.state.doc.nodesBetween(target.from, target.to, node => {
			matchingMark ||= node.marks?.some(
				mark =>
					mark.type.name === target.markType &&
					JSON.stringify(mark.attrs) === JSON.stringify(target.markAttrs)
			);
			return !matchingMark;
		});
		if (!matchingMark) return null;
	}
	return { from: target.from, to: target.to };
}

function getPageContextForPosition(editor: Editor, position: number): PageSelectionContext | null {
	let pageOrder = 0;
	let resolved: PageSelectionContext | null = null;

	editor.state.doc.descendants((node, pos) => {
		if (node.type.name !== 'page') return true;
		pageOrder += 1;
		const pageStart = pos;
		const pageEnd = pos + node.nodeSize;
		if (position < pageStart || position > pageEnd) {
			return false;
		}
		const pageId = typeof node.attrs.pageId === 'string' ? node.attrs.pageId : '';
		resolved = pageId
			? {
					pageId,
					pageName:
						typeof node.attrs.pageName === 'string' &&
						node.attrs.pageName.trim().length > 0
							? node.attrs.pageName.trim()
							: null,
					pageOrder,
				}
			: null;
		return false;
	});

	return resolved;
}

export function getSelectedTranscriptionQuote(
	editor: Editor | null
): TranscriptionSelectionQuote | null {
	const range = getSelectionRange(editor);
	if (!editor || !range) return null;

	const text = editor.state.doc.textBetween(range.from, range.to, ' ', ' ').trim();
	if (!text) return null;

	const startPage = getPageContextForPosition(editor, range.from);
	const endPage = getPageContextForPosition(editor, Math.max(range.to - 1, range.from));
	if (!startPage || !endPage || startPage.pageId !== endPage.pageId) {
		return null;
	}

	return {
		text,
		pageId: startPage.pageId,
		pageName: startPage.pageName,
		pageOrder: startPage.pageOrder,
		from: range.from,
		to: range.to,
	};
}

export function getSelectedInspectorNode(
	editor: Editor | null,
	carrierTypes: readonly string[] = DEFAULT_INSPECTOR_CARRIER_TYPES
): SelectedCarrierNode | null {
	if (!editor) return null;

	const selectionNode = (editor.state.selection as any).node;
	if (selectionNode && carrierTypes.includes(selectionNode.type.name)) {
		return {
			pos: editor.state.selection.from,
			type: selectionNode.type.name,
			attrs: selectionNode.attrs || {},
		};
	}

	const { $from } = editor.state.selection;
	for (let depth = $from.depth; depth > 0; depth -= 1) {
		const node = $from.node(depth);
		if (node.type.name === 'fw' && carrierTypes.includes('fw')) {
			return {
				pos: $from.before(depth),
				type: 'fw',
				attrs: node.attrs || {},
			};
		}
	}
	return null;
}

export function inspectorSelectionKey(node: SelectedCarrierNode | null): string {
	return node ? `${node.pos}:${node.type}` : '';
}

export function readCorrectionDraft(editor: Editor | null): Correction[] | null {
	const range = getSelectionRange(editor);
	if (!editor || !range) return null;

	const correctionMark = editor.state.schema.marks.correction;
	if (!correctionMark || !editor.state.doc.rangeHasMark(range.from, range.to, correctionMark)) {
		return [];
	}

	let existing: Correction[] = [];
	editor.state.doc.nodesBetween(range.from, range.to, node => {
		if (!node.marks) return;
		const mark = node.marks.find(current => current.type.name === 'correction');
		if (mark?.attrs.corrections) {
			existing = mark.attrs.corrections;
			return false;
		}
	});

	return [...existing];
}

function getCorrectionWordRange(editor: Editor): { from: number; to: number } | null {
	const range = getSelectionRange(editor);
	if (!range) return null;

	const { $from, $to } = editor.state.selection;
	const beforeSelection = $from.parent.textBetween(0, $from.parentOffset, '', '\ufffc');
	const afterSelection = $to.parent.textBetween(
		$to.parentOffset,
		$to.parent.content.size,
		'',
		'\ufffc'
	);
	const wordCharacters = /[^\s\p{P}\p{S}]/u;
	let from = range.from;
	let to = range.to;

	for (let index = beforeSelection.length - 1; index >= 0; index -= 1) {
		if (!wordCharacters.test(beforeSelection[index])) break;
		from -= 1;
	}
	for (let index = 0; index < afterSelection.length; index += 1) {
		if (!wordCharacters.test(afterSelection[index])) break;
		to += 1;
	}

	return { from, to };
}

export function captureCorrectionTarget(editor: Editor | null): TextMarkTarget | null {
	if (!editor) return null;
	const range = getCorrectionWordRange(editor);
	return range ? captureMarkTarget(editor, range, 'correction') : null;
}

export function captureAbbreviationTarget(editor: Editor | null): TextMarkTarget | null {
	if (!editor) return null;
	const range = getSelectionRange(editor);
	return range ? captureMarkTarget(editor, range, 'abbreviation') : null;
}

export function applyCorrectionMark(
	editor: Editor | null,
	target: TextMarkTarget | null,
	corrections: Correction[]
): boolean {
	if (!editor || corrections.length === 0) return false;
	const range = resolveMarkTarget(editor, target, false);
	if (!range) return false;
	editor
		.chain()
		.focus()
		.setTextSelection(range)
		.setMark('correction', { corrections, id: nanoid(8) })
		.run();
	return true;
}

export function removeCorrectionMark(
	editor: Editor | null,
	target: TextMarkTarget | null
): boolean {
	if (!editor) return false;
	const range = resolveMarkTarget(editor, target, true);
	if (!range) return false;
	editor.chain().focus().setTextSelection(range).unsetMark('correction').run();
	return true;
}

export function readAbbreviationDraft(editor: Editor | null): AbbreviationDraft | null {
	const range = getSelectionRange(editor);
	if (!editor || !range) return null;

	const abbreviationMark = editor.state.schema.marks.abbreviation;
	if (
		!abbreviationMark ||
		!editor.state.doc.rangeHasMark(range.from, range.to, abbreviationMark)
	) {
		return { ...DEFAULT_ABBREVIATION_DRAFT };
	}

	let existing = { ...DEFAULT_ABBREVIATION_DRAFT };
	editor.state.doc.nodesBetween(range.from, range.to, node => {
		if (!node.marks) return;
		const mark = node.marks.find(current => current.type.name === 'abbreviation');
		if (mark) {
			existing = {
				type: mark.attrs.type || DEFAULT_ABBREVIATION_DRAFT.type,
				expansion: mark.attrs.expansion || DEFAULT_ABBREVIATION_DRAFT.expansion,
				rend: mark.attrs.rend || DEFAULT_ABBREVIATION_DRAFT.rend,
			};
			return false;
		}
	});

	return existing;
}

export function applyAbbreviationMark(
	editor: Editor | null,
	target: TextMarkTarget | null,
	draft: AbbreviationDraft
): boolean {
	if (!editor) return false;
	const range = resolveMarkTarget(editor, target, false);
	if (!range) return false;
	const attrs: Record<string, any> = {
		id: nanoid(8),
		type: draft.type,
		expansion: draft.expansion,
	};
	if (draft.type === 'ligature') {
		attrs.rend = draft.rend;
	}
	editor.chain().focus().setTextSelection(range).setMark('abbreviation', attrs).run();
	return true;
}

export function removeAbbreviationMark(
	editor: Editor | null,
	target: TextMarkTarget | null
): boolean {
	if (!editor) return false;
	const range = resolveMarkTarget(editor, target, true);
	if (!range) return false;
	editor.chain().focus().setTextSelection(range).unsetMark('abbreviation').run();
	return true;
}
