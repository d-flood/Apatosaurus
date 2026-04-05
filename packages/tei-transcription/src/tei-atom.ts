import { parseElementTree } from './tei-tree';
import type { TeiAtomItem } from './types';

const RECOGNIZED_TEI_ATOM_TAGS = new Set(['gb', 'ptr', 'media', 'note', 'ellipsis']);

export function isRecognizedTeiAtomTag(tagName: string): boolean {
	return RECOGNIZED_TEI_ATOM_TAGS.has(tagName.toLowerCase());
}

export function createTeiAtomItem(
	element: Element,
	wordInline = false
): TeiAtomItem {
	const tag = element.tagName as TeiAtomItem['tag'];
	const text = normalizeText(element.textContent || '') || undefined;
	return {
		type: 'teiAtom',
		tag,
		summary: summarizeTeiAtom(element, text),
		attrs: optionalAttributes(collectAttributes(element)),
		node: parseElementTree(element),
		wordInline,
		...(text ? { text } : {}),
	};
}

function summarizeTeiAtom(element: Element, text: string | undefined): string {
	const tag = element.tagName;
	if (tag === 'gb') {
		return element.getAttribute('n') ? `gb:${element.getAttribute('n')}` : 'gb';
	}
	if (tag === 'ptr') {
		return element.getAttribute('target') || element.getAttribute('cRef') || 'ptr';
	}
	if (tag === 'media') {
		return element.getAttribute('mimeType') || element.getAttribute('url') || 'media';
	}
	if (tag === 'note') {
		const type = element.getAttribute('type');
		return type && text ? `note:${type}:${text}` : type ? `note:${type}` : text ? `note:${text}` : 'note';
	}
	if (tag === 'ellipsis') {
		return text ? `ellipsis:${text}` : 'ellipsis';
	}
	return tag;
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

function normalizeText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}
