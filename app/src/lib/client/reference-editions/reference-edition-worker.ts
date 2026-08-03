import type { ReferenceEditionCatalogEntry } from '$lib/reference-editions/catalog';
import type { ParsedReferenceEdition } from '$lib/reference-editions/source';

import type {
	ReferenceEditionWorkerRequest,
	ReferenceEditionWorkerResponse,
} from './reference-edition-worker-types';

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<
	number,
	{
		resolve: (source: ParsedReferenceEdition) => void;
		reject: (error: Error) => void;
	}
>();

export function loadReferenceEdition(
	entry: ReferenceEditionCatalogEntry
): Promise<ParsedReferenceEdition> {
	return parseReferenceEditionInWorker({ assetPath: entry.assetPath });
}

export function parseReferenceEditionInWorker(input: {
	assetPath?: string;
	xml?: string;
}): Promise<ParsedReferenceEdition> {
	const referenceWorker = getWorker();
	const requestId = nextRequestId++;

	return new Promise((resolve, reject) => {
		pending.set(requestId, { resolve, reject });
		referenceWorker.postMessage({
			type: 'parse',
			requestId,
			...input,
		} satisfies ReferenceEditionWorkerRequest);
	});
}

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker(new URL('./reference-edition.worker.ts', import.meta.url), {
			type: 'module',
		});
		worker.addEventListener('message', handleWorkerMessage);
		worker.addEventListener('error', handleWorkerError);
	}
	return worker;
}

function handleWorkerMessage(event: MessageEvent<ReferenceEditionWorkerResponse>): void {
	const message = event.data;
	const request = pending.get(message.requestId);
	if (!request) return;
	pending.delete(message.requestId);
	if (message.type === 'parsed') request.resolve(message.source);
	else request.reject(new Error(message.error));
}

function handleWorkerError(event: ErrorEvent): void {
	const error = new Error(event.message || 'Reference edition worker failed.');
	for (const request of pending.values()) request.reject(error);
	pending.clear();
	worker?.terminate();
	worker = null;
}
