import {
	createEmptyLineInsertTransaction,
	createLineSplitTransaction,
} from '$lib/editor/structure';
import { Node } from '@tiptap/core';
import { parseJsonAttr } from './node-views';

export const Manuscript = Node.create({
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

export const Page = Node.create({
	name: 'page',
	content: 'column+',
	group: 'block',
	parseHTML() {
		return [{ tag: 'div.page' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const pageName = node.attrs.pageName;
		const pageId = node.attrs.pageId;

		return [
			'div',
			{
				...HTMLAttributes,
				class: 'page drop-shadow-lg bg-base-200 rounded-lg p-4 mb-4',
				'data-page-id': pageId || '',
				'data-page-name': pageName || '',
				'data-page-label': pageName ? `Page: ${pageName}` : 'Page',
			},
			['div', { class: 'frame-grid flex gap-4' }, 0],
		];
	},
	addAttributes() {
		return {
			wrapped: {
				default: false,
				parseHTML: element => element.getAttribute('data-wrapped') === 'true',
				renderHTML: attributes => (attributes.wrapped ? { 'data-wrapped': 'true' } : {}),
			},
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

export const Column = Node.create({
	name: 'column',
	content: 'line+',
	parseHTML() {
		return [{ tag: 'div.column' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const zone = (node as any).attrs.zone;
		const zoneClass = zone ? ` frame-zone-${zone}` : '';
		const label = zone ? FRAME_ZONE_LABELS[zone] || 'Column' : '';
		const borderClass =
			zone === 'center'
				? 'border-2 border-primary'
				: zone
					? 'border border-dashed border-primary/60'
					: 'border border-primary';
		return [
			'div',
			{
				...HTMLAttributes,
				class: `column ${borderClass}${zoneClass} rounded-lg p-3 bg-transparent flex-1`,
				'data-column-label': label,
			},
			['div', {}, 0],
		];
	},
	addAttributes() {
		return {
			wrapped: {
				default: false,
				parseHTML: element => element.getAttribute('data-wrapped') === 'true',
				renderHTML: attributes => (attributes.wrapped ? { 'data-wrapped': 'true' } : {}),
			},
			columnId: {
				default: null,
				parseHTML: element => element.getAttribute('data-column-id'),
				renderHTML: attributes =>
					attributes.columnId ? { 'data-column-id': attributes.columnId } : {},
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

export const Line = Node.create({
	name: 'line',
	content: buildContentExpression(MAIN_LINE_CONTENT_NODES),
	defining: true,
	parseHTML() {
		return [{ tag: 'p.line' }];
	},
	renderHTML({ node, HTMLAttributes }) {
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
					class: 'line-content min-h-6 min-w-0 flex-1 whitespace-nowrap',
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
			Enter: ({ editor }) => {
				const tr =
					createEmptyLineInsertTransaction(editor.state) ||
					createLineSplitTransaction(editor.state);
				if (!tr) {
					return editor.chain().splitBlock().run();
				}

				editor.view.dispatch(tr);
				return true;
			},
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

export const CorrectionRenderDocument = Node.create({
	name: 'correctionDoc',
	topNode: true,
	content: buildContentExpression(CORRECTION_INLINE_CONTENT_NODES),
});

export const MarginaliaDocument = Node.create({
	name: 'doc',
	topNode: true,
	content: 'marginaliaColumn+',
});

export const MarginaliaColumn = Node.create({
	name: 'marginaliaColumn',
	content: 'marginaliaLine+',
	defining: true,
	parseHTML() {
		return [{ tag: 'div.marginalia-column' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const breakAttrs = node.attrs.breakAttrs || {};
		const label = breakAttrs.n ? `Column ${breakAttrs.n}` : '';
		return [
			'div',
			{
				...HTMLAttributes,
				class: 'marginalia-column border border-primary rounded-lg p-3 bg-base-100 flex-1 min-w-60',
			},
			[
				'div',
				{
					class: 'column-number text-sm font-bold text-base-content mb-2 select-none',
					contenteditable: 'false',
				},
				label,
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

export const MarginaliaLine = Node.create({
	name: 'marginaliaLine',
	content: buildContentExpression(FORMWORK_LINE_CONTENT_NODES),
	defining: true,
	parseHTML() {
		return [{ tag: 'p.marginalia-line' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const breakAttrs = node.attrs.breakAttrs || {};
		const isWrapped = node.attrs.wrapped || breakAttrs.break === 'no';

		return [
			'p',
			{
				...HTMLAttributes,
				class: 'marginalia-line border-l-2 border-primary/60 rounded-sm bg-base-200 flex min-h-6 items-center px-2 py-1 text-base-content text-lg font-bold font-greek',
			},
			[
				'span',
				{
					class: 'line-number text-sm text-primary/60 font-mono min-w-8 select-none',
					contenteditable: 'false',
					style: 'display: inline-block; min-width: 2rem; min-height: 1.5rem; text-align: right',
				},
				'.',
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
