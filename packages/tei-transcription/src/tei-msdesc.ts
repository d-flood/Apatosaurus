import type { TeiHandInfo, TeiLayoutInfo, TeiMsDescriptionInfo, TeiMsItemInfo } from './types';

export function extractTeiMsDescriptionInfo(msDesc: Element): TeiMsDescriptionInfo | undefined {
	const msName = extractDescendantText(msDesc, ['msIdentifier', 'msName']);
	const objectDesc = getDescendantAtPath(msDesc, ['physDesc', 'objectDesc']);
	const supportDesc = getDescendantAtPath(msDesc, ['physDesc', 'objectDesc', 'supportDesc']);
	const objectType =
		extractDescendantText(msDesc, ['physDesc', 'objectDesc', 'objectType']) ||
		objectDesc?.getAttribute('form') ||
		undefined;
	const material =
		extractDescendantText(msDesc, ['physDesc', 'objectDesc', 'supportDesc', 'support', 'material']) ||
		supportDesc?.getAttribute('material') ||
		undefined;
	const origDate = extractDescendantText(msDesc, ['history', 'origin', 'origDate']);
	const origPlace = extractDescendantText(msDesc, ['history', 'origin', 'origPlace']);
	const foliation = extractDescendantText(msDesc, ['physDesc', 'objectDesc', 'supportDesc', 'foliation']);
	const condition = extractDescendantText(msDesc, ['physDesc', 'objectDesc', 'supportDesc', 'condition']);
	const provenance = extractRepeatedDescendantText(msDesc, ['history', 'provenance']);
	const surrogates = extractRepeatedDescendantText(msDesc, ['additional', 'surrogates']);
	const layouts = extractLayouts(msDesc);
	const hands = extractHands(msDesc);
	const contents = extractContents(msDesc);

	const value: TeiMsDescriptionInfo = {
		...(msName ? { msName } : {}),
		...(objectType ? { objectType } : {}),
		...(material ? { material } : {}),
		...(origDate ? { origDate } : {}),
		...(origPlace ? { origPlace } : {}),
		...(foliation ? { foliation } : {}),
		...(condition ? { condition } : {}),
		...(layouts.length > 0 ? { layouts } : {}),
		...(hands.length > 0 ? { hands } : {}),
		...(contents.length > 0 ? { contents } : {}),
		...(provenance.length > 0 ? { provenance } : {}),
		...(surrogates.length > 0 ? { surrogates } : {}),
	};

	return Object.keys(value).length > 0 ? value : undefined;
}

function extractLayouts(msDesc: Element): TeiLayoutInfo[] {
	const layoutDesc = getDescendantAtPath(msDesc, ['physDesc', 'objectDesc', 'layoutDesc']);
	if (!layoutDesc) return [];
	return getImmediateChildElements(layoutDesc, 'layout')
		.map(layout => {
			const value: TeiLayoutInfo = {
				...(layout.getAttribute('columns') ? { columns: layout.getAttribute('columns') || undefined } : {}),
				...(layout.getAttribute('writtenLines')
					? { writtenLines: layout.getAttribute('writtenLines') || undefined }
					: {}),
				...(normalizeText(layout.textContent || '') ? { text: normalizeText(layout.textContent || '') } : {}),
			};
			return value;
		})
		.filter(layout => Object.keys(layout).length > 0);
}

function extractHands(msDesc: Element): TeiHandInfo[] {
	const handDesc = getDescendantAtPath(msDesc, ['physDesc', 'handDesc']);
	if (!handDesc) return [];
	return getImmediateChildElements(handDesc, 'handNote')
		.map(handNote => {
			const attrs = collectAttributes(handNote);
			const text = normalizeText(handNote.textContent || '') || undefined;
			const value: TeiHandInfo = {
				...(Object.keys(attrs).length > 0 ? { attrs } : {}),
				...(text ? { text } : {}),
			};
			return value;
		})
		.filter(hand => Object.keys(hand).length > 0);
}

function extractContents(msDesc: Element): TeiMsItemInfo[] {
	const msContents = getDescendantAtPath(msDesc, ['msContents']);
	if (!msContents) return [];
	return getImmediateChildElements(msContents)
		.filter(child => {
			const tag = child.tagName.toLowerCase();
			return tag === 'msitem' || tag === 'msitemstruct';
		})
		.map(item => {
			const locus = extractImmediateChildText(item, 'locus');
			const titles = getImmediateChildElements(item, 'title')
				.map(title => normalizeText(title.textContent || ''))
				.filter(Boolean);
			const authors = getImmediateChildElements(item, 'author')
				.map(author => normalizeText(author.textContent || ''))
				.filter(Boolean);
			const notes = getImmediateChildElements(item, 'note')
				.map(note => normalizeText(note.textContent || ''))
				.filter(Boolean);
			const textLang = extractImmediateChildText(item, 'textLang');

			const value: TeiMsItemInfo = {
				...(locus ? { locus } : {}),
				...(titles.length > 0 ? { titles } : {}),
				...(authors.length > 0 ? { authors } : {}),
				...(textLang ? { textLang } : {}),
				...(notes.length > 0 ? { notes } : {}),
			};
			return value;
		})
		.filter(item => Object.keys(item).length > 0);
}

function extractDescendantText(root: Element, path: string[]): string | undefined {
	const target = getDescendantAtPath(root, path);
	return normalizeText(target?.textContent || '') || undefined;
}

function extractRepeatedDescendantText(root: Element, path: string[]): string[] {
	const parent = getDescendantAtPath(root, path.slice(0, -1));
	if (!parent) return [];
	return getImmediateChildElements(parent, path[path.length - 1])
		.map(child => normalizeText(child.textContent || ''))
		.filter(Boolean);
}

function extractImmediateChildText(root: Element, tagName: string): string | undefined {
	const child = getImmediateChildElements(root, tagName)[0];
	return normalizeText(child?.textContent || '') || undefined;
}

function getDescendantAtPath(root: Element, path: string[]): Element | null {
	let current: Element | null = root;
	for (const segment of path) {
		current = current ? getImmediateChildElements(current, segment)[0] || null : null;
		if (!current) return null;
	}
	return current;
}

function getImmediateChildElements(root: Element): Element[];
function getImmediateChildElements(root: Element, tagName: string): Element[];
function getImmediateChildElements(root: Element, tagName?: string): Element[] {
	return Array.from(root.childNodes).filter(
		child =>
			child.nodeType === Node.ELEMENT_NODE &&
			(!tagName || (child as Element).tagName.toLowerCase() === tagName.toLowerCase())
	) as Element[];
}

function collectAttributes(element: Element): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const attr of Array.from(element.attributes || [])) {
		attrs[attr.name] = attr.value;
	}
	return attrs;
}

function normalizeText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}
