import type { MetamarkItem } from './types';

export function createMetamarkItem(
	element: Element,
	wordInline = false
): MetamarkItem {
	const attrs = collectAttributes(element);
	return {
		type: 'metamark',
		attrs,
		summary: summarizeMetamark(attrs),
		wordInline,
	};
}

export function summarizeMetamark(attrs: Record<string, string>): string {
	const func = attrs.function || 'metamark';
	const target = attrs.target ? ` ${attrs.target}` : '';
	return `${func}${target}`.trim();
}

function collectAttributes(element: Element): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const attr of Array.from(element.attributes || [])) {
		attrs[attr.name] = attr.value;
	}
	return attrs;
}
