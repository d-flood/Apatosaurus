import type { Database } from '../types.generated';
import { sql, type Kysely } from 'kysely';

type DbExecutor = Kysely<Database>;

export async function clearDomainTables(db: DbExecutor): Promise<string[]> {
	const result = await sql<{ name: string }>`
		SELECT name
		FROM sqlite_master
		WHERE type = 'table'
			AND name NOT LIKE 'sqlite_%'
			AND name <> 'schema_migrations'
		ORDER BY name
	`.execute(db);
	const tableNames = result.rows.map(row => row.name);

	if (tableNames.length === 0) return [];

	await db.transaction().execute(async trx => {
		for (const tableName of tableNames) {
			await sql.raw(`DELETE FROM ${quoteIdent(tableName)}`).execute(trx);
		}
	});

	return tableNames;
}

function quoteIdent(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}
