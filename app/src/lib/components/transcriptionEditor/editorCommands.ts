import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { nanoid } from 'nanoid';

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
	let insertedPos: number;
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
	attrs: Record<string, any>
): boolean {
	if (!editor) return false;

	let succeeded = false;
	editor
		.chain()
		.command(({ tr, state }) => {
			if (!Number.isInteger(pos) || pos < 0 || pos > state.doc.content.size) return false;
			const node = state.doc.nodeAt(pos);
			if (!node) return false;
			const nextAttrs = {
				...node.attrs,
				...attrs,
			};
			tr.setNodeMarkup(pos, undefined, nextAttrs);
			succeeded = true;
			return true;
		})
		.run();

	return succeeded;
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

export function insertMetamarkForSelection(editor: Editor | null, functionValue: string): boolean {
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

	const attrs = buildMetamarkAttrs(
		trimmedFunction,
		context.targetValue || '',
		context.targetLabel
	);
	if (!attrs) return false;
	return insertSelectableCarrierNode(editor, 'metamark', attrs);
}

export function describeMetamarkTarget(attrs: Record<string, any> | null | undefined): string {
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
	return { corrections: [], id: nanoid(8) };
}

export function buildTeiMilestoneAttrs(
	unit: string,
	value: string,
	ed: string
): Record<string, any> | null {
	if (!unit.trim() && !value.trim() && !ed.trim()) return null;
	return {
		teiAttrs: {
			...(unit.trim() ? { unit: unit.trim() } : {}),
			...(value.trim() ? { n: value.trim() } : {}),
			...(ed.trim() ? { ed: ed.trim() } : {}),
		},
	};
}

export type MilestoneNodeType = 'book' | 'chapter' | 'verse';

export function resolveMilestoneContext(editor: Editor | null): {
	book?: string;
	chapter?: string;
	verse?: string;
} {
	if (!editor) return {};

	const result: { book?: string; chapter?: string; verse?: string } = {};
	let fallbackBook: string | undefined;
	let fallbackChapter: string | undefined;
	let seekChapter = true;
	let seekVerse = true;

	function walkBackwards(node: any, contentStart: number, before: number): boolean {
		let offset = node.content.size;
		for (let index = node.childCount - 1; index >= 0; index -= 1) {
			const child = node.child(index);
			offset -= child.nodeSize;
			const pos = contentStart + offset;
			if (pos >= before) continue;

			if (child.childCount && walkBackwards(child, pos + 1, before)) return true;

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

	walkBackwards(editor.state.doc, 0, editor.state.selection.from);
	result.book ??= fallbackBook;
	result.chapter ??= fallbackChapter;

	return result;
}

export function getCurrentMilestoneValues(editor: Editor | null): {
	book?: string;
	chapter?: string;
	verse?: string;
} {
	return resolveMilestoneContext(editor);
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
		const context = resolveMilestoneContext(editor);
		if (!context.book) return 'missing-book';
		attrs.book = context.book;
		attrs.chapter = value;
	} else {
		const context = resolveMilestoneContext(editor);
		if (!context.book || !context.chapter) return 'missing-chapter';
		attrs.book = context.book;
		attrs.chapter = context.chapter;
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
