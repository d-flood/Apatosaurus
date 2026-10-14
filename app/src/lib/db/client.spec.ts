import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbRequest } from './rpc';

const worker = vi.hoisted(
	() =>
		new (class extends EventTarget {
			requests: DbRequest[] = [];

			postMessage(request: DbRequest) {
				this.requests.push(request);
			}

			respond(request: DbRequest, result: unknown = null) {
				this.dispatchEvent(
					new MessageEvent('message', { data: { id: request.id, ok: true, result } })
				);
			}
		})()
);

vi.mock('./runtime', () => ({
	ensureLocalDbRuntime: async () => undefined,
	getLocalDbWorker: () => worker,
}));

import { attachLocalDbClient, listProjects, moveProject } from './client';

attachLocalDbClient(worker as unknown as Worker);

function settled(promise: Promise<unknown>) {
	return promise.then(
		() => 'resolved',
		(error: Error) => error.message
	);
}

describe('local database client', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		worker.requests = [];
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('waits for a long project move and the requests queued behind it', async () => {
		const move = settled(moveProject('project-1', 'dropbox-location'));
		await vi.advanceTimersByTimeAsync(30_000);
		const queued = settled(listProjects());
		await vi.advanceTimersByTimeAsync(5 * 60_000);

		for (const request of worker.requests) worker.respond(request, []);

		expect(await move).toBe('resolved');
		expect(await queued).toBe('resolved');
	});
});
