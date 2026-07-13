import type { Kysely } from 'kysely';

import {
	rebuildIndexFromStore,
	type IndexRebuildReport,
} from '$lib/client/db/repositories/index-rebuild';
import type { Database } from '$lib/client/db/types.generated';
import {
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_FORMAT,
	PROJECT_MANIFEST_CURRENT_VERSION,
	PROJECT_TRANSCRIPTION_FORMAT,
	TOMBSTONE_FORMAT,
	WORKING_COLLATION_FORMAT,
	WORKING_TRANSCRIPTION_FORMAT,
	collationDocumentToTei,
	deleteDirectory,
	deleteFile,
	joinStorePath,
	listDirectory,
	projectFolder,
	readTextFile,
	serializeCanonicalDocument,
	transcriptionDocumentToTei,
	withDocumentStoreWriterLock,
	writeTextFileAtomic,
	type CollationCheckpointPayload,
	type CollationPayload,
	type JsonObject,
	type ProjectManifestPayload,
	type ProjectTranscriptionPayload,
	type StoreOperationOptions,
	type StoreQuarantineRecord,
	type TombstonePayload,
	type WorkingCollationPayload,
	type WorkingTranscriptionPayload,
} from '$lib/client/store';
import { hashCanonicalPayload } from './canonical-json';
import {
	PROJECT_IMPORT_LEASE_FILE,
	PROJECT_IMPORT_STAGING_ROOT,
	stageAndValidateProjectFiles,
	type ValidatedStagedProjectEntry,
} from './project-file-staging';

export type ProjectZipImportCollisionMode = 'replace' | 'copy';

interface ImportLockManager {
	request<T>(name: string, callback: () => Promise<T>): Promise<T>;
	request<T>(
		name: string,
		options: { ifAvailable: true },
		callback: (lock: unknown | null) => Promise<T>
	): Promise<T>;
}

export interface ProjectImportOptions {
	collisionMode?: ProjectZipImportCollisionMode;
	storeOptions?: StoreOperationOptions;
	nonce?: () => string;
	now?: () => Date;
	ownerId?: string;
	lockManager?: ImportLockManager | null;
}

export type ProjectZipImportOptions = ProjectImportOptions;

export interface ProjectImportCollision {
	projectId: string;
	localUpdatedAt: string;
	importedUpdatedAt: string;
}

export interface ProjectImportResult extends IndexRebuildReport {
	ok: boolean;
	projectId: string;
	storageSlug: string;
	mode: 'created' | 'replaced' | 'copied';
	draftFilesRestored: string[];
	collision?: ProjectImportCollision;
}

export type ProjectZipImportResult = ProjectImportResult;

export interface ReadableProjectImportFile {
	path: string;
	read: () => Promise<string>;
}

export type ReadableProjectFileTree =
	| Iterable<ReadableProjectImportFile>
	| AsyncIterable<ReadableProjectImportFile>;

export interface StagedProjectValidation {
	stagingPath: string;
	entries: ValidatedStagedProjectEntry[];
	manifest: ProjectManifestPayload | null;
	report: Pick<IndexRebuildReport, 'quarantinedFiles' | 'orphanedFiles'>;
	cleanup(): Promise<void>;
}

interface PreparedImport {
	entries: ValidatedStagedProjectEntry[];
	manifest: ProjectManifestPayload;
	storageSlug: string;
	mode: ProjectImportResult['mode'];
}

const STAGING_MAX_IDLE_MS = 60 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

export async function importProjectZip(
	db: Kysely<Database>,
	bytes: Uint8Array,
	options: ProjectZipImportOptions = {}
): Promise<ProjectZipImportResult> {
	try {
		const files = parseStoreOnlyZip(bytes).map(entry => ({
			path: entry.path,
			read: async () => entry.content,
		}));
		return await importProjectFileTree(db, files, options);
	} catch (error) {
		return failedImport([quarantine('', errorMessage(error), options.now)]);
	}
}

export async function stageAndValidateProjectFileTree(
	files: ReadableProjectFileTree,
	options: ProjectImportOptions = {}
): Promise<StagedProjectValidation> {
	const nonce = (options.nonce ?? createNonce)();
	const releaseLock = await acquireImportLease(importLeaseName(nonce), options);
	const candidates = [];
	try {
		for await (const file of files)
			candidates.push({ path: file.path, content: await file.read() });
		const staged = await stageAndValidateProjectFiles(candidates, {
			requireManifest: true,
			storeOptions: options.storeOptions,
			nonce: () => nonce,
			now: options.now,
			ownerId: options.ownerId,
		});
		const heartbeat = startHeartbeat(staged.stagingPath, options);
		return {
			stagingPath: staged.stagingPath,
			entries: staged.entries,
			manifest: staged.manifest,
			report: { quarantinedFiles: staged.quarantinedFiles, orphanedFiles: [] },
			cleanup: async () => {
				heartbeat.stop();
				try {
					await staged.cleanup();
				} finally {
					releaseLock();
				}
			},
		};
	} catch (error) {
		releaseLock();
		throw error;
	}
}

export async function importProjectFileTree(
	db: Kysely<Database>,
	files: ReadableProjectFileTree,
	options: ProjectImportOptions = {}
): Promise<ProjectImportResult> {
	const nonce = (options.nonce ?? createNonce)();
	const staged = await stageAndValidateProjectFileTree(files, { ...options, nonce: () => nonce });
	try {
		if (staged.report.quarantinedFiles.length || !staged.manifest)
			return failedImport(staged.report.quarantinedFiles);
		const prepared = await prepareImport(db, staged, options);
		if ('collision' in prepared) return collisionImport(prepared.collision);
		return await placePreparedImport(db, prepared, options.storeOptions ?? {});
	} catch (error) {
		return failedImport([quarantine('', errorMessage(error), options.now)]);
	} finally {
		await staged.cleanup();
	}
}

export async function cleanStaleProjectImportStaging(
	storeOptions: StoreOperationOptions = {},
	options: Pick<ProjectImportOptions, 'now' | 'lockManager'> = {}
): Promise<void> {
	let directories;
	try {
		directories = (await listDirectory(PROJECT_IMPORT_STAGING_ROOT, storeOptions)).filter(
			entry => entry.kind === 'directory'
		);
	} catch (error) {
		if (isMissingStoreEntryError(error)) return;
		throw error;
	}
	const now = (options.now?.() ?? new Date()).getTime();
	for (const directory of directories) {
		let lease: { heartbeat_at?: string; created_at?: string };
		try {
			lease = JSON.parse(
				await readTextFile(
					joinStorePath(directory.path, PROJECT_IMPORT_LEASE_FILE),
					storeOptions
				)
			);
		} catch {
			continue;
		}
		const lastActive = Date.parse(lease.heartbeat_at ?? lease.created_at ?? '');
		if (!Number.isFinite(lastActive) || now - lastActive <= STAGING_MAX_IDLE_MS) continue;
		const locks = resolveLockManager(options.lockManager);
		if (!locks) {
			await deleteDirectoryIfExists(directory.path, storeOptions);
			continue;
		}
		await locks.request(importLeaseName(directory.name), { ifAvailable: true }, async lock => {
			if (lock) await deleteDirectoryIfExists(directory.path, storeOptions);
		});
	}
}

async function prepareImport(
	db: Kysely<Database>,
	staged: StagedProjectValidation,
	options: ProjectImportOptions
): Promise<PreparedImport | { collision: ProjectImportCollision }> {
	const manifest = staged.manifest!;
	const existing = await db
		.selectFrom('projects')
		.select(['storage_slug', 'updated_at'])
		.where('id', '=', manifest.id)
		.executeTakeFirst();
	if (!existing)
		return {
			entries: staged.entries,
			manifest,
			storageSlug: deriveStorageSlug(manifest.name, manifest.id),
			mode: 'created',
		};
	if (!options.collisionMode) {
		return {
			collision: {
				projectId: manifest.id,
				localUpdatedAt: existing.updated_at,
				importedUpdatedAt: manifest.updated_at,
			},
		};
	}
	if (options.collisionMode === 'replace')
		return {
			entries: staged.entries,
			manifest,
			storageSlug: existing.storage_slug,
			mode: 'replaced',
		};
	return copyProjectEntries(staged.entries, manifest);
}

async function copyProjectEntries(
	entries: ValidatedStagedProjectEntry[],
	sourceManifest: ProjectManifestPayload
): Promise<PreparedImport> {
	const copyId = createId();
	const copyName = `${sourceManifest.name} Copy`;
	const payloads = new Map(
		entries.flatMap(entry =>
			entry.payload ? [[entry.path, structuredClone(entry.payload)] as const] : []
		)
	);
	const collationHashes = new Map<string, string>();

	for (const entry of entries) {
		const payload = payloads.get(entry.path);
		if (entry.format === PROJECT_TRANSCRIPTION_FORMAT) {
			const transcription = payload as ProjectTranscriptionPayload;
			transcription.origin = {
				source_type: 'imported_project_copy',
				source_project_id: sourceManifest.id,
				source_transcription_id: transcription.id,
				source_revision_id: transcription.current_revision.id,
				source_content_hash: transcription.current_revision.content_hash,
			};
		} else if (entry.format === WORKING_TRANSCRIPTION_FORMAT) {
			const transcription = payload as WorkingTranscriptionPayload;
			transcription.origin = {
				source_type: 'imported_project_copy',
				source_project_id: sourceManifest.id,
				source_transcription_id: transcription.id,
				source_revision_id: transcription.draft.base_revision_id,
				source_content_hash: transcription.draft.base_content_hash,
			};
		} else if (entry.format === COLLATION_FORMAT || entry.format === WORKING_COLLATION_FORMAT) {
			const collation = payload as CollationPayload | WorkingCollationPayload;
			collation.project_id = copyId;
			collation.document.meta = {
				...collation.document.meta,
				projectId: copyId,
				projectName: copyName,
			};
		} else if (entry.format === COLLATION_CHECKPOINT_FORMAT) {
			const checkpoint = payload as CollationCheckpointPayload;
			checkpoint.payload.project_id = copyId;
			checkpoint.payload.document.meta = {
				...checkpoint.payload.document.meta,
				projectId: copyId,
				projectName: copyName,
			};
			checkpoint.payload_content_hash = await hashCanonicalPayload(checkpoint.payload);
		} else if (entry.format === TOMBSTONE_FORMAT) {
			(payload as TombstonePayload).project_id = copyId;
		}
	}

	for (const entry of entries.filter(entry => entry.format === COLLATION_FORMAT)) {
		const collation = payloads.get(entry.path) as CollationPayload;
		collation.current_revision.content_hash = await hashCanonicalPayload(
			collationContent(collation)
		);
		collationHashes.set(collation.id, collation.current_revision.content_hash);
	}
	for (const entry of entries.filter(entry => entry.format === WORKING_COLLATION_FORMAT)) {
		const working = payloads.get(entry.path) as WorkingCollationPayload;
		const hash = collationHashes.get(working.id);
		if (hash) working.draft.base_content_hash = hash;
	}

	const manifest = structuredClone(sourceManifest);
	manifest.id = copyId;
	manifest.name = copyName;
	manifest.forked_from = {
		source_project_id: sourceManifest.id,
		source_manifest_content_hash: String(
			(
				JSON.parse(entries.find(entry => entry.path === 'project.json')!.content) as {
					content_hash: string;
				}
			).content_hash
		),
		source_manifest_schema_version: PROJECT_MANIFEST_CURRENT_VERSION,
	};
	for (const head of manifest.collations) {
		if (head.current_revision)
			head.current_revision.content_hash =
				collationHashes.get(head.collation_id) ?? head.current_revision.content_hash;
	}
	for (const head of manifest.tombstones) {
		const payload = payloads.get(head.primary_path) as TombstonePayload | undefined;
		if (payload) head.content_hash = await hashCanonicalPayload(payload);
	}
	manifest.manifest_content_hash = await hashCanonicalPayload({
		project_id: copyId,
		transcriptions: manifest.transcriptions,
		collations: manifest.collations,
		tombstones: manifest.tombstones,
	});
	payloads.set('project.json', manifest);

	// Entity, revision, and checkpoint IDs intentionally remain stable: a copied project is a new
	// project container with lineage, not a fork of every historical identity.
	const rewritten: ValidatedStagedProjectEntry[] = [];
	for (const entry of entries) {
		if (entry.format === null) continue;
		const payload = payloads.get(entry.path)!;
		rewritten.push({
			...entry,
			payload,
			content: await serializeCanonicalDocument(entry.format, payload),
		});
	}
	for (const entry of rewritten.filter(entry => entry.format === PROJECT_TRANSCRIPTION_FORMAT)) {
		const payload = entry.payload as ProjectTranscriptionPayload;
		rewritten.push({
			path: `transcriptions/${payload.project_transcription_id}.tei.xml`,
			content: transcriptionDocumentToTei(payload),
			format: null,
		});
	}
	for (const entry of rewritten.filter(entry => entry.format === COLLATION_FORMAT)) {
		const payload = entry.payload as CollationPayload;
		rewritten.push({
			path: `collations/${payload.id}.tei.xml`,
			content: collationDocumentToTei(payload.document),
			format: null,
		});
	}
	return {
		entries: rewritten,
		manifest,
		storageSlug: deriveStorageSlug(copyName, copyId),
		mode: 'copied',
	};
}

async function placePreparedImport(
	db: Kysely<Database>,
	prepared: PreparedImport,
	storeOptions: StoreOperationOptions
): Promise<ProjectImportResult> {
	return withDocumentStoreWriterLock(async lockedOptions => {
		const targetFolder = projectFolder(prepared.storageSlug);
		const oldFiles = await readDirectoryFiles(targetFolder, lockedOptions);
		const newPaths = new Set(prepared.entries.map(entry => entry.path));
		try {
			for (const entry of manifestLast(prepared.entries)) {
				await writeTextFileAtomic(
					joinStorePath(targetFolder, entry.path),
					entry.content,
					lockedOptions
				);
			}
			for (const path of oldFiles.keys()) {
				if (!newPaths.has(path))
					await deleteFile(joinStorePath(targetFolder, path), lockedOptions);
			}
			const report = await rebuildIndexFromStore(db, lockedOptions);
			if (report.quarantinedFiles.length)
				throw new Error('Imported project failed index rebuild validation.');
			return {
				ok: true,
				projectId: prepared.manifest.id,
				storageSlug: prepared.storageSlug,
				mode: prepared.mode,
				draftFilesRestored: prepared.entries
					.filter(entry => entry.path.endsWith('.working.json'))
					.map(entry => entry.path)
					.sort(),
				...report,
			};
		} catch (error) {
			await deleteDirectoryIfExists(targetFolder, lockedOptions);
			for (const [path, content] of oldFiles)
				await writeTextFileAtomic(
					joinStorePath(targetFolder, path),
					content,
					lockedOptions
				);
			await rebuildIndexFromStore(db, lockedOptions);
			throw error;
		}
	}, storeOptions);
}

function manifestLast(entries: ValidatedStagedProjectEntry[]): ValidatedStagedProjectEntry[] {
	return [...entries].sort(
		(left, right) =>
			Number(left.path === 'project.json') - Number(right.path === 'project.json')
	);
}

async function readDirectoryFiles(
	path: string,
	storeOptions: StoreOperationOptions
): Promise<Map<string, string>> {
	const files = new Map<string, string>();
	async function visit(folder: string, relative = ''): Promise<void> {
		let entries;
		try {
			entries = await listDirectory(folder, storeOptions);
		} catch (error) {
			if (isMissingStoreEntryError(error)) return;
			throw error;
		}
		for (const entry of entries) {
			const childRelative = joinStorePath(relative, entry.name);
			if (entry.kind === 'directory') await visit(entry.path, childRelative);
			else files.set(childRelative, await readTextFile(entry.path, storeOptions));
		}
	}
	await visit(path);
	return files;
}

function startHeartbeat(stagingPath: string, options: ProjectImportOptions): { stop(): void } {
	const storeOptions = options.storeOptions ?? {};
	const update = async () => {
		try {
			const path = joinStorePath(stagingPath, PROJECT_IMPORT_LEASE_FILE);
			const lease = JSON.parse(await readTextFile(path, storeOptions));
			lease.heartbeat_at = (options.now?.() ?? new Date()).toISOString();
			await writeTextFileAtomic(path, JSON.stringify(lease), storeOptions);
		} catch {
			/* Import cleanup or failure owns the lease lifecycle. */
		}
	};
	const timer = setInterval(() => void update(), HEARTBEAT_INTERVAL_MS);
	return { stop: () => clearInterval(timer) };
}

async function acquireImportLease(
	name: string,
	options: ProjectImportOptions
): Promise<() => void> {
	const locks = resolveLockManager(options.lockManager);
	if (!locks) return () => undefined;
	let release!: () => void;
	let acquired!: () => void;
	const acquiredPromise = new Promise<void>(resolve => {
		acquired = resolve;
	});
	const releasePromise = new Promise<void>(resolve => {
		release = resolve;
	});
	void locks.request(name, async () => {
		acquired();
		await releasePromise;
	});
	await acquiredPromise;
	return release;
}

function resolveLockManager(
	configured: ImportLockManager | null | undefined
): ImportLockManager | null {
	if (configured === null) return null;
	return (
		configured ??
		(globalThis.navigator?.locks as unknown as ImportLockManager | undefined) ??
		null
	);
}

function importLeaseName(nonce: string): string {
	return `apatosaurus:project-import:${nonce}`;
}

function collationContent(payload: CollationPayload): JsonObject {
	return {
		id: payload.id,
		project_id: payload.project_id,
		title: payload.title,
		verse_identifier: payload.verse_identifier,
		status: payload.status,
		group_path: payload.group_path,
		notes: payload.notes,
		sort_key: payload.sort_key,
		document: payload.document,
	};
}

function parseStoreOnlyZip(bytes: Uint8Array): Array<{ path: string; content: string }> {
	const decoder = new TextDecoder();
	const entries = [];
	let offset = 0;
	while (offset + 30 <= bytes.length) {
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
		if (view.getUint32(0, true) !== 0x04034b50) break;
		if (view.getUint16(8, true) !== 0)
			throw new Error('Only stored zip entries are supported.');
		const size = view.getUint32(18, true);
		const pathLength = view.getUint16(26, true);
		const extraLength = view.getUint16(28, true);
		const pathStart = offset + 30;
		const contentStart = pathStart + pathLength + extraLength;
		if (contentStart + size > bytes.length)
			throw new Error('ZIP entry extends beyond the archive.');
		entries.push({
			path: decoder.decode(bytes.slice(pathStart, pathStart + pathLength)),
			content: decoder.decode(bytes.slice(contentStart, contentStart + size)),
		});
		offset = contentStart + size;
	}
	return entries;
}

function collisionImport(collision: ProjectImportCollision): ProjectImportResult {
	return {
		...emptyReport(),
		ok: false,
		projectId: collision.projectId,
		storageSlug: '',
		mode: 'created',
		draftFilesRestored: [],
		collision,
	};
}

function failedImport(quarantinedFiles: StoreQuarantineRecord[]): ProjectImportResult {
	return {
		...emptyReport(),
		ok: false,
		projectId: '',
		storageSlug: '',
		mode: 'created',
		draftFilesRestored: [],
		quarantinedFiles,
	};
}

function emptyReport(): IndexRebuildReport {
	return {
		projectsRestored: 0,
		transcriptionsRestored: 0,
		collationsRestored: 0,
		transcriptionCheckpointsRestored: 0,
		collationCheckpointsRestored: 0,
		tombstonesRestored: 0,
		quarantinedFiles: [],
		orphanedFiles: [],
	};
}

async function deleteDirectoryIfExists(
	path: string,
	storeOptions: StoreOperationOptions
): Promise<void> {
	try {
		await deleteDirectory(path, { ...storeOptions, recursive: true });
	} catch (error) {
		if (!isMissingStoreEntryError(error)) throw error;
	}
}

function quarantine(path: string, message: string, now?: () => Date): StoreQuarantineRecord {
	return {
		path,
		code: 'invalid_shape',
		message,
		timestamp: (now?.() ?? new Date()).toISOString(),
	};
}

function deriveStorageSlug(name: string, id: string): string {
	const base =
		name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'project';
	return `${base}-${id.slice(0, 8).toLowerCase()}`;
}

function createId(): string {
	return (
		globalThis.crypto?.randomUUID?.() ?? `project-${Math.random().toString(36).slice(2, 10)}`
	);
}
function createNonce(): string {
	return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 14);
}
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
function isMissingStoreEntryError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException)
		return error.name === 'NotFoundError';
	return error instanceof Error && /not found/i.test(error.message);
}
