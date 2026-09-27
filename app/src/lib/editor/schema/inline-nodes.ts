import { Node } from '@tiptap/core';
import {
	parseJsonAttr,
	type NodeRenderer,
	inlineBadgeClass,
	iconLabelSpec,
	createIncrementalNodeView,
	formatCorrectionTooltipText,
} from './node-views';

function formatHandShiftTooltipText(teiAttrs: Record<string, any>): string {
	const nextHand = String(teiAttrs.new || '').trim();
	const medium = String(teiAttrs.medium || '').trim();
	return [nextHand, medium].filter(Boolean).join(' · ') || 'Change of Scribe';
}

function formatHandShiftAriaLabel(teiAttrs: Record<string, any>): string {
	const tooltipText = formatHandShiftTooltipText(teiAttrs);
	return tooltipText === 'Change of Scribe' ? tooltipText : `Change of Scribe: ${tooltipText}`;
}

const renderUntranscribedNode: NodeRenderer = (node, HTMLAttributes) => {
	const reason = node.attrs.reason || 'Untranscribed';
	const extent = node.attrs.extent || 'partial';
	const label =
		extent === 'partial'
			? `Partial Line Untranscribed (${reason})`
			: `Line Untranscribed (${reason})`;

	return [
		'span',
		{
			...HTMLAttributes,
			class: inlineBadgeClass('untranscribed-milestone'),
			'data-reason': reason,
			'data-extent': extent,
			'data-tei-attrs': JSON.stringify(node.attrs.teiAttrs || {}),
			title: label,
			contenteditable: 'false',
		},
		...iconLabelSpec('untranscribed', 'untranscribed'),
	];
};

export const UntranscribedNode = Node.create({
	name: 'untranscribed',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.untranscribed-milestone' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return renderUntranscribedNode(node, HTMLAttributes);
	},
	addNodeView() {
		return createIncrementalNodeView(renderUntranscribedNode);
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

const renderCorrectionNode: NodeRenderer = (node, HTMLAttributes) => {
	const corrections = node.attrs.corrections || [];
	const tooltipText = formatCorrectionTooltipText(corrections);

	return [
		'span',
		{
			class: 'tooltip tei-inline-badge-shell',
			'data-tip': tooltipText,
			...(node.attrs.id ? { 'data-node-id': node.attrs.id } : {}),
			'data-corrections': JSON.stringify(corrections),
		},
		[
			'span',
			{
				...HTMLAttributes,
				class: inlineBadgeClass('correction-node', 'badge-warning'),
				contenteditable: 'false',
				...(node.attrs.id ? { 'data-node-id': node.attrs.id } : {}),
				'data-corrections': JSON.stringify(corrections),
			},
			...iconLabelSpec('Added', 'correctionNode'),
		],
	];
};

export const CorrectionNode = Node.create({
	name: 'correctionNode',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.correction-node' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return renderCorrectionNode(node, HTMLAttributes);
	},
	addNodeView() {
		return createIncrementalNodeView(renderCorrectionNode);
	},
	addAttributes() {
		return {
			id: {
				default: null,
				parseHTML: element => element.getAttribute('data-node-id'),
				renderHTML: attributes => (attributes.id ? { 'data-node-id': attributes.id } : {}),
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

const renderGapNode: NodeRenderer = (node, HTMLAttributes) => {
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
			'data-tei-attrs': JSON.stringify(node.attrs.teiAttrs || {}),
			title: `${label}`,
			contenteditable: 'false',
		},
		...iconLabelSpec([extent, unit].filter(Boolean).join(' ') || 'gap', 'lacuna'),
	];
};

export const GapNode = Node.create({
	name: 'gap',
	group: 'inline',
	inline: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.gap-milestone' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return renderGapNode(node, HTMLAttributes);
	},
	addNodeView() {
		return createIncrementalNodeView(renderGapNode);
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

const renderSpaceNode: NodeRenderer = (node, HTMLAttributes) => {
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
};

export const SpaceNode = Node.create({
	name: 'space',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.space-milestone' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return renderSpaceNode(node, HTMLAttributes);
	},
	addNodeView() {
		return createIncrementalNodeView(renderSpaceNode);
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

const renderHandShiftNode: NodeRenderer = (node, HTMLAttributes) => {
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
};

export const HandShiftNode = Node.create({
	name: 'handShift',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.hand-shift-node' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return renderHandShiftNode(node, HTMLAttributes);
	},
	addNodeView() {
		return createIncrementalNodeView(renderHandShiftNode);
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
const renderEditorialActionNode: NodeRenderer = (node, HTMLAttributes) => {
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
};

export const EditorialActionNode = Node.create({
	name: 'editorialAction',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.editorial-action-node' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return renderEditorialActionNode(node, HTMLAttributes);
	},
	addNodeView() {
		return createIncrementalNodeView(renderEditorialActionNode);
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
const renderMetamarkNode: NodeRenderer = (node, HTMLAttributes) => {
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
};

export const MetamarkNode = Node.create({
	name: 'metamark',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.metamark-node' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return renderMetamarkNode(node, HTMLAttributes);
	},
	addNodeView() {
		return createIncrementalNodeView(renderMetamarkNode);
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
const renderTeiAtomNode: NodeRenderer = (node, HTMLAttributes) => {
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
};

export const TeiAtomNode = Node.create({
	name: 'teiAtom',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.tei-atom-node' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return renderTeiAtomNode(node, HTMLAttributes);
	},
	addNodeView() {
		return createIncrementalNodeView(renderTeiAtomNode);
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

const renderTeiWrapperNode: NodeRenderer = (node, HTMLAttributes) => {
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
};

export const TeiWrapperNode = Node.create({
	name: 'teiWrapper',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.tei-wrapper-node' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return renderTeiWrapperNode(node, HTMLAttributes);
	},
	addNodeView() {
		return createIncrementalNodeView(renderTeiWrapperNode);
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
