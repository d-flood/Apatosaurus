import type { Kysely } from 'kysely';

import { rebuildIndexFromStore, type IndexRebuildReport } from '$lib/db/repositories/index-rebuild';
import type { Database } from '$lib/db/types.generated';
import {
	CBGM_ANALYSIS_FORMAT,
	TOMBSTONE_FORMAT,
	serializeCanonicalDocument,
	parseCollationTeiVersion,
	parseTranscriptionTei,
	projectManifestSchemaVersion,
	serializeCollationPayloadTei,
	serializeTranscriptionTei,
	type CbgmAnalysisMetadata,
	type ProjectManifestPayload,
	type TombstonePayload,
} from '$lib/storage/formats';
import {
	deleteDirectory,
	deleteFile,
	listDirectory,
	readTextFile,
	withDocumentStoreWriterLock,
	writeTextFileAtomic,
	type StoreOperationOptions,
} from '$lib/storage/opfs-store';
import { joinStorePath, projectFolder } from '$lib/storage/layout';
import {
	classifyDocumentPath,
	hasLegacyHeads,
	teiPrimaryPathsOfManifest,
} from '$lib/storage/document-files';
import {
	restoreUserReferenceEditions,
	validateStoredUserReferenceEdition,
} from '$lib/reference-editions/user-reference-editions';
import type { StoreQuarantineRecord } from '$lib/storage/quarantine';
import {
	markAlphaUpgradesIndexed,
	upgradeAlphaProjects,
} from '$lib/storage/legacy-json/alpha-project-upgrade';
import { parseProjectCollationSettings } from '$lib/collation/project-settings';
import { hashCanonicalPayload } from '$lib/storage/canonical-json';
import {
	isCbgmSidecarFile,
	projectFileText,
	readProjectFile,
	writeProjectFileAtomic,
	type ProjectFileContent,
} from './project-archive';
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

interface ProjectImportCollision {
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

export interface ReferenceEditionsRestoreResult {
	restored: number;
	skipped: number;
}

interface ReadableProjectImportFile {
	path: string;
	read: () => Promise<ProjectFileContent>;
}

export type ReadableProjectFileTree =
	Iterable<ReadableProjectImportFile> | AsyncIterable<ReadableProjectImportFile>;

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
	draftFilesRestored: string[];
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
			read: async () => entry.bytes,
		}));
		return await importProjectFileTree(db, files, options);
	} catch (error) {
		return failedImport([quarantine('', errorMessage(error), options.now)]);
	}
}

export async function restoreReferenceEditionsZip(
	bytes: Uint8Array,
	storeOptions: StoreOperationOptions = {}
): Promise<ReferenceEditionsRestoreResult> {
	const decoder = new TextDecoder();
	const entries = parseStoreOnlyZip(bytes).map(entry => ({
		path: entry.path,
		content: decoder.decode(entry.bytes),
	}));
	if (entries.length === 0) {
		throw new Error('Reference edition archive must contain at least one edition.');
	}
	const paths = new Set<string>();
	for (const entry of entries) {
		if (!/^reference-editions\/user-[a-f0-9]{64}\.json$/.test(entry.path)) {
			throw new Error(`Unexpected reference edition archive entry: ${entry.path}.`);
		}
		if (paths.has(entry.path)) throw new Error(`Duplicate archive path: ${entry.path}.`);
		paths.add(entry.path);
	}
	await Promise.all(
		entries.map(entry =>
			validateStoredUserReferenceEdition(
				entry.content,
				entry.path.slice('reference-editions/'.length, -'.json'.length)
			)
		)
	);
	return restoreUserReferenceEditions(
		entries.map(entry => entry.content),
		storeOptions
	);
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
		const result = await placePreparedImport(db, prepared, options.storeOptions ?? {});
		if (
			hasLegacyHeads(prepared.manifest) &&
			(await upgradeAlphaProjects(options.storeOptions, { rescan: true }))
		) {
			await rebuildIndexFromStore(db, options.storeOptions);
			await markAlphaUpgradesIndexed(options.storeOptions);
		}
		return result;
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
	const entries = staged.entries;
	const draftFilesRestored: string[] = [];
	const existing = await db
		.selectFrom('projects')
		.select(['storage_slug', 'updated_at'])
		.where('id', '=', manifest.id)
		.executeTakeFirst();
	if (!existing)
		return {
			entries,
			manifest,
			storageSlug: deriveStorageSlug(manifest.name, manifest.id),
			mode: 'created',
			draftFilesRestored,
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
			entries,
			manifest,
			storageSlug: existing.storage_slug,
			mode: 'replaced',
			draftFilesRestored,
		};
	if (hasLegacyHeads(manifest))
		throw new Error(
			'This archive predates TEI storage. Replace the project with it, open it once, then copy it.'
		);
	return {
		...(await copyProjectEntries(entries, manifest)),
		draftFilesRestored,
	};
}

async function copyProjectEntries(
	entries: ValidatedStagedProjectEntry[],
	sourceManifest: ProjectManifestPayload
): Promise<Omit<PreparedImport, 'draftFilesRestored'>> {
	const copyId = createId();
	const copyName = `${sourceManifest.name} Copy`;
	const payloads = new Map(
		entries.flatMap(entry =>
			entry.payload ? [[entry.path, structuredClone(entry.payload)] as const] : []
		)
	);
	const collationHashes = new Map<string, string>();
	const checkpointHashes = new Map<string, string>();

	for (const entry of entries) {
		const payload = payloads.get(entry.path);
		if (entry.format === TOMBSTONE_FORMAT) {
			(payload as TombstonePayload).project_id = copyId;
		} else if (entry.format === CBGM_ANALYSIS_FORMAT) {
			(payload as CbgmAnalysisMetadata).project_id = copyId;
		}
	}

	const collationVocab = parseProjectCollationSettings(sourceManifest.collation_settings);
	const sourceTeiPaths = teiPrimaryPathsOfManifest(sourceManifest);
	const copiedTei = new Map<string, string>();
	const copyTeiCollation = async (content: ProjectFileContent) => {
		const { payload, version } = parseCollationTeiVersion(projectFileText(content));
		payload.project_id = copyId;
		payload.document.meta = {
			...payload.document.meta,
			projectId: copyId,
			projectName: copyName,
		};
		return { payload, version };
	};
	// Versions first: a copied Current's based-on hash is its copied Version's hash.
	for (const entry of entries) {
		const file = classifyDocumentPath(entry.path, sourceTeiPaths);
		if (entry.format !== null || file?.kind !== 'collation' || file.role !== 'version')
			continue;
		const { payload, version } = await copyTeiCollation(entry.content);
		const serialized = await serializeCollationPayloadTei(payload, collationVocab, version);
		copiedTei.set(entry.path, serialized.xml);
		if (version) checkpointHashes.set(version.id, serialized.contentHash);
	}
	for (const entry of entries) {
		const file = classifyDocumentPath(entry.path, sourceTeiPaths);
		if (entry.format !== null || file?.kind !== 'collation' || file.role !== 'canonical')
			continue;
		const { payload } = await copyTeiCollation(entry.content);
		if (payload.based_on_checkpoint)
			payload.based_on_checkpoint.content_hash =
				checkpointHashes.get(payload.based_on_checkpoint.id) ??
				payload.based_on_checkpoint.content_hash;
		copiedTei.set(
			entry.path,
			(await serializeCollationPayloadTei(payload, collationVocab)).xml
		);
		if (payload.based_on_checkpoint)
			collationHashes.set(payload.id, payload.based_on_checkpoint.content_hash);
	}

	const manifest = structuredClone(sourceManifest);
	manifest.id = copyId;
	manifest.name = copyName;
	manifest.forked_from = {
		source_project_id: sourceManifest.id,
		source_manifest_content_hash: String(
			(
				JSON.parse(
					projectFileText(entries.find(entry => entry.path === 'project.json')!.content)
				) as {
					content_hash: string;
				}
			).content_hash
		),
		source_manifest_schema_version: projectManifestSchemaVersion(sourceManifest),
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

	// Copied IDs stay stable: new container, not a fork.
	const rewritten: ValidatedStagedProjectEntry[] = [];
	const teiPrimaryPaths = teiPrimaryPathsOfManifest(manifest);
	for (const entry of entries) {
		if (entry.format === null) {
			const file = classifyDocumentPath(entry.path, teiPrimaryPaths);
			const copied = copiedTei.get(entry.path);
			if (copied !== undefined) rewritten.push({ ...entry, content: copied });
			else if (file?.role === 'canonical' && file.kind === 'transcription') {
				const transcription = parseTranscriptionTei(projectFileText(entry.content));
				transcription.origin = {
					source_type: 'imported_project_copy',
					source_project_id: sourceManifest.id,
					source_transcription_id: transcription.id,
					source_revision_id: transcription.based_on_checkpoint?.id ?? null,
					source_content_hash: transcription.based_on_checkpoint?.content_hash ?? null,
				};
				rewritten.push({
					...entry,
					content: (await serializeTranscriptionTei(transcription)).xml,
				});
			} else if (isCbgmSidecarFile(entry.path) || file?.role === 'version')
				rewritten.push(entry);
			continue;
		}
		const payload = payloads.get(entry.path)!;
		rewritten.push({
			...entry,
			payload,
			content: await serializeCanonicalDocument(entry.format, payload),
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
				await writeProjectFileAtomic(
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
				draftFilesRestored: prepared.draftFilesRestored,
				...report,
			};
		} catch (error) {
			await deleteDirectoryIfExists(targetFolder, lockedOptions);
			for (const [path, content] of oldFiles)
				await writeProjectFileAtomic(
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
): Promise<Map<string, ProjectFileContent>> {
	const files = new Map<string, ProjectFileContent>();
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
			else
				files.set(
					childRelative,
					await readProjectFile(childRelative, entry.path, storeOptions)
				);
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
		} catch {}
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

function parseStoreOnlyZip(bytes: Uint8Array): Array<{ path: string; bytes: Uint8Array }> {
	if (bytes.length < 22) throw new Error('Input is not a ZIP archive.');
	const decoder = new TextDecoder();
	const entries: Array<{ path: string; bytes: Uint8Array; size: number; localOffset: number }> =
		[];
	const endOffset = bytes.length - 22;
	const endView = new DataView(bytes.buffer, bytes.byteOffset + endOffset, 22);
	if (endView.getUint32(0, true) !== 0x06054b50 || endView.getUint16(20, true) !== 0) {
		throw new Error('ZIP archive has a missing end record or trailing data.');
	}
	if (endView.getUint16(4, true) !== 0 || endView.getUint16(6, true) !== 0) {
		throw new Error('Multi-disk ZIP archives are not supported.');
	}
	const entryCount = endView.getUint16(10, true);
	if (endView.getUint16(8, true) !== entryCount) {
		throw new Error('ZIP archive entry count is inconsistent.');
	}
	const centralSize = endView.getUint32(12, true);
	const centralOffset = endView.getUint32(16, true);
	if (centralOffset + centralSize !== endOffset) {
		throw new Error('ZIP archive central directory is invalid.');
	}
	let offset = 0;
	while (offset < centralOffset) {
		const localOffset = offset;
		if (offset + 30 > centralOffset) throw new Error('ZIP local entry is truncated.');
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
		if (view.getUint32(0, true) !== 0x04034b50) {
			throw new Error('ZIP local entry is invalid.');
		}
		if (view.getUint16(8, true) !== 0)
			throw new Error('Only stored zip entries are supported.');
		const size = view.getUint32(18, true);
		const pathLength = view.getUint16(26, true);
		const extraLength = view.getUint16(28, true);
		const pathStart = offset + 30;
		const contentStart = pathStart + pathLength + extraLength;
		if (contentStart + size > centralOffset)
			throw new Error('ZIP entry extends beyond the archive.');
		entries.push({
			path: decoder.decode(bytes.slice(pathStart, pathStart + pathLength)),
			bytes: bytes.slice(contentStart, contentStart + size),
			size,
			localOffset,
		});
		offset = contentStart + size;
	}
	if (entries.length !== entryCount) throw new Error('ZIP archive entry count is inconsistent.');
	offset = centralOffset;
	for (const entry of entries) {
		if (offset + 46 > endOffset) throw new Error('ZIP central directory is truncated.');
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
		if (view.getUint32(0, true) !== 0x02014b50 || view.getUint16(10, true) !== 0) {
			throw new Error('ZIP central directory entry is invalid.');
		}
		const pathLength = view.getUint16(28, true);
		const extraLength = view.getUint16(30, true);
		const commentLength = view.getUint16(32, true);
		const nextOffset = offset + 46 + pathLength + extraLength + commentLength;
		if (nextOffset > endOffset) throw new Error('ZIP central directory entry is truncated.');
		const path = decoder.decode(bytes.slice(offset + 46, offset + 46 + pathLength));
		if (
			path !== entry.path ||
			view.getUint32(20, true) !== entry.size ||
			view.getUint32(24, true) !== entry.size ||
			view.getUint32(42, true) !== entry.localOffset
		) {
			throw new Error('ZIP central directory does not match its local entries.');
		}
		offset = nextOffset;
	}
	if (offset !== endOffset) throw new Error('ZIP central directory size is inconsistent.');
	return entries.map(({ path, bytes }) => ({ path, bytes }));
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
