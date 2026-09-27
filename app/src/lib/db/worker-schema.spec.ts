import { describe, expect, it } from 'vitest';

import { createCurrentIndexSchema } from './worker-schema';

class InMemorySchemaDb {
	readonly statements: string[] = [];

	async exec(sql: string): Promise<void> {
		this.statements.push(sql);
	}
}

describe('createCurrentIndexSchema', () => {
	it('creates the current schema without migration bookkeeping', async () => {
		const db = new InMemorySchemaDb();

		await expect(createCurrentIndexSchema(db)).resolves.toBeUndefined();

		const executedSql = db.statements.join('\n');
		expect(db.statements).toContain('BEGIN');
		expect(db.statements).toContain('COMMIT');
		expect(executedSql).toContain('CREATE TABLE IF NOT EXISTS projects');
		expect(executedSql).toContain('CREATE TABLE IF NOT EXISTS transcriptions');
		expect(executedSql).not.toContain('schema_migrations');
	});
});
