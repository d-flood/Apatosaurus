import initialMigrationSql from './migrations/0001_initial.sql?raw';
import type { DbRow, DbValue } from './rpc';
import { LOCAL_DB_MIGRATIONS } from './schema-version.generated';

interface MigrationDatabase {
	exec(sql: string): Promise<void>;
	query(sql: string): Promise<DbRow[]>;
	execute(sql: string, params?: DbValue[]): Promise<{ changes: number }>;
}

const MIGRATION_SQL = new Map<number, string>([[1, initialMigrationSql]]);

export async function applyLocalDbMigrations(db: MigrationDatabase): Promise<void> {
	const startedAt = now();
	await timeMigrationStep('PRAGMA foreign_keys', () => db.exec('PRAGMA foreign_keys = ON'));
	await timeMigrationStep('schema_migrations create', () => db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		applied_at TEXT NOT NULL
	)`));
	const rows = await timeMigrationStep('schema_migrations select', () => db.query('SELECT version FROM schema_migrations'));
	const applied = new Set(rows.map((row) => Number(row.version)));
	for (const migration of LOCAL_DB_MIGRATIONS) {
		if (applied.has(migration.version)) {
			console.debug('[local-db] migration skipped', { version: migration.version, name: migration.name });
			continue;
		}
		const sql = MIGRATION_SQL.get(migration.version);
		if (!sql) throw new Error(`Missing SQL for local DB migration ${migration.version}`);
		const migrationStartedAt = now();
		await db.exec('BEGIN');
		try {
			await db.exec(sql);
			await db.execute(
				'INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
				[migration.version, migration.name, new Date().toISOString()]
			);
			await db.exec('COMMIT');
			console.debug('[local-db] migration applied', {
				version: migration.version,
				name: migration.name,
				elapsedMs: elapsed(migrationStartedAt),
			});
		} catch (error) {
			await db.exec('ROLLBACK').catch(() => undefined);
			throw error;
		}
	}
	console.debug('[local-db] migrations completed', { elapsedMs: elapsed(startedAt) });
}

async function timeMigrationStep<T>(label: string, step: () => Promise<T>): Promise<T> {
	const startedAt = now();
	try {
		const result = await step();
		console.debug(`[local-db] migration ${label} completed`, { elapsedMs: elapsed(startedAt) });
		return result;
	} catch (error) {
		console.error(`[local-db] migration ${label} failed`, {
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
