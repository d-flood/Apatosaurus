import { notificationCenter } from '$lib/client/notification-center.svelte';
import { attachLocalDbClient } from './client';
import { purgeLegacyDjazzkitStorage } from './legacy-djazzkit-purge';
import type { DbRequest, DbResponse } from './rpc';

const RUNTIME_FAILURE_NOTIFICATION_ID = 'local-db-runtime-init-failed';
const RUNTIME_INIT_TIMEOUT_MS = 60_000;

let worker: Worker | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;

export async function ensureLocalDbRuntime(): Promise<void> {
	if (initialized) return;
	if (initPromise) return initPromise;
	initPromise = (async () => {
		await purgeLegacyDjazzkitStorage();
		const dbWorker = getLocalDbWorker();
		await withTimeout(sendInit(dbWorker), RUNTIME_INIT_TIMEOUT_MS, 'Timed out while starting the local SQLite database.');
		initialized = true;
		notificationCenter.remove(RUNTIME_FAILURE_NOTIFICATION_ID);
	})().catch((error) => {
		initialized = false;
		reportRuntimeInitFailure(error);
		throw error;
	}).finally(() => {
		initPromise = null;
	});
	return initPromise;
}

export function getLocalDbWorker(): Worker {
	if (!worker) {
		worker = new Worker(new URL('./db.worker.ts', import.meta.url), { type: 'module' });
		attachLocalDbClient(worker);
	}
	return worker;
}

export async function checkpointLocalDb(): Promise<void> {
	await ensureLocalDbRuntime();
	await postWorkerMessage({ type: 'checkpoint' });
}

export async function resetLocalDb(): Promise<void> {
	await ensureLocalDbRuntime();
	await postWorkerMessage({ type: 'reset' });
	if (typeof window !== 'undefined') window.location.reload();
}

function reportRuntimeInitFailure(error: unknown): void {
	const runtimeError = error instanceof Error ? error : new Error(String(error));
	console.error('[local-db] local database failed to start', runtimeError);
	notificationCenter.upsert({
		id: RUNTIME_FAILURE_NOTIFICATION_ID,
		title: 'Local database failed to start',
		message: runtimeError.message,
		tone: 'error',
		persistent: true,
		actions: [
			{
				id: 'reload',
				label: 'Reload',
				variant: 'secondary',
				onSelect: () => {
					if (typeof window !== 'undefined') window.location.reload();
				},
			},
			{
				id: 'reset',
				label: 'Reset local DB',
				variant: 'error',
				onSelect: () => {
					void resetLocalDb();
				},
			},
		],
	});
}

function sendInit(dbWorker: Worker): Promise<void> {
	return new Promise((resolve, reject) => {
		const id = Date.now();
		const onMessage = (event: MessageEvent<DbResponse>) => {
			if (event.data.id !== id) return;
			dbWorker.removeEventListener('message', onMessage);
			if (event.data.ok) resolve();
			else reject(new Error(event.data.error));
		};
		dbWorker.addEventListener('message', onMessage);
		dbWorker.postMessage({ id, type: 'init' } satisfies DbRequest);
	});
}

function postWorkerMessage(payload: Omit<DbRequest, 'id'>): Promise<void> {
	const dbWorker = getLocalDbWorker();
	return new Promise((resolve, reject) => {
		const id = Date.now() + Math.floor(Math.random() * 1000);
		const onMessage = (event: MessageEvent<DbResponse>) => {
			if (event.data.id !== id) return;
			dbWorker.removeEventListener('message', onMessage);
			if (event.data.ok) resolve();
			else reject(new Error(event.data.error));
		};
		dbWorker.addEventListener('message', onMessage);
		dbWorker.postMessage({ id, ...payload });
	});
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timeoutId);
				resolve(value);
			},
			(error) => {
				clearTimeout(timeoutId);
				reject(error);
			}
		);
	});
}
