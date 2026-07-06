import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function applyCurrentSchema(db: Database.Database): void {
	db.pragma('foreign_keys = ON');
	const schemaPath = join(process.cwd(), 'src/lib/client/db/migrations/0001_initial.sql');
	db.exec(readFileSync(schemaPath, 'utf8'));
}
