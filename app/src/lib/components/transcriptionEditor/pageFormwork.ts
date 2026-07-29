import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { findFirstDescendantPosition } from '$lib/client/proseMirrorNodeLookup';

import { classifyFormWork } from './formworkConcepts';
import { formWorkContentToPlainText } from './formworkContent';

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

export function extractPageMetadata(
	pageNode: ProseMirrorNode,
	pagePos: number
): PageEditorMetadata {
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
			text: formWorkContentToPlainText(node.content.toJSON()),
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

export function createDefaultFormWorkAttrs(
	kind: 'pageLabel' | 'runningTitle' | 'catchword' | 'quireSignature'
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
	};
}

export function findFirstLineInsertPos(pageNode: ProseMirrorNode, pagePos: number): number | null {
	const relativePos = findFirstDescendantPosition(pageNode, node => node.type.name === 'line');
	return relativePos === null ? null : pagePos + relativePos + 2;
}
