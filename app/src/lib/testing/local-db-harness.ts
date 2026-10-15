import { createTranscriptionWithFilesResult } from '$lib/db/repositories/transcription-files';
import { createCollationWithFilesResult } from '$lib/db/repositories/collation-files';
import { createAnalysis, type CreateCbgmAnalysisInput } from '$lib/db/repositories/cbgm-analyses';
import type { CbgmAnalysisMetadata } from '$lib/storage/formats';
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

export const CBGM_ANALYSIS_INPUT: CreateCbgmAnalysisInput = {
	id: 'analysis-1',
	name: 'Romans coherence',
	settings: {
		min_extant_units: null,
		min_extant_proportion: 0.5,
		excluded_witnesses: ['04'],
		classic_rules: false,
		merge_split_readings: true,
		dropped_reading_types: ['nonsense'],
		included_correctors: ['01*'],
	},
	collations: [
		{ collation_id: 'col-1', content_hash: 'sha256:col-1', segment_name: 'Romans 1:1' },
	],
	witnesses: ['01', '02', '03'],
	undecidedReadings: [{ unit: 'col-1-u1', reading: 'b' }],
	inputTei:
		'<?xml version="1.0" encoding="UTF-8"?>\n<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><app n="col-1-u1"/></body></text></TEI>\n',
	coherence: 'computing',
};

export async function createCbgmAnalysisWithFiles(
	db: Kysely<Database>,
	projectId: string,
	input: Partial<CreateCbgmAnalysisInput> = {},
	storeOptions: StoreOperationOptions = {}
): Promise<CbgmAnalysisMetadata> {
	return createAnalysis(db, projectId, { ...CBGM_ANALYSIS_INPUT, ...input }, storeOptions);
}
