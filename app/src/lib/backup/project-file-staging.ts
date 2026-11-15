import {
	PROJECT_MANIFEST_FORMAT,
	TOMBSTONE_FORMAT,
	canonicalFormatForProjectPath,
	parseCollationTeiVersion,
	parseTranscriptionTei,
	readCanonicalDocument,
	type CollationPayload,
	type ProjectManifestPayload,
	type ProjectTranscriptionPayload,
	type TombstonePayload,
} from '$lib/storage/formats';
import { teiContentHash } from '$lib/storage/tei-content';
import {
	deleteDirectory,
	writeTextFileAtomic,
	type StoreOperationOptions,
} from '$lib/storage/opfs-store';
import { isPresencePath, joinStorePath } from '$lib/storage/layout';
import {
	classifyDocumentPath,
	documentStorageOfPath,
	documentVersionPath,
	teiPrimaryPathsOfManifest,
	type DocumentFile,
} from '$lib/storage/document-files';
import type { JsonObject } from '$lib/storage/envelope';
import type { StoreQuarantineRecord } from '$lib/storage/quarantine';
import { hashCanonicalPayload } from '$lib/storage/canonical-json';
import {
	isCbgmSidecarFile,
	projectFileText,
	writeProjectFileAtomic,
	type ProjectFileContent,
} from './project-archive';

export interface ProjectFileCandidate {
	path: string;
	content: ProjectFileContent;
}

export interface ValidateProjectFileCandidatesOptions {
	projectId?: string;
	requireManifest?: boolean;
	storeOptions?: StoreOperationOptions;
	nonce?: () => string;
	now?: () => Date;
	ownerId?: string;
	teiPrimaryPaths?: ReadonlySet<string>;
}

export interface ValidatedStagedProjectEntry extends ProjectFileCandidate {
	format: string | null;
	payload?: JsonObject;
}

export interface ValidatedProjectFileCandidates {
	stagingPath: string;
	entries: ValidatedStagedProjectEntry[];
	valid: ProjectFileCandidate[];
	manifest: ProjectManifestPayload | null;
	quarantinedFiles: StoreQuarantineRecord[];
	cleanup(): Promise<void>;
}

export type ProjectFileValidationResult = Pick<
	ValidatedProjectFileCandidates,
	'entries' | 'valid' | 'manifest' | 'quarantinedFiles'
>;

interface ParsedTeiEntry {
	record: ProjectTranscriptionPayload;
	contentHash: string;
}

interface ParsedCollationTeiEntry {
	payload: CollationPayload;
	versionId: string | null;
	contentHash: string;
}

export const PROJECT_IMPORT_STAGING_ROOT = 'staging';
export const PROJECT_IMPORT_LEASE_FILE = '.lease.json';

export async function stageAndValidateProjectFiles(
	candidates: ProjectFileCandidate[],
	options: ValidateProjectFileCandidatesOptions = {}
): Promise<ValidatedProjectFileCandidates> {
	const storeOptions = options.storeOptions ?? {};
	const now = options.now ?? (() => new Date());
	const stagingPath = joinStorePath(
		PROJECT_IMPORT_STAGING_ROOT,
		(options.nonce ?? createNonce)()
	);
	let normalized: ProjectFileCandidate[];
	try {
		normalized = normalizeProjectTree(candidates);
	} catch (error) {
		return failedStaging(stagingPath, errorMessage(error), storeOptions, now);
	}

	await writeTextFileAtomic(
		joinStorePath(stagingPath, PROJECT_IMPORT_LEASE_FILE),
		JSON.stringify({
			owner_id: options.ownerId ?? createNonce(),
			created_at: now().toISOString(),
			heartbeat_at: now().toISOString(),
		}),
		storeOptions
	);
	for (const entry of normalized) {
		await writeProjectFileAtomic(
			joinStorePath(stagingPath, entry.path),
			entry.content,
			storeOptions
		);
	}

	const quarantinedFiles: StoreQuarantineRecord[] = [];
	const entries: ValidatedStagedProjectEntry[] = [];
	let projectId = options.projectId;
	let manifest: ProjectManifestPayload | null = null;
	const manifestEntry = normalized.find(entry => entry.path === 'project.json');
	if (manifestEntry) {
		const read = await readCanonicalDocument<ProjectManifestPayload>(
			PROJECT_MANIFEST_FORMAT,
			projectFileText(manifestEntry.content),
			{ projectPath: manifestEntry.path, projectId }
		);
		if (read.ok) {
			manifest = read.payload;
			projectId ??= manifest.id;
			entries.push({
				...manifestEntry,
				format: PROJECT_MANIFEST_FORMAT,
				payload: read.payload,
			});
		} else quarantinedFiles.push(record(manifestEntry.path, read.quarantine, now));
	} else if (options.requireManifest) {
		quarantinedFiles.push(
			quarantine('project.json', 'Project file tree does not contain project.json.', now)
		);
	}

	const teiPrimaryPaths = new Set([
		...teiPrimaryPathsOfManifest(manifest),
		...(options.teiPrimaryPaths ?? []),
	]);
	const legacyHeads = legacyHeadsOfManifest(manifest);
	const parsedTei = new Map<string, ParsedTeiEntry>();
	const parsedCollationTei = new Map<string, ParsedCollationTeiEntry>();
	for (const entry of normalized) {
		if (entry === manifestEntry) continue;
		if (isCbgmSidecarFile(entry.path)) {
			entries.push({ ...entry, format: null });
			continue;
		}
		const format = canonicalFormatForProjectPath(entry.path);
		if (!format) {
			const file = classifyDocumentPath(entry.path, teiPrimaryPaths);
			// A project not yet converted to TEI keeps its JSON documents for conversion to read.
			if (file?.role === 'legacy' && legacyHeads.has(legacyHeadKey(file))) {
				entries.push({ ...entry, format: null });
				continue;
			}
			if (!file || file.role === 'legacy') {
				quarantinedFiles.push(
					quarantine(entry.path, `Unsupported project file ${entry.path}.`, now)
				);
				continue;
			}
			if (file.kind === 'transcription' && file.role !== 'unlisted') {
				const text = projectFileText(entry.content);
				try {
					parsedTei.set(entry.path, {
						record: parseTranscriptionTei(text),
						contentHash: await teiContentHash(text),
					});
				} catch (error) {
					quarantinedFiles.push(
						record(
							entry.path,
							{
								code: 'invalid_tei',
								message: `Transcription TEI does not parse: ${errorMessage(error)}`,
							},
							now
						)
					);
					continue;
				}
			}
			if (file.kind === 'collation' && file.role !== 'unlisted') {
				const text = projectFileText(entry.content);
				try {
					const { payload, version } = parseCollationTeiVersion(text);
					parsedCollationTei.set(entry.path, {
						payload,
						versionId: version?.id ?? null,
						contentHash: await teiContentHash(text),
					});
				} catch (error) {
					quarantinedFiles.push(
						record(
							entry.path,
							{
								code: 'invalid_tei',
								message: `Collation TEI does not parse: ${errorMessage(error)}`,
							},
							now
						)
					);
					continue;
				}
			}
			entries.push({ ...entry, format: null });
			continue;
		}
		const read = await readCanonicalDocument(format, projectFileText(entry.content), {
			projectPath: entry.path,
			projectId,
		});
		if (read.ok) entries.push({ ...entry, format, payload: read.payload });
		else quarantinedFiles.push(record(entry.path, read.quarantine, now));
	}

	if (manifest && quarantinedFiles.length === 0) {
		await validateProjectSemantics(
			manifest,
			entries,
			parsedTei,
			parsedCollationTei,
			quarantinedFiles,
			now
		);
	}
	return {
		stagingPath,
		entries,
		valid: entries.map(({ path, content }) => ({ path, content })),
		manifest,
		quarantinedFiles,
		cleanup: () => deleteDirectoryIfExists(stagingPath, storeOptions),
	};
}

export async function validateProjectFilesWithTemporaryStaging(
	candidates: ProjectFileCandidate[],
	options: ValidateProjectFileCandidatesOptions = {}
): Promise<ProjectFileValidationResult> {
	const staged = await stageAndValidateProjectFiles(candidates, options);
	try {
		return {
			entries: staged.entries,
			valid: staged.valid,
			manifest: staged.manifest,
			quarantinedFiles: staged.quarantinedFiles,
		};
	} finally {
		await staged.cleanup();
	}
}

function normalizeProjectEntryPath(path: string): string {
	if (
		!path ||
		path.startsWith('/') ||
		/^[A-Za-z]:($|\/)/.test(path) ||
		path.includes('\\') ||
		path.split('/').some(segment => !segment || segment === '.' || segment === '..')
	) {
		throw new Error(`Invalid project entry path ${JSON.stringify(path)}.`);
	}
	return path;
}

function normalizeProjectTree(candidates: ProjectFileCandidate[]): ProjectFileCandidate[] {
	const original = candidates.map(candidate => ({
		path: normalizeProjectEntryPath(candidate.path),
		content: candidate.content,
	}));
	const rootless = original.some(entry => entry.path === 'project.json');
	const manifestRoots = original
		.filter(entry => entry.path.split('/').length === 2 && entry.path.endsWith('/project.json'))
		.map(entry => entry.path.split('/')[0]!);
	let root: string | null = null;
	if (rootless && manifestRoots.length > 0) {
		throw new Error('Project archive contains multiple project roots.');
	}
	if (!rootless && manifestRoots.length > 0) {
		if (new Set(manifestRoots).size !== 1) {
			throw new Error('Project archive must contain exactly one project root.');
		}
		root = manifestRoots[0]!;
		if (original.some(entry => !entry.path.startsWith(`${root}/`))) {
			throw new Error('Project archive contains multiple project roots.');
		}
	}
	const seen = new Set<string>();
	return original
		.map(entry => {
			const path = root ? entry.path.slice(root.length + 1) : entry.path;
			if (seen.has(path))
				throw new Error(`Duplicate project entry path ${JSON.stringify(path)}.`);
			seen.add(path);
			return {
				path,
				content: isCbgmSidecarFile(path) ? entry.content : projectFileText(entry.content),
			};
		})
		.filter(entry => !isPresencePath(entry.path));
}

async function validateProjectSemantics(
	manifest: ProjectManifestPayload,
	entries: ValidatedStagedProjectEntry[],
	parsedTei: ReadonlyMap<string, ParsedTeiEntry>,
	parsedCollationTei: ReadonlyMap<string, ParsedCollationTeiEntry>,
	quarantined: StoreQuarantineRecord[],
	now: () => Date
): Promise<void> {
	const byPath = new Map(entries.map(entry => [entry.path, entry]));
	for (const head of manifest.transcriptions) {
		const entry = byPath.get(head.primary_path);
		if (documentStorageOfPath(head.primary_path) === 'tei') {
			if (!entry)
				quarantined.push(
					quarantine(head.primary_path, 'Manifest transcription primary is missing.', now)
				);
			else validateTeiTranscriptionHead(head, parsedTei, quarantined, now);
			continue;
		}
		if (!entry)
			quarantined.push(
				quarantine(head.primary_path, 'Manifest transcription primary is missing.', now)
			);
	}
	for (const head of manifest.collations) {
		const entry = byPath.get(head.primary_path);
		if (documentStorageOfPath(head.primary_path) === 'tei') {
			if (!entry)
				quarantined.push(
					quarantine(head.primary_path, 'Manifest collation primary is missing.', now)
				);
			else validateTeiCollationHead(manifest.id, head, parsedCollationTei, quarantined, now);
			continue;
		}
		if (!entry)
			quarantined.push(
				quarantine(head.primary_path, 'Manifest collation primary is missing.', now)
			);
	}
	for (const head of manifest.tombstones) {
		const entry = byPath.get(head.primary_path);
		const payload = entry?.payload as TombstonePayload | undefined;
		if (!payload || entry?.format !== TOMBSTONE_FORMAT) {
			quarantined.push(
				quarantine(head.primary_path, 'Manifest tombstone primary is missing.', now)
			);
			continue;
		}
		const hash = await hashCanonicalPayload(payload);
		if (
			payload.id !== head.tombstone_id ||
			payload.project_id !== manifest.id ||
			payload.entity_type !== head.entity_type ||
			payload.entity_id !== head.entity_id ||
			payload.deletion_revision_id !== head.deletion_revision_id ||
			hash !== head.content_hash
		)
			quarantined.push(
				quarantine(
					head.primary_path,
					'Manifest tombstone head does not match its primary.',
					now
				)
			);
	}

	const transcriptionHeads = new Map(
		manifest.transcriptions.map(head => [head.project_transcription_id, head])
	);
	const collationHeads = new Map(manifest.collations.map(head => [head.collation_id, head]));
	const tombstonePaths = new Set(manifest.tombstones.map(head => head.primary_path));
	for (const entry of entries) {
		let message: string | null = null;
		if (entry.format === TOMBSTONE_FORMAT && !tombstonePaths.has(entry.path))
			message = 'Tombstone is not present in the manifest.';
		else if (entry.format === null) {
			const file = classifyDocumentPath(entry.path);
			if (
				file?.role === 'unlisted' &&
				file.kind === 'transcription' &&
				!transcriptionHeads.has(file.entityId)
			)
				message = 'TEI sibling has no manifest transcription.';
			if (
				file?.role === 'unlisted' &&
				file.kind === 'collation' &&
				!collationHeads.has(file.entityId)
			)
				message = 'TEI sibling has no manifest collation.';
			if (
				file?.role === 'version' &&
				file.kind === 'transcription' &&
				!transcriptionHeads.has(file.entityId)
			)
				message = 'Transcription Version does not belong to a manifest transcription.';
			if (file?.role === 'version' && file.kind === 'collation') {
				const version = parsedCollationTei.get(entry.path);
				if (
					!collationHeads.has(file.entityId) ||
					version?.payload.project_id !== manifest.id ||
					version.payload.id !== file.entityId ||
					version.versionId !== file.versionId
				)
					message = 'Collation Version does not belong to this project.';
			}
		}
		if (message) quarantined.push(quarantine(entry.path, message, now));
	}
}

function validateTeiTranscriptionHead(
	head: ProjectManifestPayload['transcriptions'][number],
	parsedTei: ReadonlyMap<string, ParsedTeiEntry>,
	quarantined: StoreQuarantineRecord[],
	now: () => Date
): void {
	const current = parsedTei.get(head.primary_path)?.record;
	if (!current) return;
	if (
		current.project_transcription_id !== head.project_transcription_id ||
		current.id !== head.transcription_id ||
		current.based_on_checkpoint?.id !== head.current_revision?.id
	) {
		quarantined.push(
			quarantine(
				head.primary_path,
				'Manifest transcription head does not match its primary.',
				now
			)
		);
		return;
	}
	const expected = head.current_revision?.content_hash;
	const mismatch = (path: string, actual: string | undefined) =>
		quarantined.push(
			record(
				path,
				{
					code: 'hash_mismatch',
					message: 'Transcription content hash does not match its manifest head.',
					expected,
					actual,
				},
				now
			)
		);
	if (current.based_on_checkpoint?.content_hash !== expected)
		mismatch(head.primary_path, current.based_on_checkpoint?.content_hash);
	if (!head.current_revision) return;
	const versionPath = documentVersionPath(
		'transcription',
		head.project_transcription_id,
		head.current_revision.id
	);
	const version = parsedTei.get(versionPath);
	if (version && version.contentHash !== expected) mismatch(versionPath, version.contentHash);
}

function validateTeiCollationHead(
	projectId: string,
	head: ProjectManifestPayload['collations'][number],
	parsed: ReadonlyMap<string, ParsedCollationTeiEntry>,
	quarantined: StoreQuarantineRecord[],
	now: () => Date
): void {
	const current = parsed.get(head.primary_path)?.payload;
	if (!current) return;
	if (
		current.project_id !== projectId ||
		current.id !== head.collation_id ||
		current.based_on_checkpoint?.id !== head.current_revision?.id
	) {
		quarantined.push(
			quarantine(
				head.primary_path,
				'Manifest collation head does not match its primary.',
				now
			)
		);
		return;
	}
	const expected = head.current_revision?.content_hash;
	const mismatch = (path: string, actual: string | undefined) =>
		quarantined.push(
			record(
				path,
				{
					code: 'hash_mismatch',
					message: 'Collation content hash does not match its manifest head.',
					expected,
					actual,
				},
				now
			)
		);
	if (current.based_on_checkpoint?.content_hash !== expected)
		mismatch(head.primary_path, current.based_on_checkpoint?.content_hash);
	if (!head.current_revision) return;
	const versionPath = documentVersionPath(
		'collation',
		head.collation_id,
		head.current_revision.id
	);
	const version = parsed.get(versionPath);
	if (version && version.contentHash !== expected) mismatch(versionPath, version.contentHash);
}

function legacyHeadsOfManifest(manifest: ProjectManifestPayload | null): Set<string> {
	return new Set([
		...(manifest?.transcriptions ?? [])
			.filter(head => documentStorageOfPath(head.primary_path) === 'json')
			.map(head => `transcription:${head.project_transcription_id}`),
		...(manifest?.collations ?? [])
			.filter(head => documentStorageOfPath(head.primary_path) === 'json')
			.map(head => `collation:${head.collation_id}`),
	]);
}

function legacyHeadKey(file: DocumentFile): string {
	return `${file.kind}:${file.entityId}`;
}

function failedStaging(
	stagingPath: string,
	message: string,
	storeOptions: StoreOperationOptions,
	now: () => Date
): ValidatedProjectFileCandidates {
	return {
		stagingPath,
		entries: [],
		valid: [],
		manifest: null,
		quarantinedFiles: [quarantine('', message, now)],
		cleanup: () => deleteDirectoryIfExists(stagingPath, storeOptions),
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

function record(
	path: string,
	reason: Omit<StoreQuarantineRecord, 'path' | 'timestamp'>,
	now: () => Date
): StoreQuarantineRecord {
	return { path, timestamp: now().toISOString(), ...reason };
}

function quarantine(path: string, message: string, now: () => Date): StoreQuarantineRecord {
	return { path, code: 'invalid_shape', message, timestamp: now().toISOString() };
}

function createNonce(): string {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2, 14);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isMissingStoreEntryError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException)
		return error.name === 'NotFoundError';
	return error instanceof Error && /not found/i.test(error.message);
}
