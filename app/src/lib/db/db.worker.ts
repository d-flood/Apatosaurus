import type { DbInvalidationDomain, DbRequest, DbResponse } from './rpc';
import { dbApi, type DbApiContext } from './api';
import type { PersistenceWarning } from './repositories/revisions';
import { rebuildIndexFromStore } from './repositories/index-rebuild';
import { cleanStaleProjectImportStaging } from '$lib/backup/project-zip-import';
import { cleanupStaleIndexFiles, removeCurrentIndexFiles } from './index-files';
import type { Database } from './types.generated';
import { createWorkerKysely } from './worker-kysely';
import { LocalSqliteDatabase, type OpenIndexDatabaseResult } from './worker-sqlite';
import { createCurrentIndexSchema } from './worker-schema';
import { upgradeAlphaProjects, markAlphaUpgradesIndexed } from '$lib/storage/alpha-project-upgrade';
import type { Kysely } from 'kysely';

const db = new LocalSqliteDatabase();
let kyselyDb: Kysely<Database> | null = null;
let initialized = false;
let requestQueue = Promise.resolve();

type IndexStartupRebuildReason = 'missing' | 'open-failed' | 'integrity-failed';

interface IndexStartupOpenResult extends OpenIndexDatabaseResult {
	rebuildReason: IndexStartupRebuildReason | null;
	rebuildDetails: string[];
}

self.onmessage = async (event: MessageEvent<DbRequest>) => {
	const request = event.data;
	const receivedAt = now();
	requestQueue = requestQueue.then(
		() => processRequest(request, receivedAt),
		() => processRequest(request, receivedAt)
	);
};

async function processRequest(request: DbRequest, receivedAt: number): Promise<void> {
	const startedAt = now();
	const queueWaitMs = elapsed(receivedAt);
	try {
		const result = await handleRequest(request);
		postResponse({ id: request.id ?? 0, ok: true, result });
	} catch (error) {
		console.error('[local-db] worker request failed', {
			type: requestLabel(request),
			id: request.id,
			queueWaitMs,
			handlerMs: elapsed(startedAt),
			error: error instanceof Error ? error.message : String(error),
		});
		postResponse({
			id: request.id ?? 0,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function handleRequest(request: DbRequest): Promise<unknown> {
	await init();
	if ('method' in request) {
		const method = dbApi[request.method] as (
			context: DbApiContext,
			...args: unknown[]
		) => Promise<unknown>;
		return method(apiContext(), ...request.args);
	}
	if (request.type === 'query') return db.query(request.sql, request.params ?? []);
	if (request.type === 'execute') return db.execute(request.sql, request.params ?? []);
	if (request.type === 'checkpoint') await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
	return null;
}

function apiContext(): DbApiContext {
	return {
		db: getKyselyDb(),
		invalidate: (...domains: DbInvalidationDomain[]) => {
			for (const domain of domains) postMessage({ type: 'db:invalidate', domain });
		},
		warn: (warnings: PersistenceWarning[]) => {
			if (warnings.length) postMessage({ type: 'db:warnings', warnings });
		},
	};
}

async function init(): Promise<void> {
	if (initialized) return;
	const startedAt = now();
	await timeWorkerStep('stale import cleanup', () => cleanStaleProjectImportStaging());
	const openResult = await timeWorkerStep('db.open', () => openIndexDatabaseForStartup());
	if (openResult.created) {
		await timeWorkerStep('schema create', () => createCurrentIndexSchema(db));
	}
	kyselyDb = timeWorkerStepSync('kysely init', () => createWorkerKysely(db));
	const upgradedAlpha = await upgradeAlphaProjects();
	if (openResult.created || upgradedAlpha) {
		const report = await rebuildIndex();
		if (upgradedAlpha) await markAlphaUpgradesIndexed();
		console.info('[local-db] index rebuilt from document store', report);
		if (openResult.rebuildReason && openResult.rebuildReason !== 'missing') {
			postMessage({
				type: 'db:index-rebuilt',
				reason: openResult.rebuildReason,
				details: openResult.rebuildDetails,
				report,
			});
		}
		try {
			const cleanupReport = await timeWorkerStep('stale index cleanup', () =>
				cleanupStaleIndexFiles()
			);
			if (cleanupReport.removedPaths.length > 0) {
				console.info('[local-db] stale index files removed', cleanupReport);
			}
			if (cleanupReport.failedPaths.length > 0) {
				console.warn('[local-db] stale index file cleanup incomplete', cleanupReport);
			}
		} catch (error) {
			console.warn('[local-db] stale index file cleanup failed', error);
		}
	}
	initialized = true;
	console.debug('[local-db] worker init completed', { elapsedMs: elapsed(startedAt) });
}

async function openIndexDatabaseForStartup(): Promise<IndexStartupOpenResult> {
	let openResult: OpenIndexDatabaseResult;
	try {
		openResult = await db.open();
	} catch (error) {
		const message = errorMessage(error);
		console.warn('[local-db] SQLite index open failed; rebuilding from files', {
			error: message,
		});
		await replaceCurrentIndexDatabase();
		return { created: true, rebuildReason: 'open-failed', rebuildDetails: [message] };
	}
	if (openResult.created) return { ...openResult, rebuildReason: 'missing', rebuildDetails: [] };

	const integrity = await checkIndexIntegrity();
	if (integrity.ok) return { ...openResult, rebuildReason: null, rebuildDetails: [] };

	console.warn('[local-db] SQLite index integrity check failed; rebuilding from files', {
		details: integrity.details,
	});
	await replaceCurrentIndexDatabase();
	return { created: true, rebuildReason: 'integrity-failed', rebuildDetails: integrity.details };
}

async function checkIndexIntegrity(): Promise<{ ok: true } | { ok: false; details: string[] }> {
	try {
		const rows = await db.query('PRAGMA integrity_check');
		const details = rows.flatMap(row => Object.values(row).map(value => String(value)));
		if (details.length === 1 && details[0].toLowerCase() === 'ok') return { ok: true };
		return {
			ok: false,
			details: details.length ? details : ['integrity_check returned no rows'],
		};
	} catch (error) {
		return { ok: false, details: [errorMessage(error)] };
	}
}

async function replaceCurrentIndexDatabase(): Promise<void> {
	await db.close().catch(error => {
		console.warn('[local-db] failed to close damaged index before replacement', error);
	});
	kyselyDb = null;
	const removalReport = await timeWorkerStep('current index removal', () =>
		removeCurrentIndexFiles()
	);
	if (removalReport.failedPaths.length > 0) {
		throw new Error(
			`Unable to remove damaged index files: ${removalReport.failedPaths
				.map(failure => `${failure.path}: ${failure.error}`)
				.join('; ')}`
		);
	}
	await db.open();
}

async function rebuildIndex() {
	return timeWorkerStep('index rebuild', () => rebuildIndexFromStore(getKyselyDb()));
}

function getKyselyDb(): Kysely<Database> {
	if (!kyselyDb) kyselyDb = createWorkerKysely(db);
	return kyselyDb;
}

function postResponse(response: DbResponse): void {
	postMessage(response);
}

function requestLabel(request: DbRequest): string {
	return 'method' in request ? request.method : request.type;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function timeWorkerStep<T>(label: string, step: () => Promise<T>): Promise<T> {
	const startedAt = now();
	try {
		const result = await step();
		console.debug(`[local-db] worker ${label} completed`, { elapsedMs: elapsed(startedAt) });
		return result;
	} catch (error) {
		console.error(`[local-db] worker ${label} failed`, {
			elapsedMs: elapsed(startedAt),
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

function timeWorkerStepSync<T>(label: string, step: () => T): T {
	const startedAt = now();
	try {
		const result = step();
		console.debug(`[local-db] worker ${label} completed`, { elapsedMs: elapsed(startedAt) });
		return result;
	} catch (error) {
		console.error(`[local-db] worker ${label} failed`, {
			elapsedMs: elapsed(startedAt),
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

function now(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function elapsed(startedAt: number): number {
	return Math.round(now() - startedAt);
}
