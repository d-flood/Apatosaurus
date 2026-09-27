import type { IndexRebuildReport } from './repositories/index-rebuild';
import type { PersistenceWarning } from './repositories/revisions';
import type { DbApi } from './api';

export type DbValue = string | number | boolean | null | Uint8Array;
export type DbRow = Record<string, unknown>;

export type DbInvalidationDomain =
	| 'transcriptions'
	| 'projects'
	| 'collations'
	| 'iiif'
	| 'sync-targets'
	| 'reference-editions'
	| 'all';

export type DbMethod = keyof DbApi;

type DbSystemRequest =
	| { type: 'init' }
	| { type: 'checkpoint' }
	| { type: 'query'; sql: string; params?: DbValue[] }
	| { type: 'execute'; sql: string; params?: DbValue[] };

export type DbRequestPayload = DbSystemRequest | { method: DbMethod; args: unknown[] };

export type DbRequest = DbRequestPayload & { id?: number };

export type DbResponse =
	{ id: number; ok: true; result?: unknown } | { id: number; ok: false; error: string };

export type DbInvalidationEvent = {
	type: 'db:invalidate';
	domain: string;
};

type DbWarningsEvent = {
	type: 'db:warnings';
	warnings: PersistenceWarning[];
};

export type DbIndexRebuiltEvent = {
	type: 'db:index-rebuilt';
	reason: 'open-failed' | 'integrity-failed';
	details: string[];
	report: IndexRebuildReport;
};

export type DbWorkerMessage =
	DbResponse | DbInvalidationEvent | DbWarningsEvent | DbIndexRebuiltEvent;
