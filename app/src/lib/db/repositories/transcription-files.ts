import type { Kysely } from 'kysely';

import {
	coerceTranscriptionDocument,
	EMPTY_TRANSCRIPTION_DOC,
	TRANSCRIPTION_FORMAT,
	type StoredTranscriptionDocument,
} from '$lib/transcription/content';
import {
	PROJECT_TRANSCRIPTION_CURRENT_VERSION,
	PROJECT_TRANSCRIPTION_FORMAT,
	TRANSCRIPTION_CHECKPOINT_CURRENT_VERSION,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	mergeWorkingTranscription,
	readCanonicalDocument,
	transcriptionDocumentToTeiFromStore,
	WORKING_TRANSCRIPTION_FORMAT,
	type ProjectTranscriptionPayload,
	type TranscriptionCheckpointPayload as CanonicalTranscriptionCheckpointPayload,
	type WorkingTranscriptionPayload,
} from '$lib/storage/formats';
import {
	readTextFile,
	deleteFile,
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
	transcriptionCheckpointFile,
	transcriptionPrimaryFile,
	transcriptionTeiFile,
	transcriptionWorkingFile,
} from '$lib/storage/layout';

import type { Database } from '../types.generated';
import { createId } from './id';
import { transcriptionIndexRowsFromPrimary } from './index-rebuild';
import { writeProjectManifestFile } from './project-files';
import { withProjectWriteLock } from './project-locks';
import {
	buildTranscriptionHashPayload,
	createCommittedTranscriptionCheckpoint,
	deriveCheckpointStatus,
	getTranscriptionCommittedHead,
	hashCanonicalPayload,
	loadCommittedTranscriptionCheckpointPayload,
	loadProjectTranscriptionSnapshot,
	nextTranscriptionVersionLabel,
	rewriteVersionNote,
	type CommitTranscriptionInput,
	type ProjectTranscriptionCheckpointStatus,
	type ProjectTranscriptionSnapshot,
	type TranscriptionCheckpoint,
	type PersistenceWarning,
	type PersistenceResult,
} from './revisions';
import {
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
import type { DbExecutor } from '../worker-kysely';

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
	originCapturedAt: string | null;
	createdAt: string;
	updatedAt: string;
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
	const format = input.format ?? snapshot.format ?? TRANSCRIPTION_FORMAT;
	await writeCurrentTranscriptionFiles(
		context,
		{ ...snapshot, content_json: content.jsonValue, format },
		updatedAt,
		storeOptions
	);
	await updateTranscriptionContent(db, {
		id: input.id,
		document: content.document,
		contentJson: content.contentJson,
		format,
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
	await writeCurrentTranscriptionFiles(
		context,
		{
			...snapshot,
			title: input.title.trim(),
			siglum: input.siglum.trim(),
			description: input.description.trim(),
			tags: [...input.tags],
			transcriber: input.transcriber.trim(),
			repository: input.repository.trim(),
			settlement: input.settlement.trim(),
			language: input.language.trim(),
		},
		updatedAt,
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
	await writeCurrentTranscriptionFiles(context, snapshot, updatedAt, storeOptions);
}

async function writeCurrentTranscriptionFiles(
	context: TranscriptionFileContext,
	snapshot: ProjectTranscriptionSnapshot,
	updatedAt: string,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const basedOn =
		context.currentRevisionId && context.currentContentHash
			? { id: context.currentRevisionId, content_hash: context.currentContentHash }
			: null;
	const payload = buildCurrentTranscriptionPayload(context, snapshot, basedOn, updatedAt);
	await writeSealedJsonFile(
		transcriptionPrimaryFile(context.projectStorageSlug, context.projectTranscriptionId),
		PROJECT_TRANSCRIPTION_FORMAT,
		PROJECT_TRANSCRIPTION_CURRENT_VERSION,
		payload,
		storeOptions
	);
	await writeDerivedTranscriptionTei(
		context.projectStorageSlug,
		context.projectTranscriptionId,
		payload,
		storeOptions
	);
}

function buildCurrentTranscriptionPayload(
	context: TranscriptionFileContext,
	snapshot: ProjectTranscriptionSnapshot,
	basedOn: ProjectTranscriptionPayload['based_on_checkpoint'],
	updatedAt: string
): ProjectTranscriptionPayload {
	return {
		project_transcription_id: snapshot.project_transcription_id,
		id: snapshot.id,
		canonical_transcription_id: context.canonicalTranscriptionId,
		based_on_checkpoint: basedOn,
		draft: { saved_at: updatedAt, author_name: null },
		origin: {
			source_type: context.originType,
			source_project_id: context.originProjectId,
			source_transcription_id: context.originTranscriptionId,
			source_revision_id: context.originRevisionId,
			source_content_hash: context.originContentHash,
			...(context.originCapturedAt ? { source_captured_at: context.originCapturedAt } : {}),
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
}

export async function createTranscriptionWithFilesResult(
	db: Kysely<Database>,
	input: CreateTranscriptionInput,
	storeOptions: StoreOperationOptions = {}
): Promise<PersistenceResult<string>> {
	const result = await createTranscriptionsWithFilesResult(db, [input], storeOptions);
	return { value: result.value[0], warnings: result.warnings };
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
		const label = input.label?.trim() || (await nextTranscriptionVersionLabel(db, snapshot.id));
		const checkpointPayload: CanonicalTranscriptionCheckpointPayload = {
			checkpoint_id: checkpointId,
			entity_type: 'project-transcription',
			entity_id: snapshot.project_transcription_id,
			payload_transcription_id: snapshot.id,
			parent_checkpoint_id: context.currentRevisionId,
			payload_content_hash: contentHash,
			content_format: snapshot.format,
			label,
			commit_message: commitMessage,
			author_name: authorName,
			created_at: createdAt,
			metadata_updated_at: createdAt,
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

		const primaryPayload = buildCurrentTranscriptionPayload(
			context,
			snapshot,
			{ id: checkpointId, content_hash: contentHash },
			context.updatedAt
		);
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
			label,
			createdAt,
			authorName,
			commitMessage,
		});
		try {
			await deleteFile(
				transcriptionWorkingFile(
					context.projectStorageSlug,
					context.projectTranscriptionId
				),
				storeOptions
			);
		} catch (error) {
			if (!isMissingFileError(error)) throw error;
		}
		return { ...checkpoint, warnings: teiWarning ? [teiWarning] : [] };
	});
}

export async function restoreTranscriptionVersion(
	db: Kysely<Database>,
	transcriptionId: string,
	checkpointId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<ProjectTranscriptionPayload> {
	const context = await loadTranscriptionFileContext(db, transcriptionId);
	const previous = await tryReadPrimaryTranscriptionPayload(context, storeOptions);
	if (!previous) throw new Error(`Current for transcription ${transcriptionId} was not found.`);
	const version = await loadCommittedTranscriptionCheckpointPayload(
		db,
		transcriptionId,
		checkpointId,
		storeOptions
	);
	const current = buildCurrentTranscriptionPayload(
		context,
		version.payload,
		{ id: version.id, content_hash: version.contentHash },
		new Date().toISOString()
	);
	await replaceTranscriptionCurrent(db, transcriptionId, current, storeOptions);
	return previous;
}

export async function replaceTranscriptionCurrent(
	db: Kysely<Database>,
	transcriptionId: string,
	payload: ProjectTranscriptionPayload,
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	const context = await loadTranscriptionFileContext(db, transcriptionId);
	if (
		payload.id !== context.transcriptionId ||
		payload.project_transcription_id !== context.projectTranscriptionId
	) {
		throw new Error('Current does not belong to this transcription.');
	}
	await withProjectWriteLock(context.projectId, async () => {
		await writeSealedJsonFile(
			transcriptionPrimaryFile(context.projectStorageSlug, context.projectTranscriptionId),
			PROJECT_TRANSCRIPTION_FORMAT,
			PROJECT_TRANSCRIPTION_CURRENT_VERSION,
			payload,
			storeOptions
		);
		await writeDerivedTranscriptionTei(
			context.projectStorageSlug,
			context.projectTranscriptionId,
			payload,
			storeOptions
		);
		const rows = transcriptionIndexRowsFromPrimary(context.projectId, payload);
		await db.transaction().execute(async trx => {
			const { id: _id, ...transcription } = rows.transcription;
			await trx
				.updateTable('transcriptions')
				.set(transcription)
				.where('id', '=', transcriptionId)
				.execute();
			await trx
				.deleteFrom('iiif_manifest_sources')
				.where('transcription_id', '=', transcriptionId)
				.execute();
			if (rows.iiifManifestSources.length)
				await trx
					.insertInto('iiif_manifest_sources')
					.values(rows.iiifManifestSources)
					.execute();
			if (rows.pageCanvasLinks.length)
				await trx
					.insertInto('transcription_page_canvas_links')
					.values(rows.pageCanvasLinks)
					.execute();
			if (rows.canvasAnnotations.length)
				await trx
					.insertInto('iiif_canvas_annotations')
					.values(rows.canvasAnnotations)
					.execute();
			await replaceTranscriptionVerseIndexRows(
				trx,
				transcriptionId,
				rows.transcription.content_json
			);
		});
		await writeProjectManifestFile(db, context.projectId, {}, storeOptions);
	});
}

export async function updateTranscriptionVersionNote(
	db: Kysely<Database>,
	transcriptionId: string,
	checkpointId: string,
	note: string | null,
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	const context = await loadTranscriptionFileContext(db, transcriptionId);
	const row = await db
		.selectFrom('transcription_checkpoints')
		.select('label')
		.where('id', '=', checkpointId)
		.where('transcription_id', '=', transcriptionId)
		.executeTakeFirst();
	if (!row) throw new Error(`Version ${checkpointId} was not found.`);
	await withProjectWriteLock(context.projectId, async () => {
		const updated = await rewriteVersionNote<CanonicalTranscriptionCheckpointPayload>(
			transcriptionCheckpointFile(
				context.projectStorageSlug,
				context.projectTranscriptionId,
				checkpointId
			),
			TRANSCRIPTION_CHECKPOINT_FORMAT,
			TRANSCRIPTION_CHECKPOINT_CURRENT_VERSION,
			{ label: row.label, note, updatedAt: new Date().toISOString() },
			storeOptions
		);
		await db
			.updateTable('transcription_checkpoints')
			.set({ label: updated.label, commit_message: updated.commit_message })
			.where('id', '=', checkpointId)
			.execute();
	});
}

export async function loadTranscriptionWithWorkingFile(
	db: DbExecutor,
	transcriptionId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<TranscriptionRecord | null> {
	const record = await getTranscription(db, transcriptionId);
	if (!record) return null;
	const context = await loadTranscriptionFileContext(db, transcriptionId);
	const primaryPayload = await tryReadPrimaryTranscriptionPayload(context, storeOptions);
	if (primaryPayload)
		return transcriptionRecordFromPrimaryPayload(record, context, primaryPayload);
	return null;
}

export async function getTranscriptionsWithWorkingFilesByIds(
	db: DbExecutor,
	ids: string[],
	storeOptions: StoreOperationOptions = {}
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
	storeOptions: StoreOperationOptions = {}
): Promise<string | null> {
	return (
		(await loadTranscriptionWithWorkingFile(db, transcriptionId, storeOptions))?.content_json ??
		null
	);
}

export async function rebuildVerseIndexForTranscriptionsWithFiles(
	db: Kysely<Database>,
	transcriptionIds: string[],
	storeOptions: StoreOperationOptions = {}
): Promise<VerseIndexRebuildResult> {
	const ids = uniqueNonEmpty(transcriptionIds);
	if (ids.length === 0) return { processed: 0, succeeded: 0, failed: 0, failures: [] };

	const failures: VerseIndexRebuildFailure[] = [];
	let succeeded = 0;
	for (const id of ids) {
		const record = await loadTranscriptionWithWorkingFile(db, id, storeOptions);
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
	storeOptions: StoreOperationOptions = {}
): Promise<ProjectTranscriptionSnapshot> {
	const context = await loadTranscriptionFileContextByProjectTranscriptionId(
		db,
		projectTranscriptionId
	);
	const primaryPayload = await tryReadPrimaryTranscriptionPayload(context, storeOptions);
	if (primaryPayload) return projectTranscriptionSnapshotFromPayload(primaryPayload);
	throw new Error(
		`Canonical transcription file for project transcription ${projectTranscriptionId} was not found.`
	);
}

export async function getProjectTranscriptionCheckpointStatusWithFiles(
	db: DbExecutor,
	projectTranscriptionId: string,
	storeOptions: StoreOperationOptions = {}
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

function transcriptionRecordFromPrimaryPayload(
	record: TranscriptionRecord,
	context: TranscriptionFileContext,
	payload: ProjectTranscriptionPayload
): TranscriptionRecord {
	return {
		...record,
		id: payload.id,
		project_id: context.projectId,
		current_revision_id: payload.based_on_checkpoint?.id ?? '',
		current_content_hash: payload.based_on_checkpoint?.content_hash ?? '',
		origin_type: payload.origin.source_type,
		origin_project_id: payload.origin.source_project_id,
		origin_transcription_id: payload.origin.source_transcription_id,
		origin_revision_id: payload.origin.source_revision_id ?? '',
		origin_content_hash: payload.origin.source_content_hash ?? '',
		origin_captured_at: payload.origin.source_captured_at ?? '',
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
		console.warn('[document-store] Could not read canonical transcription content.', {
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
	return migrateLegacyWorkingTranscription(context, payload, storeOptions);
}

async function migrateLegacyWorkingTranscription(
	context: TranscriptionFileContext,
	primary: ProjectTranscriptionPayload,
	storeOptions: StoreOperationOptions
): Promise<ProjectTranscriptionPayload> {
	const working = await tryReadWorkingTranscriptionPayload(context, storeOptions);
	if (
		!working ||
		working.draft.base_revision_id !== primary.based_on_checkpoint?.id ||
		working.draft.base_content_hash !== primary.based_on_checkpoint?.content_hash
	) {
		return primary;
	}
	const current = mergeWorkingTranscription(primary, working);
	await writeSealedJsonFile(
		transcriptionPrimaryFile(context.projectStorageSlug, context.projectTranscriptionId),
		PROJECT_TRANSCRIPTION_FORMAT,
		PROJECT_TRANSCRIPTION_CURRENT_VERSION,
		current,
		storeOptions
	);
	await writeDerivedTranscriptionTei(
		context.projectStorageSlug,
		context.projectTranscriptionId,
		current,
		storeOptions
	);
	await deleteFile(
		transcriptionWorkingFile(context.projectStorageSlug, context.projectTranscriptionId),
		storeOptions
	);
	return current;
}

async function tryReadWorkingTranscriptionPayload(
	context: TranscriptionFileContext,
	storeOptions: StoreOperationOptions
): Promise<WorkingTranscriptionPayload | null> {
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
			console.warn('[document-store] Could not read canonical transcription content.', {
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
		const payload = result.payload;
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
			'transcriptions.origin_captured_at as origin_captured_at',
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
		originCapturedAt: emptyToNull(row.origin_captured_at),
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
			await transcriptionDocumentToTeiFromStore(payload, storeOptions),
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
	payload: ProjectTranscriptionPayload
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
