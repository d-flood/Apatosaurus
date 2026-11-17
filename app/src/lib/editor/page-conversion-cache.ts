import {
	fromProseMirror,
	normalizeDocument,
	type TranscriptionPage,
} from '@apatosaurus/tei-transcription';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

interface ConvertedPage {
	page: TranscriptionPage;
	json: string;
}

export interface ConvertedPages {
	pages: TranscriptionPage[];
	pageJson: string[];
}

function convertPage(node: ProseMirrorNode): ConvertedPage {
	const converted = fromProseMirror({ type: 'manuscript', content: [node.toJSON()] });
	const [page] = normalizeDocument(converted).pages;
	return { page, json: JSON.stringify(page) };
}

/** Converts each page node once; unchanged pages keep their node identity across transactions. */
export function createPageConversionCache() {
	const cache = new WeakMap<ProseMirrorNode, ConvertedPage>();

	return (doc: ProseMirrorNode): ConvertedPages => {
		const pages: TranscriptionPage[] = [];
		const pageJson: string[] = [];
		doc.forEach(node => {
			if (node.type.name !== 'page') return;
			let converted = cache.get(node);
			if (!converted) {
				converted = convertPage(node);
				// A generated page id differs on every conversion, so only pages with their own id are reused.
				if (
					converted.page.pageId === node.attrs.pageId ||
					converted.page.pageId === node.attrs.teiAttrs?.['xml:id']
				) {
					cache.set(node, converted);
				}
			}
			pages.push(converted.page);
			pageJson.push(converted.json);
		});
		return { pages, pageJson };
	};
}
