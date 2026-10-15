import type { Kysely, Selectable } from 'kysely';

import { createStoreOnlyZip } from '$lib/backup/project-zip-export';
import { nativeCommands } from '$lib/cbgm/cbgm-native';
import type { CollationDocument } from '$lib/collation/collation-document';
import { hashCanonicalPayload } from '$lib/storage/canonical-json';
import {
	CBGM_ANALYSIS_FORMAT,
	collationPayloadToContent,
	readCanonicalDocument,
	serializeCanonicalDocument,
	type CbgmAnalysisCollation,
	type CbgmAnalysisMetadata,
	type CbgmAnalysisSettings,
	type CbgmCoherenceState,
	type CbgmComputingDevice,
	type CbgmGlobalStemmaState,
	type CbgmUndecidedReading,
} from '$lib/storage/formats';
import { cbgmAnalysisFiles, cbgmAnalysisRelativeFiles } from '$lib/storage/layout';
import {
	readFileBytes,
	readTextFile,
	writeFileBytesAtomic,
	writeTextFileAtomic,
	type StoreOperationOptions,
} from '$lib/storage/opfs-store';
import { readDeviceIdentity } from '$lib/storage/device-identity';
import { effectiveAuthorName } from '$lib/backup/version-author';

import type { CbgmAnalyses, Database } from '../types.generated';
import type { DbExecutor } from '../worker-kysely';
import { loadCommittedCollationPayloadWithFiles } from './collation-files';
import { createId } from './id';
import { withProjectWriteLock } from './project-locks';

export type CbgmAnalysisRow = Selectable<CbgmAnalyses>;

export interface CreateCbgmAnalysisInput {
	name: string;
	settings: CbgmAnalysisSettings;
	collations: CbgmAnalysisCollation[];
	witnesses: string[];
	undecidedReadings: CbgmUndecidedReading[];
	inputTei: string;
	coherence: Extract<CbgmCoherenceState, 'computing' | 'awaiting-import'>;
	id?: string;
}

export interface CbgmCollationSnapshot {
	collationId: string;
	title: string;
	segmentName: string;
	contentHash: string;
	document: CollationDocument;
}

export interface CbgmCollationSnapshots {
	collations: CbgmCollationSnapshot[];
	unavailable: { collationId: string; title: string; message: string }[];
}

export interface CbgmCurrentCollationHashes {
	hashes: Record<string, string>;
	unavailable: string[];
}

interface AnalysisLocation {
	projectId: string;
	storageSlug: string;
}

export async function createAnalysis(
	db: Kysely<Database>,
	projectId: string,
	input: CreateCbgmAnalysisInput,
	storeOptions: StoreOperationOptions = {}
): Promise<CbgmAnalysisMetadata> {
	return withProjectWriteLock(projectId, async () => {
		const project = await db
			.selectFrom('projects')
			.select('storage_slug')
			.where('id', '=', projectId)
			.executeTakeFirst();
		if (!project) throw new Error(`Project ${projectId} was not found.`);
		const name = input.name.trim();
		if (!name) throw new Error('A CBGM analysis needs a name.');
		const existing = await db
			.selectFrom('cbgm_analyses')
			.select('name')
			.where('project_id', '=', projectId)
			.execute();
		if (existing.some(row => nameKey(row.name) === nameKey(name))) {
			throw new Error(`This project already has a CBGM analysis named "${name}".`);
		}
		const metadata: CbgmAnalysisMetadata = {
			id: input.id ?? createId(),
			project_id: projectId,
			name,
			inputs_frozen_at: new Date().toISOString(),
			completed_at: null,
			settings: input.settings,
			collations: input.collations,
			witnesses: input.witnesses,
			undecided_readings: input.undecidedReadings,
			input_tei_hash: await hashBytes(input.inputTei),
			cache_hash: null,
			coherence: input.coherence,
			global_stemma: 'none',
			computing_device:
				input.coherence === 'computing' ? await thisDevice(projectId, storeOptions) : null,
			failure: null,
		};
		const files = cbgmAnalysisFiles(project.storage_slug, metadata.id);
		await writeTextFileAtomic(files.input, input.inputTei, storeOptions);
		await publishMetadata(db, project.storage_slug, metadata, storeOptions);
		return metadata;
	});
}

export async function completeCoherence(
	db: Kysely<Database>,
	projectId: string,
	analysisId: string,
	cache: Uint8Array,
	storeOptions: StoreOperationOptions = {}
): Promise<CbgmAnalysisMetadata> {
	return updateAnalysis(db, projectId, analysisId, storeOptions, async (metadata, files) => {
		await writeFileBytesAtomic(files.cache, cache, storeOptions);
		return {
			...metadata,
			cache_hash: await hashBytes(cache),
			coherence: 'ready',
			completed_at: new Date().toISOString(),
			computing_device: null,
			failure: null,
		};
	});
}

export async function failCoherence(
	db: Kysely<Database>,
	projectId: string,
	analysisId: string,
	failure: string,
	storeOptions: StoreOperationOptions = {}
): Promise<CbgmAnalysisMetadata> {
	return updateAnalysis(db, projectId, analysisId, storeOptions, async metadata => ({
		...metadata,
		coherence: 'failed',
		computing_device: null,
		failure,
	}));
}

export async function setGlobalStemmaState(
	db: Kysely<Database>,
	projectId: string,
	analysisId: string,
	state: CbgmGlobalStemmaState,
	cache?: Uint8Array,
	dot?: string,
	storeOptions: StoreOperationOptions = {}
): Promise<CbgmAnalysisMetadata> {
	if (state === 'ready' && !cache) {
		throw new Error('A ready global stemma needs the cache holding its substemmata.');
	}
	if (state === 'imported-dot' && dot === undefined) {
		throw new Error('An imported global stemma needs its DOT file.');
	}
	return updateAnalysis(db, projectId, analysisId, storeOptions, async (metadata, files) => {
		if (cache) await writeFileBytesAtomic(files.cache, cache, storeOptions);
		if (dot !== undefined) await writeTextFileAtomic(files.globalStemma, dot, storeOptions);
		return {
			...metadata,
			cache_hash: cache ? await hashBytes(cache) : metadata.cache_hash,
			global_stemma: state,
			computing_device:
				state === 'computing' ? await thisDevice(projectId, storeOptions) : null,
			failure: null,
		};
	});
}

export async function failGlobalStemma(
	db: Kysely<Database>,
	projectId: string,
	analysisId: string,
	failure: string,
	storeOptions: StoreOperationOptions = {}
): Promise<CbgmAnalysisMetadata> {
	return updateAnalysis(db, projectId, analysisId, storeOptions, async metadata => ({
		...metadata,
		global_stemma: 'none',
		computing_device: null,
		failure,
	}));
}

export async function readAnalysis(
	db: DbExecutor,
	analysisId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<CbgmAnalysisMetadata> {
	return readMetadata(await locateAnalysis(db, analysisId), analysisId, storeOptions);
}

export async function findAnalysis(
	db: DbExecutor,
	analysisId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<CbgmAnalysisMetadata | null> {
	const location = await findAnalysisLocation(db, analysisId);
	return location ? readMetadata(location, analysisId, storeOptions) : null;
}

export async function loadCollationSnapshots(
	db: Kysely<Database>,
	projectId: string,
	collationIds?: readonly string[],
	storeOptions: StoreOperationOptions = {}
): Promise<CbgmCollationSnapshots> {
	const rows = (
		await db
			.selectFrom('collations')
			.select(['id', 'title'])
			.where('project_id', '=', projectId)
			.where('conflict_of_collation_id', '=', '')
			.orderBy('sort_key', 'asc')
			.orderBy('title', 'asc')
			.orderBy('id', 'asc')
			.execute()
	).map(row => ({ id: row.id ?? '', title: row.title }));
	const chosen = collationIds ? rows.filter(row => collationIds.includes(row.id)) : rows;
	const missing = collationIds?.filter(id => !chosen.some(row => row.id === id)) ?? [];
	if (missing.length > 0) {
		throw new Error(`Collation ${missing.join(', ')} is not in project ${projectId}.`);
	}
	const results = await Promise.allSettled(
		chosen.map(async row => {
			const payload = await loadCommittedCollationPayloadWithFiles(db, row.id, storeOptions);
			return {
				collationId: payload.id,
				title: payload.title,
				segmentName: payload.document.setup.segment.name,
				contentHash: await hashCanonicalPayload(collationPayloadToContent(payload)),
				document: payload.document,
			};
		})
	);
	const snapshots: CbgmCollationSnapshots = { collations: [], unavailable: [] };
	results.forEach((result, index) => {
		if (result.status === 'fulfilled') {
			snapshots.collations.push(result.value);
		} else {
			snapshots.unavailable.push({
				collationId: chosen[index].id,
				title: chosen[index].title,
				message:
					result.reason instanceof Error ? result.reason.message : String(result.reason),
			});
		}
	});
	return snapshots;
}

export async function readCurrentCollationHashes(
	db: Kysely<Database>,
	projectId: string,
	collationIds: readonly string[],
	storeOptions: StoreOperationOptions = {}
): Promise<CbgmCurrentCollationHashes> {
	const result: CbgmCurrentCollationHashes = { hashes: {}, unavailable: [] };
	const ids = [...new Set(collationIds)];
	if (ids.length === 0) return result;
	const [indexed, tombstoned] = await Promise.all([
		db
			.selectFrom('collations')
			.select('id')
			.where('project_id', '=', projectId)
			.where('id', 'in', ids)
			.execute(),
		db
			.selectFrom('sync_tombstones')
			.select('entity_id')
			.where('project_id', '=', projectId)
			.where('entity_type', '=', 'collation')
			.where('entity_id', 'in', ids)
			.execute(),
	]);
	const indexedIds = new Set(indexed.map(row => row.id));
	const deletedIds = new Set(tombstoned.map(row => row.entity_id));
	await Promise.all(
		ids.map(async collationId => {
			if (!indexedIds.has(collationId)) {
				if (!deletedIds.has(collationId)) result.unavailable.push(collationId);
				return;
			}
			try {
				const payload = await loadCommittedCollationPayloadWithFiles(
					db,
					collationId,
					storeOptions
				);
				result.hashes[collationId] = await hashCanonicalPayload(
					collationPayloadToContent(payload)
				);
			} catch {
				result.unavailable.push(collationId);
			}
		})
	);
	return result;
}

export async function readCache(
	db: DbExecutor,
	analysisId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<Uint8Array | null> {
	const location = await locateAnalysis(db, analysisId);
	const metadata = await readMetadata(location, analysisId, storeOptions);
	if (!metadata.cache_hash) return null;
	const cache = await readFileBytes(
		cbgmAnalysisFiles(location.storageSlug, analysisId).cache,
		storeOptions
	);
	if ((await hashBytes(cache)) !== metadata.cache_hash) {
		throw new Error(`CBGM analysis ${analysisId} cache does not match its metadata.`);
	}
	return cache;
}

export async function readInputTei(
	db: DbExecutor,
	analysisId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<string> {
	const location = await locateAnalysis(db, analysisId);
	const metadata = await readMetadata(location, analysisId, storeOptions);
	const input = await readTextFile(
		cbgmAnalysisFiles(location.storageSlug, analysisId).input,
		storeOptions
	);
	if ((await hashBytes(input)) !== metadata.input_tei_hash) {
		throw new Error(`CBGM analysis ${analysisId} input does not match its metadata.`);
	}
	return input;
}

export async function readImportedGlobalStemma(
	db: DbExecutor,
	analysisId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<string> {
	const location = await locateAnalysis(db, analysisId);
	return readTextFile(
		cbgmAnalysisFiles(location.storageSlug, analysisId).globalStemma,
		storeOptions
	);
}

export async function exportNativeInputs(
	db: DbExecutor,
	analysisId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<{ fileName: string; bytes: Uint8Array }> {
	const metadata = await readAnalysis(db, analysisId, storeOptions);
	const encoder = new TextEncoder();
	return {
		fileName: `${metadata.name}.open-cbgm.zip`,
		bytes: createStoreOnlyZip([
			{
				path: 'input.xml',
				bytes: encoder.encode(await readInputTei(db, analysisId, storeOptions)),
			},
			{ path: 'commands.txt', bytes: encoder.encode(nativeCommands(metadata.settings)) },
		]),
	};
}

export async function listAnalyses(db: DbExecutor, projectId: string): Promise<CbgmAnalysisRow[]> {
	return db
		.selectFrom('cbgm_analyses')
		.selectAll()
		.where('project_id', '=', projectId)
		.orderBy('inputs_frozen_at', 'desc')
		.orderBy('id', 'asc')
		.execute();
}

export function cbgmAnalysisIndexRow(metadata: CbgmAnalysisMetadata): CbgmAnalysisRow {
	return {
		id: metadata.id,
		project_id: metadata.project_id,
		name: metadata.name,
		inputs_frozen_at: metadata.inputs_frozen_at,
		completed_at: metadata.completed_at,
		coherence: metadata.coherence,
		global_stemma: metadata.global_stemma,
		collation_ids: JSON.stringify(metadata.collations.map(entry => entry.collation_id)),
		witness_count: metadata.witnesses.length,
	};
}

async function updateAnalysis(
	db: Kysely<Database>,
	projectId: string,
	analysisId: string,
	storeOptions: StoreOperationOptions,
	update: (
		metadata: CbgmAnalysisMetadata,
		files: ReturnType<typeof cbgmAnalysisFiles>
	) => Promise<CbgmAnalysisMetadata>
): Promise<CbgmAnalysisMetadata> {
	return withProjectWriteLock(projectId, async () => {
		const location = await locateAnalysis(db, analysisId);
		if (location.projectId !== projectId) {
			throw new Error(`CBGM analysis ${analysisId} does not belong to project ${projectId}.`);
		}
		const metadata = await readMetadata(location, analysisId, storeOptions);
		const next = await update(metadata, cbgmAnalysisFiles(location.storageSlug, analysisId));
		await publishMetadata(db, location.storageSlug, next, storeOptions);
		return next;
	});
}

async function publishMetadata(
	db: Kysely<Database>,
	storageSlug: string,
	metadata: CbgmAnalysisMetadata,
	storeOptions: StoreOperationOptions
): Promise<void> {
	await writeTextFileAtomic(
		cbgmAnalysisFiles(storageSlug, metadata.id).metadata,
		await serializeCanonicalDocument(CBGM_ANALYSIS_FORMAT, metadata),
		storeOptions
	);
	const row = cbgmAnalysisIndexRow(metadata);
	await db
		.insertInto('cbgm_analyses')
		.values(row)
		.onConflict(oc => oc.column('id').doUpdateSet(row))
		.execute();
}

async function locateAnalysis(db: DbExecutor, analysisId: string): Promise<AnalysisLocation> {
	const location = await findAnalysisLocation(db, analysisId);
	if (!location) throw new Error(`CBGM analysis ${analysisId} was not found.`);
	return location;
}

async function findAnalysisLocation(
	db: DbExecutor,
	analysisId: string
): Promise<AnalysisLocation | null> {
	const row = await db
		.selectFrom('cbgm_analyses')
		.innerJoin('projects', 'projects.id', 'cbgm_analyses.project_id')
		.select(['cbgm_analyses.project_id as project_id', 'projects.storage_slug as storage_slug'])
		.where('cbgm_analyses.id', '=', analysisId)
		.executeTakeFirst();
	return row ? { projectId: row.project_id, storageSlug: row.storage_slug } : null;
}

async function readMetadata(
	location: AnalysisLocation,
	analysisId: string,
	storeOptions: StoreOperationOptions
): Promise<CbgmAnalysisMetadata> {
	const raw = await readTextFile(
		cbgmAnalysisFiles(location.storageSlug, analysisId).metadata,
		storeOptions
	);
	const result = await readCanonicalDocument<CbgmAnalysisMetadata>(CBGM_ANALYSIS_FORMAT, raw, {
		projectPath: cbgmAnalysisRelativeFiles(analysisId).metadata,
		projectId: location.projectId,
	});
	if (!result.ok) {
		throw new Error(`CBGM analysis ${analysisId} is unreadable: ${result.quarantine.message}`);
	}
	return result.payload;
}

async function thisDevice(
	projectId: string,
	storeOptions: StoreOperationOptions
): Promise<CbgmComputingDevice> {
	const { deviceId, deviceName } = await readDeviceIdentity(storeOptions);
	return {
		device_id: deviceId,
		author_name: (await effectiveAuthorName(projectId, storeOptions)) ?? deviceName,
	};
}

function nameKey(name: string): string {
	return name.trim().toLocaleLowerCase();
}

async function hashBytes(content: string | Uint8Array): Promise<string> {
	const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
	const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
	return `sha256:${[...new Uint8Array(digest)]
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('')}`;
}
