import {
	Kysely,
	CompiledQuery,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
	type DatabaseConnection,
	type DatabaseIntrospector,
	type Dialect,
	type DialectAdapter,
	type Driver,
	type QueryCompiler,
	type QueryResult,
	type TransactionSettings,
} from 'kysely';

import type { Database } from './types.generated';
import type { LocalSqliteDatabase } from './worker-sqlite';

export function createWorkerKysely(sqlite: LocalSqliteDatabase): Kysely<Database> {
	return new Kysely<Database>({
		dialect: new WorkerSqliteDialect(sqlite),
	});
}

class WorkerSqliteDialect implements Dialect {
	constructor(private readonly sqlite: LocalSqliteDatabase) {}

	createDriver(): Driver {
		return new WorkerSqliteDriver(this.sqlite);
	}

	createQueryCompiler(): QueryCompiler {
		return new SqliteQueryCompiler();
	}

	createAdapter(): DialectAdapter {
		return new SqliteAdapter();
	}

	createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
		return new SqliteIntrospector(db);
	}
}

class WorkerSqliteDriver implements Driver {
	private readonly connection: DatabaseConnection;

	constructor(sqlite: LocalSqliteDatabase) {
		this.connection = new WorkerSqliteConnection(sqlite);
	}

	async init(): Promise<void> {}

	async acquireConnection(): Promise<DatabaseConnection> {
		return this.connection;
	}

	async beginTransaction(connection: DatabaseConnection, _settings: TransactionSettings): Promise<void> {
		await connection.executeQuery(CompiledQuery.raw('BEGIN'));
	}

	async commitTransaction(connection: DatabaseConnection): Promise<void> {
		await connection.executeQuery(CompiledQuery.raw('COMMIT'));
	}

	async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
		await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
	}

	async releaseConnection(_connection: DatabaseConnection): Promise<void> {}

	async destroy(): Promise<void> {}
}

class WorkerSqliteConnection implements DatabaseConnection {
	constructor(private readonly sqlite: LocalSqliteDatabase) {}

	async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
		const params = [...compiledQuery.parameters] as never[];
		if (returnsRows(compiledQuery.sql)) {
			const rows = await this.sqlite.query(compiledQuery.sql, params);
			return { rows: rows as R[] };
		}

		const { changes } = await this.sqlite.execute(compiledQuery.sql, params);
		const affectedRows = BigInt(changes);
		return {
			rows: [],
			numAffectedRows: affectedRows,
			numUpdatedOrDeletedRows: affectedRows,
			numUpdatedRows: affectedRows,
		} as QueryResult<R>;
	}

	async *streamQuery<R>(compiledQuery: CompiledQuery): AsyncIterableIterator<QueryResult<R>> {
		yield await this.executeQuery<R>(compiledQuery);
	}
}

function returnsRows(sql: string): boolean {
	return /^\s*(select|pragma|with)\b/i.test(sql) || /\breturning\b/i.test(sql);
}
