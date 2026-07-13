import type { Kysely, Transaction } from 'kysely';

import {
	COLLATION_CHECKPOINT_CURRENT_VERSION,
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_CURRENT_VERSION,
	COLLATION_FORMAT,
	assertCollationRevisionHash,
	collationCheckpointFile,
	collationDocumentToTei,
	collationPrimaryFile,
	collationTeiFile,
	collationWorkingFile,
	deleteFile,
	readCanonicalDocument,
	readTextFile,
	recordStoreQuarantine,
	sealDocument,
	serializeSealedDocument,
	WORKING_COLLATION_CURRENT_VERSION,
	WORKING_COLLATION_FORMAT,
	writeTextFileAtomic,
	type JsonObject,
	type JsonValue,
	type CollationCheckpointPayload as CanonicalCollationCheckpointPayload,
	type CollationContent,
	type CollationPayload,
	type StoreOperationOptions,
	type WorkingCollationPayload,
	invalidShape,
	quarantineFromError,
} from '$lib/client/store';
import {
	COLLATION_DOCUMENT_ARTIFACT_TYPE,
	buildCollationDocument,
	parseCollationDocument,
	serializeCollationDocument,
	type CollationDocument as SemanticCollationDocument,
} from '$lib/client/collation/collation-document';
import {
	buildCollationProjectionFromDocument,
	buildSerializedCollationProjectionRows,
} from '$lib/client/collation/collation-projection';
import { hashCanonicalPayload } from '$lib/client/sync/canonical-json';
import { deriveEntityCloudBackupState } from '$lib/client/sync/backup-status';

import type { Database } from '../types.generated';
import { createId } from './id';
import { writeProjectManifestFile } from './project-files';
import { withProjectWriteLock } from './project-locks';
import {
	createCollation,
	getCollationVersionStatus,
	loadCollation,
	saveCollationProjection,
	updateCollationMetadata,
	type CreateCollationInput,
	type CollationArtifactRecord,
	type CollationProjectionRecord,
	type CollationVersionStatus,
	type CollationVersionStatusOptions,
	type LoadedCollation,
	type SaveCollationArtifactInput,
	type UpdateCollationMetadataInput,
} from './collations';
import {
	recordCommittedCollationCheckpoint,
	loadSerializedCollation,
	type CollationCheckpoint,
	type CommitCollationInput,
	type PersistenceWarning,
	type PersistenceResult,
	type SerializedCollation,
} from './revisions';

interface CollationFileContext {
	collationId: string;
	projectId: string;
	projectStorageSlug: string;
	currentRevisionId: string | null;
	currentContentHash: string | null;
	createdAt: string;
	updatedAt: string;
}

type DbExecutor = Kysely<Database> | Transaction<Database>;

interface CollationCommitSource {
	content: CollationContent;
	createdAt: string;
	updatedAt: string;
}

interface FileBackedCollationLoadOptions extends StoreOperationOptions {
	allowIndexFallback?: boolean;
}

type LoadedWorkingCollationPayload = WorkingCollationPayload;

export async function saveWorkingCollationArtifact(
	db: DbExecutor,
	input: SaveCollationArtifactInput,
	storeOptions: StoreOperationOptions = {}
): Promise<string> {
	const updatedAt = input.now ?? new Date().toISOString();
	const [context, collation] = await Promise.all([
		loadCollationFileContext(db, input.collationId),
		loadSerializedCollation(db, input.collationId),
	]);
	if (input.artifactType !== COLLATION_DOCUMENT_ARTIFACT_TYPE) {
		throw new Error(`Unsupported canonical collation document type ${input.artifactType}.`);
	}
	const semanticDocument = parseCollationDocument(input.payload);
	if (!semanticDocument) throw new Error('Invalid collation_document_v1 document.');
	const artifactId = input.artifactId || crypto.randomUUID();
	const payload = buildWorkingCollationPayload(collation, context, semanticDocument, updatedAt);
	const document = await sealDocument(
		WORKING_COLLATION_FORMAT,
		WORKING_COLLATION_CURRENT_VERSION,
		payload
	);

	await writeTextFileAtomic(
		collationWorkingFile(context.projectStorageSlug, input.collationId),
		serializeSealedDocument(document),
		storeOptions
	);
	await saveCollationProjection(db, {
		collationId: input.collationId,
		...buildCollationProjectionFromDocument(semanticDocument),
	});
	return artifactId;
}

export async function saveWorkingCollationMetadata(
	db: Kysely<Database>,
	input: UpdateCollationMetadataInput,
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	const context = await loadCollationFileContext(db, input.id);
	const primary = await tryReadPrimaryCollationPayload(context, storeOptions);
	const working = await tryReadEligibleWorkingCollationPayload(context, primary, storeOptions);
	const source = working ?? primary;
	if (!source) throw new Error(`Canonical collation file for ${input.id} was not found.`);
	const updatedAt = input.updatedAt ?? new Date().toISOString();
	const payload: WorkingCollationPayload = {
		...collationContentFromPayload(source),
		title: input.title ?? source.title,
		status: input.status ?? source.status,
		notes: input.notes ?? source.notes,
		group_path: input.groupPath ?? source.group_path,
		sort_key: input.sortKey ?? source.sort_key,
		created_at: source.created_at,
		updated_at: updatedAt,
		draft: {
			base_revision_id: primary?.current_revision.id ?? context.currentRevisionId,
			base_content_hash: primary?.current_revision.content_hash ?? context.currentContentHash,
			saved_at: updatedAt,
			author_name: null,
		},
	};
	const document = await sealDocument(
		WORKING_COLLATION_FORMAT,
		WORKING_COLLATION_CURRENT_VERSION,
		payload
	);
	await writeTextFileAtomic(
		collationWorkingFile(context.projectStorageSlug, input.id),
		serializeSealedDocument(document),
		storeOptions
	);
	await updateCollationMetadata(db, input);
}

export async function createCollationWithFiles(
	db: Kysely<Database>,
	input: CreateCollationInput,
	storeOptions: StoreOperationOptions = {}
): Promise<string> {
	return (await createCollationWithFilesResult(db, input, storeOptions)).value;
}

export async function createCollationWithFilesResult(
	db: Kysely<Database>,
	input: CreateCollationInput,
	storeOptions: StoreOperationOptions = {}
): Promise<PersistenceResult<string>> {
	return db.transaction().execute(async trx => {
		const id = await createCollation(trx, input);
		const context = await loadCollationFileContext(trx, id);
		const projectName = await loadProjectName(trx, context.projectId);
		const document = buildCollationDocument({
		collationId: id,
		projectId: context.projectId,
		projectName,
		phase: 'setup',
		furthestPhase: 'setup',
		selectedVerse: {
			identifier: input.verseIdentifier,
			book: '',
			chapter: '',
			verse: '',
			count: 0,
		},
		selectedBook: '',
		selectedChapter: '',
		selectedVerseNum: '',
		witnesses: [],
		rules: [],
		ignoreWordBreaks: false,
		lowercase: false,
		ignoreTokenWhitespace: true,
		ignorePunctuation: false,
		suppliedTextMode: 'clear',
		segmentation: true,
		alignmentColumns: [],
		witnessOrder: [],
		classifiedReadings: new Map(),
		stemmaEdges: new Map(),
		alignmentDisplayMode: 'regularized',
		alignmentLayout: 'grid',
		});

		await saveWorkingCollationArtifact(
			trx,
			{
				collationId: id,
				artifactId: createId(),
				artifactType: COLLATION_DOCUMENT_ARTIFACT_TYPE,
				payload: serializeCollationDocument(document),
				now: context.createdAt,
			},
			storeOptions
		);
		const checkpoint = await createCommittedCollationCheckpointWithFiles(
			trx,
			{ collationId: id, createdAt: context.createdAt },
			storeOptions
		);
		return { value: id, warnings: checkpoint.warnings ?? [] };
	});
}

export async function createCommittedCollationCheckpointWithFiles(
	db: DbExecutor,
	input: CommitCollationInput,
	storeOptions: StoreOperationOptions = {}
): Promise<CollationCheckpoint> {
	const lockContext = await loadCollationFileContext(db, input.collationId);
	return withProjectWriteLock(lockContext.projectId, async () => {
		const context = await loadCollationFileContext(db, input.collationId);
		const source = await loadCollationCommitSource(db, context, storeOptions);
		const payload = source.content;
		const contentHash = await hashCanonicalPayload(payload);
		const checkpointId = input.checkpointId ?? createId();
		const createdAt = input.createdAt ?? new Date().toISOString();
		const authorName = input.authorName ?? '';
		const commitMessage = input.commitMessage ?? null;
		const checkpointPayload: CanonicalCollationCheckpointPayload = {
			checkpoint_id: checkpointId,
			entity_type: 'collation',
			entity_id: source.content.id,
			parent_checkpoint_id: context.currentRevisionId,
			payload_content_hash: contentHash,
			commit_message: commitMessage,
			author_name: authorName,
			created_at: createdAt,
			payload,
		};
		const checkpointPath = collationCheckpointFile(
			context.projectStorageSlug,
			context.collationId,
			checkpointId
		);
		await assertFileMissing(checkpointPath, storeOptions);
		await writeSealedJsonFile(
			checkpointPath,
			COLLATION_CHECKPOINT_FORMAT,
			COLLATION_CHECKPOINT_CURRENT_VERSION,
			checkpointPayload,
			storeOptions
		);

		const primaryPayload: CollationPayload = {
			...source.content,
			current_revision: {
				id: checkpointId,
				content_hash: contentHash,
				created_at: createdAt,
				author_name: authorName,
			},
			created_at: source.createdAt,
			updated_at: source.updatedAt,
		};
		await assertCollationRevisionHash(primaryPayload);
		await writeSealedJsonFile(
			collationPrimaryFile(context.projectStorageSlug, context.collationId),
			COLLATION_FORMAT,
			COLLATION_CURRENT_VERSION,
			primaryPayload,
			storeOptions
		);
		const teiWarning = await writeDerivedCollationTei(
			context.projectStorageSlug,
			context.collationId,
			primaryPayload,
			storeOptions
		);
		await writeProjectManifestFile(
			db,
			context.projectId,
			{
				collations: {
					[context.collationId]: { id: checkpointId, content_hash: contentHash },
				},
			},
			storeOptions
		);

		const checkpoint = await recordCommittedCollationCheckpoint(
			db,
			source.content.id,
			contentHash,
			payload,
			{
				...input,
				checkpointId,
				createdAt,
				authorName,
				commitMessage,
			}
		);
		try {
			await deleteFile(
				collationWorkingFile(context.projectStorageSlug, context.collationId),
				storeOptions
			);
		} catch (error) {
			if (!isMissingFileError(error)) throw error;
		}
		return { ...checkpoint, warnings: teiWarning ? [teiWarning] : [] };
	});
}

export async function loadCollationWithWorkingFile(
	db: Kysely<Database>,
	collationId: string,
	storeOptions: FileBackedCollationLoadOptions = {}
): Promise<LoadedCollation | null> {
	const loaded = await loadCollation(db, collationId);
	if (!loaded) return null;
	const context = await loadCollationFileContext(db, collationId);
	const primaryPayload = await tryReadPrimaryCollationPayload(context, storeOptions);
	const workingPayload = await tryReadEligibleWorkingCollationPayload(context, primaryPayload, storeOptions);
	if (workingPayload) return loadedCollationFromWorkingPayload(loaded, workingPayload);
	if (primaryPayload) return loadedCollationFromPrimaryPayload(primaryPayload);
	if (storeOptions.allowIndexFallback === false) return null;
	return loaded;
}

export async function loadSerializedCollationWithFiles(
	db: Kysely<Database>,
	collationId: string,
	storeOptions: FileBackedCollationLoadOptions = {}
): Promise<SerializedCollation> {
	const context = await loadCollationFileContext(db, collationId);
	const primaryPayload = await tryReadPrimaryCollationPayload(context, storeOptions);
	const workingPayload = await tryReadEligibleWorkingCollationPayload(context, primaryPayload, storeOptions);
	if (workingPayload) return serializedCollationFromPayload(workingPayload);
	if (primaryPayload) return serializedCollationFromPayload(primaryPayload);
	if (storeOptions.allowIndexFallback === false) {
		throw new Error(`Canonical collation file for ${collationId} was not found.`);
	}
	return loadSerializedCollation(db, collationId);
}

export async function loadCommittedCollationPayloadWithFiles(
	db: Kysely<Database>,
	collationId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<CollationPayload> {
	const context = await loadCollationFileContext(db, collationId);
	const payload = await tryReadPrimaryCollationPayload(context, storeOptions);
	if (!payload)
		throw new Error(`Canonical committed collation file for ${collationId} was not found.`);
	return payload;
}

export async function getCollationVersionStatusWithWorkingFile(
	db: Kysely<Database>,
	collationId: string,
	options: CollationVersionStatusOptions = {},
	storeOptions: FileBackedCollationLoadOptions = {}
): Promise<CollationVersionStatus> {
	const base = await getCollationVersionStatus(db, collationId, options);
	const context = await loadCollationFileContext(db, collationId);
	const primaryPayload = await tryReadPrimaryCollationPayload(context, storeOptions);
	const payload = await tryReadEligibleWorkingCollationPayload(context, primaryPayload, storeOptions);
	if (payload) return collationVersionStatusFromSerialized(db, base, payload, options);
	if (primaryPayload) {
		return collationVersionStatusFromSerialized(db, base, primaryPayload, options);
	}
	if (storeOptions.allowIndexFallback === false) {
		throw new Error(`Canonical collation file for ${collationId} was not found.`);
	}
	return base;
}

async function collationVersionStatusFromSerialized(
	db: Kysely<Database>,
	base: CollationVersionStatus,
	payload: LoadedWorkingCollationPayload | CollationPayload,
	options: CollationVersionStatusOptions
): Promise<CollationVersionStatus> {
	const content = collationContentFromPayload(payload);
	const workingContentHash = await hashCanonicalPayload(content);
	const dirtyToCheckpoint = base.currentCheckpoint
		? workingContentHash !== base.currentCheckpoint.contentHash
		: true;
	const commitState = base.currentCheckpoint
		? dirtyToCheckpoint
			? 'dirty'
			: 'clean'
		: 'never-committed';
	const cloudBackupState = options.syncContext
		? await deriveEntityCloudBackupState(
				db,
				options.syncContext,
				{ entityType: 'collation', entityId: content.id },
				base.currentCheckpoint,
				dirtyToCheckpoint
			)
		: base.cloudBackupState;

	return {
		...base,
		workingContentHash,
		dirtyToCheckpoint,
		commitState,
		cloudBackupState,
	};
}

export async function listProjectCollationVersionStatusesWithWorkingFiles(
	db: Kysely<Database>,
	projectId: string,
	options: CollationVersionStatusOptions = {},
	storeOptions: FileBackedCollationLoadOptions = {}
): Promise<CollationVersionStatus[]> {
	const rows = await db
		.selectFrom('collations')
		.select('id')
		.where('project_id', '=', projectId)
		.orderBy('updated_at', 'desc')
		.execute();
	return Promise.all(
		rows.map(row =>
			getCollationVersionStatusWithWorkingFile(
				db,
				requireString(row.id, 'collation id'),
				options,
				storeOptions
			)
		)
	);
}

async function loadCollationFileContext(
	db: DbExecutor,
	collationId: string
): Promise<CollationFileContext> {
	const row = await db
		.selectFrom('collations')
		.innerJoin('projects', 'projects.id', 'collations.project_id')
		.select([
			'collations.project_id as project_id',
			'projects.storage_slug as project_storage_slug',
			'collations.current_revision_id as current_revision_id',
			'collations.current_content_hash as current_content_hash',
			'collations.created_at as created_at',
			'collations.updated_at as updated_at',
		])
		.where('collations.id', '=', collationId)
		.executeTakeFirst();
	if (!row) throw new Error(`Collation ${collationId} was not found.`);
	return {
		collationId,
		projectId: requireString(row.project_id, 'project id'),
		projectStorageSlug: requireString(row.project_storage_slug, 'project storage slug'),
		currentRevisionId: emptyToNull(row.current_revision_id),
		currentContentHash: emptyToNull(row.current_content_hash),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function loadProjectName(db: DbExecutor, projectId: string): Promise<string | null> {
	const row = await db
		.selectFrom('projects')
		.select('name')
		.where('id', '=', projectId)
		.executeTakeFirst();
	return row?.name ?? null;
}

async function loadCollationCommitSource(
	db: Kysely<Database>,
	context: CollationFileContext,
	storeOptions: StoreOperationOptions
): Promise<CollationCommitSource> {
	const primaryPayload = await tryReadPrimaryCollationPayload(context, storeOptions);
	const workingPayload = await tryReadEligibleWorkingCollationPayload(context, primaryPayload, storeOptions);
	if (workingPayload) {
		return {
			content: collationContentFromPayload(workingPayload),
			createdAt: workingPayload.created_at,
			updatedAt: workingPayload.updated_at,
		};
	}
	if (primaryPayload) {
		return {
			content: collationContentFromPayload(primaryPayload),
			createdAt: primaryPayload.created_at,
			updatedAt: primaryPayload.updated_at,
		};
	}
	throw new Error(`Canonical collation file for ${context.collationId} was not found.`);
}

async function writeSealedJsonFile<
	TPayload extends Record<string, JsonValue>,
	TFormat extends string,
>(
	path: string,
	format: TFormat,
	schemaVersion: number,
	payload: TPayload,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const document = await sealDocument(format, schemaVersion, payload);
	await writeTextFileAtomic(path, serializeSealedDocument(document), storeOptions);
}

async function writeDerivedCollationTei(
	projectStorageSlug: string,
	collationId: string,
	payload: CollationPayload,
	storeOptions: StoreOperationOptions
): Promise<PersistenceWarning | null> {
	try {
		await writeTextFileAtomic(
			collationTeiFile(projectStorageSlug, collationId),
			collationDocumentToTei(payload.document),
			storeOptions
		);
		return null;
	} catch (error) {
		const message = errorMessage(error);
		console.warn('[document-store] Could not write derived collation TEI.', {
			collationId,
			error: message,
		});
		return {
			code: 'tei_write_failed',
			entityType: 'collation',
			entityId: collationId,
			message,
			recoverable: true,
		};
	}
}

async function assertFileMissing(path: string, storeOptions: StoreOperationOptions): Promise<void> {
	try {
		await readTextFile(path, storeOptions);
	} catch (error) {
		if (isMissingFileError(error)) return;
		throw error;
	}
	throw new Error(`Refusing to overwrite existing history file ${path}.`);
}

function buildWorkingCollationPayload(
	collation: SerializedCollation,
	context: CollationFileContext,
	document: SemanticCollationDocument,
	updatedAt: string
): WorkingCollationPayload {
	return {
		id: collation.id,
		project_id: collation.project_id,
		title: collation.title,
		verse_identifier: collation.verse_identifier,
		status: document.flow.phase === 'stemma' ? 'complete' : document.flow.phase,
		group_path: collation.group_path,
		notes: collation.notes,
		sort_key: collation.sort_key,
		created_at: context.createdAt,
		updated_at: updatedAt,
		document: document as SemanticCollationDocument & JsonObject,
		draft: {
			base_revision_id: context.currentRevisionId,
			base_content_hash: context.currentContentHash,
			saved_at: updatedAt,
			author_name: null,
		},
	};
}

async function tryReadWorkingCollationPayload(
	context: CollationFileContext,
	storeOptions: StoreOperationOptions
): Promise<LoadedWorkingCollationPayload | null> {
	const path = collationWorkingFile(context.projectStorageSlug, context.collationId);
	let raw: string;
	try {
		raw = await readTextFile(path, storeOptions);
	} catch (error) {
		if (!isMissingFileError(error)) {
			recordStoreQuarantine(storeOptions.quarantineSink, path, quarantineFromError(error));
			console.warn('[document-store] Falling back to collation index cache.', {
				path,
				error: errorMessage(error),
			});
		}
		return null;
	}
	const result = await readCanonicalDocument<WorkingCollationPayload>(
		WORKING_COLLATION_FORMAT,
		raw
	);
	if (result.ok) {
		const payload = result.payload as unknown as LoadedWorkingCollationPayload;
		if (payload.id !== context.collationId) {
			recordStoreQuarantine(
				storeOptions.quarantineSink,
				path,
				quarantineFromError(
					invalidShape('Collation working identity does not match its index context.')
				)
			);
			console.warn('[document-store] Ignoring mismatched collation working file.', {
				path,
				expectedCollationId: context.collationId,
				actualCollationId: payload.id,
			});
			return null;
		}
		return payload;
	}
	recordStoreQuarantine(storeOptions.quarantineSink, path, result.quarantine);
	console.warn('[document-store] Ignoring unreadable collation working file.', {
		path,
		quarantine: result.quarantine,
	});
	return null;
}

async function tryReadEligibleWorkingCollationPayload(
	context: CollationFileContext,
	primary: CollationPayload | null,
	storeOptions: StoreOperationOptions
): Promise<LoadedWorkingCollationPayload | null> {
	const working = await tryReadWorkingCollationPayload(context, storeOptions);
	if (!working || !primary) return working;
	if (
		working.draft.base_revision_id !== primary.current_revision.id ||
		working.draft.base_content_hash !== primary.current_revision.content_hash
	) {
		console.warn('[document-store] Ignoring stale collation working file.', {
			collationId: context.collationId,
		});
		return null;
	}
	const workingHash = await hashCanonicalPayload(collationContentFromPayload(working));
	return workingHash === primary.current_revision.content_hash ? null : working;
}

async function tryReadPrimaryCollationPayload(
	context: CollationFileContext,
	storeOptions: StoreOperationOptions
): Promise<CollationPayload | null> {
	const path = collationPrimaryFile(context.projectStorageSlug, context.collationId);
	let raw: string;
	try {
		raw = await readTextFile(path, storeOptions);
	} catch (error) {
		recordStoreQuarantine(storeOptions.quarantineSink, path, quarantineFromError(error));
		console.warn('[document-store] Falling back to collation index cache.', {
			path,
			error: errorMessage(error),
		});
		return null;
	}
	const result = await readCanonicalDocument<CollationPayload>(COLLATION_FORMAT, raw);
	if (!result.ok) {
		recordStoreQuarantine(storeOptions.quarantineSink, path, result.quarantine);
		console.warn('[document-store] Ignoring unreadable collation primary file.', {
			path,
			quarantine: result.quarantine,
		});
		return null;
	}
	const payload = result.payload;
	if (payload.id !== context.collationId || payload.project_id !== context.projectId) {
		recordStoreQuarantine(
			storeOptions.quarantineSink,
			path,
			quarantineFromError(
				invalidShape('Collation primary identity does not match its index context.')
			)
		);
		console.warn('[document-store] Ignoring mismatched collation primary file.', {
			path,
			expectedCollationId: context.collationId,
			actualCollationId: payload.id,
			expectedProjectId: context.projectId,
			actualProjectId: payload.project_id,
		});
		return null;
	}
	return payload;
}

function loadedCollationFromWorkingPayload(
	loaded: LoadedCollation,
	payload: LoadedWorkingCollationPayload
): LoadedCollation {
	return {
		row: {
			...loaded.row,
			projectId: payload.project_id,
			title: payload.title,
			verseIdentifier: payload.verse_identifier,
			status: payload.status,
			groupPath: payload.group_path,
			notes: payload.notes,
			sortKey: payload.sort_key,
			createdAt: payload.created_at,
			updatedAt: payload.updated_at,
		},
		artifact: artifactRecordFromDocument(payload.document, payload.updated_at),
		legacyArtifact: null,
		projection: projectionRecordFromDocument(payload.document),
	};
}

function loadedCollationFromPrimaryPayload(payload: CollationPayload): LoadedCollation {
	return {
		row: {
			id: payload.id,
			projectId: payload.project_id,
			title: payload.title,
			verseIdentifier: payload.verse_identifier,
			status: payload.status,
			groupPath: payload.group_path,
			notes: payload.notes,
			sortKey: payload.sort_key,
			createdAt: payload.created_at,
			updatedAt: payload.updated_at,
		},
		artifact: artifactRecordFromDocument(payload.document, payload.updated_at),
		legacyArtifact: null,
		projection: projectionRecordFromDocument(payload.document),
	};
}

function serializedCollationFromPayload(
	payload: LoadedWorkingCollationPayload | CollationPayload
): SerializedCollation {
	const projection = buildSerializedCollationProjectionRows(payload.id, payload.document);
	return {
		id: payload.id,
		project_id: payload.project_id,
		title: payload.title,
		verse_identifier: payload.verse_identifier,
		status: payload.status,
		group_path: payload.group_path,
		notes: payload.notes,
		sort_key: payload.sort_key,
		...projection,
		artifacts: [
			{
				id: `${payload.id}:document`,
				artifact_type: COLLATION_DOCUMENT_ARTIFACT_TYPE,
				payload: payload.document,
			},
		],
	};
}

function collationContentFromPayload(
	payload: LoadedWorkingCollationPayload | CollationPayload
): CollationContent {
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

function artifactRecordFromDocument(
	document: SemanticCollationDocument,
	updatedAt: string
): CollationArtifactRecord {
	return {
		id: `${document.meta.collationId ?? 'collation'}:document`,
		artifactType: COLLATION_DOCUMENT_ARTIFACT_TYPE,
		payload: serializeCollationDocument(document),
		createdAt: updatedAt,
	};
}

function projectionRecordFromDocument(
	document: SemanticCollationDocument
): CollationProjectionRecord {
	const projection = buildCollationProjectionFromDocument(document);
	return {
		witnesses: projection.witnesses,
		tokens: projection.tokens,
		variationUnits: projection.variationUnits.map((unit, unitIndex) => ({
			id: `unit:${unitIndex}`,
			...unit,
			readings: unit.readings.map((reading, readingIndex) => ({
				id: `unit:${unitIndex}:reading:${readingIndex}`,
				...reading,
			})),
		})),
	};
}

function emptyToNull(value: string | null): string | null {
	return value?.trim() ? value : null;
}

function requireString(value: string | null, label: string): string {
	if (!value) throw new Error(`Missing ${label}.`);
	return value;
}

function isMissingFileError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return /not found/i.test(errorMessage(error));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
