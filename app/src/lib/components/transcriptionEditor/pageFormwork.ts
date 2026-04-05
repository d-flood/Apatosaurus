import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { classifyFormWork } from './formworkConcepts';
import { buildPlainTextFormWorkContent, formWorkContentToPlainText } from './formworkContent';

export interface PageFormWorkField {
	pos: number;
	text: string;
	attrs: Record<string, any>;
}

export interface PageEditorMetadata {
	pos: number;
	pageId: string;
	pageOrder: number;
	pageName: string | null;
	pageLabel: PageFormWorkField | null;
	runningTitle: PageFormWorkField | null;
	catchword: PageFormWorkField | null;
	quireSignature: PageFormWorkField | null;
}

export interface PageChromeAttrs {
	pageLabel: string | null;
	runningTitle: string | null;
	catchword: string | null;
	quireSignature: string | null;
}

export function extractPageMetadata(pageNode: ProseMirrorNode, pagePos: number): PageEditorMetadata {
	const metadata: PageEditorMetadata = {
		pos: pagePos,
		pageId: pageNode.attrs?.pageId || `page-${pagePos}`,
		pageOrder: 0,
		pageName: pageNode.attrs?.pageName || null,
		pageLabel: null,
		runningTitle: null,
		catchword: null,
		quireSignature: null,
	};

	pageNode.descendants((node, relativePos) => {
		if (node.type.name !== 'fw') {
			return true;
		}

		const classification = classifyFormWork(node.attrs || {});
		const absolutePos = pagePos + 1 + relativePos;
		const field: PageFormWorkField = {
			pos: absolutePos,
			text: formWorkContentToPlainText(node.attrs?.content || []),
			attrs: node.attrs || {},
		};

		if (classification.contentConcept === 'pageLabel' && !metadata.pageLabel) {
			metadata.pageLabel = field;
			return true;
		}

		if (classification.contentConcept === 'runningTitle' && !metadata.runningTitle) {
			metadata.runningTitle = field;
			return true;
		}

		if (classification.contentConcept === 'catchword' && !metadata.catchword) {
			metadata.catchword = field;
			return true;
		}

		if (classification.contentConcept === 'quireSignature' && !metadata.quireSignature) {
			metadata.quireSignature = field;
		}

		return true;
	});

	return metadata;
}

export function getPageChromeAttrs(
	metadata: Pick<
		PageEditorMetadata,
		'pageLabel' | 'runningTitle' | 'catchword' | 'quireSignature'
	>
): PageChromeAttrs {
	return {
		pageLabel: metadata.pageLabel?.text || null,
		runningTitle: metadata.runningTitle?.text || null,
		catchword: metadata.catchword?.text || null,
		quireSignature: metadata.quireSignature?.text || null,
	};
}

export function getPageLabelCandidates(
	metadata: Pick<PageEditorMetadata, 'pageName' | 'pageLabel'>
): string[] {
	const values = [metadata.pageName, metadata.pageLabel?.text];
	return values.filter((value, index, all): value is string => {
		if (typeof value !== 'string') return false;
		const trimmed = value.trim();
		if (!trimmed) return false;
		return all.findIndex(candidate => candidate?.trim() === trimmed) === index;
	});
}

export function annotatePageChromeInJson(document: Record<string, any> | null | undefined): void {
	if (!document || !Array.isArray(document.content)) return;

	for (const pageNode of document.content) {
		if (pageNode?.type !== 'page') continue;
		const metadata = extractPageMetadataFromJson(pageNode);
		pageNode.attrs = {
			...(pageNode.attrs || {}),
			...getPageChromeAttrs(metadata),
		};
	}
}

export function createDefaultFormWorkAttrs(
	kind: 'pageLabel' | 'runningTitle' | 'catchword' | 'quireSignature',
	text: string
): Record<string, any> {
	return {
		...(kind === 'pageLabel'
			? {
					type: 'pageNum',
					place: 'top',
					subtype: '',
					rend: '',
					segType: 'margin',
					segSubtype: 'pagetop',
					segPlace: 'top',
				}
			: kind === 'runningTitle'
				? {
						type: 'runTitle',
						place: 'top',
						subtype: '',
						rend: 'center',
						segType: 'margin',
						segSubtype: 'pagetop',
						segPlace: 'top',
					}
				: kind === 'catchword'
					? {
							type: 'catchword',
							place: 'bottom',
							subtype: '',
							rend: '',
							segType: 'margin',
							segSubtype: 'colbottom',
							segPlace: 'bottom',
						}
					: {
							type: 'sig',
							place: 'bottom',
							subtype: '',
							rend: '',
							segType: 'margin',
							segSubtype: 'colbottom',
							segPlace: 'bottom',
						}),
		content: buildPlainTextFormWorkContent(text),
	};
}

export function findFirstLineInsertPos(pageNode: ProseMirrorNode, pagePos: number): number | null {
	let linePos: number | null = null;

	pageNode.descendants((node, relativePos) => {
		if (node.type.name === 'line') {
			linePos = pagePos + 1 + relativePos;
			return false;
		}
		return true;
	});

	return linePos === null ? null : linePos + 1;
}

function extractPageMetadataFromJson(pageNode: Record<string, any>): PageEditorMetadata {
	const metadata: PageEditorMetadata = {
		pos: 0,
		pageId: pageNode?.attrs?.pageId || 'page-0',
		pageOrder: 0,
		pageName: pageNode?.attrs?.pageName || null,
		pageLabel: null,
		runningTitle: null,
		catchword: null,
		quireSignature: null,
	};

	visitJsonNodes(pageNode, node => {
		if (node?.type !== 'fw') return;

		const classification = classifyFormWork(node.attrs || {});
		const field: PageFormWorkField = {
			pos: 0,
			text: formWorkContentToPlainText(node.attrs?.content || []),
			attrs: node.attrs || {},
		};

		if (classification.contentConcept === 'pageLabel' && !metadata.pageLabel) {
			metadata.pageLabel = field;
		}

		if (classification.contentConcept === 'runningTitle' && !metadata.runningTitle) {
			metadata.runningTitle = field;
			return;
		}

		if (classification.contentConcept === 'catchword' && !metadata.catchword) {
			metadata.catchword = field;
			return;
		}

		if (classification.contentConcept === 'quireSignature' && !metadata.quireSignature) {
			metadata.quireSignature = field;
		}
	});

	return metadata;
}

function visitJsonNodes(node: Record<string, any> | null | undefined, visit: (node: Record<string, any>) => void): void {
	if (!node || typeof node !== 'object') return;

	visit(node);

	if (!Array.isArray(node.content)) return;
	for (const child of node.content) {
		visitJsonNodes(child, visit);
	}
}
