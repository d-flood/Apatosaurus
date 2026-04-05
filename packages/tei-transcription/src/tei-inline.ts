const FLAT_INLINE_SPAN_TAGS = new Set([
	'foreign',
	'term',
	'name',
	'num',
	'date',
	'unit',
	'am',
	'expan',
	'metamark',
	'mod',
	'retrace',
	'gloss',
	'placeName',
	'objectName',
	'title',
	'bibl',
].map(tag => tag.toLowerCase()));

const WHOLE_WORD_WRAPPER_TAGS = new Set([
	'foreign',
	'term',
	'name',
	'num',
	'date',
	'unit',
	'gloss',
	'placeName',
	'objectName',
	'title',
	'bibl',
	'mod',
	'retrace',
].map(tag => tag.toLowerCase()));

const SAFE_FLAT_INLINE_DESCENDANT_TAGS = new Set([
	'w',
	'pc',
	'supplied',
	'damage',
	'surplus',
	'secl',
	'unclear',
	'hi',
	'abbr',
	'ex',
].map(tag => tag.toLowerCase()));

const SAFE_STRUCTURED_INLINE_DESCENDANT_TAGS = new Set([
	'lb',
	'cb',
	'w',
	'pc',
	'seg',
	'supplied',
	'damage',
	'surplus',
	'secl',
	'unclear',
	'hi',
	'abbr',
	'ex',
	'gap',
	'space',
	'handshift',
	'milestone',
	'metamark',
	'gb',
	'ptr',
	'media',
	'note',
	'ellipsis',
].map(tag => tag.toLowerCase()));

export type InlineSpanHandling = 'flat' | 'structured' | 'unsupported';

export function isFlatInlineSpanTag(tagName: string): boolean {
	return FLAT_INLINE_SPAN_TAGS.has(tagName.toLowerCase());
}

export function isWholeWordWrapperTag(tagName: string | undefined): boolean {
	return WHOLE_WORD_WRAPPER_TAGS.has((tagName || '').toLowerCase());
}

export function canFlattenFlatInlineSpanElement(element: Element): boolean {
	return Array.from(element.childNodes).every(child => {
		if (child.nodeType === Node.TEXT_NODE) {
			return true;
		}
		if (child.nodeType !== Node.ELEMENT_NODE) {
			return false;
		}

		const childElement = child as Element;
		const tagName = childElement.tagName.toLowerCase();
		if (!isFlatInlineSpanDescendantTag(tagName)) {
			return false;
		}

		return canFlattenFlatInlineSpanElement(childElement);
	});
}

export function getInlineSpanHandling(element: Element): InlineSpanHandling {
	if (hasMeaningfulChildContent(element) && canFlattenFlatInlineSpanElement(element)) {
		return 'flat';
	}

	return supportsStructuredInlineSpanElement(element) ? 'structured' : 'unsupported';
}

function isFlatInlineSpanDescendantTag(tagName: string): boolean {
	return SAFE_FLAT_INLINE_DESCENDANT_TAGS.has(tagName) || isFlatInlineSpanTag(tagName);
}

function hasMeaningfulChildContent(element: Element): boolean {
	return Array.from(element.childNodes).some(child => {
		if (child.nodeType === Node.ELEMENT_NODE) return true;
		if (child.nodeType === Node.TEXT_NODE) {
			return !!child.textContent?.trim();
		}
		return false;
	});
}

function supportsStructuredInlineSpanElement(element: Element): boolean {
	return Array.from(element.childNodes).every(child => {
		if (child.nodeType === Node.TEXT_NODE) {
			return true;
		}
		if (child.nodeType !== Node.ELEMENT_NODE) {
			return false;
		}

		const childElement = child as Element;
		const tagName = childElement.tagName.toLowerCase();
		if (tagName === 'pb' || tagName === 'div' || tagName === 'ab') {
			return false;
		}
		if (tagName === 'app' || tagName === 'listapp' || tagName === 'notegrp') {
			return false;
		}
		if (isFlatInlineSpanTag(tagName)) {
			return getInlineSpanHandling(childElement) !== 'unsupported';
		}
		if (!SAFE_STRUCTURED_INLINE_DESCENDANT_TAGS.has(tagName)) {
			return false;
		}

		return supportsStructuredInlineSpanElement(childElement);
	});
}
