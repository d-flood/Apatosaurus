import type { Kysely } from 'kysely';

import {
	CBGM_ANALYSIS_FORMAT,
	PROJECT_MANIFEST_FORMAT,
	collationPayloadToContent,
	parseCollationTeiVersion,
	parseTranscriptionTei,
	parseTranscriptionTeiVersion,
	readCanonicalDocument,
	serializeCanonicalDocument,
	serializeCollationPayloadTei,
	serializeTranscriptionTei,
	type CbgmAnalysisMetadata,
	type CollationContent,
	type CollationPayload,
	type CollationTeiVersion,
	type ProjectManifestPayload,
	type ProjectManifestRevisionHead,
	type ProjectTranscriptionPayload,
	type TranscriptionTeiVersion,
} from '$lib/storage/formats';
import {
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_FORMAT,
	PROJECT_TRANSCRIPTION_FORMAT,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	WORKING_COLLATION_FORMAT,
	WORKING_TRANSCRIPTION_FORMAT,
	legacyCollationContentHash,
	legacyTranscriptionContentHash,
	mergeWorkingCollation,
	mergeWorkingTranscription,
	projectTranscriptionPayloadToSnapshot,
	readLegacyDocument,
	upgradeLegacyIiifManifestSources,
	type CollationCheckpointPayload,
	type TranscriptionCheckpointPayload,
	type WorkingCollationPayload,
	type WorkingTranscriptionPayload,
} from '$lib/storage/legacy-json';
import type { JsonObject, JsonValue } from '$lib/storage/envelope';
import { hashCanonicalPayload } from '$lib/storage/canonical-json';
import { fingerprintContent, type FileFingerprint } from '$lib/storage/content-hash';
import {
	classifyDocumentPath,
	documentCanonicalPath,
	documentHistoryFolder,
	documentStorageOfPath,
	documentVersionPath,
	legacyDocumentPaths,
	legacyVersionPath,
	type DocumentKind,
} from '$lib/storage/document-files';
import {
	LEGACY_FOLDER,
	joinStorePath,
	projectFolder,
	projectManifestFile,
} from '$lib/storage/layout';
import {
	deleteDirectory,
	deleteFile,
	listDirectory,
	readTextFile,
	withDocumentStoreWriterLock,
	writeTextFileAtomic,
	type StoreOperationOptions,
} from '$lib/storage/opfs-store';
import { coerceTranscriptionDocument } from '$lib/transcription/content';
import { parseProjectCollationSettings } from '$lib/collation/project-settings';
import type { CollationVocabulary } from '$lib/collation/collation-apparatus-tei';

import type { Database } from '../types.generated';
import { refreshChangedDocumentFiles } from './document-refresh';
import type { IndexRebuildProgress } from './index-rebuild';
import { withProjectWriteLock } from './project-locks';
import type { ProjectTranscriptionSnapshot } from './revisions';

export interface TeiConversionFailure {
	entity: string;
	path: string;
	difference: string;
}

export interface TeiConversionReport {
	status: 'not-needed' | 'converted' | 'failed';
	files: number;
	failure?: TeiConversionFailure;
}

const STAGING_ROOT = 'upgrades/tei-canonical';
const UNSYNCED_REMOTE = 'unsynced:tei-conversion';
const REBUILT_DOCUMENT_KEYS = new Set(['teiHeader', 'metadata', 'header']);

class ConversionMismatch extends Error {
	constructor(readonly failure: TeiConversionFailure) {
		super(`${failure.entity} (${failure.path}): ${failure.difference}`);
	}
}

interface Conversion {
	slug: string;
	projectId: string;
	vocab: CollationVocabulary;
	options: StoreOperationOptions;
	/** Project-relative TEI path → staged store path. */
	staged: Map<string, string>;
	/** Old content hash → new content hash, per transcription id or collation id. */
	hashes: Map<string, Map<string, string>>;
	heads: Map<string, { kind: DocumentKind; id: string; head: string | null }>;
	legacyPaths: string[];
	/** JSON path → file hash, for each JSON file that alone becomes one TEI file. */
	sourceHashes: Map<string, string>;
	progress: () => void;
}

interface ConvertedFile {
	path: string;
	fingerprint: FileFingerprint;
	sourcePath: string;
	sourceHash: string;
}

/**
 * Converts every JSON-headed document of a project to TEI. Writing the v7 manifest commits the
 * conversion; until then the project stays on JSON, and a rerun starts over.
 */
export async function convertProjectToTei(
	db: Kysely<Database>,
	projectId: string,
	storeOptions: StoreOperationOptions = {},
	onProgress?: (progress: IndexRebuildProgress) => void
): Promise<TeiConversionReport> {
	const project = await db
		.selectFrom('projects')
		.select('storage_slug')
		.where('id', '=', projectId)
		.executeTakeFirst();
	if (!project) throw new Error(`Project ${projectId} was not found.`);
	const slug = project.storage_slug;
	let last = null as IndexRebuildProgress | null;
	const progress = (event: IndexRebuildProgress) => {
		last = event;
		onProgress?.(event);
	};
	try {
		return await withProjectWriteLock(projectId, async () => {
			const { converted = [], ...report } = await withDocumentStoreWriterLock(
				options => convertLocked(slug, projectId, options, progress),
				storeOptions
			);
			if (report.status !== 'converted') return report;
			await recordConvertedSyncFingerprints(db, projectId, converted);
			await refreshChangedDocumentFiles(db, projectId, storeOptions, progress);
			return report;
		});
	} finally {
		if (last && last.done < last.total) onProgress?.({ ...last, done: last.total });
	}
}

async function convertLocked(
	slug: string,
	projectId: string,
	options: StoreOperationOptions,
	onProgress?: (progress: IndexRebuildProgress) => void
): Promise<TeiConversionReport & { converted?: ConvertedFile[] }> {
	const manifest = await readManifest(slug, options);
	const jsonTranscriptions = manifest.transcriptions.filter(isJsonHead);
	const jsonCollations = manifest.collations.filter(isJsonHead);
	if (jsonTranscriptions.length === 0 && jsonCollations.length === 0) {
		await moveStrayJsonFiles(slug, manifest, options);
		return { status: 'not-needed', files: 0 };
	}

	const staging = joinStorePath(STAGING_ROOT, slug);
	await deleteFolderIfExists(staging, options);
	const versionFiles = new Map<string, string[]>();
	for (const head of jsonTranscriptions)
		versionFiles.set(
			head.project_transcription_id,
			await listJsonVersions(slug, 'transcription', head.project_transcription_id, options)
		);
	for (const head of jsonCollations)
		versionFiles.set(
			head.collation_id,
			await listJsonVersions(slug, 'collation', head.collation_id, options)
		);
	const files = [...versionFiles.values()].reduce((sum, paths) => sum + paths.length + 1, 0);
	let done = 0;
	const report = (count: number) =>
		onProgress?.({ done: count, total: files, phase: 'conversion' });
	report(0);

	const conversion: Conversion = {
		slug,
		projectId,
		vocab: parseProjectCollationSettings(manifest.collation_settings),
		options,
		staged: new Map(),
		hashes: new Map(),
		heads: new Map(),
		legacyPaths: [],
		sourceHashes: new Map(),
		progress: () => report(Math.min((done += 1), files - 1)),
	};
	const converted: ConvertedFile[] = [];
	try {
		const transcriptionIds = new Map(
			jsonTranscriptions.map(head => [head.transcription_id, head.project_transcription_id])
		);
		const sources = new Map<string, string | null>();
		const payloads = new Map<string, ProjectTranscriptionPayload>();
		for (const head of jsonTranscriptions) {
			const payload = await readTranscriptionCurrent(
				conversion,
				head.project_transcription_id
			);
			payloads.set(head.project_transcription_id, payload);
			sources.set(
				head.project_transcription_id,
				payload.origin.source_project_id === projectId
					? (transcriptionIds.get(payload.origin.source_transcription_id ?? '') ?? null)
					: null
			);
		}
		// An origin inside the project is remapped through its source's hashes, so sources go first.
		for (const ptid of sourcesFirst(sources)) {
			const head = jsonTranscriptions.find(entry => entry.project_transcription_id === ptid)!;
			await convertTranscription(
				conversion,
				payloads.get(ptid)!,
				versionFiles.get(ptid)!,
				head.current_revision
			);
		}
		for (const head of jsonCollations)
			await convertCollation(
				conversion,
				head.collation_id,
				versionFiles.get(head.collation_id)!,
				head.current_revision
			);
		assertHeadsOneToOne(conversion);
		const analyses = await remapCbgmAnalyses(conversion);

		for (const [path, stagedPath] of conversion.staged) {
			const xml = await readTextFile(stagedPath, options);
			await writeTextFileAtomic(joinStorePath(projectFolder(slug), path), xml, options);
			const sourcePath = jsonSourcePath(path);
			const sourceHash = conversion.sourceHashes.get(sourcePath);
			if (sourceHash)
				converted.push({
					path,
					fingerprint: await fingerprintContent(xml, ''),
					sourcePath,
					sourceHash,
				});
		}
		for (const [path, content] of analyses)
			await writeTextFileAtomic(joinStorePath(projectFolder(slug), path), content, options);
		await writeConvertedManifest(conversion, manifest);
	} catch (error) {
		await deleteFolderIfExists(staging, options);
		if (error instanceof ConversionMismatch)
			return { status: 'failed', files, failure: error.failure };
		throw error;
	}
	await deleteFolderIfExists(staging, options);
	await moveToLegacy(slug, conversion.legacyPaths, options);
	report(files);
	return { status: 'converted', files, converted };
}

function jsonSourcePath(teiPath: string): string {
	const file = classifyDocumentPath(teiPath)!;
	return file.versionId
		? legacyVersionPath(file.kind, file.entityId, file.versionId)
		: legacyDocumentPaths(file.kind, file.entityId).primary;
}

/**
 * Records each converted file as synced wherever its JSON source was unchanged since that
 * target's last sync, so sync takes the remote's newer copy instead of reporting a conflict.
 * A remote copy already synced at the TEI path keeps its fields; otherwise none is known.
 */
async function recordConvertedSyncFingerprints(
	db: Kysely<Database>,
	projectId: string,
	converted: ConvertedFile[]
): Promise<void> {
	if (converted.length === 0) return;
	const rows = await db
		.selectFrom('sync_file_fingerprints')
		.selectAll()
		.where('project_id', '=', projectId)
		.execute();
	for (const { path, fingerprint, sourcePath, sourceHash } of converted) {
		for (const source of rows) {
			if (source.file_path !== sourcePath || source.local_content_hash !== sourceHash)
				continue;
			const synced = rows.find(
				row => row.target_id === source.target_id && row.file_path === path
			);
			const values = {
				...source,
				file_path: path,
				local_content_hash: fingerprint.contentHash,
				local_size: fingerprint.size,
				local_modified_at: fingerprint.modifiedAt,
				remote_file_id: synced?.remote_file_id ?? '',
				remote_revision: synced?.remote_revision ?? UNSYNCED_REMOTE,
				remote_content_hash: synced?.remote_content_hash ?? UNSYNCED_REMOTE,
				remote_size: synced?.remote_size ?? 0,
				remote_modified_at: synced?.remote_modified_at ?? '',
			};
			await db
				.insertInto('sync_file_fingerprints')
				.values(values)
				.onConflict(conflict =>
					conflict.columns(['target_id', 'project_id', 'file_path']).doUpdateSet(values)
				)
				.execute();
		}
	}
}

async function readManifest(
	slug: string,
	options: StoreOperationOptions
): Promise<ProjectManifestPayload> {
	const read = await readCanonicalDocument<ProjectManifestPayload>(
		PROJECT_MANIFEST_FORMAT,
		await readTextFile(projectManifestFile(slug), options)
	);
	if (!read.ok) throw new Error(`Project manifest is invalid: ${read.quarantine.message}`);
	return read.payload;
}

function isJsonHead(head: { primary_path: string }): boolean {
	return documentStorageOfPath(head.primary_path) === 'json';
}

function sourcesFirst(sources: Map<string, string | null>): string[] {
	const ordered: string[] = [];
	const seen = new Set<string>();
	const visit = (id: string) => {
		if (seen.has(id)) return;
		seen.add(id);
		const source = sources.get(id);
		if (source) visit(source);
		ordered.push(id);
	};
	for (const id of sources.keys()) visit(id);
	return ordered;
}

async function readTranscriptionCurrent(
	conversion: Conversion,
	ptid: string
): Promise<ProjectTranscriptionPayload> {
	const path = legacyDocumentPaths('transcription', ptid).primary;
	const primary = await readJson<ProjectTranscriptionPayload>(
		conversion,
		PROJECT_TRANSCRIPTION_FORMAT,
		path,
		`Transcription ${ptid}`
	);
	if (primary.project_transcription_id !== ptid)
		throw mismatch(`Transcription ${ptid}`, path, 'The file belongs to another transcription.');
	conversion.legacyPaths.push(path);
	const workingPath = legacyDocumentPaths('transcription', ptid).working;
	const working = await readOptionalJson<WorkingTranscriptionPayload>(
		conversion,
		WORKING_TRANSCRIPTION_FORMAT,
		workingPath
	);
	if (!working) return primary;
	conversion.legacyPaths.push(workingPath);
	if (
		working.project_transcription_id !== ptid ||
		working.draft.base_revision_id !== primary.based_on_checkpoint?.id ||
		working.draft.base_content_hash !== primary.based_on_checkpoint?.content_hash
	)
		return primary;
	conversion.sourceHashes.delete(path);
	return mergeWorkingTranscription(primary, working);
}

async function convertTranscription(
	conversion: Conversion,
	current: ProjectTranscriptionPayload,
	versionPaths: string[],
	head: { id: string; content_hash: string } | null
): Promise<void> {
	const ptid = current.project_transcription_id;
	const entity = `Transcription “${current.title || current.siglum || ptid}”`;
	const origin = remapOrigin(conversion, current.origin);
	const hashes = hashMap(conversion, current.id);
	const versionHashes = new Map<string, string>();
	const checkpoints = await readCheckpoints<TranscriptionCheckpointPayload>(
		conversion,
		TRANSCRIPTION_CHECKPOINT_FORMAT,
		versionPaths,
		ptid,
		entity
	);
	for (const checkpoint of checkpoints) {
		const snapshot = upgradeLegacyIiifManifestSources(
			checkpoint.payload
		) as unknown as ProjectTranscriptionSnapshot;
		const payload = transcriptionPayload(current, origin, snapshot, checkpoint.created_at);
		const version = versionOf(checkpoint);
		const path = documentVersionPath('transcription', ptid, checkpoint.checkpoint_id);
		const serialized = await serializeTranscriptionTei(payload, version);
		await stageAndVerify(conversion, entity, path, serialized.xml, xml => {
			compareTranscription(entity, path, payload, parseTranscriptionTei(xml));
			compare(
				entity,
				path,
				'Version record',
				version,
				parseTranscriptionTeiVersion(xml).version
			);
		});
		mapHash(hashes, checkpoint.payload_content_hash, serialized.contentHash, entity, path);
		versionHashes.set(checkpoint.checkpoint_id, serialized.contentHash);
	}

	const path = documentCanonicalPath('transcription', ptid);
	const payload: ProjectTranscriptionPayload = {
		...current,
		content_json: withStablePageIds(current.content_json),
		origin,
		based_on_checkpoint: basedOn(current.based_on_checkpoint, versionHashes, entity, path),
	};
	const serialized = await serializeTranscriptionTei(payload);
	await stageAndVerify(conversion, entity, path, serialized.xml, xml =>
		compareTranscription(entity, path, payload, parseTranscriptionTei(xml))
	);
	const legacyHash = await legacyTranscriptionContentHash(
		projectTranscriptionPayloadToSnapshot(current)
	);
	mapHash(hashes, legacyHash, serialized.contentHash, entity, path);
	recordHead(conversion, 'transcription', ptid, head, versionHashes, entity, path);
}

function transcriptionPayload(
	current: ProjectTranscriptionPayload,
	origin: ProjectTranscriptionPayload['origin'],
	snapshot: ProjectTranscriptionSnapshot,
	savedAt: string
): ProjectTranscriptionPayload {
	return {
		project_transcription_id: current.project_transcription_id,
		id: current.id,
		canonical_transcription_id: current.canonical_transcription_id,
		based_on_checkpoint: null,
		draft: { saved_at: savedAt, author_name: null },
		origin,
		title: snapshot.title,
		siglum: snapshot.siglum,
		description: snapshot.description,
		content_json: withStablePageIds(snapshot.content_json as JsonValue),
		content_format: snapshot.format,
		created_at: current.created_at,
		updated_at: savedAt,
		owner: snapshot.owner,
		is_public: snapshot.is_public === true,
		tags: [...snapshot.tags],
		transcriber: snapshot.transcriber,
		repository: snapshot.repository,
		settlement: snapshot.settlement,
		language: snapshot.language,
		iiif_manifest_sources: snapshot.iiif_manifest_sources,
		page_canvas_links: snapshot.page_canvas_links,
		canvas_annotations: snapshot.canvas_annotations,
	} as unknown as ProjectTranscriptionPayload;
}

// Loading assigns a random id to a page without one, so equal content would get unequal TEI.
function withStablePageIds(content: JsonValue): JsonValue {
	const document = content as { pages?: Array<Record<string, any>> } | null;
	if (!document?.pages?.some(page => !pageIdOf(page))) return content;
	const taken = new Set(document.pages.map(pageIdOf).filter(Boolean));
	let next = 1;
	return {
		...document,
		pages: document.pages.map(page => {
			if (pageIdOf(page)) return page;
			while (taken.has(`page-${next}`)) next += 1;
			taken.add(`page-${next}`);
			return { ...page, pageId: `page-${next}` };
		}),
	} as JsonValue;
}

function pageIdOf(page: Record<string, any>): string | undefined {
	return page.pageId || page.teiAttrs?.['xml:id'] || undefined;
}

function remapOrigin(
	conversion: Conversion,
	origin: ProjectTranscriptionPayload['origin']
): ProjectTranscriptionPayload['origin'] {
	if (origin.source_project_id !== conversion.projectId || !origin.source_content_hash)
		return origin;
	const mapped = conversion.hashes
		.get(origin.source_transcription_id ?? '')
		?.get(origin.source_content_hash);
	return mapped ? { ...origin, source_content_hash: mapped } : origin;
}

async function convertCollation(
	conversion: Conversion,
	collationId: string,
	versionPaths: string[],
	head: { id: string; content_hash: string } | null
): Promise<void> {
	const current = await readCollationCurrent(conversion, collationId);
	const entity = `Collation “${current.title || collationId}”`;
	const hashes = hashMap(conversion, collationId);
	const versionHashes = new Map<string, string>();
	const checkpoints = await readCheckpoints<CollationCheckpointPayload>(
		conversion,
		COLLATION_CHECKPOINT_FORMAT,
		versionPaths,
		collationId,
		entity
	);
	for (const checkpoint of checkpoints) {
		const payload: CollationPayload = {
			...remapWitnessSources(conversion, checkpoint.payload),
			based_on_checkpoint: null,
			draft: { saved_at: checkpoint.created_at, author_name: null },
			created_at: current.created_at,
			updated_at: checkpoint.created_at,
		};
		if (current.conflict_of_collation_id)
			payload.conflict_of_collation_id = current.conflict_of_collation_id;
		const version = versionOf(checkpoint);
		const path = documentVersionPath('collation', collationId, checkpoint.checkpoint_id);
		const serialized = await serializeCollationPayloadTei(payload, conversion.vocab, version);
		await stageAndVerify(conversion, entity, path, serialized.xml, xml => {
			const parsed = parseCollationTeiVersion(xml);
			compare(entity, path, 'collation', payload, parsed.payload);
			compare(entity, path, 'Version record', version, parsed.version);
		});
		mapHash(hashes, checkpoint.payload_content_hash, serialized.contentHash, entity, path);
		versionHashes.set(checkpoint.checkpoint_id, serialized.contentHash);
	}

	const path = documentCanonicalPath('collation', collationId);
	const payload: CollationPayload = {
		...current,
		...remapWitnessSources(conversion, collationPayloadToContent(current)),
		based_on_checkpoint: basedOn(current.based_on_checkpoint, versionHashes, entity, path),
	};
	const serialized = await serializeCollationPayloadTei(payload, conversion.vocab);
	await stageAndVerify(conversion, entity, path, serialized.xml, xml =>
		compare(entity, path, 'collation', payload, parseCollationTeiVersion(xml).payload)
	);
	const legacyHash = await legacyCollationContentHash(current);
	mapHash(hashes, legacyHash, serialized.contentHash, entity, path);
	recordHead(conversion, 'collation', collationId, head, versionHashes, entity, path);
}

async function readCollationCurrent(
	conversion: Conversion,
	collationId: string
): Promise<CollationPayload> {
	const path = legacyDocumentPaths('collation', collationId).primary;
	const entity = `Collation ${collationId}`;
	const primary = await readJson<CollationPayload>(conversion, COLLATION_FORMAT, path, entity);
	if (primary.id !== collationId || primary.project_id !== conversion.projectId)
		throw mismatch(entity, path, 'The file belongs to another collation or project.');
	conversion.legacyPaths.push(path);
	const workingPath = legacyDocumentPaths('collation', collationId).working;
	const working = await readOptionalJson<WorkingCollationPayload>(
		conversion,
		WORKING_COLLATION_FORMAT,
		workingPath
	);
	if (!working) return primary;
	conversion.legacyPaths.push(workingPath);
	if (
		working.id !== collationId ||
		working.draft.base_revision_id !== (primary.based_on_checkpoint?.id ?? null) ||
		working.draft.base_content_hash !== (primary.based_on_checkpoint?.content_hash ?? null)
	)
		return primary;
	conversion.sourceHashes.delete(path);
	return mergeWorkingCollation(primary, working);
}

function remapWitnessSources(conversion: Conversion, content: CollationContent): CollationContent {
	const { flow: _viewState, ...document } = structuredClone(content.document);
	for (const witness of document.setup.witnesses) {
		const source = witness.source;
		if (source?.kind !== 'current') continue;
		const mapped = conversion.hashes
			.get(source.transcriptionId || witness.transcriptionId)
			?.get(source.contentHash);
		if (mapped) witness.source = { ...source, contentHash: mapped };
	}
	return { ...collationPayloadToContent(content), document };
}

async function stageAndVerify(
	conversion: Conversion,
	entity: string,
	path: string,
	xml: string,
	verify: (xml: string) => void
): Promise<void> {
	const stagedPath = joinStorePath(STAGING_ROOT, conversion.slug, path);
	await writeTextFileAtomic(stagedPath, xml, conversion.options);
	const written = await readTextFile(stagedPath, conversion.options);
	try {
		verify(written);
	} catch (error) {
		if (error instanceof ConversionMismatch) throw error;
		throw mismatch(entity, path, `The new file does not parse: ${errorMessage(error)}`);
	}
	conversion.staged.set(path, stagedPath);
	conversion.progress();
}

function compareTranscription(
	entity: string,
	path: string,
	expected: ProjectTranscriptionPayload,
	parsed: ProjectTranscriptionPayload
): void {
	compare(
		entity,
		path,
		'transcription',
		{ ...expected, content_json: comparableDocument(expected.content_json) },
		parsed
	);
}

// The header is rebuilt from the record fields, which are compared on their own.
function comparableDocument(content: JsonValue) {
	const document = coerceTranscriptionDocument(content);
	if (!document) return null;
	return Object.fromEntries(
		Object.entries(document).filter(([key]) => !REBUILT_DOCUMENT_KEYS.has(key))
	);
}

// Reading TEI back may add what the file states explicitly (an xml:id, a source label), but
// every value the JSON held must come back unchanged.
function compare(
	entity: string,
	path: string,
	what: string,
	expected: unknown,
	actual: unknown
): void {
	const difference = firstLoss(expected, actual, what);
	if (difference) throw mismatch(entity, path, `The ${what} read back differs at ${difference}.`);
}

function firstLoss(expected: unknown, actual: unknown, at: string): string | null {
	if (expected === undefined || expected === actual || (expected === null && actual == null))
		return null;
	if (Array.isArray(expected)) {
		if (!Array.isArray(actual) || actual.length !== expected.length)
			return `${at}: expected ${expected.length} entries, read ${Array.isArray(actual) ? actual.length : describe(actual)}`;
		for (const [index, entry] of expected.entries()) {
			const loss = firstLoss(entry, actual[index], `${at}[${index}]`);
			if (loss) return loss;
		}
		return null;
	}
	if (expected && typeof expected === 'object') {
		if (!actual || typeof actual !== 'object' || Array.isArray(actual))
			return `${at}: expected an object, read ${describe(actual)}`;
		for (const [key, value] of Object.entries(expected)) {
			const loss = firstLoss(
				value,
				(actual as Record<string, unknown>)[key.normalize('NFC')],
				`${at}.${key}`
			);
			if (loss) return loss;
		}
		return null;
	}
	if (
		typeof expected === 'string' &&
		typeof actual === 'string' &&
		normalizedString(expected) === normalizedString(actual)
	)
		return null;
	return `${at}: expected ${describe(expected)}, read ${describe(actual)}`;
}

// Writing TEI normalizes text to NFC with LF line endings, as the content hash does.
function normalizedString(value: string): string {
	return value.normalize('NFC').replace(/\r\n?/g, '\n');
}

function describe(value: unknown): string {
	const text = JSON.stringify(value) ?? 'nothing';
	return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function hashMap(conversion: Conversion, entityId: string): Map<string, string> {
	let hashes = conversion.hashes.get(entityId);
	if (!hashes) conversion.hashes.set(entityId, (hashes = new Map()));
	return hashes;
}

function mapHash(
	hashes: Map<string, string>,
	oldHash: string,
	newHash: string,
	entity: string,
	path: string
): void {
	const existing = hashes.get(oldHash);
	if (existing !== undefined && existing !== newHash)
		throw mismatch(
			entity,
			path,
			`Content that was identical before conversion (${oldHash}) now differs.`
		);
	hashes.set(oldHash, newHash);
}

function basedOn(
	reference: { id: string; content_hash: string } | null,
	versionHashes: Map<string, string>,
	entity: string,
	path: string
): { id: string; content_hash: string } | null {
	if (!reference) return null;
	const contentHash = versionHashes.get(reference.id);
	if (!contentHash)
		throw mismatch(entity, path, `Its last Version ${reference.id} has no history file.`);
	return { id: reference.id, content_hash: contentHash };
}

function recordHead(
	conversion: Conversion,
	kind: DocumentKind,
	id: string,
	head: { id: string; content_hash: string } | null,
	versionHashes: Map<string, string>,
	entity: string,
	path: string
): void {
	const newHash = head ? versionHashes.get(head.id) : undefined;
	if (head && !newHash)
		throw mismatch(entity, path, `The manifest's Version ${head.id} has no history file.`);
	conversion.heads.set(`${kind}:${id}`, { kind, id, head: newHash ?? null });
}

function assertHeadsOneToOne(conversion: Conversion): void {
	const seen = new Map<string, string>();
	for (const [key, { head }] of conversion.heads) {
		if (!head) continue;
		const other = seen.get(head);
		if (other)
			throw mismatch(key, head, `Its Version content hash is also the head of ${other}.`);
		seen.set(head, key);
	}
}

function versionOf(
	checkpoint: TranscriptionCheckpointPayload | CollationCheckpointPayload
): TranscriptionTeiVersion & CollationTeiVersion {
	return {
		id: checkpoint.checkpoint_id,
		label: checkpoint.label,
		note: checkpoint.commit_message,
		author_name: checkpoint.author_name,
		created_at: checkpoint.created_at,
		parent_id: checkpoint.parent_checkpoint_id,
	};
}

async function readCheckpoints<
	T extends TranscriptionCheckpointPayload | CollationCheckpointPayload,
>(
	conversion: Conversion,
	format: string,
	paths: string[],
	entityId: string,
	entity: string
): Promise<T[]> {
	const checkpoints: T[] = [];
	for (const path of paths) {
		const checkpoint = await readJson<T>(conversion, format, path, entity);
		if (checkpoint.entity_id !== entityId)
			throw mismatch(entity, path, 'The Version belongs to another document.');
		checkpoints.push(checkpoint);
		conversion.legacyPaths.push(path);
	}
	return checkpoints.sort((left, right) => left.created_at.localeCompare(right.created_at));
}

async function remapCbgmAnalyses(conversion: Conversion): Promise<Map<string, string>> {
	const rewritten = new Map<string, string>();
	const folder = joinStorePath(projectFolder(conversion.slug), 'cbgm');
	for (const entry of await listFolderIfExists(folder, conversion.options)) {
		if (entry.kind !== 'file' || !/^[^.]+\.json$/.test(entry.name)) continue;
		const path = `cbgm/${entry.name}`;
		const read = await readCanonicalDocument<CbgmAnalysisMetadata>(
			CBGM_ANALYSIS_FORMAT,
			await readTextFile(entry.path, conversion.options)
		);
		if (!read.ok) continue;
		let changed = false;
		const collations = read.payload.collations.map(collation => {
			const mapped = conversion.hashes
				.get(collation.collation_id)
				?.get(collation.content_hash);
			if (!mapped || mapped === collation.content_hash) return collation;
			changed = true;
			return { ...collation, content_hash: mapped };
		});
		if (changed)
			rewritten.set(
				path,
				await serializeCanonicalDocument(CBGM_ANALYSIS_FORMAT, {
					...read.payload,
					collations,
				})
			);
	}
	return rewritten;
}

async function writeConvertedManifest(
	conversion: Conversion,
	manifest: ProjectManifestPayload
): Promise<void> {
	const revision = (
		kind: DocumentKind,
		id: string,
		revision: ProjectManifestRevisionHead | null
	) => {
		const converted = conversion.heads.get(`${kind}:${id}`);
		return converted?.head && revision
			? { id: revision.id, content_hash: converted.head }
			: revision;
	};
	const transcriptions = manifest.transcriptions.map(head =>
		isJsonHead(head)
			? {
					...head,
					current_revision: revision(
						'transcription',
						head.project_transcription_id,
						head.current_revision
					),
					primary_path: documentCanonicalPath(
						'transcription',
						head.project_transcription_id
					),
				}
			: head
	);
	const collations = manifest.collations.map(head =>
		isJsonHead(head)
			? {
					...head,
					current_revision: revision(
						'collation',
						head.collation_id,
						head.current_revision
					),
					primary_path: documentCanonicalPath('collation', head.collation_id),
				}
			: head
	);
	const converted: ProjectManifestPayload = {
		...manifest,
		transcriptions,
		collations,
		manifest_content_hash: await hashCanonicalPayload({
			project_id: manifest.id,
			transcriptions,
			collations,
			tombstones: manifest.tombstones,
		}),
	};
	await writeTextFileAtomic(
		projectManifestFile(conversion.slug),
		await serializeCanonicalDocument(PROJECT_MANIFEST_FORMAT, converted),
		conversion.options
	);
}

// History goes first and primaries last, so a primary left behind marks an unfinished move.
async function moveToLegacy(
	slug: string,
	paths: string[],
	options: StoreOperationOptions
): Promise<void> {
	const order = (path: string) =>
		path.startsWith('history/') ? 0 : path.endsWith('.working.json') ? 1 : 2;
	for (const path of [...paths].sort((left, right) => order(left) - order(right))) {
		const from = joinStorePath(projectFolder(slug), path);
		let content: string;
		try {
			content = await readTextFile(from, options);
		} catch (error) {
			if (isMissing(error)) continue;
			throw error;
		}
		await writeTextFileAtomic(
			joinStorePath(projectFolder(slug), LEGACY_FOLDER, path),
			content,
			options
		);
		await deleteFile(from, options);
	}
}

async function moveStrayJsonFiles(
	slug: string,
	manifest: ProjectManifestPayload,
	options: StoreOperationOptions
): Promise<void> {
	const strays: string[] = [];
	const heads: Array<[DocumentKind, string]> = [
		...manifest.transcriptions.map(
			head => ['transcription', head.project_transcription_id] as [DocumentKind, string]
		),
		...manifest.collations.map(
			head => ['collation', head.collation_id] as [DocumentKind, string]
		),
	];
	const listed = new Map<string, Set<string>>();
	for (const folder of ['transcriptions', 'collations'])
		listed.set(
			folder,
			new Set(
				(await listFolderIfExists(joinStorePath(projectFolder(slug), folder), options)).map(
					entry => `${folder}/${entry.name}`
				)
			)
		);
	for (const [kind, id] of heads) {
		const files = listed.get(kind === 'transcription' ? 'transcriptions' : 'collations')!;
		const { primary, working } = legacyDocumentPaths(kind, id);
		if (!files.has(primary) && !files.has(working)) continue;
		strays.push(...(await listJsonVersions(slug, kind, id, options)));
		strays.push(...[working, primary].filter(path => files.has(path)));
	}
	await moveToLegacy(slug, strays, options);
}

async function listJsonVersions(
	slug: string,
	kind: DocumentKind,
	id: string,
	options: StoreOperationOptions
): Promise<string[]> {
	const folder = documentHistoryFolder(kind, id);
	return (await listFolderIfExists(joinStorePath(projectFolder(slug), folder), options))
		.filter(entry => entry.kind === 'file' && /^[^.]+\.json$/.test(entry.name))
		.map(entry => `${folder}/${entry.name}`);
}

async function readJson<T extends JsonObject>(
	conversion: Conversion,
	format: string,
	path: string,
	entity: string
): Promise<T> {
	let raw: string;
	try {
		raw = await readTextFile(
			joinStorePath(projectFolder(conversion.slug), path),
			conversion.options
		);
	} catch (error) {
		throw mismatch(entity, path, `The file cannot be read: ${errorMessage(error)}`);
	}
	const read = await readLegacyDocument<T>(format, raw, { projectPath: path });
	if (!read.ok)
		throw mismatch(entity, path, `The file cannot be read: ${read.quarantine.message}`);
	conversion.sourceHashes.set(path, (await fingerprintContent(raw, '')).contentHash);
	return read.payload;
}

async function readOptionalJson<T extends JsonObject>(
	conversion: Conversion,
	format: string,
	path: string
): Promise<T | null> {
	let raw: string;
	try {
		raw = await readTextFile(
			joinStorePath(projectFolder(conversion.slug), path),
			conversion.options
		);
	} catch (error) {
		if (isMissing(error)) return null;
		throw error;
	}
	const read = await readLegacyDocument<T>(format, raw, { projectPath: path });
	return read.ok ? read.payload : null;
}

async function listFolderIfExists(folder: string, options: StoreOperationOptions) {
	try {
		return await listDirectory(folder, options);
	} catch (error) {
		if (isMissing(error)) return [];
		throw error;
	}
}

async function deleteFolderIfExists(folder: string, options: StoreOperationOptions): Promise<void> {
	try {
		await deleteDirectory(folder, { ...options, recursive: true });
	} catch (error) {
		if (!isMissing(error)) throw error;
	}
}

function mismatch(entity: string, path: string, difference: string): ConversionMismatch {
	return new ConversionMismatch({ entity, path, difference });
}

function isMissing(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.name === 'NotFoundError' || /not found/i.test(error.message))
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
