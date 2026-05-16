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
	await db.exec('PRAGMA foreign_keys = ON');
	await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		applied_at TEXT NOT NULL
	)`);
	const rows = await db.query('SELECT version FROM schema_migrations');
	const applied = new Set(rows.map((row) => Number(row.version)));
	for (const migration of LOCAL_DB_MIGRATIONS) {
		if (applied.has(migration.version)) continue;
		const sql = MIGRATION_SQL.get(migration.version);
		if (!sql) throw new Error(`Missing SQL for local DB migration ${migration.version}`);
		await db.exec('BEGIN');
		try {
			await db.exec(sql);
			await db.execute(
				'INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
				[migration.version, migration.name, new Date().toISOString()]
			);
			await db.exec('COMMIT');
		} catch (error) {
			await db.exec('ROLLBACK').catch(() => undefined);
			throw error;
		}
	}
}
