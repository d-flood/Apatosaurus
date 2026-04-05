import type {
	CollationRunPayload,
	CollationRunResult,
	CollationTokenInput,
	CollationWitnessInput,
	WorkerIncomingMessage,
	WorkerOutgoingMessage,
} from './collation-worker-types';
import type { GapMetadata } from './collation-types';

interface PendingRequest<T> {
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
}

const pendingRequests = new Map<string, PendingRequest<unknown>>();
let worker: Worker | null = null;
let requestCounter = 0;

function makeId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	requestCounter += 1;
	return `collation-${Date.now()}-${requestCounter}`;
}

function getWorker(): Worker {
	if (typeof window === 'undefined' || typeof Worker === 'undefined') {
		throw new Error('Collation runtime is only available in a browser environment.');
	}

	if (worker) return worker;

	worker = new Worker(new URL('./collation.worker.ts', import.meta.url), {
		type: 'module',
	});
	worker.onmessage = (event: MessageEvent<WorkerOutgoingMessage>) => {
		const message = event.data;
		const pending = pendingRequests.get(message.requestId);
		if (!pending) return;
		pendingRequests.delete(message.requestId);
		if (message.type === 'error') {
			pending.reject(new Error(message.error));
			return;
		}
		pending.resolve(message.result);
	};
	worker.onerror = (event: ErrorEvent) => {
		const error = new Error(event.message || 'Collation worker failed.');
		for (const pending of pendingRequests.values()) {
			pending.reject(error);
		}
		pendingRequests.clear();
		worker?.terminate();
		worker = null;
	};

	return worker;
}

function postWorkerRequest<T>(message: WorkerIncomingMessage): Promise<T> {
	const runtime = getWorker();
	return new Promise<T>((resolve, reject) => {
		pendingRequests.set(message.requestId, {
			resolve: resolve as (value: unknown) => void,
			reject,
		});
		runtime.postMessage(message);
	});
}

export async function runCollationInWorker(
	payload: CollationRunPayload,
): Promise<CollationRunResult> {
	if (payload.witnesses.length < 2) {
		throw new Error('At least two witnesses are required for collation.');
	}

	return postWorkerRequest<CollationRunResult>({
		type: 'collate',
		requestId: makeId(),
		payload: makeCloneableCollationRunPayload(payload),
	});
}

export function makeCloneableCollationRunPayload(payload: CollationRunPayload): CollationRunPayload {
	return {
		witnesses: payload.witnesses.map(makeCloneableWitnessInput),
		options: payload.options ? { segmentation: payload.options.segmentation === true } : undefined,
	};
}

function makeCloneableWitnessInput(witness: CollationWitnessInput): CollationWitnessInput {
	return {
		id: String(witness.id),
		content: String(witness.content ?? ''),
		tokens: witness.tokens?.map(makeCloneableTokenInput),
	};
}

function makeCloneableTokenInput(token: CollationTokenInput): CollationTokenInput {
	return {
		t: String(token.t ?? ''),
		n: String(token.n ?? ''),
		sourceTokenIds: token.sourceTokenIds ? [...token.sourceTokenIds] : undefined,
		kind: token.kind,
		displayRegularized: token.displayRegularized ?? null,
		originalSegments: token.originalSegments?.map((segment) => ({ ...segment })),
		gap: cloneGapMetadata(token.gap),
		hasUnclear: token.hasUnclear === true,
		isPunctuation: token.isPunctuation === true,
		isSupplied: token.isSupplied === true,
		ruleIds: token.ruleIds ? [...token.ruleIds] : undefined,
		regularizationTypes: token.regularizationTypes ? [...token.regularizationTypes] : undefined,
	};
}

function cloneGapMetadata(gap: GapMetadata | null | undefined): GapMetadata | null {
	if (!gap) return null;
	return {
		source: gap.source,
		reason: String(gap.reason ?? ''),
		unit: String(gap.unit ?? ''),
		extent: String(gap.extent ?? ''),
	};
}
