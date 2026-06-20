import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function applyMigrations(db: Database.Database): void {
	db.pragma('foreign_keys = ON');
	const migrationsDir = join(process.cwd(), 'src/lib/client/db/migrations');
	const files = readdirSync(migrationsDir)
		.filter(file => file.endsWith('.sql'))
		.sort();
	for (const file of files) {
		const sql = readFileSync(join(migrationsDir, file), 'utf8');
		db.exec(sql);
	}
}
