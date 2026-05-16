import AsyncSQLiteESMFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs';
import asyncWasmUrl from '@journeyapps/wa-sqlite/dist/wa-sqlite-async.wasm?url';
import { IDBBatchAtomicVFS } from '@journeyapps/wa-sqlite/src/examples/IDBBatchAtomicVFS.js';
import { OPFSAnyContextVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSAnyContextVFS.js';
import * as SQLite from '@journeyapps/wa-sqlite';

import type { DbRow, DbValue } from './rpc';

type SQLiteApi = ReturnType<typeof SQLite.Factory>;

const DB_FILENAME = 'apatosaurus-local-v1.db';
const OPFS_VFS_NAME = 'apatosaurus-local-v1-opfs';
const IDB_VFS_NAME = 'apatosaurus-local-v1-idb';

export class LocalSqliteDatabase {
	private sqlite: SQLiteApi | null = null;
	private db: number | null = null;
	private vfs: { close?: () => Promise<void> | void } | null = null;

	async open(): Promise<void> {
		if (this.sqlite && this.db !== null) return;
		const module = await AsyncSQLiteESMFactory({
			locateFile(path: string) {
				return path.endsWith('.wasm') ? asyncWasmUrl : path;
			},
		});
		this.sqlite = SQLite.Factory(module);
		this.vfs = (await this.createVfs(module)) as { close?: () => Promise<void> | void };
		this.sqlite.vfs_register(this.vfs as never, true);
		this.db = await this.sqlite.open_v2(DB_FILENAME);
		await this.exec('PRAGMA foreign_keys = ON');
		await this.exec('PRAGMA busy_timeout = 250');
		await this.exec('PRAGMA journal_mode = WAL');
		await this.exec('PRAGMA synchronous = NORMAL');
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
			for (const statement of statements) await this.execute(statement.sql, statement.params ?? []);
			await this.exec('COMMIT');
		} catch (error) {
			await this.exec('ROLLBACK').catch(() => undefined);
			throw error;
		}
	}

	private async createVfs(module: unknown) {
		if (typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function') {
			try {
				return await (OPFSAnyContextVFS as never as { create: (name: string, module: unknown) => Promise<unknown> }).create(OPFS_VFS_NAME, module);
			} catch (error) {
				console.warn('[local-db] OPFS SQLite VFS unavailable; falling back to IndexedDB', error);
			}
		}
		return (IDBBatchAtomicVFS as never as { create: (name: string, module: unknown) => Promise<unknown> }).create(IDB_VFS_NAME, module);
	}

	private bind(statement: number, params: DbValue[]) {
		this.sqlite!.bind_collection(statement, params as never);
	}

	private assertOpen() {
		if (!this.sqlite || this.db === null) throw new Error('Local SQLite database is not open.');
	}
}

function rowArrayToObject(columns: string[], values: unknown[]): DbRow {
	return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
}
