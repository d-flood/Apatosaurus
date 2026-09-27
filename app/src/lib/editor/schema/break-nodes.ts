import { badgeIconSpec } from '$lib/editor/badge-icons';
import { Node } from '@tiptap/core';
import { type DOMOutputSpec, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { parseJsonAttr, type NodeRenderer, createIncrementalNodeView } from './node-views';

function renderBreakNode(
	node: ProseMirrorNode,
	HTMLAttributes: Record<string, any>,
	options: {
		className: string;
		colorClass: string;
		label: string;
		icon: 'lineBreak' | 'columnBreak' | 'pageBreak';
	}
): DOMOutputSpec {
	const teiAttrs = node.attrs.teiAttrs || {};
	const title =
		teiAttrs.break === 'no'
			? `${options.label} break (word continues)`
			: `${options.label} break`;
	return [
		'span',
		{
			...HTMLAttributes,
			class: `${options.className} badge badge-outline badge-xs mx-1 ${options.colorClass} font-bold inline-flex items-center gap-1`,
			'data-tei-attrs': JSON.stringify(teiAttrs),
			contenteditable: 'false',
			title,
		},
		badgeIconSpec(options.icon, 12),
		[
			'span',
			{ class: 'tei-inline-badge-label' },
			teiAttrs.n
				? `${options.label.toLowerCase()[0]}b ${teiAttrs.n}`
				: `${options.label.toLowerCase()[0]}b`,
		],
	];
}

const renderLineBreakNode: NodeRenderer = (node, HTMLAttributes) =>
	renderBreakNode(node, HTMLAttributes, {
		className: 'line-break-marker',
		colorClass: 'text-secondary',
		label: 'Line',
		icon: 'lineBreak',
	});
const renderColumnBreakNode: NodeRenderer = (node, HTMLAttributes) =>
	renderBreakNode(node, HTMLAttributes, {
		className: 'column-break-marker',
		colorClass: 'text-accent',
		label: 'Column',
		icon: 'columnBreak',
	});
const renderPageBreakNode: NodeRenderer = (node, HTMLAttributes) =>
	renderBreakNode(node, HTMLAttributes, {
		className: 'page-break-marker',
		colorClass: 'text-info',
		label: 'Page',
		icon: 'pageBreak',
	});

export const LineBreakInline = Node.create({
	name: 'lineBreak',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.line-break-marker' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return renderLineBreakNode(node, HTMLAttributes);
	},
	addNodeView() {
		return createIncrementalNodeView(renderLineBreakNode);
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

export const ColumnBreakInline = Node.create({
	name: 'columnBreak',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.column-break-marker' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return renderColumnBreakNode(node, HTMLAttributes);
	},
	addNodeView() {
		return createIncrementalNodeView(renderColumnBreakNode);
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

export const PageBreakInline = Node.create({
	name: 'pageBreak',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.page-break-marker' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return renderPageBreakNode(node, HTMLAttributes);
	},
	addNodeView() {
		return createIncrementalNodeView(renderPageBreakNode);
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
