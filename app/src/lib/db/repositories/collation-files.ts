import type { Kysely } from 'kysely';

import {
	COLLATION_CHECKPOINT_CURRENT_VERSION,
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_CURRENT_VERSION,
	COLLATION_FORMAT,
	collationPayloadToContent,
	mergeWorkingCollation,
	readCanonicalDocument,
	WORKING_COLLATION_FORMAT,
	type CollationCheckpointPayload as CanonicalCollationCheckpointPayload,
	type CollationContent,
	type CollationPayload,
	type WorkingCollationPayload,
} from '$lib/storage/formats';
import {
	collationCheckpointFile,
	collationPrimaryFile,
	collationTeiFile,
	collationWorkingFile,
} from '$lib/storage/layout';
import {
	deleteFile,
	readTextFile,
	writeTextFileAtomic,
	type StoreOperationOptions,
} from '$lib/storage/opfs-store';
import { recordStoreQuarantine, invalidShape, quarantineFromError } from '$lib/storage/quarantine';
import {
	sealDocument,
	serializeSealedDocument,
	type JsonObject,
	type JsonValue,
} from '$lib/storage/envelope';
import {
	COLLATION_DOCUMENT_ARTIFACT_TYPE,
	buildCollationDocument,
	parseCollationDocument,
	serializeCollationDocument,
	type CollationDocument as SemanticCollationDocument,
} from '$lib/collation/collation-document';
import { exportCollationDocumentTei } from '$lib/collation/collation-tei';
import { parseProjectCollationSettings } from '$lib/collation/project-settings';
import type { ReadingTypeDefinition } from '$lib/collation/reading-types';
import { buildCollationProjectionFromDocument } from '$lib/collation/collation-projection';
import { hashCanonicalPayload } from '$lib/storage/canonical-json';
import { deriveEntityCloudBackupState } from '$lib/backup/backup-status';

import type { Database } from '../types.generated';
import { createId } from './id';
import { writeProjectManifestFile } from './project-files';
import { withProjectWriteLock } from './project-locks';
import {
	createCollation,
	getCollationWitnessSourceStatuses,
	saveCollationProjection,
	updateCollationMetadata,
	type CreateCollationInput,
	type CollationArtifactRecord,
	type CollationVersionStatus,
	type CollationVersionStatusOptions,
	type LoadedCollation,
	type SaveCollationArtifactInput,
	type UpdateCollationMetadataInput,
} from './collations';
import {
	getCollationCommittedHead,
	recordCommittedCollationCheckpoint,
	loadSerializedCollation,
	nextCollationVersionLabel,
	rewriteVersionNote,
	type CollationCheckpoint,
	type CommitCollationInput,
	type PersistenceWarning,
	type PersistenceResult,
	type SerializedCollation,
} from './revisions';
import type { DbExecutor } from '../worker-kysely';

interface CollationFileContext {
	collationId: string;
	projectId: string;
	projectStorageSlug: string;
	projectReadingTypes: ReadingTypeDefinition[];
	currentRevisionId: string | null;
	currentContentHash: string | null;
	conflictOfCollationId: string;
	createdAt: string;
	updatedAt: string;
}

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
	await writeCurrentCollationFiles(
		context,
		buildCurrentCollationContent(collation, semanticDocument),
		updatedAt,
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
	const source = await tryReadPrimaryCollationPayload(context, storeOptions);
	if (!source) throw new Error(`Canonical collation file for ${input.id} was not found.`);
	const updatedAt = input.updatedAt ?? new Date().toISOString();
	await writeCurrentCollationFiles(
		context,
		{
			...collationPayloadToContent(source),
			title: input.title ?? source.title,
			verse_identifier: input.verseIdentifier ?? source.verse_identifier,
			status: input.status ?? source.status,
			notes: input.notes ?? source.notes,
			group_path: input.groupPath ?? source.group_path,
			sort_key: input.sortKey ?? source.sort_key,
		},
		updatedAt,
		storeOptions
	);
	await updateCollationMetadata(db, input);
}

export async function createCollationWithFilesResult(
	db: Kysely<Database>,
	input: CreateCollationInput,
	storeOptions: StoreOperationOptions = {}
): Promise<PersistenceResult<string>> {
	const segment = input.segment;
	if (!segment) throw new Error('Collation segment is required.');
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
			segment,
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
			unitDecisions: new Map(),
			readingArcs: new Map(),
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
		const source = await tryReadPrimaryCollationPayload(context, storeOptions);
		if (!source)
			throw new Error(`Canonical collation file for ${context.collationId} was not found.`);
		const payload = collationPayloadToContent(source);
		const contentHash = await hashCanonicalPayload(payload);
		const checkpointId = input.checkpointId ?? createId();
		const createdAt = input.createdAt ?? new Date().toISOString();
		const authorName = input.authorName ?? '';
		const commitMessage = input.commitMessage ?? null;
		const label =
			input.label?.trim() || (await nextCollationVersionLabel(db, context.collationId));
		const checkpointPayload: CanonicalCollationCheckpointPayload = {
			checkpoint_id: checkpointId,
			entity_type: 'collation',
			entity_id: payload.id,
			parent_checkpoint_id: context.currentRevisionId,
			payload_content_hash: contentHash,
			label,
			commit_message: commitMessage,
			author_name: authorName,
			created_at: createdAt,
			metadata_updated_at: createdAt,
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
			...source,
			based_on_checkpoint: { id: checkpointId, content_hash: contentHash },
		};
		await writeSealedJsonFile(
			collationPrimaryFile(context.projectStorageSlug, context.collationId),
			COLLATION_FORMAT,
			COLLATION_CURRENT_VERSION,
			primaryPayload,
			storeOptions
		);
		const teiWarning = await writeDerivedCollationTei(context, primaryPayload, storeOptions);
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
			payload.id,
			contentHash,
			payload,
			{
				...input,
				checkpointId,
				label,
				createdAt,
				authorName,
				commitMessage,
			}
		);
		return { ...checkpoint, warnings: teiWarning ? [teiWarning] : [] };
	});
}

async function readCollationVersion(
	context: CollationFileContext,
	collationId: string,
	checkpointId: string,
	storeOptions: StoreOperationOptions
): Promise<CanonicalCollationCheckpointPayload> {
	const path = collationCheckpointFile(context.projectStorageSlug, collationId, checkpointId);
	const read = await readCanonicalDocument<CanonicalCollationCheckpointPayload>(
		COLLATION_CHECKPOINT_FORMAT,
		await readTextFile(path, storeOptions)
	);
	if (!read.ok) throw new Error(`Invalid version file ${path}: ${read.quarantine.code}`);
	if (read.payload.entity_id !== collationId) {
		throw new Error('Version does not belong to this collation.');
	}
	return read.payload;
}

export async function loadCollationVersionDocument(
	db: Kysely<Database>,
	collationId: string,
	checkpointId: string | null,
	storeOptions: StoreOperationOptions = {}
): Promise<SemanticCollationDocument> {
	if (!checkpointId) {
		return (await loadCommittedCollationPayloadWithFiles(db, collationId, storeOptions))
			.document;
	}
	const context = await loadCollationFileContext(db, collationId);
	return (await readCollationVersion(context, collationId, checkpointId, storeOptions)).payload
		.document;
}

export async function restoreCollationVersion(
	db: Kysely<Database>,
	collationId: string,
	checkpointId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<CollationPayload> {
	const context = await loadCollationFileContext(db, collationId);
	const previous = await tryReadPrimaryCollationPayload(context, storeOptions);
	if (!previous) throw new Error(`Current for collation ${collationId} was not found.`);
	const version = await readCollationVersion(context, collationId, checkpointId, storeOptions);
	const now = new Date().toISOString();
	await replaceCollationCurrent(
		db,
		collationId,
		{
			...version.payload,
			based_on_checkpoint: {
				id: version.checkpoint_id,
				content_hash: version.payload_content_hash,
			},
			draft: { saved_at: now, author_name: null },
			created_at: previous.created_at,
			updated_at: now,
			...(previous.conflict_of_collation_id
				? { conflict_of_collation_id: previous.conflict_of_collation_id }
				: {}),
		},
		storeOptions
	);
	return previous;
}

export async function replaceCollationCurrent(
	db: Kysely<Database>,
	collationId: string,
	payload: CollationPayload,
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	const context = await loadCollationFileContext(db, collationId);
	if (payload.id !== collationId || payload.project_id !== context.projectId) {
		throw new Error('Current does not belong to this collation.');
	}
	await withProjectWriteLock(context.projectId, async () => {
		await writeSealedJsonFile(
			collationPrimaryFile(context.projectStorageSlug, collationId),
			COLLATION_FORMAT,
			COLLATION_CURRENT_VERSION,
			payload,
			storeOptions
		);
		await writeDerivedCollationTei(context, payload, storeOptions);
		await db.transaction().execute(async trx => {
			await trx
				.updateTable('collations')
				.set({
					current_revision_id: payload.based_on_checkpoint?.id ?? '',
					current_content_hash: payload.based_on_checkpoint?.content_hash ?? '',
					title: payload.title,
					verse_identifier: payload.verse_identifier,
					status: payload.status,
					group_path: payload.group_path,
					notes: payload.notes,
					sort_key: payload.sort_key,
					updated_at: payload.updated_at,
				})
				.where('id', '=', collationId)
				.execute();
			await saveCollationProjection(trx, {
				collationId,
				...buildCollationProjectionFromDocument(payload.document),
			});
		});
		await writeProjectManifestFile(db, context.projectId, {}, storeOptions);
	});
}

export async function updateCollationVersionNote(
	db: Kysely<Database>,
	collationId: string,
	checkpointId: string,
	note: string | null,
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	const context = await loadCollationFileContext(db, collationId);
	const row = await db
		.selectFrom('collation_checkpoints')
		.select('label')
		.where('id', '=', checkpointId)
		.where('collation_id', '=', collationId)
		.executeTakeFirst();
	if (!row) throw new Error(`Version ${checkpointId} was not found.`);
	await withProjectWriteLock(context.projectId, async () => {
		const updated = await rewriteVersionNote<CanonicalCollationCheckpointPayload>(
			collationCheckpointFile(context.projectStorageSlug, collationId, checkpointId),
			COLLATION_CHECKPOINT_FORMAT,
			COLLATION_CHECKPOINT_CURRENT_VERSION,
			{ label: row.label, note, updatedAt: new Date().toISOString() },
			storeOptions
		);
		await db
			.updateTable('collation_checkpoints')
			.set({ label: updated.label, commit_message: updated.commit_message })
			.where('id', '=', checkpointId)
			.execute();
	});
}

export async function loadCollationWithWorkingFile(
	db: Kysely<Database>,
	collationId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<LoadedCollation | null> {
	const row = await db
		.selectFrom('collations')
		.select('id')
		.where('id', '=', collationId)
		.executeTakeFirst();
	if (!row) return null;
	const context = await loadCollationFileContext(db, collationId);
	const primaryPayload = await tryReadPrimaryCollationPayload(context, storeOptions);
	if (primaryPayload) return loadedCollationFromPrimaryPayload(primaryPayload);
	return null;
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
	storeOptions: StoreOperationOptions = {}
): Promise<CollationVersionStatus> {
	const row = await db
		.selectFrom('collations')
		.innerJoin('projects', 'projects.id', 'collations.project_id')
		.select([
			'collations.id as id',
			'collations.project_id as project_id',
			'projects.name as project_name',
			'collations.title as title',
			'collations.verse_identifier as verse_identifier',
			'collations.status as status',
		])
		.where('collations.id', '=', collationId)
		.executeTakeFirst();
	if (!row) throw new Error(`Collation ${collationId} was not found.`);
	const context = await loadCollationFileContext(db, collationId);
	const primaryPayload = await tryReadPrimaryCollationPayload(context, storeOptions);
	if (!primaryPayload)
		throw new Error(`Canonical collation file for ${collationId} was not found.`);
	const base = {
		projectId: row.project_id,
		projectName: row.project_name,
		collationId,
		title: row.title,
		verseIdentifier: row.verse_identifier,
		workflowStatus: row.status,
		currentCheckpoint: await getCollationCommittedHead(db, collationId),
		witnesses: await getCollationWitnessSourceStatuses(db, collationId),
	};
	return collationVersionStatusFromSerialized(db, base, primaryPayload, options);
}

async function collationVersionStatusFromSerialized(
	db: Kysely<Database>,
	base: Omit<
		CollationVersionStatus,
		'workingContentHash' | 'dirtyToCheckpoint' | 'commitState' | 'cloudBackupState'
	>,
	payload: CollationPayload,
	options: CollationVersionStatusOptions
): Promise<CollationVersionStatus> {
	const content = collationPayloadToContent(payload);
	const workingContentHash = await hashCanonicalPayload(content);
	const dirtyToCheckpoint = base.currentCheckpoint
		? workingContentHash !== base.currentCheckpoint.contentHash
		: true;
	const commitState = base.currentCheckpoint
		? dirtyToCheckpoint
			? 'dirty'
			: 'clean'
		: 'never-committed';
	const cloudBackupState = await deriveEntityCloudBackupState(
		db,
		options.syncContext,
		{ entityType: 'collation', entityId: content.id },
		base.currentCheckpoint,
		dirtyToCheckpoint
	);

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
	storeOptions: StoreOperationOptions = {}
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
			'projects.collation_settings as collation_settings',
			'collations.current_revision_id as current_revision_id',
			'collations.current_content_hash as current_content_hash',
			'collations.conflict_of_collation_id as conflict_of_collation_id',
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
		projectReadingTypes:
			parseProjectCollationSettings(row.collation_settings).readingTypes ?? [],
		currentRevisionId: emptyToNull(row.current_revision_id),
		currentContentHash: emptyToNull(row.current_content_hash),
		conflictOfCollationId: row.conflict_of_collation_id,
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
	context: CollationFileContext,
	payload: CollationPayload,
	storeOptions: StoreOperationOptions
): Promise<PersistenceWarning | null> {
	const { projectStorageSlug, collationId, projectReadingTypes } = context;
	const path = collationTeiFile(projectStorageSlug, collationId);
	try {
		await writeTextFileAtomic(
			path,
			exportCollationDocumentTei(payload.document, projectReadingTypes),
			storeOptions
		);
		return null;
	} catch (error) {
		try {
			await deleteFile(path, storeOptions);
		} catch (deleteError) {
			if (!isMissingFileError(deleteError)) {
				console.warn('[document-store] Could not remove stale derived collation TEI.', {
					collationId,
					error: errorMessage(deleteError),
				});
			}
		}
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

function buildCurrentCollationContent(
	collation: SerializedCollation,
	document: SemanticCollationDocument
): CollationContent {
	return {
		id: collation.id,
		project_id: collation.project_id,
		title: collation.title,
		verse_identifier: collation.verse_identifier,
		status: document.flow.phase === 'stemma' ? 'complete' : document.flow.phase,
		group_path: collation.group_path,
		notes: collation.notes,
		sort_key: collation.sort_key,
		document: document as SemanticCollationDocument & JsonObject,
	};
}

async function writeCurrentCollationFiles(
	context: CollationFileContext,
	content: CollationContent,
	updatedAt: string,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const payload: CollationPayload = {
		...content,
		based_on_checkpoint:
			context.currentRevisionId && context.currentContentHash
				? { id: context.currentRevisionId, content_hash: context.currentContentHash }
				: null,
		draft: { saved_at: updatedAt, author_name: null },
		created_at: context.createdAt,
		updated_at: updatedAt,
		...(context.conflictOfCollationId
			? { conflict_of_collation_id: context.conflictOfCollationId }
			: {}),
	};
	await writeSealedJsonFile(
		collationPrimaryFile(context.projectStorageSlug, context.collationId),
		COLLATION_FORMAT,
		COLLATION_CURRENT_VERSION,
		payload,
		storeOptions
	);
	await writeDerivedCollationTei(context, payload, storeOptions);
}

async function tryReadWorkingCollationPayload(
	context: CollationFileContext,
	storeOptions: StoreOperationOptions
): Promise<WorkingCollationPayload | null> {
	const path = collationWorkingFile(context.projectStorageSlug, context.collationId);
	let raw: string;
	try {
		raw = await readTextFile(path, storeOptions);
	} catch (error) {
		if (!isMissingFileError(error)) {
			recordStoreQuarantine(storeOptions.quarantineSink, path, quarantineFromError(error));
			console.warn('[document-store] Could not read canonical collation content.', {
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
		const payload = result.payload;
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
		console.warn('[document-store] Could not read canonical collation content.', {
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
	return migrateLegacyWorkingCollation(context, payload, storeOptions);
}

async function migrateLegacyWorkingCollation(
	context: CollationFileContext,
	primary: CollationPayload,
	storeOptions: StoreOperationOptions
): Promise<CollationPayload> {
	const working = await tryReadWorkingCollationPayload(context, storeOptions);
	if (
		!working ||
		working.draft.base_revision_id !== (primary.based_on_checkpoint?.id ?? null) ||
		working.draft.base_content_hash !== (primary.based_on_checkpoint?.content_hash ?? null)
	) {
		return primary;
	}
	const current = mergeWorkingCollation(primary, working);
	await writeSealedJsonFile(
		collationPrimaryFile(context.projectStorageSlug, context.collationId),
		COLLATION_FORMAT,
		COLLATION_CURRENT_VERSION,
		current,
		storeOptions
	);
	await writeDerivedCollationTei(context, current, storeOptions);
	await deleteFile(
		collationWorkingFile(context.projectStorageSlug, context.collationId),
		storeOptions
	);
	return current;
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
