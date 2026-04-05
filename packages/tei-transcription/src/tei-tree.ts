import type { TeiElementNode, TeiNode } from './types';

export function parseElementTree(element: Element): TeiElementNode {
	return {
		type: 'element',
		tag: element.tagName,
		attrs: optionalAttributes(collectAttributes(element)),
		children: parseChildNodes(element.childNodes),
	};
}

export function parseChildNodes(nodes: NodeList | Node[]): TeiNode[] {
	const parsed: TeiNode[] = [];
	for (const node of Array.from(nodes)) {
		if (node.nodeType === Node.ELEMENT_NODE) {
			parsed.push(parseElementTree(node as Element));
			continue;
		}

		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent || '';
			if (text.length > 0) {
				parsed.push({ type: 'text', text });
			}
		}
	}
	return parsed;
}

export function serializeTeiNode(node: TeiNode): string {
	if (node.type === 'text') {
		return escapeXml(node.text);
	}

	const attrs = serializeAttrs(node.attrs || {});
	const children = node.children || [];
	if (children.length === 0) {
		return `<${node.tag}${attrs}/>`;
	}
	return `<${node.tag}${attrs}>${children.map(serializeTeiNode).join('')}</${node.tag}>`;
}

export function serializeTeiNodes(nodes: TeiNode[] | undefined): string[] {
	return (nodes || []).map(serializeTeiNode);
}

function collectAttributes(element: Element): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const attr of Array.from(element.attributes || [])) {
		attrs[attr.name] = attr.value;
	}
	return attrs;
}

function optionalAttributes(
	attrs: Record<string, string>
): Record<string, string> | undefined {
	return Object.keys(attrs).length > 0 ? attrs : undefined;
}

function serializeAttrs(attrs: Record<string, string>): string {
	const pairs = Object.entries(attrs).filter(([, value]) => value != null && value !== '');
	if (pairs.length === 0) return '';
	return ` ${pairs
		.map(([key, value]) => `${key}="${escapeXml(value)}"`)
		.join(' ')}`;
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}
