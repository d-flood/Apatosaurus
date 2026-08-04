import { importTEIDocument } from '$lib/tei/tei-importer';
import { DOMParser } from '@xmldom/xmldom';

import { createReferenceEditionSource } from './source';
import type { ParsedReferenceEditionResult } from '$lib/client/reference-editions/reference-edition-worker-types';

export function parseReferenceEditionXml(xml: string): ParsedReferenceEditionResult {
	const previousDOMParser = globalThis.DOMParser;
	const previousNode = globalThis.Node;
	if (typeof globalThis.DOMParser === 'undefined') {
		globalThis.DOMParser = DOMParser as typeof globalThis.DOMParser;
	}
	if (typeof globalThis.Node === 'undefined') {
		globalThis.Node = {
			ELEMENT_NODE: 1,
			TEXT_NODE: 3,
		} as typeof globalThis.Node;
	}

	try {
		const document = importTEIDocument(xml, { opaqueMilestoneLabels: true });
		const source = createReferenceEditionSource(document);
		const title =
			document.header?.titles?.find(item => item.type === 'document')?.text ||
			document.header?.titles?.find(item => item.type === 'short')?.text ||
			document.header?.titles?.[0]?.text ||
			document.metadata?.title;
		return {
			source,
			metadata: {
				...(title ? { title } : {}),
				...(document.header?.publication?.availability
					? { attribution: document.header.publication.availability }
					: {}),
			},
		};
	} finally {
		if (previousDOMParser === undefined) Reflect.deleteProperty(globalThis, 'DOMParser');
		else globalThis.DOMParser = previousDOMParser;
		if (previousNode === undefined) Reflect.deleteProperty(globalThis, 'Node');
		else globalThis.Node = previousNode;
	}
}
