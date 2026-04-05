import type {
	EditorialActionItem,
	EditorialActionStructure,
	EditorialPointerAction,
	EditorialTranspose,
	EditorialTransposeList,
} from './types';

const POINTER_TAGS = new Set(['undo', 'redo', 'substjoin']);

export function isEditorialActionTag(tagName: string): boolean {
	return POINTER_TAGS.has(tagName.toLowerCase()) || tagName === 'transpose' || tagName === 'listtranspose';
}

export function createEditorialActionItem(
	element: Element
): EditorialActionItem {
	const structure = parseEditorialActionStructure(element);
	return {
		type: 'editorialAction',
		tag: structure.kind,
		summary: summarizeEditorialAction(structure),
		attrs: optionalAttributes(collectAttributes(element)),
		structure,
	};
}

export function parseEditorialActionStructure(element: Element): EditorialActionStructure {
	const tagName = element.tagName.toLowerCase();
	if (POINTER_TAGS.has(tagName)) {
		return {
			kind: normalizePointerTag(tagName),
			attrs: optionalAttributes(collectAttributes(element)),
			targets: parseTargets(element.getAttribute('target')),
		};
	}

	if (tagName === 'transpose') {
		return {
			kind: 'transpose',
			attrs: optionalAttributes(collectAttributes(element)),
			targets: Array.from(element.getElementsByTagName('ptr'))
				.map(ptr => ptr.getAttribute('target') || '')
				.filter(Boolean),
		};
	}

	if (tagName === 'listtranspose') {
		return {
			kind: 'listTranspose',
			attrs: optionalAttributes(collectAttributes(element)),
			items: getImmediateChildElements(element)
				.filter(child => child.tagName.toLowerCase() === 'transpose')
				.map(parseEditorialActionStructure)
				.filter((item): item is EditorialTranspose => item.kind === 'transpose'),
		};
	}

	throw new Error(`Unsupported editorial action tag: ${element.tagName}`);
}

export function summarizeEditorialAction(structure: EditorialActionStructure): string {
	switch (structure.kind) {
		case 'undo':
		case 'redo':
		case 'substJoin':
			return structure.targets.length > 0
				? `${structure.kind}: ${structure.targets.join(' ')}`
				: structure.kind;
		case 'transpose':
			return structure.targets.length > 0
				? `transpose: ${structure.targets.join(' -> ')}`
				: 'transpose';
		case 'listTranspose':
			return structure.items.length > 0
				? `listTranspose (${structure.items.length} entries)`
				: 'listTranspose';
	}
}

export function serializeEditorialActionStructure(structure: EditorialActionStructure): string {
	switch (structure.kind) {
		case 'undo':
		case 'redo':
		case 'substJoin':
			return `<${structure.kind}${serializeAttrs({
				...(structure.attrs || {}),
				target: joinTargets(structure.targets),
			})}/>`;
		case 'transpose':
			return [
				`<transpose${serializeAttrs(structure.attrs || {})}>`,
				...structure.targets.map(target => `<ptr target="${escapeXml(target)}"/>`),
				'</transpose>',
			].join('');
		case 'listTranspose':
			return [
				`<listTranspose${serializeAttrs(structure.attrs || {})}>`,
				...structure.items.map(item => serializeEditorialActionStructure(item)),
				'</listTranspose>',
			].join('');
	}
}

function normalizePointerTag(tagName: string): EditorialPointerAction['kind'] {
	if (tagName === 'substjoin') return 'substJoin';
	return tagName as EditorialPointerAction['kind'];
}

function getImmediateChildElements(root: Element): Element[] {
	return Array.from(root.childNodes).filter(
		child => child.nodeType === Node.ELEMENT_NODE
	) as Element[];
}

function parseTargets(targetAttr: string | null): string[] {
	return (targetAttr || '')
		.split(/\s+/)
		.map(token => token.trim())
		.filter(Boolean);
}

function joinTargets(targets: string[]): string | undefined {
	return targets.length > 0 ? targets.join(' ') : undefined;
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

function serializeAttrs(attrs: Record<string, string | undefined>): string {
	const pairs = Object.entries(attrs).filter(([, value]) => value);
	if (pairs.length === 0) return '';
	return ` ${pairs.map(([key, value]) => `${key}="${escapeXml(String(value))}"`).join(' ')}`;
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}
