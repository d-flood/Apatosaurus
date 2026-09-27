import { badgeIconSpec, type BadgeIconName } from '$lib/editor/badge-icons';
import { DOMSerializer, type DOMOutputSpec, type Node as ProseMirrorNode } from '@tiptap/pm/model';

export function parseJsonAttr<T>(value: string | null, fallback: T = {} as T): T {
	if (!value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

export function serializeJsonAttr(value: unknown): string {
	return JSON.stringify(value || {});
}

export function iconLabelSpec(label: string, icon: BadgeIconName) {
	return [badgeIconSpec(icon), ['span', { class: 'tei-inline-badge-label' }, label]];
}

export function inlineBadgeClass(className: string, extraClass: string = '') {
	return `${className} tei-inline-badge badge badge-sm inline-flex items-center gap-1.5 ${extraClass}`.trim();
}

export type NodeRenderer = (
	node: ProseMirrorNode,
	HTMLAttributes: Record<string, any>
) => DOMOutputSpec;

function domShapesAgree(
	current: globalThis.Node,
	next: globalThis.Node,
	currentContentDOM?: HTMLElement,
	nextContentDOM?: HTMLElement
): boolean {
	if (current === currentContentDOM) return next === nextContentDOM;
	if (current.nodeType !== next.nodeType) return false;
	if (current instanceof Element && next instanceof Element) {
		if (
			current.tagName !== next.tagName ||
			current.childNodes.length !== next.childNodes.length
		) {
			return false;
		}
		return Array.from(current.childNodes).every((child, index) =>
			domShapesAgree(child, next.childNodes[index], currentContentDOM, nextContentDOM)
		);
	}
	return current.childNodes.length === next.childNodes.length;
}

function patchRenderedDom(
	current: globalThis.Node,
	previous: globalThis.Node,
	next: globalThis.Node,
	contentDOM?: HTMLElement
) {
	if (current === contentDOM) return;
	if (current instanceof Element && previous instanceof Element && next instanceof Element) {
		const previousClasses = new Set(Array.from(previous.classList));
		const nextClasses = Array.from(next.classList);
		const extraClasses = Array.from(current.classList).filter(
			name => !previousClasses.has(name)
		);
		const classes = [
			...nextClasses,
			...extraClasses.filter(name => !next.classList.contains(name)),
		];
		if (classes.length > 0) {
			current.setAttribute('class', classes.join(' '));
		} else {
			current.removeAttribute('class');
		}

		for (const attribute of Array.from(previous.attributes)) {
			if (
				attribute.name !== 'class' &&
				!next.hasAttribute(attribute.name) &&
				current.getAttribute(attribute.name) === attribute.value
			) {
				current.removeAttribute(attribute.name);
			}
		}
		for (const attribute of Array.from(next.attributes)) {
			if (attribute.name === 'class') continue;
			current.setAttribute(attribute.name, attribute.value);
		}
		Array.from(current.childNodes).forEach((child, index) =>
			patchRenderedDom(child, previous.childNodes[index], next.childNodes[index], contentDOM)
		);
		return;
	}
	if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
}

export function createIncrementalNodeView(renderNode: NodeRenderer) {
	return ({
		node,
		HTMLAttributes,
	}: {
		node: ProseMirrorNode;
		HTMLAttributes: Record<string, any>;
	}) => {
		let currentNode = node;
		const rendered = DOMSerializer.renderSpec(document, renderNode(node, HTMLAttributes));
		let renderedTemplate = rendered.dom.cloneNode(true);
		return {
			dom: rendered.dom,
			contentDOM: rendered.contentDOM,
			update(nextNode: ProseMirrorNode) {
				if (nextNode.type !== currentNode.type) return false;
				const nextRendered = DOMSerializer.renderSpec(document, renderNode(nextNode, {}));
				if (
					!domShapesAgree(
						rendered.dom,
						nextRendered.dom,
						rendered.contentDOM,
						nextRendered.contentDOM
					)
				) {
					return false;
				}
				patchRenderedDom(
					rendered.dom,
					renderedTemplate,
					nextRendered.dom,
					rendered.contentDOM
				);
				renderedTemplate = nextRendered.dom.cloneNode(true);
				currentNode = nextNode;
				return true;
			},
		};
	};
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

function serializeCorrectionPreview(content: unknown): string {
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
