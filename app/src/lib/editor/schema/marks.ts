import { getChangedRanges, LINE_SPLIT_TARGET_LINE_ID_META } from '$lib/editor/structure';
import { Extension, Mark, markInputRule } from '@tiptap/core';
import {
	Fragment,
	Slice,
	type Mark as ProseMirrorMark,
	type MarkType,
	type Node as ProseMirrorNode,
} from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { parseJsonAttr, formatCorrectionTooltipText } from './node-views';

function renderTeiAttrMark(className: string, title: string) {
	return Mark.create({
		name: className,
		parseHTML() {
			return [{ tag: `span.${className}` }];
		},
		renderHTML({ mark, HTMLAttributes }) {
			const teiAttrs = mark.attrs.teiAttrs || {};
			return [
				'span',
				{
					...HTMLAttributes,
					class: className,
					'data-tei-attrs': JSON.stringify(teiAttrs),
					title,
				},
				0,
			];
		},
		addAttributes() {
			return {
				teiAttrs: {
					default: {},
					parseHTML: element => parseJsonAttr(element.getAttribute('data-tei-attrs')),
					renderHTML: attributes => ({
						'data-tei-attrs': JSON.stringify(attributes.teiAttrs || {}),
					}),
				},
			};
		},
	});
}

export const Lacunose = Mark.create({
	name: 'lacunose',
	parseHTML() {
		return [
			{ tag: 'span.lacunose' },
			{
				tag: 'span',
				getAttrs: node => {
					const text = (node as HTMLElement).textContent || '';
					return text.match(/^\[.*\]$/) ? {} : false;
				},
			},
		];
	},
	renderHTML({ mark, HTMLAttributes }) {
		return [
			'span',
			{
				...HTMLAttributes,
				class: 'lacunose',
				'data-tei-attrs': JSON.stringify(mark.attrs.teiAttrs || {}),
				title: 'Lacunose text',
			},
			0,
		];
	},
	addAttributes() {
		return {
			teiAttrs: {
				default: {},
				parseHTML: element => parseJsonAttr(element.getAttribute('data-tei-attrs')),
				renderHTML: attributes => ({
					'data-tei-attrs': JSON.stringify(attributes.teiAttrs || {}),
				}),
			},
		};
	},
	addKeyboardShortcuts() {
		return {
			'Mod-u': ({ editor }) => editor.chain().toggleMark('lacunose').run(),
		};
	},
	addInputRules() {
		return [
			markInputRule({
				find: /\[([^\]]+)\]$/,
				type: this.type,
			}),
		];
	},
});

export const Unclear = Mark.create({
	name: 'unclear',
	parseHTML() {
		return [{ tag: 'span.unclear' }];
	},
	renderHTML({ mark, HTMLAttributes }) {
		return [
			'span',
			{
				...HTMLAttributes,
				class: 'unclear',
				'data-tei-attrs': JSON.stringify(mark.attrs.teiAttrs || {}),
				title: 'Unclear text',
			},
			0,
		];
	},
	addAttributes() {
		return {
			teiAttrs: {
				default: {},
				parseHTML: element => parseJsonAttr(element.getAttribute('data-tei-attrs')),
				renderHTML: attributes => ({
					'data-tei-attrs': JSON.stringify(attributes.teiAttrs || {}),
				}),
			},
		};
	},
	addKeyboardShortcuts() {
		return {
			'Mod-Shift-u': ({ editor }) => editor.chain().toggleMark('unclear').run(),
		};
	},
});

export const Damage = renderTeiAttrMark('damage', 'Damage');
export const Surplus = renderTeiAttrMark('surplus', 'Surplus');
export const Secluded = renderTeiAttrMark('secl', 'Secluded text');
export const Highlight = renderTeiAttrMark('hi', 'Highlighted text');
export const WordAttrs = renderTeiAttrMark('word', 'Word attributes');
export const TeiSpan = Mark.create({
	name: 'teiSpan',
	excludes: '',
	parseHTML() {
		return [{ tag: 'span.tei-span' }];
	},
	renderHTML({ mark, HTMLAttributes }) {
		const tag = mark.attrs.tag || 'span';
		const teiAttrs = mark.attrs.teiAttrs || {};
		return [
			'span',
			{
				...HTMLAttributes,
				class: `tei-span tei-span-${tag}`,
				'data-tag': tag,
				'data-tei-attrs': JSON.stringify(teiAttrs),
				title: `<${tag}>`,
			},
			0,
		];
	},
	addAttributes() {
		return {
			tag: {
				default: 'span',
				parseHTML: element => element.getAttribute('data-tag') || 'span',
				renderHTML: attributes => ({
					'data-tag': attributes.tag || 'span',
				}),
			},
			teiAttrs: {
				default: {},
				parseHTML: element => parseJsonAttr(element.getAttribute('data-tei-attrs')),
				renderHTML: attributes => ({
					'data-tei-attrs': JSON.stringify(attributes.teiAttrs || {}),
				}),
			},
		};
	},
});

export const Correction = Mark.create({
	name: 'correction',
	parseHTML() {
		return [{ tag: 'span.correction' }];
	},
	renderHTML({ mark, HTMLAttributes }) {
		const corrections = mark.attrs.corrections || [];
		const tooltipText = formatCorrectionTooltipText(corrections);

		return [
			'span',
			{
				...HTMLAttributes,
				class: 'correction tooltip inline',
				'data-tip': tooltipText,
				...(mark.attrs.id ? { 'data-mark-id': mark.attrs.id } : {}),
				'data-corrections': JSON.stringify(corrections),
			},
			0,
		];
	},
	addAttributes() {
		return {
			id: {
				default: null,
				parseHTML: element => element.getAttribute('data-mark-id'),
				renderHTML: attributes => (attributes.id ? { 'data-mark-id': attributes.id } : {}),
			},
			corrections: {
				default: [],
				parseHTML: element => {
					const correctionsStr = element.getAttribute('data-corrections');
					if (!correctionsStr) {
						return [];
					}
					try {
						return JSON.parse(correctionsStr);
					} catch {
						return [];
					}
				},
				renderHTML: attributes => ({
					'data-corrections': JSON.stringify(attributes.corrections || []),
				}),
			},
			type: {
				default: '',
				parseHTML: element => element.getAttribute('data-correction-type') || '',
				renderHTML: attributes => ({
					'data-correction-type': attributes.type || '',
				}),
			},
			position: {
				default: '',
				parseHTML: element => element.getAttribute('data-correction-position') || '',
				renderHTML: attributes => ({
					'data-correction-position': attributes.position || '',
				}),
			},
		};
	},
	addKeyboardShortcuts() {
		return {
			'Mod-Shift-c': () => {
				// Discoverable shortcut; UI lives in the bubble menu.
				return true;
			},
		};
	},
});

export const Abbreviation = Mark.create({
	name: 'abbreviation',
	parseHTML() {
		return [{ tag: 'span.abbreviation' }];
	},
	renderHTML({ mark, HTMLAttributes }) {
		const type = mark.attrs.type || 'nomSac';
		const expansion = mark.attrs.expansion || '';
		const rend = mark.attrs.rend || '¯';

		const tooltipText = (() => {
			if (type === 'nomSac') return `Nomen Sacrum ${expansion}` || 'Abbreviation';
			if (type === 'ligature') return expansion || 'Expansion';

			const tooltipParts = [];
			if (type) tooltipParts.push(`Type: ${type}`);
			if (expansion) tooltipParts.push(`Expansion: ${expansion}`);
			return tooltipParts.join(' | ') || 'Abbreviation';
		})();
		if (type === 'nomSac') {
			return [
				'span',
				{
					...HTMLAttributes,
					class: 'abbreviation nomSac tooltip inline',
					'data-tip': tooltipText,
					...(mark.attrs.id ? { 'data-mark-id': mark.attrs.id } : {}),
					'data-abbr-type': type,
				},
				0,
			];
		} else {
			return [
				'span',
				{
					...HTMLAttributes,
					class: 'abbreviation other tooltip inline',
					'data-tip': tooltipText,
					...(mark.attrs.id ? { 'data-mark-id': mark.attrs.id } : {}),
					'data-abbr-type': type,
					'data-rend': rend,
				},
				0,
			];
		}
	},
	addAttributes() {
		return {
			id: {
				default: null,
				parseHTML: element => element.getAttribute('data-mark-id'),
				renderHTML: attributes => (attributes.id ? { 'data-mark-id': attributes.id } : {}),
			},
			type: {
				default: 'nomSac',
				parseHTML: element => element.getAttribute('data-abbr-type') || 'nomSac',
				renderHTML: attributes => ({
					'data-abbr-type': attributes.type || 'nomSac',
				}),
			},
			expansion: {
				default: '',
				parseHTML: element => element.getAttribute('data-expansion'),
				renderHTML: attributes => ({
					'data-expansion': attributes.expansion,
				}),
			},
			rend: {
				default: '¯',
				parseHTML: element => element.getAttribute('data-rend') || '¯',
				renderHTML: attributes => ({
					'data-rend': attributes.rend || '¯',
				}),
			},
		};
	},
	addKeyboardShortcuts() {
		return {
			'Mod-Shift-a': () => {
				// Discoverable shortcut; UI lives in the bubble menu.
				return true;
			},
		};
	},
});

export const Punctuation = Mark.create({
	name: 'punctuation',
	inclusive: false,
	parseHTML() {
		return [{ tag: 'span.punctuation' }];
	},
	renderHTML({ HTMLAttributes }) {
		return [
			'span',
			{
				...HTMLAttributes,
				class: 'punctuation',
			},
			0,
		];
	},
	addAttributes() {
		return {
			teiAttrs: {
				default: {},
				parseHTML: element => parseJsonAttr(element.getAttribute('data-tei-attrs')),
				renderHTML: attributes => ({
					'data-tei-attrs': JSON.stringify(attributes.teiAttrs || {}),
				}),
			},
		};
	},
});

function markPastedText(fragment: Fragment, mark: ProseMirrorMark): Fragment {
	const children: ProseMirrorNode[] = [];
	fragment.forEach(node => {
		if (node.isText) {
			children.push(node.mark(mark.addToSet(node.marks)));
			return;
		}
		children.push(
			node.copy(node.content.size > 0 ? markPastedText(node.content, mark) : node.content)
		);
	});
	return Fragment.fromArray(children);
}

export function markPastedSlice(slice: Slice, markType: MarkType): Slice {
	return new Slice(
		markPastedText(slice.content, markType.create()),
		slice.openStart,
		slice.openEnd
	);
}

export const Unconfirmed = Mark.create({
	name: 'unconfirmed',
	inclusive: false,
	parseHTML() {
		return [{ tag: 'span.unconfirmed' }];
	},
	renderHTML({ mark, HTMLAttributes }) {
		return [
			'span',
			{
				...HTMLAttributes,
				class: 'unconfirmed',
				'data-tei-attrs': JSON.stringify(mark.attrs.teiAttrs || {}),
				title: 'Unconfirmed text',
			},
			0,
		];
	},
	addAttributes() {
		return {
			teiAttrs: {
				default: {},
				parseHTML: element => parseJsonAttr(element.getAttribute('data-tei-attrs')),
				renderHTML: attributes => ({
					'data-tei-attrs': JSON.stringify(attributes.teiAttrs || {}),
				}),
			},
		};
	},
	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey('unconfirmedTextInvalidator'),
				appendTransaction: (transactions, _oldState, newState) => {
					if (
						!transactions.some(transaction => transaction.docChanged) ||
						transactions.some(
							transaction => transaction.getMeta('uiEvent') === 'paste'
						) ||
						transactions.some(
							transaction => transaction.getMeta('referenceEditionSeed') === true
						) ||
						transactions.some(transaction =>
							Boolean(transaction.getMeta(LINE_SPLIT_TARGET_LINE_ID_META))
						) ||
						transactions.some(
							transaction => transaction.getMeta('addToHistory') === false
						)
					) {
						return null;
					}

					const markType = newState.schema.marks.unconfirmed;
					if (!markType) return null;
					const transaction = newState.tr;
					for (const range of getChangedRanges(transactions, newState.doc.content.size)) {
						if (range.from < range.to)
							transaction.removeMark(range.from, range.to, markType);
					}
					return transaction.docChanged ? transaction : null;
				},
			}),
		];
	},
});

export const PunctuationHighlighter = Extension.create({
	name: 'punctuationHighlighter',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey('punctuationHighlighter'),
				appendTransaction: (transactions, oldState, newState) => {
					if (!newState.doc.eq(oldState.doc)) {
						const punctuationType = newState.schema.marks.punctuation;
						if (!punctuationType) {
							return null;
						}
						const tr = newState.tr;
						let changed = false;
						const punctuationRegex = /[.,;:!?"'«»()\[\]{}\-–—/\\·⸄⸃´`†‡]/g;

						for (const range of getChangedRanges(
							transactions,
							newState.doc.content.size
						)) {
							newState.doc.nodesBetween(range.from, range.to, (node, pos) => {
								if (!node.isText || !node.text) return;
								const start = Math.max(range.from - pos, 0);
								const end = Math.min(range.to - pos, node.nodeSize);
								const regex = new RegExp(punctuationRegex.source, 'g');
								let match;
								while ((match = regex.exec(node.text.slice(start, end))) !== null) {
									const from = pos + start + match.index;
									const to = from + 1;
									if (newState.doc.rangeHasMark(from, to, punctuationType))
										continue;
									tr.addMark(from, to, punctuationType.create());
									changed = true;
								}
							});
						}

						if (!changed) {
							return null;
						}

						return tr;
					}

					return null;
				},
			}),
		];
	},
});

// Keeps selection visible when the inspector drawer takes focus.
const selectionHighlightKey = new PluginKey('selectionHighlight');

export const SelectionHighlight = Extension.create({
	name: 'selectionHighlight',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: selectionHighlightKey,
				state: {
					init() {
						return DecorationSet.empty;
					},
					apply(tr, value) {
						const highlight = tr.getMeta(selectionHighlightKey);
						if (highlight === 'clear') return DecorationSet.empty;
						if (highlight === 'show') {
							const { selection } = tr;
							if (selection instanceof NodeSelection) {
								return DecorationSet.create(tr.doc, [
									Decoration.node(selection.from, selection.to, {
										class: 'selection-highlight-node',
									}),
								]);
							}
							const { from, to } = selection;
							if (from === to) return DecorationSet.empty;
							return DecorationSet.create(tr.doc, [
								Decoration.inline(from, to, {
									class: 'selection-highlight',
								}),
							]);
						}
						return value.map(tr.mapping, tr.doc);
					},
				},
				props: {
					decorations(state) {
						return selectionHighlightKey.getState(state);
					},
					handleDOMEvents: {
						blur(view) {
							const tr = view.state.tr.setMeta(selectionHighlightKey, 'show');
							view.dispatch(tr);
							return false;
						},
						focus(view) {
							const tr = view.state.tr.setMeta(selectionHighlightKey, 'clear');
							view.dispatch(tr);
							return false;
						},
					},
				},
			}),
		];
	},
});
