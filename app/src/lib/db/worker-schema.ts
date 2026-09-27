import currentSchemaSql from './migrations/0001_initial.sql?raw';

interface SchemaDatabase {
	exec(sql: string): Promise<void>;
}

export async function createCurrentIndexSchema(db: SchemaDatabase): Promise<void> {
	const startedAt = now();
	await timeSchemaStep('PRAGMA foreign_keys', () => db.exec('PRAGMA foreign_keys = ON'));
	await db.exec('BEGIN');
	try {
		await timeSchemaStep('current schema create', () => db.exec(currentSchemaSql));
		await db.exec('COMMIT');
		console.debug('[local-db] current index schema created', { elapsedMs: elapsed(startedAt) });
	} catch (error) {
		await db.exec('ROLLBACK').catch(() => undefined);
		throw error;
	}
}

async function timeSchemaStep<T>(label: string, step: () => Promise<T>): Promise<T> {
	const startedAt = now();
	try {
		const result = await step();
		console.debug(`[local-db] schema ${label} completed`, { elapsedMs: elapsed(startedAt) });
		return result;
	} catch (error) {
		console.error(`[local-db] schema ${label} failed`, {
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
