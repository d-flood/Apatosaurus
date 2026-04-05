import { createBrowserRuntime } from '../../../../djazzkit/packages/core/src/index';
import type { MigrationResolutionAction } from '../../../../djazzkit/packages/core/src/index';
import { CLIENT_MIGRATIONS } from '../../generated/migrations';
import { DDL_STATEMENTS, SCHEMA_REGISTRY, SCHEMA_VERSION } from '../../generated/schema';
import { migrationGate } from './migration-gate.svelte';
import { notificationCenter } from './notification-center.svelte';

// Bump this when introducing breaking local-schema changes so existing browser DBs reset cleanly.
const APP_SCHEMA_EPOCH = '2026-03-17-iiif-linking-v1';
// Temporary trigger to force the local runtime into the migration approval/reset flow.
const APP_SCHEMA_FORCE_RESET_PROMPT = '2026-03-17-force-reset-prompt-1';
// Bump this to force the browser to start a fresh worker instance after runtime-level fixes.
const APP_RUNTIME_CACHE_KEY = '2026-03-17-runtime-worker-refresh-1';
const HARD_RESET_FLAG = 'apatopwa:hard-local-db-reset-pending';
const OPFS_PREFIX = 'djazzkit';
const IDB_DATABASES = ['djazzkit-idb'];
const HARD_RESET_TIMEOUT_MS = 10000;
const RUNTIME_INIT_TIMEOUT_MS = 60000;
const RUNTIME_FAILURE_NOTIFICATION_ID = 'local-runtime-init-failed';
const RUNTIME_LOG_PREFIX = '[djazzkit-runtime]';
const APP_RUNTIME_SOURCE = 'apatopwa-app';

interface RuntimeAttemptInfo {
	attemptId: string;
	runtimeCacheKey: string;
	source: string;
	startedAt: string;
	pageUrl: string | null;
	hadPendingHardReset: boolean;
}

const browserRuntime = createBrowserRuntime({
	schemaVersion: `${SCHEMA_VERSION}+${APP_SCHEMA_FORCE_RESET_PROMPT}:${APP_SCHEMA_EPOCH}`,
	runtimeCacheKey: APP_RUNTIME_CACHE_KEY,
	getDebugInfo: () =>
		currentRuntimeAttempt
			? {
					attemptId: currentRuntimeAttempt.attemptId,
					runtimeCacheKey: currentRuntimeAttempt.runtimeCacheKey,
					source: currentRuntimeAttempt.source,
					startedAt: currentRuntimeAttempt.startedAt,
					pageUrl: currentRuntimeAttempt.pageUrl ?? undefined,
					hadPendingHardReset: currentRuntimeAttempt.hadPendingHardReset
				}
			: {
					runtimeCacheKey: APP_RUNTIME_CACHE_KEY,
					source: APP_RUNTIME_SOURCE
				},
	ddlStatements: DDL_STATEMENTS,
	clientMigrations: CLIENT_MIGRATIONS,
	allowDestructiveReset: true,
	schemaRegistry: SCHEMA_REGISTRY as any,
	backend: { mode: 'disabled' },
	defaultMode: 'local',
	onMigrationRequired: info => {
		logRuntime('warn', 'schema migration requires approval', {
			...runtimeAttemptContext(),
			currentSchemaVersion: info.currentSchemaVersion,
			targetSchemaVersion: info.targetSchemaVersion,
			pendingMigrationCount: info.pendingMigrations.length,
			reason: info.reason ?? null
		});
		migrationGate.present(info);
		notifyPendingMigration();
		return 'defer' satisfies MigrationResolutionAction;
	}
});

let initialized = false;
let initPromise: Promise<void> | null = null;
let currentRuntimeAttempt: RuntimeAttemptInfo | null = null;

export async function ensureDjazzkitRuntime(): Promise<void> {
	if (initialized) {
		logRuntime('debug', 'ensureDjazzkitRuntime reused initialized runtime', runtimeAttemptContext());
		return;
	}
	if (initPromise) {
		logRuntime('debug', 'ensureDjazzkitRuntime reused in-flight init promise', runtimeAttemptContext());
		return initPromise;
	}
	const attempt = createRuntimeAttempt();
	currentRuntimeAttempt = attempt;
	logRuntime('debug', 'ensureDjazzkitRuntime start', {
		...runtimeAttemptContext(attempt),
		schemaVersion: `${SCHEMA_VERSION}+${APP_SCHEMA_FORCE_RESET_PROMPT}:${APP_SCHEMA_EPOCH}`
	});
	initPromise = (async () => {
		if (typeof window !== 'undefined') {
			await runLoggedStep(
				'attempt pending hard reset',
				() =>
					withTimeout(
						runPendingHardReset(attempt),
						HARD_RESET_TIMEOUT_MS,
						'Timed out while clearing the pending local database reset.',
						() => {
							logRuntime('error', 'pending hard reset timed out', runtimeAttemptContext(attempt));
						}
					),
				attempt
			);
		}
		await runLoggedStep(
			'browserRuntime.init',
			() =>
				withTimeout(
					browserRuntime.init(),
					RUNTIME_INIT_TIMEOUT_MS,
					'Timed out while starting the local database runtime. Reload the app. If it still hangs, use Reset local DB from notifications.',
					() => {
						logRuntime('error', 'browserRuntime.init timed out', runtimeAttemptContext(attempt));
					}
				),
			attempt
		);
		initialized = true;
		notificationCenter.remove(RUNTIME_FAILURE_NOTIFICATION_ID);
		logRuntime('debug', 'local runtime initialized successfully', runtimeAttemptContext(attempt));
	})()
		.catch((error: unknown) => {
			initialized = false;
			logRuntime('error', 'local runtime initialization failed', {
				...runtimeAttemptContext(attempt),
				error: describeUnknownError(error)
			});
			reportRuntimeInitFailure(error);
			throw error;
		})
		.finally(() => {
			logRuntime('debug', 'ensureDjazzkitRuntime finished', runtimeAttemptContext(attempt));
			initPromise = null;
			if (currentRuntimeAttempt?.attemptId === attempt.attemptId) {
				currentRuntimeAttempt = null;
			}
		});
	return initPromise;
}

function reportRuntimeInitFailure(error: unknown): void {
	const runtimeError =
			error instanceof Error
				? error
				: new Error(typeof error === 'string' ? error : 'Local database startup failed.');
	logRuntime('error', 'reporting runtime init failure to UI', {
		...runtimeAttemptContext(),
		error: runtimeError.message
	});
	console.error('Failed to initialize local runtime:', runtimeError);
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
					if (typeof window === 'undefined') return;
					window.location.reload();
				}
			},
			{
				id: 'reset',
				label: 'Reset local DB',
				variant: 'error',
				onSelect: () => {
					requestHardLocalDbReset();
				}
			}
		]
	});
}

function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	message: string,
	onTimeout?: () => void
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeoutId = globalThis.setTimeout(() => {
			onTimeout?.();
			reject(new Error(message));
		}, timeoutMs);

		promise.then(
			value => {
				globalThis.clearTimeout(timeoutId);
				resolve(value);
			},
			error => {
				globalThis.clearTimeout(timeoutId);
				reject(error);
			}
		);
	});
}

function notifyPendingMigration(): void {
	logRuntime('warn', 'showing pending migration notification', runtimeAttemptContext());
	notificationCenter.upsert({
		id: 'schema-migration-required',
		title: 'Schema migration requires approval',
		message:
			'Your local database upgrade is waiting for approval. Until approved or reset, local-only mode remains active.',
		tone: 'warning',
		persistent: true,
		actions: [
			{
				id: 'review',
				label: 'Review',
				variant: 'secondary',
				onSelect: () => {
					migrationGate.reopen();
				}
			},
			{
				id: 'approve',
				label: 'Approve migration',
				variant: 'primary',
				onSelect: async () => {
					await resolvePendingMigration('approve');
				}
			},
			{
				id: 'reset',
				label: 'Reset local DB',
				variant: 'error',
				onSelect: async () => {
					requestHardLocalDbReset();
				}
			}
		]
	});
}

export async function resolvePendingMigration(
	action: MigrationResolutionAction
): Promise<{ applied: boolean; deferred: boolean }> {
	logRuntime('debug', 'resolvePendingMigration start', {
		...runtimeAttemptContext(),
		action
	});
	const result = await browserRuntime.resolveMigration(action);
	logRuntime('debug', 'resolvePendingMigration completed', {
		...runtimeAttemptContext(),
		action,
		applied: result.applied,
		deferred: result.deferred
	});
	if (result.applied) {
		notificationCenter.remove('schema-migration-required');
		migrationGate.clearInfo();
	} else if (result.deferred) {
		notifyPendingMigration();
	}
	return result;
}

export function deferPendingMigration(): void {
	migrationGate.dismiss();
}

export function requestHardLocalDbReset(): void {
	if (typeof window === 'undefined') return;
	logRuntime('warn', 'requesting hard local DB reset', {
		...runtimeAttemptContext(),
		hardResetFlag: HARD_RESET_FLAG
	});
	window.localStorage.setItem(HARD_RESET_FLAG, '1');
	window.location.reload();
}

async function runPendingHardReset(attempt: RuntimeAttemptInfo): Promise<void> {
	if (typeof window === 'undefined') return;
	if (window.localStorage.getItem(HARD_RESET_FLAG) !== '1') {
		logRuntime('debug', 'no pending hard reset detected', runtimeAttemptContext(attempt));
		return;
	}

	logRuntime('warn', 'pending hard reset detected', runtimeAttemptContext(attempt));

	try {
		await clearDjazzkitIndexedDb(attempt);
		await clearDjazzkitOpfs(attempt);
	} finally {
		window.localStorage.removeItem(HARD_RESET_FLAG);
		logRuntime('debug', 'cleared hard reset flag', runtimeAttemptContext(attempt));
	}
}

async function clearDjazzkitIndexedDb(attempt: RuntimeAttemptInfo): Promise<void> {
	if (typeof indexedDB === 'undefined') return;
	for (const name of IDB_DATABASES) {
		logRuntime('debug', 'deleting IndexedDB database', {
			...runtimeAttemptContext(attempt),
			databaseName: name
		});
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.deleteDatabase(name);
			request.onsuccess = () => {
				logRuntime('debug', 'deleted IndexedDB database', {
					...runtimeAttemptContext(attempt),
					databaseName: name
				});
				resolve();
			};
			request.onerror = () => {
				const error =
					request.error ?? new Error(`Failed to delete IndexedDB database ${name}.`);
				logRuntime('error', 'failed to delete IndexedDB database', {
					...runtimeAttemptContext(attempt),
					databaseName: name,
					error: error.message
				});
				reject(error);
			};
			request.onblocked = () => {
				const error = new Error(`Deleting IndexedDB database ${name} was blocked by another tab.`);
				logRuntime('warn', 'IndexedDB delete was blocked', {
					...runtimeAttemptContext(attempt),
					databaseName: name
				});
				reject(error);
			};
		});
	}
}

async function clearDjazzkitOpfs(attempt: RuntimeAttemptInfo): Promise<void> {
	if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return;
	const root = (await navigator.storage.getDirectory()) as FileSystemDirectoryHandle & {
		entries: () => AsyncIterable<[string, FileSystemHandle]>;
	};
	logRuntime('debug', 'enumerating OPFS entries for reset', runtimeAttemptContext(attempt));
	for await (const [name] of root.entries()) {
		if (!name.startsWith(OPFS_PREFIX)) continue;
		logRuntime('debug', 'removing OPFS entry', {
			...runtimeAttemptContext(attempt),
			entryName: name
		});
		await root.removeEntry(name, { recursive: true });
		logRuntime('debug', 'removed OPFS entry', {
			...runtimeAttemptContext(attempt),
			entryName: name
		});
	}
}

async function runLoggedStep<T>(
	label: string,
	step: () => Promise<T>,
	attempt: RuntimeAttemptInfo
): Promise<T> {
	const startedAt = Date.now();
	logRuntime('debug', `${label} start`, runtimeAttemptContext(attempt));
	try {
		const result = await step();
		logRuntime('debug', `${label} completed`, {
			...runtimeAttemptContext(attempt),
			elapsedMs: Date.now() - startedAt
		});
		return result;
	} catch (error) {
		logRuntime('error', `${label} failed`, {
			...runtimeAttemptContext(attempt),
			elapsedMs: Date.now() - startedAt,
			error: describeUnknownError(error)
		});
		throw error;
	}
}

function createRuntimeAttempt(): RuntimeAttemptInfo {
	return {
		attemptId: createAttemptId(),
		runtimeCacheKey: APP_RUNTIME_CACHE_KEY,
		source: APP_RUNTIME_SOURCE,
		startedAt: new Date().toISOString(),
		pageUrl: typeof window !== 'undefined' ? window.location.href : null,
		hadPendingHardReset:
			typeof window !== 'undefined' && window.localStorage.getItem(HARD_RESET_FLAG) === '1'
	};
}

function runtimeAttemptContext(attempt: RuntimeAttemptInfo | null = currentRuntimeAttempt): Record<string, unknown> {
	return {
		attemptId: attempt?.attemptId ?? null,
		runtimeCacheKey: attempt?.runtimeCacheKey ?? APP_RUNTIME_CACHE_KEY,
		source: attempt?.source ?? APP_RUNTIME_SOURCE,
		pageUrl: attempt?.pageUrl ?? (typeof window !== 'undefined' ? window.location.href : null),
		hadPendingHardReset: attempt?.hadPendingHardReset ?? false
	};
}

function createAttemptId(): string {
	const random = Math.random().toString(36).slice(2, 8);
	return `${Date.now()}-${random}`;
}

function logRuntime(
	level: 'debug' | 'warn' | 'error',
	message: string,
	details?: Record<string, unknown>
): void {
	const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.debug;
	if (details && Object.keys(details).length > 0) {
		logger(`${RUNTIME_LOG_PREFIX} ${message}`, details);
		return;
	}
	logger(`${RUNTIME_LOG_PREFIX} ${message}`);
}

function describeUnknownError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return typeof error === 'string' ? error : String(error);
}

export const runtime = {
	init: ensureDjazzkitRuntime,
	client: browserRuntime
};
