import {
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_FORMAT,
	PROJECT_MANIFEST_FORMAT,
	PROJECT_TRANSCRIPTION_FORMAT,
	TOMBSTONE_FORMAT,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	WORKING_COLLATION_FORMAT,
	WORKING_TRANSCRIPTION_FORMAT,
	canonicalFormatForProjectPath,
	deleteDirectory,
	joinStorePath,
	readCanonicalDocument,
	writeTextFileAtomic,
	type CollationCheckpointPayload,
	type CollationPayload,
	type JsonObject,
	type ProjectManifestPayload,
	type ProjectTranscriptionPayload,
	type StoreOperationOptions,
	type StoreQuarantineRecord,
	type TombstonePayload,
	type TranscriptionCheckpointPayload,
	type WorkingCollationPayload,
	type WorkingTranscriptionPayload,
} from '$lib/client/store';
import { hashCanonicalPayload } from './canonical-json';

export interface ProjectFileCandidate {
	path: string;
	content: string;
}

export interface ValidateProjectFileCandidatesOptions {
	projectId?: string;
	requireManifest?: boolean;
	storeOptions?: StoreOperationOptions;
	nonce?: () => string;
	now?: () => Date;
	ownerId?: string;
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
		await writeTextFileAtomic(
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
			manifestEntry.content,
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

	for (const entry of normalized) {
		if (entry === manifestEntry) continue;
		const format = canonicalFormatForProjectPath(entry.path);
		if (!format) {
			if (isCanonicalTeiPath(entry.path)) entries.push({ ...entry, format: null });
			else
				quarantinedFiles.push(
					quarantine(entry.path, `Unsupported project file ${entry.path}.`, now)
				);
			continue;
		}
		const read = await readCanonicalDocument(format, entry.content, {
			projectPath: entry.path,
			projectId,
		});
		if (read.ok) entries.push({ ...entry, format, payload: read.payload });
		else quarantinedFiles.push(record(entry.path, read.quarantine, now));
	}

	if (manifest && quarantinedFiles.length === 0) {
		await validateProjectSemantics(manifest, entries, quarantinedFiles, now);
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

export function normalizeProjectEntryPath(path: string): string {
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
	return original.map(entry => {
		const path = root ? entry.path.slice(root.length + 1) : entry.path;
		if (seen.has(path))
			throw new Error(`Duplicate project entry path ${JSON.stringify(path)}.`);
		seen.add(path);
		return { ...entry, path };
	});
}

async function validateProjectSemantics(
	manifest: ProjectManifestPayload,
	entries: ValidatedStagedProjectEntry[],
	quarantined: StoreQuarantineRecord[],
	now: () => Date
): Promise<void> {
	const byPath = new Map(entries.map(entry => [entry.path, entry]));
	for (const head of manifest.transcriptions) {
		const entry = byPath.get(head.primary_path);
		const payload = entry?.payload as ProjectTranscriptionPayload | undefined;
		if (!payload || entry?.format !== PROJECT_TRANSCRIPTION_FORMAT) {
			quarantined.push(
				quarantine(head.primary_path, 'Manifest transcription primary is missing.', now)
			);
			continue;
		}
		if (
			payload.project_transcription_id !== head.project_transcription_id ||
			payload.id !== head.transcription_id ||
			payload.title !== head.title ||
			payload.siglum !== head.siglum ||
			payload.current_revision.id !== head.current_revision?.id ||
			payload.current_revision.content_hash !== head.current_revision?.content_hash
		)
			quarantined.push(
				quarantine(
					head.primary_path,
					'Manifest transcription head does not match its primary.',
					now
				)
			);
	}
	for (const head of manifest.collations) {
		const entry = byPath.get(head.primary_path);
		const payload = entry?.payload as CollationPayload | undefined;
		if (!payload || entry?.format !== COLLATION_FORMAT) {
			quarantined.push(
				quarantine(head.primary_path, 'Manifest collation primary is missing.', now)
			);
			continue;
		}
		if (
			payload.project_id !== manifest.id ||
			payload.id !== head.collation_id ||
			payload.title !== head.title ||
			payload.verse_identifier !== head.verse_identifier ||
			payload.current_revision.id !== head.current_revision?.id ||
			payload.current_revision.content_hash !== head.current_revision?.content_hash
		)
			quarantined.push(
				quarantine(
					head.primary_path,
					'Manifest collation head does not match its primary.',
					now
				)
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
		const payload = entry.payload;
		let message: string | null = null;
		if (
			entry.format === PROJECT_TRANSCRIPTION_FORMAT &&
			!manifest.transcriptions.some(head => head.primary_path === entry.path)
		)
			message = 'Transcription primary is not present in the manifest.';
		else if (
			entry.format === COLLATION_FORMAT &&
			!manifest.collations.some(head => head.primary_path === entry.path)
		)
			message = 'Collation primary is not present in the manifest.';
		else if (entry.format === TOMBSTONE_FORMAT && !tombstonePaths.has(entry.path))
			message = 'Tombstone is not present in the manifest.';
		else if (entry.format === null) {
			const match = /^(transcriptions|collations)\/([^/]+)\.tei\.xml$/.exec(entry.path);
			if (match?.[1] === 'transcriptions' && !transcriptionHeads.has(match[2]!))
				message = 'TEI sibling has no manifest transcription.';
			if (match?.[1] === 'collations' && !collationHeads.has(match[2]!))
				message = 'TEI sibling has no manifest collation.';
		} else if (entry.format === WORKING_TRANSCRIPTION_FORMAT) {
			const working = payload as WorkingTranscriptionPayload;
			const head = transcriptionHeads.get(String(working.project_transcription_id));
			if (
				!head ||
				working.id !== head.transcription_id ||
				working.draft.base_revision_id !== head.current_revision?.id ||
				working.draft.base_content_hash !== head.current_revision?.content_hash
			)
				message = 'Working transcription does not match its committed primary.';
		} else if (entry.format === WORKING_COLLATION_FORMAT) {
			const working = payload as WorkingCollationPayload;
			const head = collationHeads.get(working.id);
			if (
				!head ||
				working.project_id !== manifest.id ||
				working.draft.base_revision_id !== head.current_revision?.id ||
				working.draft.base_content_hash !== head.current_revision?.content_hash
			)
				message = 'Working collation does not match its committed primary.';
		} else if (entry.format === TRANSCRIPTION_CHECKPOINT_FORMAT) {
			const checkpoint = payload as TranscriptionCheckpointPayload;
			const head = transcriptionHeads.get(checkpoint.entity_id);
			if (!head || checkpoint.payload_transcription_id !== head.transcription_id)
				message = 'Transcription checkpoint does not belong to a manifest transcription.';
		} else if (entry.format === COLLATION_CHECKPOINT_FORMAT) {
			const checkpoint = payload as CollationCheckpointPayload;
			if (
				!collationHeads.has(checkpoint.entity_id) ||
				checkpoint.payload.project_id !== manifest.id
			)
				message = 'Collation checkpoint does not belong to this project.';
		}
		if (message) quarantined.push(quarantine(entry.path, message, now));
	}
}

function isCanonicalTeiPath(path: string): boolean {
	return /^(transcriptions|collations)\/[^/]+\.tei\.xml$/.test(path);
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
