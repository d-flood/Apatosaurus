import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbRequest, DbWorkerMessage } from './rpc';

const sqlite = vi.hoisted(() => ({
	open: vi.fn(),
	close: vi.fn(),
	query: vi.fn(),
	execute: vi.fn(),
	exec: vi.fn(),
}));
const indexFiles = vi.hoisted(() => ({
	cleanupStaleIndexFiles: vi.fn(),
	removeCurrentIndexFiles: vi.fn(),
}));
const rebuildIndexFromStore = vi.hoisted(() => vi.fn());

vi.mock('./worker-sqlite', () => ({
	LocalSqliteDatabase: class {
		open = sqlite.open;
		close = sqlite.close;
		query = sqlite.query;
		execute = sqlite.execute;
		exec = sqlite.exec;
	},
}));
vi.mock('./index-files', () => indexFiles);
vi.mock('./repositories/index-rebuild', () => ({ rebuildIndexFromStore }));
vi.mock('./worker-schema', () => ({ createCurrentIndexSchema: async () => undefined }));
vi.mock('./worker-kysely', () => ({ createWorkerKysely: () => ({}) }));
vi.mock('./api', () => ({ dbApi: {}, unqueuedMethods: new Set(), backgroundMethods: new Set() }));
vi.mock('$lib/backup/project-zip-import', () => ({
	cleanStaleProjectImportStaging: async () => undefined,
}));
vi.mock('$lib/storage/legacy-json/alpha-project-upgrade', () => ({
	upgradeAlphaProjects: async () => false,
	markAlphaUpgradesIndexed: async () => undefined,
}));

const scope: { onmessage: ((event: { data: DbRequest }) => void) | null } = { onmessage: null };
const log: string[] = [];
const posted: DbWorkerMessage[] = [];

function post(request: DbRequest) {
	scope.onmessage!({ data: request });
}

function flush() {
	return new Promise(resolve => setImmediate(resolve));
}

function response(id: number) {
	return posted.find(message => 'id' in message && message.id === id);
}

async function startWorker() {
	vi.resetModules();
	await import('./db.worker');
	post({ id: 1, type: 'init', verifyIntegrity: true });
	await flush();
	expect(response(1)).toMatchObject({ ok: true });
}

describe('local database worker', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		vi.stubGlobal('self', scope);
		vi.stubGlobal('postMessage', (message: DbWorkerMessage) => {
			posted.push(message);
			log.push('id' in message ? `response ${message.id}` : message.type);
		});
		vi.spyOn(console, 'debug').mockImplementation(() => undefined);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		log.length = 0;
		posted.length = 0;
		vi.clearAllMocks();
		sqlite.open.mockResolvedValue({ created: false });
		sqlite.close.mockResolvedValue(undefined);
		sqlite.query.mockImplementation(async (sql: string) => {
			if (sql !== 'PRAGMA quick_check') return [];
			log.push('quick_check');
			return [{ quick_check: 'ok' }];
		});
		indexFiles.removeCurrentIndexFiles.mockResolvedValue({ removedPaths: [], failedPaths: [] });
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('defers quick_check until the queue stays quiet after the first page requests', async () => {
		await startWorker();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(log).not.toContain('quick_check');

		post({ id: 2, type: 'query', sql: 'SELECT 1' });
		await flush();
		expect(log).toEqual(['response 1', 'response 2']);

		await vi.advanceTimersByTimeAsync(600);
		post({ id: 3, type: 'query', sql: 'SELECT 2' });
		await flush();
		await vi.advanceTimersByTimeAsync(999);
		expect(log).not.toContain('quick_check');

		await vi.advanceTimersByTimeAsync(1);
		await flush();
		expect(log).toEqual([
			'response 1',
			'response 2',
			'response 3',
			'quick_check',
			'db:index-verified',
		]);
	});

	it('reports a failed quick_check to the page without rebuilding by itself', async () => {
		sqlite.query.mockResolvedValue([{ quick_check: 'row 3 missing from index' }]);
		await startWorker();
		post({ id: 2, type: 'query', sql: 'SELECT 1' });
		await flush();
		await vi.advanceTimersByTimeAsync(1_000);
		await flush();

		expect(posted).toContainEqual({
			type: 'db:index-damaged',
			details: ['row 3 missing from index'],
		});
		expect(sqlite.close).not.toHaveBeenCalled();
		expect(indexFiles.removeCurrentIndexFiles).not.toHaveBeenCalled();
		expect(rebuildIndexFromStore).not.toHaveBeenCalled();
	});

	it('answers a repair request that cannot replace the index with a failure', async () => {
		indexFiles.removeCurrentIndexFiles.mockResolvedValue({
			removedPaths: [],
			failedPaths: [{ path: 'index.sqlite3', error: 'locked' }],
		});
		await startWorker();

		post({ id: 2, type: 'rebuild-damaged-index', details: ['row 3 missing from index'] });
		await flush();

		expect(response(2)).toEqual({
			id: 2,
			ok: false,
			error: 'Unable to remove damaged index files: index.sqlite3: locked',
		});
		expect(rebuildIndexFromStore).not.toHaveBeenCalled();
	});
});
