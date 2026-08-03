import { importTEIDocument } from '$lib/tei/tei-importer';
import { createReferenceEditionSource } from '$lib/reference-editions/source';
import { DOMParser } from '@xmldom/xmldom';

import type {
	ReferenceEditionWorkerRequest,
	ReferenceEditionWorkerResponse,
} from './reference-edition-worker-types';

if (typeof globalThis.DOMParser === 'undefined') {
	globalThis.DOMParser = DOMParser as typeof globalThis.DOMParser;
}

if (typeof globalThis.Node === 'undefined') {
	globalThis.Node = {
		ELEMENT_NODE: 1,
		TEXT_NODE: 3,
	} as typeof globalThis.Node;
}

self.onmessage = (event: MessageEvent<ReferenceEditionWorkerRequest>) => {
	void handleMessage(event.data);
};

async function handleMessage(message: ReferenceEditionWorkerRequest): Promise<void> {
	try {
		if (message.type !== 'parse') return;
		const xml = message.xml ?? (await loadAsset(message.assetPath));
		const document = importTEIDocument(xml, { opaqueMilestoneLabels: true });
		const source = createReferenceEditionSource(document);
		postMessage({
			type: 'parsed',
			requestId: message.requestId,
			source,
		} satisfies ReferenceEditionWorkerResponse);
	} catch (error) {
		postMessage({
			type: 'error',
			requestId: message.requestId,
			error: error instanceof Error ? error.message : String(error),
		} satisfies ReferenceEditionWorkerResponse);
	}
}

async function loadAsset(assetPath: string | undefined): Promise<string> {
	if (!assetPath) throw new Error('Reference edition has no asset path.');
	const response = await fetch(assetPath);
	if (!response.ok) {
		throw new Error(`Failed to load reference edition (${response.status}).`);
	}
	return response.text();
}
