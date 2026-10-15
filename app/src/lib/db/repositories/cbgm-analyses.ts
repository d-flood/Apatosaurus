import type { Kysely, Selectable } from 'kysely';

import {
	CBGM_ANALYSIS_FORMAT,
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
		};
	});
}

export async function readAnalysis(
	db: DbExecutor,
	analysisId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<CbgmAnalysisMetadata> {
	return readMetadata(await locateAnalysis(db, analysisId), analysisId, storeOptions);
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
	const row = await db
		.selectFrom('cbgm_analyses')
		.innerJoin('projects', 'projects.id', 'cbgm_analyses.project_id')
		.select(['cbgm_analyses.project_id as project_id', 'projects.storage_slug as storage_slug'])
		.where('cbgm_analyses.id', '=', analysisId)
		.executeTakeFirst();
	if (!row) throw new Error(`CBGM analysis ${analysisId} was not found.`);
	return { projectId: row.project_id, storageSlug: row.storage_slug };
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
