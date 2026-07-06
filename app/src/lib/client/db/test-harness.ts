import BetterSqliteDatabase from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';

import { applyCurrentSchema } from '../../../../scripts/db/apply-current-schema';
import type { Database } from './types.generated';

export interface LocalDbTestHarness {
	db: Kysely<Database>;
	sqlite: BetterSqliteDatabase.Database;
	destroy: () => Promise<void>;
}

export function createLocalDbTestHarness(): LocalDbTestHarness {
	const sqlite = new BetterSqliteDatabase(':memory:');
	applyCurrentSchema(sqlite);
	const db = new Kysely<Database>({
		dialect: new SqliteDialect({ database: sqlite }),
	});

	return {
		db,
		sqlite,
		async destroy() {
			await db.destroy();
			sqlite.close();
		},
	};
}
