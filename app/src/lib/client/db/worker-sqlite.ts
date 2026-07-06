import SQLiteESMFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs';
import wasmUrl from '@journeyapps/wa-sqlite/dist/wa-sqlite.wasm?url';
import { OPFSCoopSyncVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js';
import * as SQLite from '@journeyapps/wa-sqlite';

import type { DbRow, DbValue } from './rpc';
import { INDEX_DATABASE_FILENAME, INDEX_DATABASE_PATH, INDEX_VFS_NAME } from './schema-version.generated';

type SQLiteApi = ReturnType<typeof SQLite.Factory>;

export interface OpenIndexDatabaseResult {
	created: boolean;
}

export class LocalSqliteDatabase {
	private sqlite: SQLiteApi | null = null;
	private db: number | null = null;
	private vfs: { close?: () => Promise<void> | void } | null = null;

	async open(): Promise<OpenIndexDatabaseResult> {
		if (this.sqlite && this.db !== null) return { created: false };
		const openStartedAt = now();
		const existed = await indexDatabaseFileExists(INDEX_DATABASE_PATH);
		const module = await timeSqliteStep('module load', () =>
			SQLiteESMFactory({
				locateFile(path: string) {
					return path.endsWith('.wasm') ? wasmUrl : path;
				},
			})
		);
		this.sqlite = SQLite.Factory(module);
		this.vfs = (await timeSqliteStep('VFS creation', () => this.createVfs(module))) as {
			close?: () => Promise<void> | void;
		};
		this.sqlite.vfs_register(this.vfs as never, true);
		this.db = await timeSqliteStep('open_v2', () =>
			this.sqlite!.open_v2(INDEX_DATABASE_PATH)
		);
		await timeSqliteStep('PRAGMAs', async () => {
			await this.exec('PRAGMA foreign_keys = ON');
			await this.exec('PRAGMA busy_timeout = 250');
			await this.exec('PRAGMA journal_mode = WAL');
			await this.exec('PRAGMA synchronous = NORMAL');
		});
		console.debug('[local-db] SQLite database opened', {
			build: 'wa-sqlite',
			vfs: INDEX_VFS_NAME,
			filename: INDEX_DATABASE_FILENAME,
			path: INDEX_DATABASE_PATH,
			created: !existed,
			elapsedMs: elapsed(openStartedAt),
		});
		return { created: !existed };
	}

	async close(): Promise<void> {
		if (this.sqlite && this.db !== null) await this.sqlite.close(this.db);
		if (this.vfs?.close) await this.vfs.close();
		this.sqlite = null;
		this.db = null;
		this.vfs = null;
	}

	async query(sql: string, params: DbValue[] = []): Promise<DbRow[]> {
		this.assertOpen();
		const rows: DbRow[] = [];
		const statement = await this.sqlite!.statements(this.db!, sql);
		try {
			for await (const prepared of statement) {
				this.bind(prepared, params);
				const columns = this.sqlite!.column_names(prepared);
				while ((await this.sqlite!.step(prepared)) === SQLite.SQLITE_ROW) {
					rows.push(rowArrayToObject(columns, this.sqlite!.row(prepared)));
				}
			}
		} finally {
			// wa-sqlite finalizes statements after the async iterator completes.
		}
		return rows;
	}

	async execute(sql: string, params: DbValue[] = []): Promise<{ changes: number }> {
		this.assertOpen();
		const statement = await this.sqlite!.statements(this.db!, sql);
		try {
			for await (const prepared of statement) {
				this.bind(prepared, params);
				while ((await this.sqlite!.step(prepared)) === SQLite.SQLITE_ROW) {
					// Drain accidental RETURNING rows.
				}
			}
		} finally {
			// wa-sqlite finalizes statements after the async iterator completes.
		}
		return { changes: await this.sqlite!.changes(this.db!) };
	}

	async exec(sql: string): Promise<void> {
		this.assertOpen();
		await this.sqlite!.exec(this.db!, sql);
	}

	async transaction(statements: Array<{ sql: string; params?: DbValue[] }>): Promise<void> {
		await this.exec('BEGIN');
		try {
			for (const statement of statements)
				await this.execute(statement.sql, statement.params ?? []);
			await this.exec('COMMIT');
		} catch (error) {
			await this.exec('ROLLBACK').catch(() => undefined);
			throw error;
		}
	}

	private async createVfs(module: unknown) {
		if (
			typeof navigator === 'undefined' ||
			typeof navigator.storage?.getDirectory !== 'function'
		) {
			throw new Error(
				'Local transcription database requires sync OPFS storage in a dedicated browser worker. This browser does not expose OPFS storage.'
			);
		}
		console.debug('[local-db] selecting SQLite VFS', {
			build: 'wa-sqlite',
			vfs: 'OPFSCoopSyncVFS',
		});
		return (
			OPFSCoopSyncVFS as never as {
				create: (name: string, module: unknown) => Promise<unknown>;
			}
		).create(INDEX_VFS_NAME, module);
	}

	private bind(statement: number, params: DbValue[]) {
		this.sqlite!.bind_collection(statement, params as never);
	}

	private assertOpen() {
		if (!this.sqlite || this.db === null) throw new Error('Local SQLite database is not open.');
	}
}

async function indexDatabaseFileExists(path: string): Promise<boolean> {
	if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function')
		return false;
	try {
		const segments = path.split('/').filter(Boolean);
		const filename = segments.pop();
		if (!filename) return false;
		let directory = await navigator.storage.getDirectory();
		for (const segment of segments) {
			directory = await directory.getDirectoryHandle(segment, { create: false });
		}
		await directory.getFileHandle(filename, { create: false });
		return true;
	} catch (error) {
		if (isNotFoundError(error)) return false;
		throw error;
	}
}

function isNotFoundError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		(error as { name?: unknown }).name === 'NotFoundError'
	);
}

function rowArrayToObject(columns: string[], values: unknown[]): DbRow {
	return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
}

async function timeSqliteStep<T>(label: string, step: () => Promise<T> | T): Promise<T> {
	const startedAt = now();
	try {
		const result = await step();
		console.debug(`[local-db] SQLite ${label} completed`, { elapsedMs: elapsed(startedAt) });
		return result;
	} catch (error) {
		console.error(`[local-db] SQLite ${label} failed`, {
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
