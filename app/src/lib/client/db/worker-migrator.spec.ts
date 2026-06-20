import { describe, expect, it } from 'vitest';

import { applyLocalDbMigrations } from './worker-migrator';
import type { DbRow, DbValue } from './rpc';

class InMemoryMigrationDb {
	private tables = new Set<string>();
	private migrationVersions = new Set<number>();

	async exec(sql: string): Promise<void> {
		if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(sql))
			this.tables.add('schema_migrations');
	}

	async query(sql: string): Promise<DbRow[]> {
		if (/SELECT version FROM schema_migrations/i.test(sql)) {
			return [...this.migrationVersions].map(version => ({ version }));
		}
		return [];
	}

	async execute(sql: string, params: DbValue[] = []): Promise<{ changes: number }> {
		if (/INSERT OR IGNORE INTO schema_migrations/i.test(sql)) {
			const version = Number(params[0]);
			const hadVersion = this.migrationVersions.has(version);
			this.migrationVersions.add(version);
			return { changes: hadVersion ? 0 : 1 };
		}
		return { changes: 0 };
	}
}

describe('applyLocalDbMigrations', () => {
	it('does not fail when the initial migration records itself before the marker insert', async () => {
		const db = new InMemoryMigrationDb();

		await expect(applyLocalDbMigrations(db)).resolves.toBeUndefined();
	});
});
