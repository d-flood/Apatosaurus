import type { Editor } from '@tiptap/core';

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

export function getSelectionRange(editor: Editor | null): { from: number; to: number } | null {
	if (!editor) return null;
	const { from, to } = editor.state.selection;
	if (from === to) return null;
	return { from, to };
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
					typeof node.attrs.n === 'string' && node.attrs.n.trim().length > 0
						? node.attrs.n.trim()
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
	if (!selectionNode || !carrierTypes.includes(selectionNode.type.name)) {
		return null;
	}

	return {
		pos: editor.state.selection.from,
		type: selectionNode.type.name,
		attrs: selectionNode.attrs || {},
	};
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

export function applyCorrectionMark(editor: Editor | null, corrections: Correction[]): boolean {
	if (!editor || corrections.length === 0) return false;
	editor.chain().focus().setMark('correction', { corrections }).run();
	return true;
}

export function removeCorrectionMark(editor: Editor | null): boolean {
	if (!editor) return false;
	editor.chain().focus().unsetMark('correction').run();
	return true;
}

export function readAbbreviationDraft(editor: Editor | null): AbbreviationDraft | null {
	const range = getSelectionRange(editor);
	if (!editor || !range) return null;

	const abbreviationMark = editor.state.schema.marks.abbreviation;
	if (!abbreviationMark || !editor.state.doc.rangeHasMark(range.from, range.to, abbreviationMark)) {
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

export function applyAbbreviationMark(editor: Editor | null, draft: AbbreviationDraft): boolean {
	if (!editor) return false;
	const attrs: Record<string, any> = {
		type: draft.type,
		expansion: draft.expansion,
	};
	if (draft.type === 'ligature') {
		attrs.rend = draft.rend;
	}
	editor.chain().focus().setMark('abbreviation', attrs).run();
	return true;
}

export function removeAbbreviationMark(editor: Editor | null): boolean {
	if (!editor) return false;
	editor.chain().focus().unsetMark('abbreviation').run();
	return true;
}
