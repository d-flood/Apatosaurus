import type { Kysely } from 'kysely';

import { rebuildIndexFromStore, type IndexRebuildReport } from '$lib/client/db/repositories/index-rebuild';
import type { Database } from '$lib/client/db/types.generated';
import { hashCanonicalPayload } from '$lib/client/sync/canonical-json';
import {
	PROJECT_MANIFEST_FORMAT,
	PROJECT_TRANSCRIPTION_FORMAT,
	deleteDirectory,
	joinStorePath,
	moveFile,
	projectFolder,
	projectsFolder,
	readCanonicalDocument,
	readTextFile,
	sealDocument,
	writeTextFileAtomic,
	type JsonObject,
	type ProjectManifestPayload,
	type ProjectTranscriptionPayload,
	type StoreOperationOptions,
	type StoreQuarantineRecord,
} from '$lib/client/store';
import { normalizeProjectEntryPath, stageAndValidateProjectFiles } from './project-file-staging';

export type ProjectZipImportCollisionMode = 'replace' | 'copy';

export interface ProjectImportOptions {
	collisionMode?: ProjectZipImportCollisionMode;
	storeOptions?: StoreOperationOptions;
	nonce?: () => string;
}

export type ProjectZipImportOptions = ProjectImportOptions;

export interface ProjectImportResult extends IndexRebuildReport {
	ok: boolean;
	projectId: string;
	storageSlug: string;
	mode: 'created' | 'replaced' | 'copied';
}

export type ProjectZipImportResult = ProjectImportResult;

export interface ReadableProjectImportFile {
	path: string;
	read: () => Promise<string>;
}

export type ReadableProjectFileTree =
	| Iterable<ReadableProjectImportFile>
	| AsyncIterable<ReadableProjectImportFile>;

interface ImportEntry {
	path: string;
	content: string;
}

interface PreparedImport {
	entries: ImportEntry[];
	manifest: ProjectManifestPayload;
	storageSlug: string;
	mode: ProjectZipImportResult['mode'];
}

const STAGING_ROOT = 'staging';

export async function importProjectZip(
	db: Kysely<Database>,
	bytes: Uint8Array,
	options: ProjectZipImportOptions = {}
): Promise<ProjectZipImportResult> {
	const files = parseStoreOnlyZip(bytes).map(entry => ({
		path: entry.path,
		read: async () => entry.content,
	}));
	return importProjectFileTree(db, files, options);
}

export async function importProjectFileTree(
	db: Kysely<Database>,
	files: ReadableProjectFileTree,
	options: ProjectImportOptions = {}
): Promise<ProjectImportResult> {
	const storeOptions = options.storeOptions ?? {};
	const stagingPath = joinStorePath(STAGING_ROOT, (options.nonce ?? createNonce)());
	try {
		const entries: ImportEntry[] = [];
		for await (const file of files) {
			entries.push({ path: normalizeProjectEntryPath(file.path), content: await file.read() });
		}
		for (const entry of entries) {
			await writeTextFileAtomic(joinStorePath(stagingPath, entry.path), entry.content, storeOptions);
		}

		const validation = await stageAndValidateProjectFiles(entries, {
			requireManifest: true,
			storeOptions,
		});
		if (validation.quarantinedFiles.length) return failedImport(validation.quarantinedFiles);

		const prepared = await prepareImport(db, stagingPath, entries, options);
		await placeStagedEntries(stagingPath, prepared, storeOptions);
		const report = await rebuildIndexFromStore(db, storeOptions);
		return {
			ok: report.quarantinedFiles.length === 0,
			projectId: prepared.manifest.id,
			storageSlug: prepared.storageSlug,
			mode: prepared.mode,
			...report,
		};
	} catch (error) {
		return failedImport([
			{
				path: '',
				code: 'invalid_shape',
				message: error instanceof Error ? error.message : String(error),
				timestamp: new Date().toISOString(),
			},
		]);
	} finally {
		await deleteDirectoryIfExists(stagingPath, storeOptions);
	}
}

export async function cleanStaleProjectImportStaging(
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	await deleteDirectoryIfExists(STAGING_ROOT, storeOptions);
}

async function prepareImport(
	db: Kysely<Database>,
	stagingPath: string,
	entries: ImportEntry[],
	options: ProjectZipImportOptions
): Promise<PreparedImport> {
	const manifestEntry = entries.find(entry => entry.path === 'project.json');
	if (!manifestEntry) throw new Error('Project zip does not contain project.json.');
	const manifest = await readStagedManifest(stagingPath, options.storeOptions ?? {});
	const existing = await db
		.selectFrom('projects')
		.select(['id', 'storage_slug', 'updated_at'])
		.where('id', '=', manifest.id)
		.executeTakeFirst();
	if (!existing) {
		return { entries, manifest, storageSlug: deriveStorageSlug(manifest.name, manifest.id), mode: 'created' };
	}
	if (!options.collisionMode) {
		throw new Error(
			`Project ${manifest.id} already exists locally. Choose replace or import as copy. Local updated ${existing.updated_at}; imported updated ${manifest.updated_at}.`
		);
	}
	if (options.collisionMode === 'replace') {
		return { entries, manifest, storageSlug: existing.storage_slug, mode: 'replaced' };
	}
	const copied = await copyProjectEntries(stagingPath, entries, options.storeOptions ?? {});
	return copied;
}

async function copyProjectEntries(
	stagingPath: string,
	entries: ImportEntry[],
	storeOptions: StoreOperationOptions
): Promise<PreparedImport> {
	const sourceManifest = await readStagedManifest(stagingPath, storeOptions);
	const copyId = createId();
	const storageSlug = deriveStorageSlug(sourceManifest.name, copyId);
	const updatedEntries: ImportEntry[] = [];
	for (const entry of entries) {
		if (entry.path === 'project.json') {
			const payloadWithoutHash = {
				...sourceManifest,
				id: copyId,
				name: `${sourceManifest.name} Copy`,
			};
			const payload: ProjectManifestPayload = {
				...payloadWithoutHash,
				manifest_content_hash: await hashCanonicalPayload({
					project_id: copyId,
					transcriptions: payloadWithoutHash.transcriptions,
					collations: payloadWithoutHash.collations,
					tombstones: payloadWithoutHash.tombstones,
				}),
			};
			updatedEntries.push({
				path: entry.path,
				content: JSON.stringify(await sealDocument(PROJECT_MANIFEST_FORMAT, 1, payload)),
			});
			continue;
		}
		if (isProjectTranscriptionPath(entry.path)) {
			const parsed = await readCanonicalDocument<ProjectTranscriptionPayload>(
				PROJECT_TRANSCRIPTION_FORMAT,
				entry.content
			);
			if (parsed.ok) {
				const payload: ProjectTranscriptionPayload = {
					...parsed.payload,
					origin: {
						source_type: 'imported_project_copy',
						source_project_id: sourceManifest.id,
						source_transcription_id: parsed.payload.id,
						source_revision_id: parsed.payload.current_revision.id,
						source_content_hash: parsed.payload.current_revision.content_hash,
					},
				};
				updatedEntries.push({
					path: entry.path,
					content: JSON.stringify(await sealDocument(PROJECT_TRANSCRIPTION_FORMAT, 1, payload)),
				});
				continue;
			}
		}
		updatedEntries.push(entry);
	}
	return {
		entries: updatedEntries,
		manifest: { ...sourceManifest, id: copyId, name: `${sourceManifest.name} Copy` },
		storageSlug,
		mode: 'copied',
	};
}

async function placeStagedEntries(
	stagingPath: string,
	prepared: PreparedImport,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const targetFolder = projectFolder(prepared.storageSlug);
	if (prepared.mode === 'replaced') await deleteDirectoryIfExists(targetFolder, storeOptions);
	for (const entry of prepared.entries) {
		const stagedFile = joinStorePath(stagingPath, entry.path);
		const targetFile = joinStorePath(targetFolder, entry.path);
		if (prepared.mode === 'copied') {
			await writeTextFileAtomic(targetFile, entry.content, storeOptions);
		} else {
			await moveFile(stagedFile, targetFile, storeOptions);
		}
	}
}

async function readStagedManifest(
	stagingPath: string,
	storeOptions: StoreOperationOptions
): Promise<ProjectManifestPayload> {
	const raw = await readTextFile(joinStorePath(stagingPath, 'project.json'), storeOptions);
	const result = await readCanonicalDocument<ProjectManifestPayload>(PROJECT_MANIFEST_FORMAT, raw);
	if (!result.ok) throw new Error(result.quarantine.message);
	return result.payload;
}

function isProjectTranscriptionPath(path: string): boolean {
	return /^transcriptions\/[^/]+\.json$/.test(path) && !path.endsWith('.working.json');
}

function parseStoreOnlyZip(bytes: Uint8Array): ImportEntry[] {
	const decoder = new TextDecoder();
	const entries: ImportEntry[] = [];
	let offset = 0;
	while (offset < bytes.length) {
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
		const signature = view.getUint32(0, true);
		if (signature !== 0x04034b50) break;
		const method = view.getUint16(8, true);
		if (method !== 0) throw new Error('Only stored zip entries are supported.');
		const compressedSize = view.getUint32(18, true);
		const pathLength = view.getUint16(26, true);
		const extraLength = view.getUint16(28, true);
		const pathStart = offset + 30;
		const contentStart = pathStart + pathLength + extraLength;
		const path = decoder.decode(bytes.slice(pathStart, pathStart + pathLength));
		const content = decoder.decode(bytes.slice(contentStart, contentStart + compressedSize));
		entries.push({ path, content });
		offset = contentStart + compressedSize;
	}
	return entries;
}

function failedImport(quarantinedFiles: StoreQuarantineRecord[]): ProjectZipImportResult {
	return {
		ok: false,
		projectId: '',
		storageSlug: '',
		mode: 'created',
		projectsRestored: 0,
		transcriptionsRestored: 0,
		collationsRestored: 0,
		transcriptionCheckpointsRestored: 0,
		collationCheckpointsRestored: 0,
		tombstonesRestored: 0,
		quarantinedFiles,
		orphanedFiles: [],
	};
}

async function deleteDirectoryIfExists(path: string, storeOptions: StoreOperationOptions): Promise<void> {
	try {
		await deleteDirectory(path, { ...storeOptions, recursive: true });
	} catch (error) {
		if (!isMissingStoreEntryError(error)) throw error;
	}
}

function deriveStorageSlug(name: string, id: string): string {
	const base = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'project';
	return `${base}-${id.slice(0, 8).toLowerCase()}`;
}

function createId(): string {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `project-${Math.random().toString(36).slice(2, 10)}`;
}

function createNonce(): string {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2, 14);
}

function isMissingStoreEntryError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return error instanceof Error && /not found/i.test(error.message);
}
