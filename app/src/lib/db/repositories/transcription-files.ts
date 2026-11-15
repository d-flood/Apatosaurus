import type { Kysely } from 'kysely';

import {
	coerceTranscriptionDocument,
	EMPTY_TRANSCRIPTION_DOC,
	TRANSCRIPTION_FORMAT,
	type StoredTranscriptionDocument,
} from '$lib/transcription/content';
import {
	parseTranscriptionTei,
	parseTranscriptionTeiVersion,
	rewriteTranscriptionTeiVersion,
	serializeTranscriptionTei,
	splitTranscriptionTeiIiif,
	type ProjectTranscriptionPayload,
} from '$lib/storage/formats';
import { readTextFile, type StoreOperationOptions } from '$lib/storage/opfs-store';
import type { JsonValue } from '$lib/storage/envelope';
import { joinStorePath, projectFolder } from '$lib/storage/layout';
import { documentCanonicalPath, documentVersionPath } from '$lib/storage/document-files';

import type { Database } from '../types.generated';
import { createId } from './id';
import {
	assertNoDocumentFileProblem,
	getTranscriptionContentHash,
	upsertDocumentFingerprint,
	writeTeiFile,
} from './document-fingerprints';
import { replaceIiifRows } from './iiif';
import { transcriptionIndexRowsFromPrimary } from './index-rebuild';
import { writeProjectManifestFile } from './project-files';
import { withProjectWriteLock } from './project-locks';
import {
	createCommittedTranscriptionCheckpoint,
	getProjectTranscriptionCheckpointStatus,
	inTransaction,
	loadCommittedTranscriptionCheckpointPayload,
	loadProjectTranscriptionSnapshot,
	nextTranscriptionVersionLabel,
	type CommitTranscriptionInput,
	type ProjectTranscriptionSnapshot,
	type TranscriptionCheckpoint,
	type PersistenceWarning,
	type PersistenceResult,
} from './revisions';
import {
	createTranscriptions,
	getTranscription,
	replaceTranscriptionVerseIndexRows,
	type CreateTranscriptionInput,
	type TranscriptionRecord,
	type UpdateTranscriptionContentInput,
	type UpdateTranscriptionMetadataInput,
	type VerseIndexRebuildFailure,
	type VerseIndexRebuildResult,
} from './transcriptions';
import type { DbExecutor } from '../worker-kysely';
import type { TranscriptionIiif } from '$lib/storage/formats/transcription-tei-iiif';

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
	await writeTeiCurrent(
		db,
		context,
		currentPayload(
			context,
			{ ...snapshot, content_json: content.jsonValue, format },
			updatedAt
		),
		storeOptions
	);
	await touchProject(db, context.projectId, updatedAt);
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
	const next = {
		...snapshot,
		title: input.title.trim(),
		siglum: input.siglum.trim(),
		description: input.description.trim(),
		tags: [...input.tags],
		transcriber: input.transcriber.trim(),
		repository: input.repository.trim(),
		settlement: input.settlement.trim(),
		language: input.language.trim(),
	};
	await writeTeiCurrent(db, context, currentPayload(context, next, updatedAt), storeOptions);
}

export async function writeWorkingTranscriptionSnapshot(
	db: DbExecutor,
	transcriptionId: string,
	updatedAt: string,
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	const context = await loadTranscriptionFileContext(db, transcriptionId);
	const snapshot = await loadProjectTranscriptionSnapshot(db, context.projectTranscriptionId);
	await writeTeiCurrent(db, context, currentPayload(context, snapshot, updatedAt), storeOptions);
}

function currentPayload(
	context: TranscriptionFileContext,
	snapshot: ProjectTranscriptionSnapshot,
	updatedAt: string
): ProjectTranscriptionPayload {
	const basedOn =
		context.currentRevisionId && context.currentContentHash
			? { id: context.currentRevisionId, content_hash: context.currentContentHash }
			: null;
	return buildCurrentTranscriptionPayload(context, snapshot, basedOn, updatedAt);
}

// Indexes what parsing the written file yields, so a rebuild from files reproduces these rows.
async function writeTeiCurrent(
	db: DbExecutor,
	context: TranscriptionFileContext,
	payload: ProjectTranscriptionPayload,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const path = documentCanonicalPath('transcription', context.projectTranscriptionId);
	await assertNoDocumentFileProblem(db, path);
	const serialized = await serializeTranscriptionTei(payload);
	const fingerprint = await writeTeiFile(
		{
			projectSlug: context.projectStorageSlug,
			path,
			entityType: 'transcription',
			entityId: context.projectTranscriptionId,
			...serialized,
		},
		storeOptions
	);
	const rows = transcriptionIndexRowsFromPrimary(
		context.projectId,
		parseTranscriptionTei(serialized.xml)
	);
	await inTransaction(db, async trx => {
		await replaceTranscriptionIndexRows(trx, context.transcriptionId, rows);
		await upsertDocumentFingerprint(trx, fingerprint);
	});
}

async function touchProject(db: DbExecutor, projectId: string, updatedAt: string): Promise<void> {
	await db
		.updateTable('projects')
		.set({ updated_at: updatedAt })
		.where('id', '=', projectId)
		.execute();
}

export async function replaceTranscriptionIndexRows(
	trx: DbExecutor,
	transcriptionId: string,
	rows: ReturnType<typeof transcriptionIndexRowsFromPrimary>
): Promise<void> {
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
		await trx.insertInto('iiif_manifest_sources').values(rows.iiifManifestSources).execute();
	if (rows.pageCanvasLinks.length)
		await trx
			.insertInto('transcription_page_canvas_links')
			.values(rows.pageCanvasLinks)
			.execute();
	if (rows.canvasAnnotations.length)
		await trx.insertInto('iiif_canvas_annotations').values(rows.canvasAnnotations).execute();
	await replaceTranscriptionVerseIndexRows(trx, transcriptionId, rows.transcription.content_json);
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
			synthetic_canvases: source.synthetic_canvases.map(canvas => ({
				...canvas,
				metadata: canvas.metadata.map(item => ({ ...item })),
			})),
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
		const prepared = inputs.map(splitImportedIiif);
		const ids = await createTranscriptions(
			trx,
			prepared.map(entry => entry.input)
		);
		const warnings: PersistenceWarning[] = [];
		for (const [index, id] of ids.entries()) {
			const iiif = prepared[index].iiif;
			if (iiif) await replaceIiifRows(trx, id, iiif, new Date().toISOString());
		}
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

// TEI exported by the app carries its IIIF data; turn it into rows so it stays editable.
function splitImportedIiif(input: CreateTranscriptionInput): {
	input: CreateTranscriptionInput;
	iiif: TranscriptionIiif | null;
} {
	const document = coerceTranscriptionDocument(input.document ?? input.contentJson ?? null);
	if (!document) return { input, iiif: null };
	const split = splitTranscriptionTeiIiif(document);
	if (split.iiif.iiif_manifest_sources.length === 0) return { input, iiif: null };
	return {
		input: { ...input, document: split.document, contentJson: undefined },
		iiif: split.iiif,
	};
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
		const checkpointId = input.checkpointId ?? createId();
		const createdAt = input.createdAt ?? new Date().toISOString();
		const authorName = input.authorName ?? '';
		const commitMessage = input.commitMessage ?? null;
		const label = input.label?.trim() || (await nextTranscriptionVersionLabel(db, snapshot.id));
		const commit = { ...input, checkpointId, label, createdAt, authorName, commitMessage };
		return commitTeiTranscription(db, context, snapshot, commit, storeOptions);
	});
}

async function commitTeiTranscription(
	db: DbExecutor,
	context: TranscriptionFileContext,
	snapshot: ProjectTranscriptionSnapshot,
	commit: CommitTranscriptionInput & {
		checkpointId: string;
		label: string;
		createdAt: string;
		authorName: string;
		commitMessage: string | null;
	},
	storeOptions: StoreOperationOptions
): Promise<TranscriptionCheckpoint> {
	await assertNoDocumentFileProblem(
		db,
		documentCanonicalPath('transcription', context.projectTranscriptionId)
	);
	const current = buildCurrentTranscriptionPayload(context, snapshot, null, context.updatedAt);
	const version = await serializeTranscriptionTei(current, {
		id: commit.checkpointId,
		label: commit.label,
		note: commit.commitMessage,
		author_name: commit.authorName,
		created_at: commit.createdAt,
		parent_id: context.currentRevisionId,
	});
	const versionPath = documentVersionPath(
		'transcription',
		context.projectTranscriptionId,
		commit.checkpointId
	);
	await assertFileMissing(
		joinStorePath(projectFolder(context.projectStorageSlug), versionPath),
		storeOptions
	);
	const versionFingerprint = await writeTeiFile(
		{
			projectSlug: context.projectStorageSlug,
			path: versionPath,
			entityType: 'version',
			entityId: commit.checkpointId,
			...version,
		},
		storeOptions
	);
	const head = { id: commit.checkpointId, content_hash: version.contentHash };
	await writeTeiCurrent(db, context, { ...current, based_on_checkpoint: head }, storeOptions);
	await upsertDocumentFingerprint(db, versionFingerprint);
	await writeProjectManifestFile(
		db,
		context.projectId,
		{ transcriptions: { [context.projectTranscriptionId]: head } },
		storeOptions
	);
	const checkpoint = await createCommittedTranscriptionCheckpoint(
		db,
		commit,
		context.currentRevisionId
	);
	return { ...checkpoint, warnings: [] };
}

export async function restoreTranscriptionVersion(
	db: Kysely<Database>,
	transcriptionId: string,
	checkpointId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<ProjectTranscriptionPayload> {
	const context = await loadTranscriptionFileContext(db, transcriptionId);
	const previous = await readCurrentPayload(db, context, storeOptions);
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
		await writeTeiCurrent(db, context, payload, storeOptions);
		await writeProjectManifestFile(db, context.projectId, {}, storeOptions);
	});
}

export async function reimportTranscriptionContent(
	db: Kysely<Database>,
	id: string,
	contentJson: string,
	storeOptions: StoreOperationOptions = {}
): Promise<PersistenceWarning[]> {
	const document = coerceTranscriptionDocument(contentJson);
	if (!document) throw new Error(`Transcription ${id} content is missing or invalid.`);
	const { projectTranscriptionId } = await loadTranscriptionFileContext(db, id);
	const commitIfDirty = async (commitMessage: string) => {
		const status = await getProjectTranscriptionCheckpointStatus(db, projectTranscriptionId);
		if (!status.dirtyToCheckpoint) return [];
		const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
			db,
			{ projectTranscriptionId, commitMessage },
			storeOptions
		);
		return checkpoint.warnings ?? [];
	};
	const warnings = await commitIfDirty('Before TEI re-import');
	const previous = await loadProjectTranscriptionSnapshotWithFiles(
		db,
		projectTranscriptionId,
		storeOptions
	);
	await saveWorkingTranscriptionContent(
		db,
		{
			id,
			document: inheritPageIds(coerceTranscriptionDocument(previous.content_json), document),
		},
		storeOptions
	);
	warnings.push(...(await commitIfDirty('TEI re-import')));
	return warnings;
}

// Pages without a TEI xml:id are parsed with random ids; reuse the previous ones by page name so IIIF links survive.
function inheritPageIds(
	previous: StoredTranscriptionDocument | null,
	next: StoredTranscriptionDocument
): StoredTranscriptionDocument {
	const claimed = new Set(next.pages.map(page => page.teiAttrs?.['xml:id']).filter(Boolean));
	const pageIdsByName = new Map<string, string[]>();
	for (const page of previous?.pages ?? []) {
		if (!page.pageId || claimed.has(page.pageId)) continue;
		pageIdsByName.set(page.id, [...(pageIdsByName.get(page.id) ?? []), page.pageId]);
	}
	return {
		...next,
		pages: next.pages.map(page => {
			const pageId = page.teiAttrs?.['xml:id']
				? undefined
				: pageIdsByName.get(page.id)?.shift();
			return pageId ? { ...page, pageId } : page;
		}),
	};
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
		const updated = await rewriteTeiVersionNote(
			db,
			context.projectStorageSlug,
			documentVersionPath('transcription', context.projectTranscriptionId, checkpointId),
			row.label,
			note,
			storeOptions
		);
		await db
			.updateTable('transcription_checkpoints')
			.set({ label: updated.label, commit_message: updated.note })
			.where('id', '=', checkpointId)
			.execute();
	});
}

async function rewriteTeiVersionNote(
	db: DbExecutor,
	projectSlug: string,
	path: string,
	label: string,
	note: string | null,
	storeOptions: StoreOperationOptions
): Promise<{ label: string; note: string | null }> {
	await assertNoDocumentFileProblem(db, path);
	const xml = await readTextFile(joinStorePath(projectFolder(projectSlug), path), storeOptions);
	const { version } = parseTranscriptionTeiVersion(xml);
	if (!version) throw new Error(`Invalid version file ${path}: no Version change.`);
	const updated = { ...version, label: version.label || label, note };
	const serialized = await rewriteTranscriptionTeiVersion(xml, updated);
	await upsertDocumentFingerprint(
		db,
		await writeTeiFile(
			{ projectSlug, path, entityType: 'version', entityId: version.id, ...serialized },
			storeOptions
		)
	);
	return updated;
}

// Reads the content column once; every other primary-payload field mirrors this same row.
export async function loadTranscriptionWithWorkingFile(
	db: DbExecutor,
	transcriptionId: string,
	_storeOptions: StoreOperationOptions = {}
): Promise<TranscriptionRecord | null> {
	const record = await getTranscription(db, transcriptionId);
	if (!record) return null;
	const context = await loadTranscriptionFileContext(db, transcriptionId);
	if ((await getTranscriptionContentHash(db, context.projectTranscriptionId)) === null)
		return null;
	const { currentRevisionId, currentContentHash } = context;
	const basedOn = currentRevisionId && currentContentHash;
	return {
		...record,
		current_revision_id: basedOn ? currentRevisionId : '',
		current_content_hash: basedOn ? currentContentHash : '',
	};
}

async function loadPrimaryTranscription(
	db: DbExecutor,
	transcriptionId: string,
	storeOptions: StoreOperationOptions
): Promise<{ record: TranscriptionRecord; payload: ProjectTranscriptionPayload } | null> {
	const record = await getTranscription(db, transcriptionId);
	if (!record) return null;
	const context = await loadTranscriptionFileContext(db, transcriptionId);
	const payload = await readCurrentPayload(db, context, storeOptions);
	if (!payload) return null;
	return { record: transcriptionRecordFromPrimaryPayload(record, context, payload), payload };
}

export async function exportTranscriptionTeiWithFiles(
	db: DbExecutor,
	transcriptionId: string,
	document: StoredTranscriptionDocument,
	storeOptions: StoreOperationOptions = {}
): Promise<string> {
	const primary = await loadPrimaryTranscription(db, transcriptionId, storeOptions);
	if (!primary)
		throw new Error(`Canonical transcription file for ${transcriptionId} was not found.`);
	const payload = { ...primary.payload, content_json: document as unknown as JsonValue };
	return (await serializeTranscriptionTei(payload)).xml;
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
	const primaryPayload = await readCurrentPayload(db, context, storeOptions);
	if (primaryPayload) return projectTranscriptionSnapshotFromPayload(primaryPayload);
	throw new Error(
		`Canonical transcription file for project transcription ${projectTranscriptionId} was not found.`
	);
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

// The index mirrors a TEI Current, so it is read from SQLite instead of parsed.
async function readCurrentPayload(
	db: DbExecutor,
	context: TranscriptionFileContext,
	_storeOptions: StoreOperationOptions
): Promise<ProjectTranscriptionPayload | null> {
	if ((await getTranscriptionContentHash(db, context.projectTranscriptionId)) === null)
		return null;
	const snapshot = await loadProjectTranscriptionSnapshot(db, context.projectTranscriptionId);
	return currentPayload(context, snapshot, context.updatedAt);
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
