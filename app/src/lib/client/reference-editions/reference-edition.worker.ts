import { parseReferenceEditionXml } from '$lib/reference-editions/parse';

import type {
	ReferenceEditionWorkerRequest,
	ReferenceEditionWorkerResponse,
} from './reference-edition-worker-types';

self.onmessage = (event: MessageEvent<ReferenceEditionWorkerRequest>) => {
	void handleMessage(event.data);
};

async function handleMessage(message: ReferenceEditionWorkerRequest): Promise<void> {
	try {
		if (message.type !== 'parse') return;
		const xml = message.xml ?? (await loadAsset(message.assetPath));
		const { source, metadata } = parseReferenceEditionXml(xml);
		postMessage({
			type: 'parsed',
			requestId: message.requestId,
			source,
			metadata,
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
