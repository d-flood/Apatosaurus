import { createTranscriptionWithFilesResult } from '$lib/db/repositories/transcription-files';
import { createCollationWithFilesResult } from '$lib/db/repositories/collation-files';
import type { CreateTranscriptionInput } from '$lib/db/repositories/transcriptions';
import type { CreateCollationInput } from '$lib/db/repositories/collations';
import type { StoreOperationOptions } from '$lib/storage/opfs-store';
import BetterSqliteDatabase from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';

import { applyCurrentSchema } from '../../../scripts/db/apply-current-schema';
import type { Database } from '$lib/db/types.generated';

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

export async function createTranscriptionWithFiles(
	db: Kysely<Database>,
	input: CreateTranscriptionInput,
	storeOptions: StoreOperationOptions = {}
): Promise<string> {
	return (await createTranscriptionWithFilesResult(db, input, storeOptions)).value;
}

export async function createCollationWithFiles(
	db: Kysely<Database>,
	input: CreateCollationInput,
	storeOptions: StoreOperationOptions = {}
): Promise<string> {
	return (await createCollationWithFilesResult(db, input, storeOptions)).value;
}
