import { describe, expect, it, vi } from 'vitest';
import type { DbRequest, DbWorkerMessage } from './rpc';

const workers = vi.hoisted(() => [] as FakeWorker[]);

const events = vi.hoisted(() => [] as string[]);

class FakeWorker extends EventTarget {
	requests: DbRequest[] = [];
	terminate = vi.fn();

	constructor() {
		super();
		workers.push(this);
	}

	postMessage(request: DbRequest) {
		this.requests.push(request);
		events.push('method' in request ? request.method : request.type);
	}

	emit(message: DbWorkerMessage) {
		this.dispatchEvent(new MessageEvent('message', { data: message }));
	}

	request(name: string) {
		return this.requests.find(request =>
			'method' in request ? request.method === name : request.type === name
		);
	}
}

const session = new Map<string, string>();
const reload = vi.fn();
vi.stubGlobal('Worker', FakeWorker);
vi.stubGlobal('sessionStorage', {
	getItem: (key: string) => session.get(key) ?? null,
	setItem: (key: string, value: string) => session.set(key, value),
});
vi.stubGlobal('window', { location: { reload } });

const { ensureLocalDbRuntime } = await import('./runtime');
const { updateTranscriptionContent } = await import('./client');
const { indexRebuildProgress } = await import('./index-rebuild-progress.svelte');
const { notificationCenter } = await import('$lib/shell/notification-center.svelte');
const { registerPendingSave } = await import('./pending-saves');

describe('local database runtime', () => {
	it('flushes pending saves, then repairs a damaged index behind the progress card without reloading', async () => {
		const started = ensureLocalDbRuntime();
		const worker = workers[0];
		const init = worker.requests[0];
		expect(init).toMatchObject({ type: 'init', verifyIntegrity: true });
		worker.emit({ id: init.id!, ok: true });
		await started;
		expect(session.size).toBe(0);

		const unregisterFailing = registerPendingSave(() => Promise.reject(new Error('offline')));
		const unregisterEditor = registerPendingSave(async () => {
			await updateTranscriptionContent({ id: 'tx-1', contentJson: '{}' });
			events.push('flushed');
		});
		events.length = 0;

		worker.emit({ type: 'db:index-damaged', details: ['row 3 missing from index'] });
		await vi.waitFor(() => expect(worker.request('updateTranscriptionContent')).toBeDefined());
		expect(worker.request('rebuild-damaged-index')).toBeUndefined();

		worker.emit({ id: worker.request('updateTranscriptionContent')!.id!, ok: true });
		await vi.waitFor(() => expect(worker.request('rebuild-damaged-index')).toBeDefined());
		expect(events).toEqual(['updateTranscriptionContent', 'flushed', 'rebuild-damaged-index']);
		expect(worker.request('rebuild-damaged-index')).toMatchObject({
			details: ['row 3 missing from index'],
		});

		worker.emit({ type: 'db:index-rebuild-progress', done: 1, total: 4 });
		expect(indexRebuildProgress).toMatchObject({ done: 1, total: 4, phase: 'rebuild' });
		worker.emit({ type: 'db:index-rebuild-progress', done: 4, total: 4 });
		worker.emit({
			type: 'db:index-rebuilt',
			reason: 'integrity-failed',
			details: ['row 3 missing from index'],
			report: {
				projectsRestored: 1,
				transcriptionsRestored: 2,
				collationsRestored: 0,
				transcriptionCheckpointsRestored: 0,
				collationCheckpointsRestored: 0,
				tombstonesRestored: 0,
				quarantinedFiles: [],
				orphanedFiles: [],
			},
		});
		worker.emit({ type: 'db:index-verified' });
		worker.emit({ id: worker.request('rebuild-damaged-index')!.id!, ok: true });

		expect(notificationCenter.items.map(item => item.id)).toContain('local-db-index-rebuilt');
		expect(session.get('apatosaurus:index-verified')).toBe('true');
		expect(workers).toHaveLength(1);
		expect(reload).not.toHaveBeenCalled();
		unregisterFailing();
		unregisterEditor();
	});

	it('hides the progress card and offers reload or reset when the repair fails', async () => {
		await ensureLocalDbRuntime();
		const worker = workers[0];
		worker.requests = [];

		worker.emit({ type: 'db:index-damaged', details: ['row 3 missing from index'] });
		await vi.waitFor(() => expect(worker.request('rebuild-damaged-index')).toBeDefined());
		worker.emit({ type: 'db:index-rebuild-progress', done: 2, total: 4 });
		worker.emit({
			id: worker.request('rebuild-damaged-index')!.id!,
			ok: false,
			error: 'Unable to remove damaged index files',
		});

		await vi.waitFor(() =>
			expect(
				notificationCenter.items.find(item => item.id === 'local-db-runtime-init-failed')
			).toMatchObject({
				title: 'Local database repair failed',
				message: 'Unable to remove damaged index files',
				actions: [{ id: 'reload' }, { id: 'reset' }],
			})
		);
		expect(indexRebuildProgress.total).toBe(0);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(reload).not.toHaveBeenCalled();
	});
});
