import { badgeIconSpec } from '$lib/editor/badge-icons';
import { classifyFormWork } from '$lib/editor/formworkConcepts';
import { Node } from '@tiptap/core';
import {
	parseJsonAttr,
	type NodeRenderer,
	inlineBadgeClass,
	createIncrementalNodeView,
	serializeJsonAttr,
} from './node-views';

const renderFormWorkNode: NodeRenderer = (node, HTMLAttributes) => {
	const classification = classifyFormWork(node.attrs || {});
	const category =
		classification.entryPoint === 'marginalia'
			? classification.marginaliaCategory || 'Other'
			: classification.label;
	const label = node.textContent.trim() || String(category).toLowerCase();
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
			'data-tei-attrs': serializeJsonAttr(node.attrs.teiAttrs),
			'data-seg-type': node.attrs.segType || '',
			'data-seg-subtype': node.attrs.segSubtype || '',
			'data-seg-place': node.attrs.segPlace || '',
			'data-seg-hand': node.attrs.segHand || '',
			'data-seg-rend': node.attrs.segRend || '',
			'data-seg-n': node.attrs.segN || '',
			'data-seg-attrs': serializeJsonAttr(node.attrs.segAttrs),
			title: label,
		},
		[
			'span',
			{ class: 'tei-inline-badge-icon', contenteditable: 'false' },
			badgeIconSpec(iconName),
		],
		['span', { class: 'fw-content' }, 0],
	];
};

export const FormWorkNode = Node.create({
	name: 'fw',
	priority: 1000,
	group: 'inline',
	inline: true,
	content: 'inline*',
	selectable: true,
	parseHTML() {
		return [{ tag: 'span.fw-node' }];
	},
	addKeyboardShortcuts() {
		return {
			Enter: () => {
				const { $from } = this.editor.state.selection;
				for (let depth = $from.depth; depth > 0; depth -= 1) {
					if ($from.node(depth).type.name === 'fw') {
						return this.editor.commands.insertContent({
							type: 'lineBreak',
							attrs: { teiAttrs: {} },
						});
					}
				}
				return false;
			},
		};
	},
	renderHTML({ node, HTMLAttributes }) {
		return renderFormWorkNode(node, HTMLAttributes);
	},
	addNodeView() {
		return createIncrementalNodeView(renderFormWorkNode);
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
					'data-tei-attrs': serializeJsonAttr(attributes.teiAttrs),
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
					'data-seg-attrs': serializeJsonAttr(attributes.segAttrs),
				}),
			},
		};
	},
});
