import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

import { classifyFormWork } from './formworkConcepts';
import { formWorkContentToPlainText } from './formworkContent';

export const COMMON_ABBREVIATION_TYPES = [
	'nomSac',
	'ligature',
	'symbol',
	'abbreviation',
	'suspension',
	'contraction',
] as const;

export interface MetamarkInsertContext {
	kind: 'text-selection' | 'editorial-action';
	targetValue?: string;
	targetLabel: string;
}

interface UpdateNodeAttrsContext {
	tr: any;
	state: any;
	node: any;
	pos: number;
	nextAttrs: Record<string, any>;
}

export function toggleEditorMark(
	editor: Editor | null,
	name: string,
	attrs?: Record<string, any>
): boolean {
	if (!editor) return false;
	editor.chain().focus().toggleMark(name, attrs).run();
	return true;
}

export function insertContentNode(
	editor: Editor | null,
	nodeTypeName: string,
	attrs: Record<string, any>
): boolean {
	if (!editor) return false;
	editor.chain().focus().insertContent({ type: nodeTypeName, attrs }).run();
	return true;
}

export function insertSelectableCarrierNode(
	editor: Editor | null,
	nodeTypeName: string,
	attrs: Record<string, any>
): boolean {
	if (!editor) return false;
	editor.commands.focus();
	const { state, view } = editor;
	const nodeType = state.schema.nodes[nodeTypeName];
	if (!nodeType) return false;
	const node = nodeType.create(attrs);
	let tr = state.tr;
	let insertedPos = state.selection.from;
	if (state.selection instanceof NodeSelection && state.selection.node.isInline) {
		insertedPos = state.selection.to;
		tr = tr.insert(insertedPos, node);
	} else {
		tr = tr.replaceSelectionWith(node, false);
		insertedPos = Math.max(0, tr.selection.from - node.nodeSize);
	}
	tr.setSelection(NodeSelection.create(tr.doc, insertedPos));
	view.dispatch(tr.scrollIntoView());
	return true;
}

export function updateNodeAttrs(
	editor: Editor | null,
	pos: number,
	attrs: Record<string, any>,
	afterUpdate?: (context: UpdateNodeAttrsContext) => void | boolean
): boolean {
	if (!editor) return false;

	let succeeded = false;
	editor
		.chain()
		.command(({ tr, state }) => {
			const node = state.doc.nodeAt(pos);
			if (!node) return false;
			const nextAttrs = {
				...node.attrs,
				...attrs,
			};
			tr.setNodeMarkup(pos, undefined, nextAttrs);
			if (afterUpdate) {
				const result = afterUpdate({ tr, state, node, pos, nextAttrs });
				if (result === false) return false;
			}
			succeeded = true;
			return true;
		})
		.run();

	return succeeded;
}

export function syncPageFormWorkToContainingPage(context: UpdateNodeAttrsContext): void {
	const { tr, state, node, pos, nextAttrs } = context;
	if (node.type.name !== 'fw') return;

	const classification = classifyFormWork(nextAttrs);
	const kind =
		classification.contentConcept === 'pageLabel'
			? 'pageLabel'
			: classification.contentConcept === 'runningTitle'
				? 'runningTitle'
				: classification.contentConcept === 'catchword'
					? 'catchword'
					: classification.contentConcept === 'quireSignature'
						? 'quireSignature'
						: null;

	if (!kind) return;

	let pagePos: number | null = null;
	state.doc.nodesBetween(0, pos, (candidateNode: any, candidatePos: number) => {
		if (candidateNode.type.name === 'page') {
			pagePos = candidatePos;
		}
	});

	if (pagePos === null) return;

	const pageNode = state.doc.nodeAt(pagePos);
	if (pageNode?.type.name !== 'page') return;

	tr.setNodeMarkup(pagePos, undefined, {
		...pageNode.attrs,
		[kind]: formWorkContentToPlainText(nextAttrs.content || []),
	});
}

export function buildGapAttrs(reason: string, unit: string, extent: string): Record<string, any> {
	return { reason, unit, extent };
}

export function summarizeTeiAtomAttrs(
	tag: string,
	teiAttrs: Record<string, any> | undefined,
	text: string | undefined
): string {
	const normalizedText = String(text || '')
		.replace(/\s+/g, ' ')
		.trim();

	if (tag === 'gb') {
		return teiAttrs?.n ? `gb:${teiAttrs.n}` : 'gb';
	}

	if (tag === 'ptr') {
		return teiAttrs?.target || teiAttrs?.cRef || 'ptr';
	}

	if (tag === 'media') {
		return teiAttrs?.mimeType || teiAttrs?.url || 'media';
	}

	if (tag === 'note') {
		const type = String(teiAttrs?.type || '').trim();
		return type && normalizedText
			? `note:${type}:${normalizedText}`
			: type
				? `note:${type}`
				: normalizedText
					? `note:${normalizedText}`
					: 'note';
	}

	if (tag === 'ellipsis') {
		return normalizedText ? `ellipsis:${normalizedText}` : 'ellipsis';
	}

	return tag;
}

export function buildEditorNoteAttrs(type: string, text: string): Record<string, any> | null {
	const normalizedText = text.trim();
	if (!normalizedText) return null;

	const normalizedType = type.trim() || 'editorial';
	const teiAttrs = { type: normalizedType };

	return {
		tag: 'note',
		summary: summarizeTeiAtomAttrs('note', teiAttrs, normalizedText),
		teiAttrs,
		text: normalizedText,
		teiNode: {
			type: 'element',
			tag: 'note',
			attrs: teiAttrs,
			children: [{ type: 'text', text: normalizedText }],
		},
		wordInline: false,
	};
}

export function buildSpaceAttrs(unit: string, extent: string): Record<string, any> {
	return {
		teiAttrs: {
			...(unit.trim() ? { unit: unit.trim() } : {}),
			...(extent.trim() ? { extent: extent.trim() } : {}),
		},
	};
}

export function buildHandShiftAttrs(newHand: string, medium: string): Record<string, any> | null {
	const normalizedHand = newHand.trim();
	if (!normalizedHand) return null;
	return {
		teiAttrs: {
			new: normalizedHand.startsWith('#') ? normalizedHand : `#${normalizedHand}`,
			...(medium.trim() ? { medium: medium.trim() } : {}),
		},
	};
}

export function buildMetamarkAttrs(
	functionValue: string,
	targetValue = '',
	targetLabel = ''
): Record<string, any> | null {
	const trimmedFunction = functionValue.trim();
	const trimmedTarget = targetValue.trim();
	if (!trimmedFunction) return null;
	return {
		summary: `metamark:${trimmedFunction}`,
		teiAttrs: {
			function: trimmedFunction,
			...(trimmedTarget ? { target: trimmedTarget } : {}),
		},
		...(targetLabel ? { targetLabel } : {}),
		wordInline: false,
	};
}

export function getMetamarkInsertContext(editor: Editor | null): MetamarkInsertContext | null {
	if (!editor) return null;
	const { selection } = editor.state;

	if (!selection.empty && selectionHasMeaningfulText(editor)) {
		return {
			kind: 'text-selection',
			targetLabel: 'Selected text',
		};
	}

	if (selection instanceof NodeSelection && selection.node.type.name === 'editorialAction') {
		const targets = extractEditorialActionTargets(selection.node.attrs?.structure);
		if (targets.length === 0) return null;
		const actionKind = String(selection.node.attrs?.structure?.kind || 'editorial action');
		return {
			kind: 'editorial-action',
			targetValue: targets.join(' '),
			targetLabel:
				targets.length === 1
					? `Selected ${actionKind}`
					: `${targets.length} linked elements from selected ${actionKind}`,
		};
	}

	return null;
}

export function insertMetamarkForSelection(
	editor: Editor | null,
	functionValue: string
): boolean {
	if (!editor) return false;

	const trimmedFunction = functionValue.trim();
	if (!trimmedFunction) return false;

	const context = getMetamarkInsertContext(editor);
	if (!context) return false;

	if (context.kind === 'text-selection') {
		editor
			.chain()
			.focus()
			.setMark('teiSpan', {
				tag: 'metamark',
				teiAttrs: { function: trimmedFunction },
			})
			.run();
		return true;
	}

	const attrs = buildMetamarkAttrs(trimmedFunction, context.targetValue || '', context.targetLabel);
	if (!attrs) return false;
	return insertSelectableCarrierNode(editor, 'metamark', attrs);
}

export function describeMetamarkTarget(
	attrs: Record<string, any> | null | undefined
): string {
	const targetLabel = String(attrs?.targetLabel || '').trim();
	if (targetLabel) return targetLabel;

	const rawTarget = String(attrs?.teiAttrs?.target || '').trim();
	if (!rawTarget) return 'Text-bearing mark';

	const targetCount = rawTarget
		.split(/\s+/)
		.map(token => token.trim())
		.filter(Boolean).length;

	return targetCount === 1 ? '1 linked element' : `${targetCount} linked elements`;
}

export function buildCorrectionNodeAttrs(): Record<string, any> {
	return { corrections: [] };
}

export function buildTeiMilestoneAttrs(unit: string, value: string, ed: string): Record<string, any> | null {
	if (!unit.trim() && !value.trim() && !ed.trim()) return null;
	return {
		teiAttrs: {
			...(unit.trim() ? { unit: unit.trim() } : {}),
			...(value.trim() ? { n: value.trim() } : {}),
			...(ed.trim() ? { ed: ed.trim() } : {}),
		},
	};
}

export function insertBreakNode(
	editor: Editor | null,
	nodeTypeName: 'pageBreak' | 'lineBreak' | 'columnBreak'
): boolean {
	return insertContentNode(editor, nodeTypeName, { teiAttrs: {} });
}

export type MilestoneNodeType = 'book' | 'chapter' | 'verse';

interface LocatedMilestoneNode {
	node: any;
	pos: number;
}

export function findPrecedingMilestoneNode(
	editor: Editor | null,
	nodeType: 'book' | 'chapter'
): LocatedMilestoneNode | null {
	if (!editor) return null;
	const { state } = editor;
	const { from } = state.selection;
	let foundNode: LocatedMilestoneNode | null = null;

	state.doc.nodesBetween(0, from, (node: any, pos: number) => {
		if (node.type.name === nodeType) {
			if (!foundNode || pos > foundNode.pos) {
				foundNode = { node, pos };
			}
		}
	});

	return foundNode;
}

export function getCurrentMilestoneValues(editor: Editor | null): {
	book?: string;
	chapter?: string;
	verse?: string;
} {
	if (!editor) return {};

	const result: { book?: string; chapter?: string; verse?: string } = {};

	const bookNode = findPrecedingMilestoneNode(editor, 'book');
	if (bookNode) {
		result.book = bookNode.node.attrs.book;
	}

	const chapterNode = findPrecedingMilestoneNode(editor, 'chapter');
	if (chapterNode) {
		result.chapter = chapterNode.node.attrs.chapter;
		if (!result.book) {
			result.book = chapterNode.node.attrs.book;
		}
	}

	const { from } = editor.state.selection;
	let foundVerseNode: any = null;
	editor.state.doc.nodesBetween(0, from, (node: any) => {
		if (node.type.name === 'verse') {
			foundVerseNode = node;
		}
	});

	if (foundVerseNode) {
		result.verse = foundVerseNode.attrs.verse;
		if (!result.book) {
			result.book = foundVerseNode.attrs.book;
		}
		if (!result.chapter) {
			result.chapter = foundVerseNode.attrs.chapter;
		}
	}

	return result;
}

export function insertMilestoneNode(
	editor: Editor | null,
	type: MilestoneNodeType,
	value: string
): 'ok' | 'missing-book' | 'missing-chapter' | 'invalid' {
	if (!editor || !value) return 'invalid';

	const attrs: Record<string, string> = {};

	if (type === 'book') {
		attrs.book = value;
	} else if (type === 'chapter') {
		const bookNode = findPrecedingMilestoneNode(editor, 'book');
		if (!bookNode) return 'missing-book';
		attrs.book = bookNode.node.attrs.book;
		attrs.chapter = value;
	} else {
		const chapterNode = findPrecedingMilestoneNode(editor, 'chapter');
		if (!chapterNode) return 'missing-chapter';
		attrs.book = chapterNode.node.attrs.book;
		attrs.chapter = chapterNode.node.attrs.chapter;
		attrs.verse = value;
	}

	editor.chain().focus().insertContent({ type, attrs }).run();
	return 'ok';
}

function selectionHasMeaningfulText(editor: Editor): boolean {
	const { from, to } = editor.state.selection;
	let hasText = false;

	editor.state.doc.nodesBetween(from, to, node => {
		if (node.isText && /\S/.test(node.text || '')) {
			hasText = true;
			return false;
		}
		return undefined;
	});

	return hasText;
}

function extractEditorialActionTargets(structure: any): string[] {
	if (!structure || typeof structure !== 'object') return [];

	if (Array.isArray(structure.targets)) {
		return structure.targets
			.map((target: unknown) => String(target || '').trim())
			.filter(Boolean);
	}

	if (structure.kind === 'listTranspose' && Array.isArray(structure.items)) {
		return structure.items.flatMap((item: any) => extractEditorialActionTargets(item));
	}

	return [];
}
