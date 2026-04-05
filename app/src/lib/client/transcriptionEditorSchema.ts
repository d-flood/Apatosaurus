import { badgeIconSpec, type BadgeIconName } from '$lib/client/transcriptionEditorBadgeIcons';
import { repairManuscriptStructureJson } from '$lib/client/transcriptionEditorStructure';
import { classifyFormWork } from '$lib/components/transcriptionEditor/formworkConcepts';
import {
	formWorkContentToPlainText,
	normalizeMarginaliaContent,
} from '$lib/components/transcriptionEditor/formworkContent';
import { Editor, Extension, Mark, Node, generateHTML, markInputRule } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/extension-bubble-menu';
import { History } from '@tiptap/extension-history';
import { Text } from '@tiptap/extension-text';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { nanoid } from 'nanoid';

function parseJsonAttr<T>(value: string | null, fallback: T = {} as T): T {
	if (!value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

function iconLabelSpec(label: string, icon: BadgeIconName) {
	return [badgeIconSpec(icon), ['span', { class: 'tei-inline-badge-label' }, label]];
}

function inlineBadgeClass(className: string, extraClass: string = '') {
	return `${className} tei-inline-badge badge badge-sm inline-flex items-center gap-1.5 ${extraClass}`.trim();
}

interface PreviewNodeLike {
	type?: string;
	text?: string;
	marks?: Array<{ type?: string; attrs?: Record<string, any> }>;
	content?: PreviewNodeLike[];
	attrs?: Record<string, any>;
	tag?: string;
	summary?: string;
	corrections?: Array<Record<string, any>>;
}

export function formatCorrectionTooltipText(corrections: any[]): string {
	return corrections
		.map((correction: any) => {
			const text = serializeCorrectionPreview(correction.content || []).trim();
			const metadata = [correction.type, correction.position].filter(Boolean).join(', ');
			const metadataStr = metadata ? ` (${metadata})` : '';
			return `${correction.hand}${metadataStr}: ${text}`;
		})
		.join(' | ');
}

export function serializeCorrectionPreview(content: unknown): string {
	if (Array.isArray(content)) {
		return content.map(node => serializeCorrectionPreview(node)).join('');
	}

	if (!content || typeof content !== 'object') {
		return '';
	}

	const node = content as PreviewNodeLike;

	if (node.type === 'text') {
		return (node.marks || []).reduce(
			(text, mark) => {
				switch (mark.type) {
					case 'lacunose':
						return `[${text}]`;
					case 'unclear':
						return `\`${text}\``;
					case 'abbreviation':
						if (mark.attrs?.type === 'ligature') {
							return `${text}{=${mark.attrs.expansion || ''}}`;
						}
						if (mark.attrs?.expansion) {
							return `${text}{abbr=${mark.attrs.expansion}}`;
						}
						return text;
					case 'hi':
						return `{hi:${text}}`;
					case 'damage':
						return `{damage:${text}}`;
					case 'surplus':
						return `{surplus:${text}}`;
					case 'secl':
						return `{secl:${text}}`;
					case 'teiSpan':
						if (mark.attrs?.tag === 'mod' || mark.attrs?.tag === 'retrace') {
							return `{${mark.attrs.tag}:${text}}`;
						}
						return text;
					case 'correction':
						return `++ ${text} => ${formatCorrectionTooltipText(mark.attrs?.corrections || [])} ++`;
					default:
						return text;
				}
			},
			String(node.text || '')
		);
	}

	if (node.type === 'boundary') return ' ';
	if (node.type === 'pageBreak') return '<pb/>';
	if (node.type === 'lineBreak') return '<lb/>';
	if (node.type === 'columnBreak') return '<cb/>';
	if (node.type === 'gap') return `<gap/>`;
	if (node.type === 'space') return `<space/>`;
	if (node.type === 'handShift') return `<handShift/>`;
	if (node.type === 'teiMilestone') return '<milestone/>';
	if (node.type === 'metamark') return `<metamark:${node.summary || ''}>`;
	if (node.type === 'teiAtom') return `<${node.tag || 'atom'}:${node.summary || ''}>`;
	if (node.type === 'teiWrapper')
		return `<${node.attrs?.tag || node.tag || 'wrapper'}:${node.summary || ''}>`;
	if (node.type === 'fw')
		return `<fw:${serializeCorrectionPreview(node.attrs?.content || node.content || []).trim()}>`;
	if (node.type === 'correctionNode') {
		const corrections = node.attrs?.corrections || node.corrections || [];
		return corrections
			.map((correction: any) => `++ ${formatCorrectionTooltipText([correction])} ++`)
			.join(' ');
	}

	if (Array.isArray(node.content)) {
		return node.content.map(child => serializeCorrectionPreview(child)).join('');
	}

	return '';
}

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

function createTeiAttrAtomNode(
	name: string,
	className: string,
	label: string,
	icon: BadgeIconName
) {
	return Node.create({
		name,
		group: 'inline',
		inline: true,
		atom: true,
		selectable: true,
		parseHTML() {
			return [{ tag: `span.${className}` }];
		},
		renderHTML({ node, HTMLAttributes }) {
			const teiAttrs = node.attrs.teiAttrs || {};
			return [
				'span',
				{
					...HTMLAttributes,
					class: inlineBadgeClass(className),
					'data-tei-attrs': JSON.stringify(teiAttrs),
					title: label,
					contenteditable: 'false',
				},
				...iconLabelSpec(label, icon),
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

function formatHandShiftTooltipText(teiAttrs: Record<string, any>): string {
	const nextHand = String(teiAttrs.new || '').trim();
	const medium = String(teiAttrs.medium || '').trim();
	return [nextHand, medium].filter(Boolean).join(' · ') || 'Change of Scribe';
}

function formatHandShiftAriaLabel(teiAttrs: Record<string, any>): string {
	const tooltipText = formatHandShiftTooltipText(teiAttrs);
	return tooltipText === 'Change of Scribe' ? tooltipText : `Change of Scribe: ${tooltipText}`;
}

// ########################################
//                Marks
// ########################################
const Lacunose = Mark.create({
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
	renderHTML({ HTMLAttributes }) {
		return [
			'span',
			{
				...HTMLAttributes,
				class: 'lacunose',
				'data-tei-attrs': JSON.stringify(HTMLAttributes.teiAttrs || {}),
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

const Unclear = Mark.create({
	name: 'unclear',
	parseHTML() {
		return [{ tag: 'span.unclear' }];
	},
	renderHTML({ HTMLAttributes }) {
		return [
			'span',
			{
				...HTMLAttributes,
				class: 'unclear',
				'data-tei-attrs': JSON.stringify(HTMLAttributes.teiAttrs || {}),
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

const Damage = renderTeiAttrMark('damage', 'Damage');
const Surplus = renderTeiAttrMark('surplus', 'Surplus');
const Secluded = renderTeiAttrMark('secl', 'Secluded text');
const Highlight = renderTeiAttrMark('hi', 'Highlighted text');
const WordAttrs = renderTeiAttrMark('word', 'Word attributes');
const TeiSpan = Mark.create({
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

const UntranscribedNode = Node.create({
	name: 'untranscribed',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.untranscribed-milestone' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const reason = node.attrs.reason || 'Untranscribed';
		const extent = node.attrs.extent || 'partial';

		let label = '';
		if (extent === 'partial') {
			label = `Partial Line Untranscribed (${reason})`;
		} else {
			label = `Line Untranscribed (${reason})`;
		}

		return [
			'span',
			{
				...HTMLAttributes,
				class: inlineBadgeClass('untranscribed-milestone'),
				'data-reason': reason,
				'data-extent': extent,
				title: label,
				contenteditable: 'false',
			},
			...iconLabelSpec('untranscribed', 'untranscribed'),
		];
	},
	addAttributes() {
		return {
			reason: {
				default: 'Untranscribed',
				parseHTML: element => element.getAttribute('data-reason'),
				renderHTML: attributes => ({
					'data-reason': attributes.reason,
				}),
			},
			extent: {
				default: 'partial',
				parseHTML: element => element.getAttribute('data-extent'),
				renderHTML: attributes => ({
					'data-extent': attributes.extent,
				}),
			},
		};
	},
});

const BookNode = Node.create({
	name: 'book',
	group: 'inline',
	inline: true,
	selectable: false,
	parseHTML() {
		return [{ tag: 'span.book-milestone' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const book = node.attrs.book || '';
		return [
			'span',
			{
				...HTMLAttributes,
				class: inlineBadgeClass('book-milestone', 'select-none mx-1'),
				'data-book': book,
				contenteditable: 'false',
			},
			...iconLabelSpec(`${book}`, 'milestone'),
		];
	},
	addAttributes() {
		return {
			book: {
				default: '',
				parseHTML: element => element.getAttribute('data-book'),
				renderHTML: attributes => ({
					'data-book': attributes.book,
				}),
			},
		};
	},
});

const ChapterNode = Node.create({
	name: 'chapter',
	group: 'inline',
	inline: true,
	selectable: false,
	parseHTML() {
		return [{ tag: 'span.chapter-milestone' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const book = node.attrs.book || '';
		const chapter = node.attrs.chapter || '';
		const display = chapter;
		return [
			'span',
			{
				...HTMLAttributes,
				class: inlineBadgeClass('chapter-milestone', 'select-none mx-1'),
				'data-book': book,
				'data-chapter': chapter,
				contenteditable: 'false',
			},
			...iconLabelSpec(`${display}`, 'milestone'),
		];
	},
	addAttributes() {
		return {
			book: {
				default: '',
				parseHTML: element => element.getAttribute('data-book'),
				renderHTML: attributes => ({
					'data-book': attributes.book,
				}),
			},
			chapter: {
				default: '',
				parseHTML: element => element.getAttribute('data-chapter'),
				renderHTML: attributes => ({
					'data-chapter': attributes.chapter,
				}),
			},
		};
	},
});

const Correction = Mark.create({
	name: 'correction',
	parseHTML() {
		return [{ tag: 'span.correction' }];
	},
	renderHTML({ mark, HTMLAttributes }) {
		const corrections = mark.attrs.corrections || [];
		const id = mark.attrs.id || nanoid(8);
		const tooltipText = formatCorrectionTooltipText(corrections);

		// Wrap corrected text in DaisyUI tooltip div
		return [
			'div',
			{
				class: 'tooltip',
				'data-tip': tooltipText,
				'data-mark-id': id,
				'data-corrections': JSON.stringify(corrections),
			},
			[
				'span',
				{
					...HTMLAttributes,
					class: 'correction',
				},
				0,
			],
		];
	},
	addAttributes() {
		return {
			id: {
				default: null,
				parseHTML: element => element.getAttribute('data-mark-id'),
				renderHTML: attributes => ({
					'data-mark-id': attributes.id || nanoid(8),
				}),
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
				// Keyboard shortcut registered - actual correction UI opens via bubble menu
				// This allows users to discover the shortcut but the UI is in the bubble menu
				return true;
			},
		};
	},
});

const CorrectionNode = Node.create({
	name: 'correctionNode',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.correction-node' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const corrections = node.attrs.corrections || [];
		const id = node.attrs.id || nanoid(8);
		const tooltipText = formatCorrectionTooltipText(corrections);

		// Render as a badge showing [Added] with tooltip showing details
		return [
			'span',
			{
				class: 'tooltip tei-inline-badge-shell',
				'data-tip': tooltipText,
				'data-node-id': id,
				'data-corrections': JSON.stringify(corrections),
			},
			[
				'span',
				{
					...HTMLAttributes,
					class: inlineBadgeClass('correction-node', 'badge-warning'),
					contenteditable: 'false',
					'data-node-id': id,
					'data-corrections': JSON.stringify(corrections),
				},
				...iconLabelSpec('Added', 'correctionNode'),
			],
		];
	},
	addAttributes() {
		return {
			id: {
				default: null,
				parseHTML: element => element.getAttribute('data-node-id'),
				renderHTML: attributes => ({
					'data-node-id': attributes.id || nanoid(8),
				}),
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
		};
	},
});

const Abbreviation = Mark.create({
	name: 'abbreviation',
	parseHTML() {
		return [{ tag: 'span.abbreviation' }];
	},
	renderHTML({ mark, HTMLAttributes }) {
		const type = mark.attrs.type || 'nomSac';
		const expansion = mark.attrs.expansion || '';
		const rend = mark.attrs.rend || '¯';
		const id = mark.attrs.id || nanoid(8);

		// Build tooltip text based on type
		let tooltipText = 'Abbreviation';
		if (type === 'nomSac') {
			tooltipText = `Nomen Sacrum ${expansion}` || 'Abbreviation';
		} else {
			// For ligature and other types, show expansion or type info
			if (type === 'ligature') {
				tooltipText = expansion || 'Expansion';
			} else {
				// For other custom types, show type and expansion
				const tooltipParts = [];
				if (type) tooltipParts.push(`Type: ${type}`);
				if (expansion) tooltipParts.push(`Expansion: ${expansion}`);
				tooltipText = tooltipParts.join(' | ') || 'Abbreviation';
			}
		}

		// Render differently based on type
		if (type === 'nomSac') {
			// nomSac: render the abbreviated text with overline
			return [
				'div',
				{
					class: 'tooltip',
					'data-tip': tooltipText,
					'data-mark-id': id,
					'data-abbr-type': type,
				},
				[
					'span',
					{
						...HTMLAttributes,
						class: 'abbreviation nomSac',
					},
					0, // Content is the original text
				],
			];
		} else {
			// Ligature and other types: render the rend character
			return [
				'div',
				{
					class: 'tooltip',
					'data-tip': tooltipText,
					'data-mark-id': id,
					'data-abbr-type': type,
				},
				[
					'span',
					{
						...HTMLAttributes,
						class: 'abbreviation other',
						'data-rend': rend,
					},
					0,
				],
			];
		}
	},
	addAttributes() {
		return {
			id: {
				default: null,
				parseHTML: element => element.getAttribute('data-mark-id'),
				renderHTML: attributes => ({
					'data-mark-id': attributes.id || nanoid(8),
				}),
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
				// Keyboard shortcut registered - actual abbreviation UI opens via bubble menu
				// This allows users to discover the shortcut but the UI is in the bubble menu
				return true;
			},
		};
	},
});

const Punctuation = Mark.create({
	name: 'punctuation',
	// Prevent marks from expanding when text is typed adjacent to them
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

const PunctuationHighlighter = Extension.create({
	name: 'punctuationHighlighter',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey('punctuationHighlighter'),
				// Regex to match punctuation characters: Latin + Greek punctuation
				// This runs AFTER each transaction to mark any punctuation that was added
				appendTransaction: (transactions, oldState, newState) => {
					// If the document didn't change, we don't need to do anything
					if (!newState.doc.eq(oldState.doc)) {
						const tr = newState.tr;
						// Comprehensive regex for Latin and Greek punctuation
						const punctuationRegex = /[.,;:!?"'«»()\[\]{}\-–—/\\·⸄⸃´`†‡]/g;

						// Iterate through all text nodes in the document
						newState.doc.descendants((node, pos) => {
							if (!node.isText || !node.text) {
								return;
							}

							let match;
							// Reset regex for each node
							const regex = new RegExp(punctuationRegex.source, 'g');
							while ((match = regex.exec(node.text)) !== null) {
								const from = pos + match.index;
								const to = from + 1; // Mark a single character

								// Check if the mark is already applied to avoid duplicating marks
								if (!node.marks.some(m => m.type.name === 'punctuation')) {
									// Add the mark to the transaction
									tr.addMark(
										from,
										to,
										newState.schema.marks.punctuation.create()
									);
								}
							}
						});

						// Return the transaction with our new marks
						return tr;
					}

					return null; // No changes to apply
				},
			}),
		];
	},
});

// Preserves the visual selection highlight when the editor loses focus
// (e.g. when clicking into the inspector drawer). Adds a decoration over the
// selection range on blur and removes it on focus.
const selectionHighlightKey = new PluginKey('selectionHighlight');

const SelectionHighlight = Extension.create({
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
								// For atom/node selections, add a node decoration
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
						// Map decorations through document changes
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

const VerseNode = Node.create({
	name: 'verse',
	group: 'inline',
	inline: true,
	selectable: false,
	parseHTML() {
		return [{ tag: 'span.verse-milestone' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const book = node.attrs.book || '';
		const chapter = node.attrs.chapter || '';
		const verse = node.attrs.verse || '';
		let display = verse;
		if (chapter) {
			display = `${chapter}:${verse}`;
		}
		return [
			'span',
			{
				...HTMLAttributes,
				class: inlineBadgeClass('verse-milestone', 'select-none mx-1'),
				'data-book': book,
				'data-chapter': chapter,
				'data-verse': verse,
				contenteditable: 'false',
			},
			...iconLabelSpec(`${display}`, 'milestone'),
		];
	},
	addAttributes() {
		return {
			book: {
				default: '',
				parseHTML: element => element.getAttribute('data-book'),
				renderHTML: attributes => ({
					'data-book': attributes.book,
				}),
			},
			chapter: {
				default: '',
				parseHTML: element => element.getAttribute('data-chapter'),
				renderHTML: attributes => ({
					'data-chapter': attributes.chapter,
				}),
			},
			verse: {
				default: '',
				parseHTML: element => element.getAttribute('data-verse'),
				renderHTML: attributes => ({
					'data-verse': attributes.verse,
				}),
			},
		};
	},
});

// ########################################
//                Nodes
// ########################################
const Manuscript = Node.create({
	name: 'manuscript',
	topNode: true,
	content: 'page*',
	parseHTML() {
		return [{ tag: 'div.manuscript' }];
	},
	renderHTML({ HTMLAttributes }) {
		return ['div', { ...HTMLAttributes, class: 'manuscript' }, 0];
	},
});

const Page = Node.create({
	name: 'page',
	content: 'column+',
	group: 'block',
	parseHTML() {
		return [{ tag: 'div.page' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const pageName = node.attrs.pageName;
		const pageId = node.attrs.pageId;
		const pageLabel = node.attrs.pageLabel;
		const runningTitle = node.attrs.runningTitle;
		const catchword = node.attrs.catchword;
		const quireSignature = node.attrs.quireSignature;

		let hasFrameZones = false;
		node.content.forEach((child: any) => {
			if (child.attrs?.zone) hasFrameZones = true;
		});

		const columnContainerClass = hasFrameZones ? 'frame-grid' : 'flex gap-4';

		return [
			'div',
			{
				...HTMLAttributes,
				class: 'page drop-shadow-lg bg-base-200 rounded-lg p-4 mb-4',
				'data-page-id': pageId || '',
			},
			[
				'div',
				{
					class: 'mb-3 select-none',
					contenteditable: 'false',
				},
				[
					'div',
					{
						class: 'flex items-center justify-between gap-3 font-bold text-base-content',
					},
					['span', pageName ? `Page: ${pageName}` : 'Page'],
					...(pageLabel
						? [
								[
									'span',
									{
										class: 'badge badge-outline badge-sm inline-flex items-center gap-1.5',
									},
									badgeIconSpec('pageFurniture'),
									['span', { class: 'tei-inline-badge-label' }, pageLabel],
								],
							]
						: []),
				],
				...(runningTitle
					? [
							[
								'div',
								{
									class: 'text-xs uppercase tracking-[0.18em] text-base-content/60 mt-1',
								},
								runningTitle,
							],
						]
					: []),
			],
			['div', { class: columnContainerClass }, 0],
			...(catchword || quireSignature
				? [
						[
							'div',
							{
								class: 'mt-3 flex items-center justify-between gap-3 text-[11px] text-base-content/55 select-none',
								contenteditable: 'false',
							},
							[
								'span',
								{ class: 'uppercase tracking-[0.16em]' },
								quireSignature || '',
							],
							['span', { class: 'italic tracking-[0.04em]' }, catchword || ''],
						],
					]
				: []),
		];
	},
	addAttributes() {
		return {
			pageId: {
				default: null,
				parseHTML: element => element.getAttribute('data-page-id'),
				renderHTML: attributes => {
					if (!attributes.pageId) {
						return {};
					}
					return {
						'data-page-id': attributes.pageId,
					};
				},
			},
			pageName: {
				default: null,
				parseHTML: element => element.getAttribute('data-page-name'),
				renderHTML: attributes => {
					if (!attributes.pageName) {
						return {};
					}
					return {
						'data-page-name': attributes.pageName,
					};
				},
			},
			pageLabel: {
				default: null,
				parseHTML: element => element.getAttribute('data-page-label'),
				renderHTML: attributes =>
					attributes.pageLabel ? { 'data-page-label': attributes.pageLabel } : {},
			},
			runningTitle: {
				default: null,
				parseHTML: element => element.getAttribute('data-running-title'),
				renderHTML: attributes =>
					attributes.runningTitle
						? { 'data-running-title': attributes.runningTitle }
						: {},
			},
			catchword: {
				default: null,
				parseHTML: element => element.getAttribute('data-catchword'),
				renderHTML: attributes =>
					attributes.catchword ? { 'data-catchword': attributes.catchword } : {},
			},
			quireSignature: {
				default: null,
				parseHTML: element => element.getAttribute('data-quire-signature'),
				renderHTML: attributes =>
					attributes.quireSignature
						? { 'data-quire-signature': attributes.quireSignature }
						: {},
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

const FRAME_ZONE_LABELS: Record<string, string> = {
	top: 'Top Commentary',
	left: 'Left Commentary',
	center: 'Center',
	right: 'Right Commentary',
	bottom: 'Bottom Commentary',
};

const Column = Node.create({
	name: 'column',
	content: 'line+',
	parseHTML() {
		return [{ tag: 'div.column' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const columnNumber = (node as any).attrs.columnNumber;
		const zone = (node as any).attrs.zone;
		const label = zone
			? FRAME_ZONE_LABELS[zone] || `Column ${columnNumber || 1}`
			: `Column ${columnNumber || 1}`;
		const borderClass =
			zone === 'center'
				? 'border-2 border-primary'
				: zone
					? 'border border-dashed border-primary/60'
					: 'border border-primary';
		const gridAreaStyle = zone ? `grid-area: ${zone}` : '';
		return [
			'div',
			{
				...HTMLAttributes,
				class: `column ${borderClass} rounded-lg p-3 bg-transparent flex-1`,
				...(gridAreaStyle ? { style: gridAreaStyle } : {}),
			},
			[
				'div',
				{
					class: 'text-sm font-bold text-base-content mb-1 select-none',
					contenteditable: 'false',
				},
				label,
			],
			['div', {}, 0],
		];
	},
	addAttributes() {
		return {
			columnId: {
				default: null,
				parseHTML: element => element.getAttribute('data-column-id'),
				renderHTML: attributes =>
					attributes.columnId ? { 'data-column-id': attributes.columnId } : {},
			},
			columnNumber: {
				default: 1,
				parseHTML: element => parseInt(element.getAttribute('data-column-number') || '1'),
				renderHTML: attributes => {
					return {
						'data-column-number': attributes.columnNumber,
					};
				},
			},
			zone: {
				default: null,
				parseHTML: element => element.getAttribute('data-zone') || null,
				renderHTML: attributes => (attributes.zone ? { 'data-zone': attributes.zone } : {}),
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

const MAIN_LINE_CONTENT_NODES = [
	'text',
	'book',
	'chapter',
	'verse',
	'gap',
	'space',
	'handShift',
	'metamark',
	'teiAtom',
	'teiWrapper',
	'teiMilestone',
	'editorialAction',
	'untranscribed',
	'correctionNode',
	'fw',
] as const;

const FORMWORK_LINE_CONTENT_NODES = MAIN_LINE_CONTENT_NODES.filter(name => name !== 'fw');

const CORRECTION_INLINE_CONTENT_NODES = [
	'text',
	'pageBreak',
	'lineBreak',
	'columnBreak',
	'gap',
	'space',
	'handShift',
	'teiMilestone',
	'teiAtom',
	'teiWrapper',
	'metamark',
	'correctionNode',
	'fw',
] as const;

function buildContentExpression(content: readonly string[]): string {
	return `(${content.join(' | ')})*`;
}

function createStableEditorNodeId(prefix: string): string {
	if (typeof crypto?.randomUUID === 'function') {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Math.random().toString(36).slice(2, 12)}`;
}

const manuscriptStructureRepairKey = new PluginKey('manuscriptStructureRepair');
const lineNumberNormalizerKey = new PluginKey('lineNumberNormalizer');

function createManuscriptStructureRepairTransaction(state: Editor['state']) {
	if (state.doc.type.name !== 'manuscript') {
		return null;
	}

	const repairResult = repairManuscriptStructureJson(state.doc.toJSON());
	if (!repairResult.repaired) return null;

	if (repairResult.issues.length > 0) {
		console.warn('[Transcription] Repaired invalid manuscript structure:', repairResult.issues);
	}

	const repairedDoc = state.schema.nodeFromJSON(repairResult.doc);
	return state.tr.replaceWith(0, state.doc.content.size, repairedDoc.content);
}

function createLineNumberNormalizationTransaction(state: Editor['state']) {
	const tr = state.tr;
	let changed = false;

	state.doc.descendants((node, pos) => {
		if (node.type.name !== 'column' && node.type.name !== 'marginaliaColumn') {
			return true;
		}

		if (!node.type.validContent(node.content)) {
			console.warn(
				`[Transcription] Skipping line number normalization for invalid ${node.type.name} node at ${pos}`
			);
			return false;
		}

		if (!node.attrs.columnId) {
			tr.setNodeMarkup(pos, undefined, {
				...node.attrs,
				columnId: createStableEditorNodeId(node.type.name === 'column' ? 'col' : 'mcol'),
			});
			changed = true;
		}

		const expectedLineType = node.type.name === 'column' ? 'line' : 'marginaliaLine';
		node.forEach((child, offset, index) => {
			if (child.type.name !== expectedLineType) return;
			const expectedLineNumber = index + 1;
			const nextAttrs = {
				...child.attrs,
				lineNumber: expectedLineNumber,
				lineId:
					child.attrs.lineId ||
					createStableEditorNodeId(child.type.name === 'line' ? 'line' : 'mline'),
			};
			if (
				child.attrs.lineNumber === expectedLineNumber &&
				child.attrs.lineId === nextAttrs.lineId
			) {
				return;
			}

			tr.setNodeMarkup(pos + 1 + offset, undefined, nextAttrs);
			changed = true;
		});

		return false;
	});

	return changed ? tr : null;
}

const LineNumberNormalizer = Extension.create({
	name: 'lineNumberNormalizer',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: lineNumberNormalizerKey,
				appendTransaction: (transactions, _oldState, newState) => {
					if (!transactions.some(transaction => transaction.docChanged)) {
						return null;
					}

					if (
						transactions.some(transaction =>
							transaction.getMeta(lineNumberNormalizerKey)
						)
					) {
						return null;
					}

					const repairTr = createManuscriptStructureRepairTransaction(newState);
					if (repairTr) {
						repairTr.setMeta(manuscriptStructureRepairKey, true);
						return repairTr;
					}

					const tr = createLineNumberNormalizationTransaction(newState);
					if (!tr) return null;

					tr.setMeta(lineNumberNormalizerKey, true);
					return tr;
				},
			}),
		];
	},
});
const Line = Node.create({
	name: 'line',
	content: buildContentExpression(MAIN_LINE_CONTENT_NODES),
	defining: true,
	parseHTML() {
		return [{ tag: 'p.line' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const isWrapped = node.attrs.wrapped;
		const isParagraphStart = node.attrs['paragraph-start'];

		return [
			'p',
			{
				...HTMLAttributes,
				class: `line border-l-2 border-primary/60 rounded-sm shadow-2xs bg-base-200 flex-row flex-nowrap text-base-content text-lg font-bold font-greek pl-2 py-1 mb-1 flex min-h-6 relative items-center${
					isParagraphStart ? ' paragraph-start' : ''
				}`,
			},
			[
				'span',
				{
					class: 'text-sm text-primary/60 font-mono min-w-8 select-none',
					contenteditable: 'false',
				},
				`${node.attrs.lineNumber || 1}.`,
			],
			[
				'span',
				{
					class: `wrapped-arrow font-semibold text-secondary select-none pointer-events-none -mb-2 mr-1 ${
						isWrapped ? 'is-wrapped' : ''
					}`.trim(),
					contenteditable: 'false',
					title: 'Word continues from previous line/column/page (wrapped)',
				},
				'↪',
			],
			[
				'span',
				{
					class: 'line-content inline-block min-h-6 whitespace-nowrap',
					style: 'min-width: 1px',
				},
				0,
			],
		];
	},
	addAttributes() {
		return {
			lineId: {
				default: null,
				parseHTML: element => element.getAttribute('data-line-id'),
				renderHTML: attributes =>
					attributes.lineId ? { 'data-line-id': attributes.lineId } : {},
			},
			lineNumber: {
				default: 1,
				parseHTML: element => parseInt(element.getAttribute('data-line-number') || '1'),
				renderHTML: attributes => {
					return {
						'data-line-number': attributes.lineNumber,
					};
				},
			},
			wrapped: {
				default: false,
				parseHTML: element => element.getAttribute('data-wrapped') === 'true',
				renderHTML: attributes => {
					if (!attributes.wrapped) {
						return {};
					}
					return {
						'data-wrapped': 'true',
					};
				},
			},
			'paragraph-start': {
				default: false,
				parseHTML: element => element.getAttribute('data-paragraph-start') === 'true',
				renderHTML: attributes => {
					if (!attributes['paragraph-start']) {
						return {};
					}
					return {
						'data-paragraph-start': 'true',
					};
				},
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
	addKeyboardShortcuts() {
		return {
			Enter: ({ editor }) => editor.chain().splitBlock().run(),
			'Mod-Shift-b': ({ editor }) => {
				const { state } = editor;
				const from = state.selection.$from;
				let lineNode: any = null;
				let linePos = null;
				state.doc.nodesBetween(from.pos, from.pos, (node, pos) => {
					if (node.type.name === 'line') {
						lineNode = node;
						linePos = pos;
						return false;
					}
				});
				if (lineNode && linePos !== null) {
					const newWrapped = !lineNode.attrs.wrapped;
					editor.chain().updateAttributes('line', { wrapped: newWrapped }).run();
					return true;
				}
				return false;
			},
		};
	},
});

const GapNode = Node.create({
	name: 'gap',
	group: 'inline',
	inline: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.gap-milestone' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const reason = node.attrs.reason || 'gap';
		const unit = node.attrs.unit || '';
		const extent = node.attrs.extent || '';
		let label = reason;
		if (unit) label += ` (${unit}`;
		if (extent) label += `, ${extent}`;
		if (unit || extent) label += ')';

		return [
			'span',
			{
				...HTMLAttributes,
				class: inlineBadgeClass('gap-milestone'),
				'data-reason': reason,
				'data-unit': unit,
				'data-extent': extent,
				title: `${label}`,
				contenteditable: 'false',
			},
			...iconLabelSpec([extent, unit].filter(Boolean).join(' ') || 'gap', 'lacuna'),
		];
	},
	addAttributes() {
		return {
			reason: {
				default: '',
				parseHTML: element => element.getAttribute('data-reason'),
				renderHTML: attributes => ({
					'data-reason': attributes.reason,
				}),
			},
			unit: {
				default: '',
				parseHTML: element => element.getAttribute('data-unit'),
				renderHTML: attributes => ({
					'data-unit': attributes.unit,
				}),
			},
			extent: {
				default: '',
				parseHTML: element => element.getAttribute('data-extent'),
				renderHTML: attributes => ({
					'data-extent': attributes.extent,
				}),
			},
		};
	},
});

const SpaceNode = Node.create({
	name: 'space',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.space-milestone' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const teiAttrs = node.attrs.teiAttrs || {};
		const extent = teiAttrs.extent || teiAttrs.quantity || '';
		const unit = teiAttrs.unit || '';
		const dim = teiAttrs.dim || '';
		const labelParts = ['space', extent, unit, dim].filter(Boolean);

		return [
			'span',
			{
				...HTMLAttributes,
				class: inlineBadgeClass('space-milestone'),
				'data-tei-attrs': JSON.stringify(teiAttrs),
				title: labelParts.join(' '),
				contenteditable: 'false',
			},
			...iconLabelSpec([extent, unit].filter(Boolean).join(' ') || 'space', 'blankSpace'),
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

const HandShiftNode = Node.create({
	name: 'handShift',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.hand-shift-node' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const teiAttrs = node.attrs.teiAttrs || {};
		const tooltipText = formatHandShiftTooltipText(teiAttrs);
		const ariaLabel = formatHandShiftAriaLabel(teiAttrs);
		return [
			'span',
			{
				class: 'tooltip tei-inline-badge-shell',
				'data-tip': tooltipText,
			},
			[
				'span',
				{
					...HTMLAttributes,
					class: inlineBadgeClass('hand-shift-node hand-shift-badge'),
					'aria-label': ariaLabel,
					role: 'img',
					'data-tei-attrs': JSON.stringify(teiAttrs),
					title: '',
					contenteditable: 'false',
				},
				['span', { class: 'hand-shift-badge-glyph', 'aria-hidden': 'true' }],
			],
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
const TeiMilestoneNode = createTeiAttrAtomNode(
	'teiMilestone',
	'tei-milestone-node',
	'milestone',
	'milestone'
);
const EditorialActionNode = Node.create({
	name: 'editorialAction',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.editorial-action-node' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const tag = node.attrs.tag || 'editorial';
		const summary = node.attrs.summary || tag;
		return [
			'span',
			{
				...HTMLAttributes,
				class: inlineBadgeClass('editorial-action-node', 'badge-secondary'),
				'data-tag': tag,
				'data-summary': summary,
				'data-xml': node.attrs.xml || '',
				'data-tei-attrs': JSON.stringify(node.attrs.teiAttrs || {}),
				'data-structure': JSON.stringify(node.attrs.structure || null),
				title: summary,
				contenteditable: 'false',
			},
			...iconLabelSpec(summary, 'teiAtom'),
		];
	},
	addAttributes() {
		return {
			tag: {
				default: 'editorial',
				parseHTML: element => element.getAttribute('data-tag') || 'editorial',
				renderHTML: attributes => ({ 'data-tag': attributes.tag || 'editorial' }),
			},
			summary: {
				default: 'editorial',
				parseHTML: element => element.getAttribute('data-summary') || 'editorial',
				renderHTML: attributes => ({ 'data-summary': attributes.summary || 'editorial' }),
			},
			xml: {
				default: '',
				parseHTML: element => element.getAttribute('data-xml') || '',
				renderHTML: attributes => ({ 'data-xml': attributes.xml || '' }),
			},
			teiAttrs: {
				default: {},
				parseHTML: element => parseJsonAttr(element.getAttribute('data-tei-attrs')),
				renderHTML: attributes => ({
					'data-tei-attrs': JSON.stringify(attributes.teiAttrs || {}),
				}),
			},
			structure: {
				default: null,
				parseHTML: element => parseJsonAttr(element.getAttribute('data-structure'), null),
				renderHTML: attributes => ({
					'data-structure': JSON.stringify(attributes.structure || null),
				}),
			},
		};
	},
});
const MetamarkNode = Node.create({
	name: 'metamark',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.metamark-node' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const summary = node.attrs.summary || 'metamark';
		return [
			'span',
			{
				...HTMLAttributes,
				class: inlineBadgeClass('metamark-node', 'badge-accent'),
				'data-summary': summary,
				'data-xml': node.attrs.xml || '',
				'data-tei-attrs': JSON.stringify(node.attrs.teiAttrs || {}),
				'data-word-inline': node.attrs.wordInline ? 'true' : 'false',
				title: summary,
				contenteditable: 'false',
			},
			...iconLabelSpec(summary, 'metamark'),
		];
	},
	addAttributes() {
		return {
			summary: {
				default: 'metamark',
				parseHTML: element => element.getAttribute('data-summary') || 'metamark',
				renderHTML: attributes => ({ 'data-summary': attributes.summary || 'metamark' }),
			},
			teiAttrs: {
				default: {},
				parseHTML: element => parseJsonAttr(element.getAttribute('data-tei-attrs')),
				renderHTML: attributes => ({
					'data-tei-attrs': JSON.stringify(attributes.teiAttrs || {}),
				}),
			},
			wordInline: {
				default: false,
				parseHTML: element => element.getAttribute('data-word-inline') === 'true',
				renderHTML: attributes => ({
					'data-word-inline': attributes.wordInline ? 'true' : 'false',
				}),
			},
		};
	},
});
const TeiAtomNode = Node.create({
	name: 'teiAtom',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.tei-atom-node' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const tag = node.attrs.tag || 'tei';
		const summary = node.attrs.summary || tag;
		const isNote = tag === 'note';
		const noteText = node.attrs.text || summary;
		return [
			'span',
			{
				...HTMLAttributes,
				class: isNote
					? `${inlineBadgeClass('tei-atom-node tei-note-badge', 'badge-info')} tooltip tooltip-info`
					: inlineBadgeClass('tei-atom-node', 'badge-info'),
				'data-tag': tag,
				'data-summary': summary,
				'data-tei-node': JSON.stringify(node.attrs.teiNode || null),
				'data-tei-attrs': JSON.stringify(node.attrs.teiAttrs || {}),
				'data-word-inline': node.attrs.wordInline ? 'true' : 'false',
				'data-text': node.attrs.text || '',
				...(isNote ? { 'data-tip': noteText } : {}),
				title: isNote ? '' : summary,
				contenteditable: 'false',
			},
			...(isNote
				? [['span', { class: 'tei-note-badge-glyph', 'aria-hidden': 'true' }]]
				: iconLabelSpec(summary, 'teiAtom')),
		];
	},
	addAttributes() {
		return {
			tag: {
				default: 'tei',
				parseHTML: element => element.getAttribute('data-tag') || 'tei',
				renderHTML: attributes => ({ 'data-tag': attributes.tag || 'tei' }),
			},
			summary: {
				default: 'tei',
				parseHTML: element => element.getAttribute('data-summary') || 'tei',
				renderHTML: attributes => ({ 'data-summary': attributes.summary || 'tei' }),
			},
			teiAttrs: {
				default: {},
				parseHTML: element => parseJsonAttr(element.getAttribute('data-tei-attrs')),
				renderHTML: attributes => ({
					'data-tei-attrs': JSON.stringify(attributes.teiAttrs || {}),
				}),
			},
			wordInline: {
				default: false,
				parseHTML: element => element.getAttribute('data-word-inline') === 'true',
				renderHTML: attributes => ({
					'data-word-inline': attributes.wordInline ? 'true' : 'false',
				}),
			},
			text: {
				default: '',
				parseHTML: element => element.getAttribute('data-text') || '',
				renderHTML: attributes => ({ 'data-text': attributes.text || '' }),
			},
			teiNode: {
				default: null,
				parseHTML: element => parseJsonAttr(element.getAttribute('data-tei-node'), null),
				renderHTML: attributes => ({
					'data-tei-node': JSON.stringify(attributes.teiNode || null),
				}),
			},
		};
	},
});

const TeiWrapperNode = Node.create({
	name: 'teiWrapper',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.tei-wrapper-node' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const tag = node.attrs.tag || 'seg';
		const summary = node.attrs.summary || `<${tag}>`;
		const preview = summary.startsWith(`<${tag}>`) ? summary : `<${tag}> ${summary}`;
		return [
			'span',
			{
				...HTMLAttributes,
				class: inlineBadgeClass('tei-wrapper-node', 'badge-outline badge-secondary'),
				'data-tag': tag,
				'data-summary': summary,
				'data-tei-attrs': JSON.stringify(node.attrs.teiAttrs || {}),
				'data-children': JSON.stringify(node.attrs.children || []),
				'data-word-inline': node.attrs.wordInline ? 'true' : 'false',
				'data-text': node.attrs.text || '',
				title: preview,
				contenteditable: 'false',
			},
			...iconLabelSpec(preview, 'teiWrapper'),
		];
	},
	addAttributes() {
		return {
			tag: {
				default: 'seg',
				parseHTML: element => element.getAttribute('data-tag') || 'seg',
				renderHTML: attributes => ({ 'data-tag': attributes.tag || 'seg' }),
			},
			summary: {
				default: '',
				parseHTML: element => element.getAttribute('data-summary') || '',
				renderHTML: attributes => ({ 'data-summary': attributes.summary || '' }),
			},
			teiAttrs: {
				default: {},
				parseHTML: element => parseJsonAttr(element.getAttribute('data-tei-attrs')),
				renderHTML: attributes => ({
					'data-tei-attrs': JSON.stringify(attributes.teiAttrs || {}),
				}),
			},
			children: {
				default: [],
				parseHTML: element => parseJsonAttr(element.getAttribute('data-children'), []),
				renderHTML: attributes => ({
					'data-children': JSON.stringify(attributes.children || []),
				}),
			},
			wordInline: {
				default: false,
				parseHTML: element => element.getAttribute('data-word-inline') === 'true',
				renderHTML: attributes => ({
					'data-word-inline': attributes.wordInline ? 'true' : 'false',
				}),
			},
			text: {
				default: '',
				parseHTML: element => element.getAttribute('data-text') || '',
				renderHTML: attributes => ({ 'data-text': attributes.text || '' }),
			},
		};
	},
});

const FormWorkNode = Node.create({
	name: 'fw',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.fw-node' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const content = node.attrs.content || [];
		const text = formWorkContentToPlainText(content);
		const classification = classifyFormWork(node.attrs || {});
		const category =
			classification.entryPoint === 'marginalia'
				? classification.marginaliaCategory || 'Other'
				: classification.label;
		const label = text || String(category).toLowerCase();
		const placement = classification.placementConcept;
		const categoryClass =
			classification.entryPoint !== 'marginalia'
				? 'badge-info'
				: category === 'Marginal'
					? 'badge-warning marginalia-margin'
					: category === 'Interlinear'
						? 'badge-success marginalia-interlinear'
						: category === 'Column'
							? 'badge-secondary marginalia-column'
							: category === 'Inline'
								? 'badge-accent marginalia-inline'
								: 'badge-outline marginalia-other';
		const iconName =
			classification.entryPoint !== 'marginalia'
				? ('pageFurniture' as const)
				: category === 'Marginal'
					? ('marginal' as const)
					: category === 'Interlinear'
						? ('interlinear' as const)
						: category === 'Column'
							? ('column' as const)
							: category === 'Inline'
								? ('inline' as const)
								: ('pageFurniture' as const);
		return [
			'span',
			{
				...HTMLAttributes,
				class: `fw-node marginalia-node ${inlineBadgeClass('', categoryClass)}`,
				'data-entry-point': classification.entryPoint,
				'data-category': String(category),
				'data-placement': placement,
				'data-type': node.attrs.type || '',
				'data-subtype': node.attrs.subtype || '',
				'data-place': node.attrs.place || '',
				'data-hand': node.attrs.hand || '',
				'data-n': node.attrs.n || '',
				'data-rend': node.attrs.rend || '',
				'data-seg-type': node.attrs.segType || '',
				'data-seg-subtype': node.attrs.segSubtype || '',
				'data-seg-place': node.attrs.segPlace || '',
				'data-seg-hand': node.attrs.segHand || '',
				'data-seg-rend': node.attrs.segRend || '',
				'data-seg-n': node.attrs.segN || '',
				'data-tei-attrs': JSON.stringify(node.attrs.teiAttrs || {}),
				'data-seg-attrs': JSON.stringify(node.attrs.segAttrs || {}),
				'data-content': JSON.stringify(content),
				title: label,
				contenteditable: 'false',
			},
			...iconLabelSpec(label, iconName),
		];
	},
	addAttributes() {
		return {
			type: {
				default: '',
				parseHTML: element => element.getAttribute('data-type'),
				renderHTML: attributes => ({ 'data-type': attributes.type || '' }),
			},
			subtype: {
				default: '',
				parseHTML: element => element.getAttribute('data-subtype'),
				renderHTML: attributes => ({ 'data-subtype': attributes.subtype || '' }),
			},
			place: {
				default: '',
				parseHTML: element => element.getAttribute('data-place'),
				renderHTML: attributes => ({ 'data-place': attributes.place || '' }),
			},
			hand: {
				default: '',
				parseHTML: element => element.getAttribute('data-hand'),
				renderHTML: attributes => ({ 'data-hand': attributes.hand || '' }),
			},
			n: {
				default: '',
				parseHTML: element => element.getAttribute('data-n'),
				renderHTML: attributes => ({ 'data-n': attributes.n || '' }),
			},
			entryPoint: {
				default: '',
				parseHTML: element => element.getAttribute('data-entry-point'),
				renderHTML: attributes => ({ 'data-entry-point': attributes.entryPoint || '' }),
			},
			category: {
				default: '',
				parseHTML: element => element.getAttribute('data-category'),
				renderHTML: attributes => ({ 'data-category': attributes.category || '' }),
			},
			placementConcept: {
				default: '',
				parseHTML: element => element.getAttribute('data-placement'),
				renderHTML: attributes => ({ 'data-placement': attributes.placementConcept || '' }),
			},
			rend: {
				default: '',
				parseHTML: element => element.getAttribute('data-rend'),
				renderHTML: attributes => ({ 'data-rend': attributes.rend || '' }),
			},
			teiAttrs: {
				default: {},
				parseHTML: element => parseJsonAttr(element.getAttribute('data-tei-attrs'), {}),
				renderHTML: attributes => ({
					'data-tei-attrs': JSON.stringify(attributes.teiAttrs || {}),
				}),
			},
			segType: {
				default: '',
				parseHTML: element => element.getAttribute('data-seg-type'),
				renderHTML: attributes => ({ 'data-seg-type': attributes.segType || '' }),
			},
			segSubtype: {
				default: '',
				parseHTML: element => element.getAttribute('data-seg-subtype'),
				renderHTML: attributes => ({
					'data-seg-subtype': attributes.segSubtype || '',
				}),
			},
			segPlace: {
				default: '',
				parseHTML: element => element.getAttribute('data-seg-place'),
				renderHTML: attributes => ({ 'data-seg-place': attributes.segPlace || '' }),
			},
			segHand: {
				default: '',
				parseHTML: element => element.getAttribute('data-seg-hand'),
				renderHTML: attributes => ({ 'data-seg-hand': attributes.segHand || '' }),
			},
			segRend: {
				default: '',
				parseHTML: element => element.getAttribute('data-seg-rend'),
				renderHTML: attributes => ({ 'data-seg-rend': attributes.segRend || '' }),
			},
			segN: {
				default: '',
				parseHTML: element => element.getAttribute('data-seg-n'),
				renderHTML: attributes => ({ 'data-seg-n': attributes.segN || '' }),
			},
			segAttrs: {
				default: {},
				parseHTML: element => parseJsonAttr(element.getAttribute('data-seg-attrs'), {}),
				renderHTML: attributes => ({
					'data-seg-attrs': JSON.stringify(attributes.segAttrs || {}),
				}),
			},
			content: {
				default: normalizeMarginaliaContent([]),
				parseHTML: element => {
					const value = element.getAttribute('data-content');
					if (!value) return normalizeMarginaliaContent([]);
					try {
						return JSON.parse(value);
					} catch {
						return normalizeMarginaliaContent([]);
					}
				},
				renderHTML: attributes => ({
					'data-content': JSON.stringify(attributes.content || []),
				}),
			},
		};
	},
});

// Line break node for use in correction mini-editor
const LineBreakInline = Node.create({
	name: 'lineBreak',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.line-break-marker' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const teiAttrs = node.attrs.teiAttrs || {};
		const breakAttr = teiAttrs.break;
		const label = teiAttrs.n ? `lb ${teiAttrs.n}` : 'lb';
		const title = breakAttr === 'no' ? 'Line break (word continues)' : 'Line break';
		return [
			'span',
			{
				...HTMLAttributes,
				class: 'line-break-marker badge badge-outline badge-xs mx-1 text-secondary font-bold inline-flex items-center gap-1',
				'data-tei-attrs': JSON.stringify(teiAttrs),
				contenteditable: 'false',
				title,
			},
			badgeIconSpec('lineBreak', 12),
			['span', { class: 'tei-inline-badge-label' }, label],
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

const ColumnBreakInline = Node.create({
	name: 'columnBreak',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.column-break-marker' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const teiAttrs = node.attrs.teiAttrs || {};
		const breakAttr = teiAttrs.break;
		const label = teiAttrs.n ? `cb ${teiAttrs.n}` : 'cb';
		const title = breakAttr === 'no' ? 'Column break (word continues)' : 'Column break';
		return [
			'span',
			{
				...HTMLAttributes,
				class: 'column-break-marker badge badge-outline badge-xs mx-1 text-accent font-bold inline-flex items-center gap-1',
				'data-tei-attrs': JSON.stringify(teiAttrs),
				contenteditable: 'false',
				title,
			},
			badgeIconSpec('columnBreak', 12),
			['span', { class: 'tei-inline-badge-label' }, label],
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

const PageBreakInline = Node.create({
	name: 'pageBreak',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.page-break-marker' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const teiAttrs = node.attrs.teiAttrs || {};
		const breakAttr = teiAttrs.break;
		const label = teiAttrs.n ? `pb ${teiAttrs.n}` : 'pb';
		const title = breakAttr === 'no' ? 'Page break (word continues)' : 'Page break';
		return [
			'span',
			{
				...HTMLAttributes,
				class: 'page-break-marker badge badge-outline badge-xs mx-1 text-info font-bold inline-flex items-center gap-1',
				'data-tei-attrs': JSON.stringify(teiAttrs),
				contenteditable: 'false',
				title,
			},
			badgeIconSpec('pageBreak', 12),
			['span', { class: 'tei-inline-badge-label' }, label],
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

// Inline carrier document for nested inspector-backed content such as marginalia.
const InlineCarrierDocument = Node.create({
	name: 'doc',
	topNode: true,
	content: buildContentExpression(CORRECTION_INLINE_CONTENT_NODES),
});

const MarginaliaDocument = Node.create({
	name: 'doc',
	topNode: true,
	content: 'marginaliaColumn+',
});

const MarginaliaColumn = Node.create({
	name: 'marginaliaColumn',
	content: 'marginaliaLine+',
	defining: true,
	parseHTML() {
		return [{ tag: 'div.marginalia-column' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const breakAttrs = node.attrs.breakAttrs || {};
		const label = breakAttrs.n || node.attrs.columnNumber || 1;
		return [
			'div',
			{
				...HTMLAttributes,
				class: 'marginalia-column border border-primary rounded-lg p-3 bg-base-100 flex-1 min-w-60',
			},
			[
				'div',
				{
					class: 'text-sm font-bold text-base-content mb-2 select-none',
					contenteditable: 'false',
				},
				`Column ${label}`,
			],
			['div', { class: 'space-y-1' }, 0],
		];
	},
	addAttributes() {
		return {
			columnId: {
				default: null,
				parseHTML: element => element.getAttribute('data-column-id'),
				renderHTML: attributes =>
					attributes.columnId ? { 'data-column-id': attributes.columnId } : {},
			},
			columnNumber: {
				default: 1,
				parseHTML: element => parseInt(element.getAttribute('data-column-number') || '1'),
				renderHTML: attributes => ({ 'data-column-number': attributes.columnNumber || 1 }),
			},
			breakAttrs: {
				default: {},
				parseHTML: element => parseJsonAttr(element.getAttribute('data-break-attrs'), {}),
				renderHTML: attributes => ({
					'data-break-attrs': JSON.stringify(attributes.breakAttrs || {}),
				}),
			},
		};
	},
});

const MarginaliaLine = Node.create({
	name: 'marginaliaLine',
	content: buildContentExpression(FORMWORK_LINE_CONTENT_NODES),
	defining: true,
	parseHTML() {
		return [{ tag: 'p.marginalia-line' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const breakAttrs = node.attrs.breakAttrs || {};
		const isWrapped = node.attrs.wrapped || breakAttrs.break === 'no';
		const label = node.attrs.lineNumber || 1;

		return [
			'p',
			{
				...HTMLAttributes,
				class: 'marginalia-line border-l-2 border-primary/60 rounded-sm bg-base-200 flex min-h-6 items-center px-2 py-1 text-base-content text-lg font-bold font-greek',
			},
			[
				'span',
				{
					class: 'text-sm text-primary/60 font-mono min-w-8 select-none',
					contenteditable: 'false',
				},
				`${label}.`,
			],
			[
				'span',
				{
					class: `wrapped-arrow font-semibold text-secondary select-none pointer-events-none -mb-2 mr-1 ${isWrapped ? 'is-wrapped' : ''}`.trim(),
					contenteditable: 'false',
					title: 'Word continues from previous line/column',
				},
				'↪',
			],
			[
				'span',
				{
					class: 'line-content inline-block min-h-6 whitespace-nowrap',
					style: 'min-width: 1px',
				},
				0,
			],
		];
	},
	addAttributes() {
		return {
			lineId: {
				default: null,
				parseHTML: element => element.getAttribute('data-line-id'),
				renderHTML: attributes =>
					attributes.lineId ? { 'data-line-id': attributes.lineId } : {},
			},
			lineNumber: {
				default: 1,
				parseHTML: element => parseInt(element.getAttribute('data-line-number') || '1'),
				renderHTML: attributes => ({ 'data-line-number': attributes.lineNumber || 1 }),
			},
			wrapped: {
				default: false,
				parseHTML: element => element.getAttribute('data-wrapped') === 'true',
				renderHTML: attributes => ({
					'data-wrapped': attributes.wrapped ? 'true' : 'false',
				}),
			},
			breakAttrs: {
				default: {},
				parseHTML: element => parseJsonAttr(element.getAttribute('data-break-attrs'), {}),
				renderHTML: attributes => ({
					'data-break-attrs': JSON.stringify(attributes.breakAttrs || {}),
				}),
			},
		};
	},
});

const SHARED_MARK_EXTENSIONS = [
	Lacunose,
	Unclear,
	WordAttrs,
	Highlight,
	TeiSpan,
	Damage,
	Surplus,
	Secluded,
	Correction,
	Abbreviation,
	Punctuation,
] as const;

const SHARED_INLINE_NODE_EXTENSIONS = [
	PageBreakInline,
	LineBreakInline,
	ColumnBreakInline,
	GapNode,
	SpaceNode,
	HandShiftNode,
	MetamarkNode,
	TeiAtomNode,
	TeiWrapperNode,
	TeiMilestoneNode,
	CorrectionNode,
	EditorialActionNode,
	UntranscribedNode,
	BookNode,
	ChapterNode,
	VerseNode,
	FormWorkNode,
] as const;

const SHARED_SELECTION_EXTENSIONS = [PunctuationHighlighter, SelectionHighlight] as const;

type EditorProfile = 'main-manuscript' | 'formwork-nested';

interface BaseEditorOptions {
	element: HTMLElement;
	bubbleMenu?: HTMLElement | null;
	className: string;
}

function createBubbleMenuExtension(element: HTMLElement | null | undefined) {
	if (!element) return null;
	return BubbleMenu.configure({
		element,
		tippyOptions: {
			interactive: true,
		},
		shouldShow: (props: any) => {
			const ed = props.editor as Editor;
			const { selection } = ed.state;
			return ed.isFocused && !selection.empty && !(selection instanceof NodeSelection);
		},
	} as any) as any;
}

function getSharedInlineExtensions() {
	return [
		...SHARED_MARK_EXTENSIONS,
		...SHARED_SELECTION_EXTENSIONS,
		LineNumberNormalizer,
		...SHARED_INLINE_NODE_EXTENSIONS,
		Text,
	];
}

function getProfileExtensions(profile: EditorProfile, bubbleMenu?: HTMLElement | null) {
	const bubbleMenuExtension = createBubbleMenuExtension(bubbleMenu);
	const sharedInlineExtensions = getSharedInlineExtensions();

	if (profile === 'main-manuscript') {
		return [
			History,
			...(bubbleMenuExtension ? [bubbleMenuExtension] : []),
			Manuscript,
			Page,
			Column,
			Line,
			...sharedInlineExtensions,
		];
	}

	if (profile === 'formwork-nested') {
		return [
			History,
			...(bubbleMenuExtension ? [bubbleMenuExtension] : []),
			MarginaliaDocument,
			MarginaliaColumn,
			MarginaliaLine,
			...sharedInlineExtensions,
		];
	}
}

function createEditorForProfile(profile: EditorProfile, options: BaseEditorOptions) {
	return new Editor({
		element: options.element,
		extensions: getProfileExtensions(profile, options.bubbleMenu),
		editorProps: {
			attributes: {
				class: options.className,
				spellcheck: 'false',
				autocorrect: 'off',
				autocapitalize: 'off',
			},
			...(profile === 'main-manuscript'
				? {
						handleDOMEvents: {
							mousemove: () => true,
							mouseenter: () => true,
							mouseleave: () => true,
							dragover: () => true,
							dragenter: () => true,
							dragleave: () => true,
						},
						scrollThreshold: 80,
						scrollMargin: {
							top: 50,
							bottom: 50,
							left: 0,
							right: 0,
						},
						transformPastedText: text => text,
					}
				: {}),
		},
		parseOptions: {
			preserveWhitespace: 'full',
		},
	});
}

export function getEditor(element: HTMLElement, bubbleMenu: HTMLElement) {
	return createEditorForProfile('main-manuscript', {
		element,
		bubbleMenu,
		className: 'transcription-editor-content',
	});
}

export function getInlineCarrierEditor(element: HTMLElement, bubbleMenu?: HTMLElement | null) {
	return createEditorForProfile('formwork-nested', {
		element,
		bubbleMenu,
		className:
			'inline-carrier-editor-content marginalia-editor-content border rounded p-3 min-h-[132px] text-base font-greek bg-base-50 flex items-start gap-3 overflow-x-auto',
	});
}

/**
 * Render correction content (JSON) as HTML using TipTap's generateHTML
 * This uses the same extensions as the correction mini-editor to ensure
 * consistent rendering of marks like lacunose, unclear, etc.
 */
export function renderCorrectionContent(content: any): string {
	// Empty content check
	if (!content || (Array.isArray(content) && content.length === 0)) {
		return '[empty]';
	}

	const correctionExtensions = getCorrectionRenderExtensions();

	try {
		// generateHTML expects a full document structure
		const docContent = {
			type: 'doc',
			content: Array.isArray(content) ? content : [content],
		};

		return generateHTML(docContent, correctionExtensions);
	} catch (error) {
		console.error('Error rendering correction content:', error);
		return '[error rendering content]';
	}
}

export function getCorrectionRenderExtensions() {
	// Use the broader inline-carrier schema so previews can render correction nodes
	// inside marginalia/formwork as well as plain correction content.
	return [
		InlineCarrierDocument,
		...SHARED_MARK_EXTENSIONS,
		...SHARED_INLINE_NODE_EXTENSIONS,
		Text,
	];
}
