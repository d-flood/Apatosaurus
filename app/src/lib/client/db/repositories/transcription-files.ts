import type { Kysely, Transaction } from 'kysely';

import {
	coerceTranscriptionDocument,
	EMPTY_TRANSCRIPTION_DOC,
	TRANSCRIPTION_FORMAT,
	type StoredTranscriptionDocument,
} from '$lib/client/transcription/content';
import {
	PROJECT_TRANSCRIPTION_CURRENT_VERSION,
	PROJECT_TRANSCRIPTION_FORMAT,
	TRANSCRIPTION_CHECKPOINT_CURRENT_VERSION,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	assertProjectTranscriptionRevisionHash,
	readCanonicalDocument,
	readTextFile,
	recordStoreQuarantine,
	sealDocument,
	serializeSealedDocument,
	transcriptionCheckpointFile,
	transcriptionDocumentToTei,
	transcriptionPrimaryFile,
	transcriptionTeiFile,
	transcriptionWorkingFile,
	deleteFile,
	WORKING_TRANSCRIPTION_CURRENT_VERSION,
	WORKING_TRANSCRIPTION_FORMAT,
	writeTextFileAtomic,
	type JsonObject,
	type JsonValue,
	type ProjectTranscriptionPayload,
	type StoreOperationOptions,
	type TranscriptionCheckpointPayload as CanonicalTranscriptionCheckpointPayload,
	type WorkingTranscriptionPayload,
	invalidShape,
	quarantineFromError,
} from '$lib/client/store';

import type { Database } from '../types.generated';
import { createId } from './id';
import { writeProjectManifestFile } from './project-files';
import { withProjectWriteLock } from './project-locks';
import {
	buildTranscriptionHashPayload,
	createCommittedTranscriptionCheckpoint,
	deriveCheckpointStatus,
	getTranscriptionCommittedHead,
	hashCanonicalPayload,
	loadProjectTranscriptionSnapshot,
	type CommitTranscriptionInput,
	type ProjectTranscriptionCheckpointStatus,
	type ProjectTranscriptionSnapshot,
	type TranscriptionCheckpoint,
	type PersistenceWarning,
	type PersistenceResult,
} from './revisions';
import {
	createTranscription,
	createTranscriptions,
	getTranscription,
	replaceTranscriptionVerseIndexRows,
	updateTranscriptionContent,
	updateTranscriptionMetadata,
	type CreateTranscriptionInput,
	type TranscriptionRecord,
	type UpdateTranscriptionContentInput,
	type UpdateTranscriptionMetadataInput,
	type VerseIndexRebuildFailure,
	type VerseIndexRebuildResult,
} from './transcriptions';

type DbExecutor = Kysely<Database> | Transaction<Database>;

interface FileBackedLoadOptions extends StoreOperationOptions {
	allowIndexFallback?: boolean;
}

interface TranscriptionFileContext {
	transcriptionId: string;
	projectTranscriptionId: string;
	projectId: string;
	projectStorageSlug: string;
	canonicalTranscriptionId: string | null;
	currentRevisionId: string | null;
	currentContentHash: string | null;
	originType: string;
	originProjectId: string | null;
	originTranscriptionId: string | null;
	originRevisionId: string | null;
	originContentHash: string | null;
	createdAt: string;
	updatedAt: string;
}

interface LoadedWorkingTranscriptionPayload {
	project_transcription_id: string;
	id: string;
	canonical_transcription_id: string | null;
	origin: ProjectTranscriptionPayload['origin'];
	title: string;
	siglum: string;
	description: string;
	content_json: JsonValue;
	content_format: string;
	created_at: string;
	updated_at: string;
	owner: string | null;
	is_public: boolean;
	tags: string[];
	transcriber: string;
	repository: string;
	settlement: string;
	language: string;
	iiif_manifest_sources: ProjectTranscriptionPayload['iiif_manifest_sources'];
	page_canvas_links: ProjectTranscriptionPayload['page_canvas_links'];
	canvas_annotations: ProjectTranscriptionPayload['canvas_annotations'];
	draft: WorkingTranscriptionPayload['draft'];
}

interface NormalizedWorkingTranscriptionContent {
	contentJson: string;
	document: StoredTranscriptionDocument;
	jsonValue: JsonValue;
}

export async function saveWorkingTranscriptionContent(
	db: Kysely<Database>,
	input: UpdateTranscriptionContentInput,
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	const content = normalizeWorkingTranscriptionContent(input, input.id);
	const updatedAt = input.updatedAt ?? new Date().toISOString();
	const context = await loadTranscriptionFileContext(db, input.id);
	const snapshot = await loadProjectTranscriptionSnapshot(db, context.projectTranscriptionId);
	const contentFormat = input.format ?? snapshot.format ?? TRANSCRIPTION_FORMAT;
	const payload = {
		project_transcription_id: snapshot.project_transcription_id,
		id: snapshot.id,
		canonical_transcription_id: context.canonicalTranscriptionId,
		origin: {
			source_type: context.originType,
			source_project_id: context.originProjectId,
			source_transcription_id: context.originTranscriptionId,
			source_revision_id: context.originRevisionId,
			source_content_hash: context.originContentHash,
		},
		title: snapshot.title,
		siglum: snapshot.siglum,
		description: snapshot.description,
		content_json: content.jsonValue,
		content_format: contentFormat,
		created_at: context.createdAt,
		updated_at: updatedAt,
		owner: snapshot.owner,
		is_public: snapshot.is_public,
		tags: [...snapshot.tags],
		transcriber: snapshot.transcriber,
		repository: snapshot.repository,
		settlement: snapshot.settlement,
		language: snapshot.language,
		iiif_manifest_sources: snapshot.iiif_manifest_sources.map(source => ({
			...source,
			metadata_json: source.metadata_json as JsonValue,
		})),
		page_canvas_links: snapshot.page_canvas_links.map(link => ({
			id: link.id,
			page_id: link.page_id,
			page_name_snapshot: link.page_name_snapshot,
			page_order: link.page_order,
			manifest_source_id: link.manifest_source_id,
			manifest_url_snapshot: link.manifest_url_snapshot,
			canvas_id: link.canvas_id,
			canvas_order: link.canvas_order,
			canvas_label: link.canvas_label,
			image_service_url: link.image_service_url,
			thumbnail_url: link.thumbnail_url,
			link_role: link.link_role,
		})),
		canvas_annotations: snapshot.canvas_annotations.map(annotation => ({
			...annotation,
			body_json: annotation.body_json as JsonValue,
			target_json: annotation.target_json as JsonValue,
			anchor_json: annotation.anchor_json as JsonValue,
		})),
		draft: {
			base_revision_id: context.currentRevisionId,
			base_content_hash: context.currentContentHash,
			saved_at: updatedAt,
			author_name: null,
		},
	};
	const document = await sealDocument(
		WORKING_TRANSCRIPTION_FORMAT,
		WORKING_TRANSCRIPTION_CURRENT_VERSION,
		payload as unknown as WorkingTranscriptionPayload
	);

	await writeTextFileAtomic(
		transcriptionWorkingFile(context.projectStorageSlug, context.projectTranscriptionId),
		serializeSealedDocument(document),
		storeOptions
	);
	await updateTranscriptionContent(db, {
		id: input.id,
		document: content.document,
		contentJson: content.contentJson,
		format: contentFormat,
		updatedAt,
	});
}

export async function saveWorkingTranscriptionMetadata(
	db: Kysely<Database>,
	input: UpdateTranscriptionMetadataInput,
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	const updatedAt = input.updatedAt ?? new Date().toISOString();
	const context = await loadTranscriptionFileContext(db, input.id);
	const snapshot = await loadProjectTranscriptionSnapshotWithFiles(
		db,
		context.projectTranscriptionId,
		storeOptions
	);
	const payload: WorkingTranscriptionPayload = {
		project_transcription_id: snapshot.project_transcription_id,
		id: snapshot.id,
		canonical_transcription_id: context.canonicalTranscriptionId,
		origin: {
			source_type: context.originType,
			source_project_id: context.originProjectId,
			source_transcription_id: context.originTranscriptionId,
			source_revision_id: context.originRevisionId,
			source_content_hash: context.originContentHash,
		},
		title: input.title.trim(),
		siglum: input.siglum.trim(),
		description: input.description.trim(),
		content_json: snapshot.content_json as JsonValue,
		content_format: snapshot.format,
		created_at: context.createdAt,
		updated_at: updatedAt,
		owner: snapshot.owner,
		is_public: snapshot.is_public,
		tags: [...input.tags],
		transcriber: input.transcriber.trim(),
		repository: input.repository.trim(),
		settlement: input.settlement.trim(),
		language: input.language.trim(),
		iiif_manifest_sources: snapshot.iiif_manifest_sources.map(source => ({
			...source,
			metadata_json: source.metadata_json as JsonValue,
		})),
		page_canvas_links: snapshot.page_canvas_links.map(link => ({ ...link })),
		canvas_annotations: snapshot.canvas_annotations.map(annotation => ({
			...annotation,
			body_json: annotation.body_json as JsonValue,
			target_json: annotation.target_json as JsonValue,
			anchor_json: annotation.anchor_json as JsonValue,
		})),
		draft: {
			base_revision_id: context.currentRevisionId,
			base_content_hash: context.currentContentHash,
			saved_at: updatedAt,
			author_name: null,
		},
	};
	const document = await sealDocument(
		WORKING_TRANSCRIPTION_FORMAT,
		WORKING_TRANSCRIPTION_CURRENT_VERSION,
		payload
	);
	await writeTextFileAtomic(
		transcriptionWorkingFile(context.projectStorageSlug, context.projectTranscriptionId),
		serializeSealedDocument(document),
		storeOptions
	);
	await updateTranscriptionMetadata(db, { ...input, updatedAt });
}

export async function writeWorkingTranscriptionSnapshot(
	db: DbExecutor,
	transcriptionId: string,
	updatedAt: string,
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	const context = await loadTranscriptionFileContext(db, transcriptionId);
	const snapshot = await loadProjectTranscriptionSnapshot(db, context.projectTranscriptionId);
	const payload: WorkingTranscriptionPayload = {
		project_transcription_id: snapshot.project_transcription_id,
		id: snapshot.id,
		canonical_transcription_id: context.canonicalTranscriptionId,
		origin: {
			source_type: context.originType,
			source_project_id: context.originProjectId,
			source_transcription_id: context.originTranscriptionId,
			source_revision_id: context.originRevisionId,
			source_content_hash: context.originContentHash,
		},
		title: snapshot.title,
		siglum: snapshot.siglum,
		description: snapshot.description,
		content_json: snapshot.content_json as JsonValue,
		content_format: snapshot.format,
		created_at: context.createdAt,
		updated_at: updatedAt,
		owner: snapshot.owner,
		is_public: snapshot.is_public,
		tags: [...snapshot.tags],
		transcriber: snapshot.transcriber,
		repository: snapshot.repository,
		settlement: snapshot.settlement,
		language: snapshot.language,
		iiif_manifest_sources: snapshot.iiif_manifest_sources.map(source => ({
			...source,
			metadata_json: source.metadata_json as JsonValue,
		})),
		page_canvas_links: snapshot.page_canvas_links.map(link => ({ ...link })),
		canvas_annotations: snapshot.canvas_annotations.map(annotation => ({
			...annotation,
			body_json: annotation.body_json as JsonValue,
			target_json: annotation.target_json as JsonValue,
			anchor_json: annotation.anchor_json as JsonValue,
		})),
		draft: {
			base_revision_id: context.currentRevisionId,
			base_content_hash: context.currentContentHash,
			saved_at: updatedAt,
			author_name: null,
		},
	};
	const document = await sealDocument(
		WORKING_TRANSCRIPTION_FORMAT,
		WORKING_TRANSCRIPTION_CURRENT_VERSION,
		payload
	);
	await writeTextFileAtomic(
		transcriptionWorkingFile(context.projectStorageSlug, context.projectTranscriptionId),
		serializeSealedDocument(document),
		storeOptions
	);
}

export async function createTranscriptionWithFiles(
	db: Kysely<Database>,
	input: CreateTranscriptionInput,
	storeOptions: StoreOperationOptions = {}
): Promise<string> {
	return (await createTranscriptionWithFilesResult(db, input, storeOptions)).value;
}

export async function createTranscriptionWithFilesResult(
	db: Kysely<Database>,
	input: CreateTranscriptionInput,
	storeOptions: StoreOperationOptions = {}
): Promise<PersistenceResult<string>> {
	const result = await createTranscriptionsWithFilesResult(db, [input], storeOptions);
	return { value: result.value[0], warnings: result.warnings };
}

export async function createTranscriptionsWithFiles(
	db: Kysely<Database>,
	inputs: CreateTranscriptionInput[],
	storeOptions: StoreOperationOptions = {}
): Promise<string[]> {
	return (await createTranscriptionsWithFilesResult(db, inputs, storeOptions)).value;
}

export async function createTranscriptionsWithFilesResult(
	db: Kysely<Database>,
	inputs: CreateTranscriptionInput[],
	storeOptions: StoreOperationOptions = {}
): Promise<PersistenceResult<string[]>> {
	return db.transaction().execute(async trx => {
		const ids = await createTranscriptions(trx, inputs);
		const warnings: PersistenceWarning[] = [];
		for (const id of ids) {
			const context = await loadTranscriptionFileContext(trx, id);
			const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
				trx,
				{
					projectTranscriptionId: context.projectTranscriptionId,
					createdAt: context.createdAt,
				},
				storeOptions
			);
			warnings.push(...(checkpoint.warnings ?? []));
		}
		return { value: ids, warnings };
	});
}

export async function createCommittedTranscriptionCheckpointWithFiles(
	db: DbExecutor,
	input: CommitTranscriptionInput,
	storeOptions: StoreOperationOptions = {}
): Promise<TranscriptionCheckpoint> {
	const lockContext = await loadTranscriptionFileContextByProjectTranscriptionId(
		db,
		input.projectTranscriptionId
	);
	return withProjectWriteLock(lockContext.projectId, async () => {
		const context = await loadTranscriptionFileContextByProjectTranscriptionId(
			db,
			input.projectTranscriptionId
		);
		const snapshot = await loadProjectTranscriptionSnapshot(db, input.projectTranscriptionId);
		const payload = buildTranscriptionHashPayload(snapshot);
		const contentHash = await hashCanonicalPayload(payload);
		const checkpointId = input.checkpointId ?? createId();
		const createdAt = input.createdAt ?? new Date().toISOString();
		const authorName = input.authorName ?? '';
		const commitMessage = input.commitMessage ?? null;
		const checkpointPayload: CanonicalTranscriptionCheckpointPayload = {
			checkpoint_id: checkpointId,
			entity_type: 'project-transcription',
			entity_id: snapshot.project_transcription_id,
			payload_transcription_id: snapshot.id,
			parent_checkpoint_id: context.currentRevisionId,
			payload_content_hash: contentHash,
			content_format: snapshot.format,
			commit_message: commitMessage,
			author_name: authorName,
			created_at: createdAt,
			payload: payload as JsonObject,
		};
		const checkpointPath = transcriptionCheckpointFile(
			context.projectStorageSlug,
			context.projectTranscriptionId,
			checkpointId
		);
		await assertFileMissing(checkpointPath, storeOptions);
		await writeSealedJsonFile(
			checkpointPath,
			TRANSCRIPTION_CHECKPOINT_FORMAT,
			TRANSCRIPTION_CHECKPOINT_CURRENT_VERSION,
			checkpointPayload,
			storeOptions
		);

		const primaryPayload: ProjectTranscriptionPayload = {
			project_transcription_id: snapshot.project_transcription_id,
			id: snapshot.id,
			canonical_transcription_id: context.canonicalTranscriptionId,
			current_revision: {
				id: checkpointId,
				content_hash: contentHash,
				created_at: createdAt,
				author_name: authorName,
			},
			origin: {
				source_type: context.originType,
				source_project_id: context.originProjectId,
				source_transcription_id: context.originTranscriptionId,
				source_revision_id: context.originRevisionId,
				source_content_hash: context.originContentHash,
			},
			title: snapshot.title,
			siglum: snapshot.siglum,
			description: snapshot.description,
			content_json: snapshot.content_json as JsonValue,
			content_format: snapshot.format,
			created_at: context.createdAt,
			updated_at: context.updatedAt,
			owner: snapshot.owner,
			is_public: snapshot.is_public,
			tags: [...snapshot.tags],
			transcriber: snapshot.transcriber,
			repository: snapshot.repository,
			settlement: snapshot.settlement,
			language: snapshot.language,
			iiif_manifest_sources: snapshot.iiif_manifest_sources.map(source => ({
				...source,
				metadata_json: source.metadata_json as JsonValue,
			})),
			page_canvas_links: snapshot.page_canvas_links.map(link => ({
				id: link.id,
				page_id: link.page_id,
				page_name_snapshot: link.page_name_snapshot,
				page_order: link.page_order,
				manifest_source_id: link.manifest_source_id,
				manifest_url_snapshot: link.manifest_url_snapshot,
				canvas_id: link.canvas_id,
				canvas_order: link.canvas_order,
				canvas_label: link.canvas_label,
				image_service_url: link.image_service_url,
				thumbnail_url: link.thumbnail_url,
				link_role: link.link_role,
			})),
			canvas_annotations: snapshot.canvas_annotations.map(annotation => ({
				...annotation,
				body_json: annotation.body_json as JsonValue,
				target_json: annotation.target_json as JsonValue,
				anchor_json: annotation.anchor_json as JsonValue,
			})),
		};
		await assertProjectTranscriptionRevisionHash(primaryPayload);
		await writeSealedJsonFile(
			transcriptionPrimaryFile(context.projectStorageSlug, context.projectTranscriptionId),
			PROJECT_TRANSCRIPTION_FORMAT,
			PROJECT_TRANSCRIPTION_CURRENT_VERSION,
			primaryPayload,
			storeOptions
		);
		const teiWarning = await writeDerivedTranscriptionTei(
			context.projectStorageSlug,
			context.projectTranscriptionId,
			primaryPayload,
			storeOptions
		);
		await writeProjectManifestFile(
			db,
			context.projectId,
			{
				transcriptions: {
					[context.projectTranscriptionId]: {
						id: checkpointId,
						content_hash: contentHash,
					},
				},
			},
			storeOptions
		);

		const checkpoint = await createCommittedTranscriptionCheckpoint(db, {
			...input,
			checkpointId,
			createdAt,
			authorName,
			commitMessage,
		});
		try {
			await deleteFile(
				transcriptionWorkingFile(context.projectStorageSlug, context.projectTranscriptionId),
				storeOptions
			);
		} catch (error) {
			if (!isMissingFileError(error)) throw error;
		}
		return { ...checkpoint, warnings: teiWarning ? [teiWarning] : [] };
	});
}

export async function loadTranscriptionWithWorkingFile(
	db: DbExecutor,
	transcriptionId: string,
	storeOptions: FileBackedLoadOptions = {}
): Promise<TranscriptionRecord | null> {
	const record = await getTranscription(db, transcriptionId);
	if (!record) return null;
	const context = await loadTranscriptionFileContext(db, transcriptionId);
	const primaryPayload = await tryReadPrimaryTranscriptionPayload(context, storeOptions);
	const workingPayload = await tryReadEligibleWorkingTranscriptionPayload(context, primaryPayload, storeOptions);
	if (workingPayload) return transcriptionRecordFromWorkingPayload(record, workingPayload);
	if (primaryPayload)
		return transcriptionRecordFromPrimaryPayload(record, context, primaryPayload);
	if (storeOptions.allowIndexFallback === false) return null;
	return record;
}

export async function getTranscriptionsWithWorkingFilesByIds(
	db: DbExecutor,
	ids: string[],
	storeOptions: FileBackedLoadOptions = {}
): Promise<TranscriptionRecord[]> {
	const records: TranscriptionRecord[] = [];
	for (const id of uniqueNonEmpty(ids)) {
		const record = await loadTranscriptionWithWorkingFile(db, id, storeOptions);
		if (record) records.push(record);
	}
	return records;
}

export async function loadTranscriptionContentWithFiles(
	db: DbExecutor,
	transcriptionId: string,
	storeOptions: FileBackedLoadOptions = {}
): Promise<string | null> {
	return (
		(await loadTranscriptionWithWorkingFile(db, transcriptionId, storeOptions))?.content_json ??
		null
	);
}

export async function rebuildVerseIndexForTranscriptionsWithFiles(
	db: Kysely<Database>,
	transcriptionIds: string[],
	storeOptions: FileBackedLoadOptions = {}
): Promise<VerseIndexRebuildResult> {
	const ids = uniqueNonEmpty(transcriptionIds);
	if (ids.length === 0) return { processed: 0, succeeded: 0, failed: 0, failures: [] };

	const failures: VerseIndexRebuildFailure[] = [];
	let succeeded = 0;
	for (const id of ids) {
		const record = await loadTranscriptionWithWorkingFile(db, id, {
			...storeOptions,
			allowIndexFallback: false,
		});
		const label = record ? formatTranscriptionLabel(record) : id;
		try {
			if (!record) throw new Error('Canonical transcription file was not found');
			await db
				.transaction()
				.execute(trx => replaceTranscriptionVerseIndexRows(trx, id, record.content_json));
			succeeded += 1;
		} catch (error) {
			failures.push({
				transcriptionId: id,
				label,
				message: error instanceof Error ? error.message : 'Failed to rebuild verse index',
			});
		}
	}

	return {
		processed: ids.length,
		succeeded,
		failed: failures.length,
		failures,
	};
}

export async function loadProjectTranscriptionSnapshotWithFiles(
	db: DbExecutor,
	projectTranscriptionId: string,
	storeOptions: FileBackedLoadOptions = {}
): Promise<ProjectTranscriptionSnapshot> {
	const context = await loadTranscriptionFileContextByProjectTranscriptionId(
		db,
		projectTranscriptionId
	);
	const primaryPayload = await tryReadPrimaryTranscriptionPayload(context, storeOptions);
	const workingPayload = await tryReadEligibleWorkingTranscriptionPayload(context, primaryPayload, storeOptions);
	if (workingPayload) return projectTranscriptionSnapshotFromPayload(workingPayload);
	if (primaryPayload) return projectTranscriptionSnapshotFromPayload(primaryPayload);
	if (storeOptions.allowIndexFallback === false) {
		throw new Error(
			`Canonical transcription file for project transcription ${projectTranscriptionId} was not found.`
		);
	}
	return loadProjectTranscriptionSnapshot(db, projectTranscriptionId);
}

export async function getProjectTranscriptionCheckpointStatusWithFiles(
	db: DbExecutor,
	projectTranscriptionId: string,
	storeOptions: FileBackedLoadOptions = {}
): Promise<ProjectTranscriptionCheckpointStatus> {
	const snapshot = await loadProjectTranscriptionSnapshotWithFiles(
		db,
		projectTranscriptionId,
		storeOptions
	);
	const currentCheckpoint = await getTranscriptionCommittedHead(db, snapshot.id);
	const workingContentHash = await hashCanonicalPayload(buildTranscriptionHashPayload(snapshot));
	return {
		projectTranscriptionId,
		projectOwnedTranscriptionId: snapshot.id,
		...deriveCheckpointStatus(currentCheckpoint, workingContentHash),
	};
}

function transcriptionRecordFromWorkingPayload(
	record: TranscriptionRecord,
	payload: LoadedWorkingTranscriptionPayload
): TranscriptionRecord {
	return {
		...record,
		origin_type: payload.origin.source_type,
		origin_project_id: payload.origin.source_project_id,
		origin_transcription_id: payload.origin.source_transcription_id,
		origin_revision_id: payload.origin.source_revision_id ?? '',
		origin_content_hash: payload.origin.source_content_hash ?? '',
		title: payload.title,
		siglum: payload.siglum,
		description: payload.description,
		content_json: JSON.stringify(payload.content_json),
		format: payload.content_format,
		updated_at: payload.updated_at,
		owner: payload.owner,
		is_public: payload.is_public,
		tags: [...payload.tags],
		transcriber: payload.transcriber,
		repository: payload.repository,
		settlement: payload.settlement,
		language: payload.language,
	};
}

function transcriptionRecordFromPrimaryPayload(
	record: TranscriptionRecord,
	context: TranscriptionFileContext,
	payload: ProjectTranscriptionPayload
): TranscriptionRecord {
	return {
		...record,
		id: payload.id,
		project_id: context.projectId,
		current_revision_id: payload.current_revision.id,
		current_content_hash: payload.current_revision.content_hash,
		origin_type: payload.origin.source_type,
		origin_project_id: payload.origin.source_project_id,
		origin_transcription_id: payload.origin.source_transcription_id,
		origin_revision_id: payload.origin.source_revision_id ?? '',
		origin_content_hash: payload.origin.source_content_hash ?? '',
		title: payload.title,
		siglum: payload.siglum,
		description: payload.description,
		content_json: JSON.stringify(payload.content_json),
		format: payload.content_format,
		created_at: payload.created_at,
		updated_at: payload.updated_at,
		owner: payload.owner,
		is_public: payload.is_public,
		tags: [...payload.tags],
		transcriber: payload.transcriber,
		repository: payload.repository,
		settlement: payload.settlement,
		language: payload.language,
	};
}

async function tryReadPrimaryTranscriptionPayload(
	context: TranscriptionFileContext,
	storeOptions: StoreOperationOptions
): Promise<ProjectTranscriptionPayload | null> {
	const path = transcriptionPrimaryFile(
		context.projectStorageSlug,
		context.projectTranscriptionId
	);
	let raw: string;
	try {
		raw = await readTextFile(path, storeOptions);
	} catch (error) {
		recordStoreQuarantine(storeOptions.quarantineSink, path, quarantineFromError(error));
		console.warn('[document-store] Falling back to transcription index cache.', {
			path,
			error: errorMessage(error),
		});
		return null;
	}
	const result = await readCanonicalDocument<ProjectTranscriptionPayload>(
		PROJECT_TRANSCRIPTION_FORMAT,
		raw
	);
	if (!result.ok) {
		recordStoreQuarantine(storeOptions.quarantineSink, path, result.quarantine);
		console.warn('[document-store] Ignoring unreadable transcription primary file.', {
			path,
			quarantine: result.quarantine,
		});
		return null;
	}
	const payload = result.payload;
	if (
		payload.id !== context.transcriptionId ||
		payload.project_transcription_id !== context.projectTranscriptionId
	) {
		recordStoreQuarantine(
			storeOptions.quarantineSink,
			path,
			quarantineFromError(
				invalidShape(
					'Transcription primary identity does not match its index context.',
					{
						transcriptionId: context.transcriptionId,
						projectTranscriptionId: context.projectTranscriptionId,
					},
					{
						transcriptionId: payload.id,
						projectTranscriptionId: payload.project_transcription_id,
					}
				)
			)
		);
		console.warn('[document-store] Ignoring mismatched transcription primary file.', {
			path,
			expectedTranscriptionId: context.transcriptionId,
			actualTranscriptionId: payload.id,
			expectedProjectTranscriptionId: context.projectTranscriptionId,
			actualProjectTranscriptionId: payload.project_transcription_id,
		});
		return null;
	}
	return payload;
}

async function tryReadWorkingTranscriptionPayload(
	context: TranscriptionFileContext,
	storeOptions: StoreOperationOptions
): Promise<LoadedWorkingTranscriptionPayload | null> {
	const path = transcriptionWorkingFile(
		context.projectStorageSlug,
		context.projectTranscriptionId
	);
	let raw: string;
	try {
		raw = await readTextFile(path, storeOptions);
	} catch (error) {
		if (!isMissingFileError(error)) {
			recordStoreQuarantine(storeOptions.quarantineSink, path, quarantineFromError(error));
			console.warn('[document-store] Falling back to transcription index cache.', {
				path,
				error: errorMessage(error),
			});
		}
		return null;
	}
	const result = await readCanonicalDocument<WorkingTranscriptionPayload>(
		WORKING_TRANSCRIPTION_FORMAT,
		raw
	);
	if (result.ok) {
		const payload = result.payload as unknown as LoadedWorkingTranscriptionPayload & {
			id: string;
			project_transcription_id: string;
		};
		if (
			payload.id !== context.transcriptionId ||
			payload.project_transcription_id !== context.projectTranscriptionId
		) {
			recordStoreQuarantine(
				storeOptions.quarantineSink,
				path,
				quarantineFromError(
					invalidShape('Transcription working identity does not match its index context.')
				)
			);
			console.warn('[document-store] Ignoring mismatched transcription working file.', {
				path,
				expectedTranscriptionId: context.transcriptionId,
				actualTranscriptionId: payload.id,
				expectedProjectTranscriptionId: context.projectTranscriptionId,
				actualProjectTranscriptionId: payload.project_transcription_id,
			});
			return null;
		}
		return payload;
	}
	recordStoreQuarantine(storeOptions.quarantineSink, path, result.quarantine);
	console.warn('[document-store] Ignoring unreadable transcription working file.', {
		path,
		quarantine: result.quarantine,
	});
	return null;
}

async function tryReadEligibleWorkingTranscriptionPayload(
	context: TranscriptionFileContext,
	primary: ProjectTranscriptionPayload | null,
	storeOptions: StoreOperationOptions
): Promise<LoadedWorkingTranscriptionPayload | null> {
	const working = await tryReadWorkingTranscriptionPayload(context, storeOptions);
	if (!working || !primary) return working;
	if (
		working.draft.base_revision_id !== primary.current_revision.id ||
		working.draft.base_content_hash !== primary.current_revision.content_hash
	) {
		console.warn('[document-store] Ignoring stale transcription working file.', {
			projectTranscriptionId: context.projectTranscriptionId,
		});
		return null;
	}
	const workingHash = await hashCanonicalPayload(
		buildTranscriptionHashPayload(projectTranscriptionSnapshotFromPayload(working))
	);
	return workingHash === primary.current_revision.content_hash ? null : working;
}

async function loadTranscriptionFileContext(
	db: DbExecutor,
	transcriptionId: string
): Promise<TranscriptionFileContext> {
	const row = await db
		.selectFrom('transcriptions')
		.innerJoin('project_transcriptions', join =>
			join
				.onRef('project_transcriptions.transcription_id', '=', 'transcriptions.id')
				.onRef('project_transcriptions.project_id', '=', 'transcriptions.project_id')
		)
		.innerJoin('projects', 'projects.id', 'transcriptions.project_id')
		.select([
			'project_transcriptions.id as project_transcription_id',
			'project_transcriptions.canonical_transcription_id as canonical_transcription_id',
			'transcriptions.project_id as project_id',
			'projects.storage_slug as project_storage_slug',
			'transcriptions.current_revision_id as current_revision_id',
			'transcriptions.current_content_hash as current_content_hash',
			'transcriptions.origin_type as origin_type',
			'transcriptions.origin_project_id as origin_project_id',
			'transcriptions.origin_transcription_id as origin_transcription_id',
			'transcriptions.origin_revision_id as origin_revision_id',
			'transcriptions.origin_content_hash as origin_content_hash',
			'transcriptions.created_at as created_at',
			'transcriptions.updated_at as updated_at',
		])
		.where('transcriptions.id', '=', transcriptionId)
		.executeTakeFirst();
	if (!row) throw new Error(`Transcription ${transcriptionId} was not found.`);
	return {
		transcriptionId,
		projectTranscriptionId: requireString(
			row.project_transcription_id,
			'project transcription id'
		),
		projectId: row.project_id,
		projectStorageSlug: requireString(row.project_storage_slug, 'project storage slug'),
		canonicalTranscriptionId: row.canonical_transcription_id,
		currentRevisionId: emptyToNull(row.current_revision_id),
		currentContentHash: emptyToNull(row.current_content_hash),
		originType: row.origin_type,
		originProjectId: row.origin_project_id,
		originTranscriptionId: row.origin_transcription_id,
		originRevisionId: emptyToNull(row.origin_revision_id),
		originContentHash: emptyToNull(row.origin_content_hash),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function loadTranscriptionFileContextByProjectTranscriptionId(
	db: DbExecutor,
	projectTranscriptionId: string
): Promise<TranscriptionFileContext> {
	const row = await db
		.selectFrom('project_transcriptions')
		.select(['transcription_id'])
		.where('id', '=', projectTranscriptionId)
		.executeTakeFirst();
	if (!row) throw new Error(`Project transcription ${projectTranscriptionId} was not found.`);
	return loadTranscriptionFileContext(db, row.transcription_id);
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

async function writeDerivedTranscriptionTei(
	projectStorageSlug: string,
	projectTranscriptionId: string,
	payload: ProjectTranscriptionPayload,
	storeOptions: StoreOperationOptions
): Promise<PersistenceWarning | null> {
	try {
		await writeTextFileAtomic(
			transcriptionTeiFile(projectStorageSlug, projectTranscriptionId),
			transcriptionDocumentToTei(payload),
			storeOptions
		);
		return null;
	} catch (error) {
		const message = errorMessage(error);
		console.warn('[document-store] Could not write derived transcription TEI.', {
			projectTranscriptionId,
			error: message,
		});
		return {
			code: 'tei_write_failed',
			entityType: 'transcription',
			entityId: projectTranscriptionId,
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

function normalizeWorkingTranscriptionContent(
	input: {
		contentJson?: string;
		document?: StoredTranscriptionDocument | null;
	},
	transcriptionId: string
): NormalizedWorkingTranscriptionContent {
	const document = input.document
		? coerceTranscriptionDocument(input.document)
		: coerceTranscriptionDocument(input.contentJson || EMPTY_TRANSCRIPTION_DOC);
	if (!document)
		throw new Error(`Transcription ${transcriptionId} content is missing or invalid.`);
	return {
		contentJson: JSON.stringify(document),
		document,
		jsonValue: document as unknown as JsonValue,
	};
}

function emptyToNull(value: string | null): string | null {
	return value?.trim() ? value : null;
}

function requireString(value: string | null, label: string): string {
	if (!value) throw new Error(`Missing ${label}.`);
	return value;
}

function projectTranscriptionSnapshotFromPayload(
	payload: ProjectTranscriptionPayload | LoadedWorkingTranscriptionPayload
): ProjectTranscriptionSnapshot {
	return {
		project_transcription_id: payload.project_transcription_id,
		id: payload.id,
		format: payload.content_format,
		title: payload.title,
		siglum: payload.siglum,
		description: payload.description,
		content_json: payload.content_json,
		owner: payload.owner,
		is_public: payload.is_public,
		tags: [...payload.tags],
		transcriber: payload.transcriber,
		repository: payload.repository,
		settlement: payload.settlement,
		language: payload.language,
		iiif_manifest_sources: payload.iiif_manifest_sources,
		page_canvas_links: payload.page_canvas_links,
		canvas_annotations: payload.canvas_annotations,
	};
}

function uniqueNonEmpty(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

function formatTranscriptionLabel(
	record: Pick<TranscriptionRecord, 'id' | 'siglum' | 'title'>
): string {
	return record.siglum?.trim() || record.title?.trim() || record.id;
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
