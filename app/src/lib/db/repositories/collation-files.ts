import type { Kysely } from 'kysely';

import {
	collationPayloadToContent,
	parseCollationTeiVersion,
	type CollationContent,
	type CollationPayload,
	type CollationTeiVersion,
	serializeCollationPayloadTei,
} from '$lib/storage/formats';
import { joinStorePath, projectFolder } from '$lib/storage/layout';
import { documentCanonicalPath, documentVersionPath } from '$lib/storage/document-files';
import { teiContentHash } from '$lib/storage/tei-content';
import { readTextFile, type StoreOperationOptions } from '$lib/storage/opfs-store';
import { recordStoreQuarantine, invalidShape, quarantineFromError } from '$lib/storage/quarantine';
import type { JsonObject } from '$lib/storage/envelope';
import {
	COLLATION_DOCUMENT_ARTIFACT_TYPE,
	buildCollationDocument,
	parseCollationDocument,
	serializeCollationDocument,
	type CollationDocument as SemanticCollationDocument,
} from '$lib/collation/collation-document';
import {
	rewriteCollationTeiChanges,
	type CollationRevisionChange,
} from '$lib/collation/collation-document-tei';
import { parseProjectCollationSettings } from '$lib/collation/project-settings';
import type { ProjectCollationSettings } from '$lib/collation/collation-types';
import { buildCollationProjectionFromDocument } from '$lib/collation/collation-projection';
import { deriveEntityCloudBackupState } from '$lib/backup/backup-status';

import type { Database } from '../types.generated';
import { createId } from './id';
import {
	assertNoDocumentFileProblem,
	getCollationContentHash,
	upsertDocumentFingerprint,
	writeTeiFile,
} from './document-fingerprints';
import { writeProjectManifestFile } from './project-files';
import { withProjectWriteLock } from './project-locks';
import {
	collationIndexRowsFromPayload,
	createCollation,
	getCollationWitnessSourceStatuses,
	loadIndexedCollationPayload,
	replaceCollationIndexRows,
	saveCollationProjection,
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
	inTransaction,
	recordCommittedCollationCheckpoint,
	nextCollationVersionLabel,
	type CollationCheckpoint,
	type CommitCollationInput,
	type PersistenceResult,
} from './revisions';
import type { DbExecutor } from '../worker-kysely';

interface CollationFileContext {
	collationId: string;
	projectId: string;
	projectStorageSlug: string;
	projectSettings: ProjectCollationSettings;
	currentRevisionId: string | null;
	currentContentHash: string | null;
	conflictOfCollationId: string;
	teiContentHash: string | null;
	createdAt: string;
	updatedAt: string;
}

type CollationRecordRow = Pick<
	CollationContent,
	'id' | 'project_id' | 'title' | 'verse_identifier' | 'group_path' | 'notes' | 'sort_key'
>;

type CollationCommit = CommitCollationInput & {
	checkpointId: string;
	label: string;
	createdAt: string;
	authorName: string;
	commitMessage: string | null;
};

export async function saveWorkingCollationArtifact(
	db: DbExecutor,
	input: SaveCollationArtifactInput,
	storeOptions: StoreOperationOptions = {}
): Promise<string> {
	const updatedAt = input.now ?? new Date().toISOString();
	const [context, collation] = await Promise.all([
		loadCollationFileContext(db, input.collationId),
		loadCollationRecordRow(db, input.collationId),
	]);
	if (input.artifactType !== COLLATION_DOCUMENT_ARTIFACT_TYPE) {
		throw new Error(`Unsupported canonical collation document type ${input.artifactType}.`);
	}
	const semanticDocument = parseCollationDocument(input.payload);
	if (!semanticDocument) throw new Error('Invalid collation_document_v1 document.');
	const artifactId = input.artifactId || crypto.randomUUID();
	const content = withMetadata(
		buildCurrentCollationContent(collation, semanticDocument),
		input.metadata ?? {}
	);
	await writeTeiCurrent(db, context, currentPayload(context, content, updatedAt), storeOptions);
	return artifactId;
}

export async function saveWorkingCollationMetadata(
	db: Kysely<Database>,
	input: UpdateCollationMetadataInput,
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	const context = await loadCollationFileContext(db, input.id);
	const source = await readCurrentPayload(db, context, storeOptions);
	if (!source) throw new Error(`Canonical collation file for ${input.id} was not found.`);
	const updatedAt = input.updatedAt ?? new Date().toISOString();
	const content = withMetadata(collationPayloadToContent(source), input);
	await writeTeiCurrent(db, context, currentPayload(context, content, updatedAt), storeOptions, {
		projection: false,
	});
}

function withMetadata(
	content: CollationContent,
	metadata: Omit<UpdateCollationMetadataInput, 'id' | 'updatedAt'>
): CollationContent {
	return {
		...content,
		title: metadata.title ?? content.title,
		verse_identifier: metadata.verseIdentifier ?? content.verse_identifier,
		status: metadata.status ?? content.status,
		notes: metadata.notes ?? content.notes,
		group_path: metadata.groupPath ?? content.group_path,
		sort_key: metadata.sortKey ?? content.sort_key,
	};
}

// Indexes the payload it writes; parsing the written file yields the same payload.
async function writeTeiCurrent(
	db: DbExecutor,
	context: CollationFileContext,
	payload: CollationPayload,
	storeOptions: StoreOperationOptions,
	{ projection = true }: { projection?: boolean } = {}
): Promise<void> {
	const path = documentCanonicalPath('collation', context.collationId);
	await assertNoDocumentFileProblem(db, path);
	const fingerprint = await writeTeiFile(
		{
			projectSlug: context.projectStorageSlug,
			path,
			entityType: 'collation',
			entityId: context.collationId,
			...(await serializeCollationPayloadTei(payload, context.projectSettings)),
		},
		storeOptions
	);
	await inTransaction(db, async trx => {
		await replaceCollationIndexRows(
			trx,
			collationIndexRowsFromPayload(context.projectId, payload)
		);
		if (projection)
			await saveCollationProjection(trx, {
				collationId: context.collationId,
				...buildCollationProjectionFromDocument(payload.document),
			});
		await upsertDocumentFingerprint(trx, fingerprint);
	});
}

async function readCurrentPayload(
	db: DbExecutor,
	context: CollationFileContext,
	storeOptions: StoreOperationOptions
): Promise<CollationPayload | null> {
	return (
		(await loadIndexedCollationPayload(db, context.collationId)) ??
		readTeiCurrentFile(context, storeOptions)
	);
}

async function readTeiCurrentFile(
	context: CollationFileContext,
	storeOptions: StoreOperationOptions
): Promise<CollationPayload | null> {
	const path = joinStorePath(
		projectFolder(context.projectStorageSlug),
		documentCanonicalPath('collation', context.collationId)
	);
	try {
		const payload = parseCollationTeiVersion(await readTextFile(path, storeOptions)).payload;
		if (payload.id !== context.collationId || payload.project_id !== context.projectId)
			throw invalidShape('Collation TEI identity does not match its index context.');
		return payload;
	} catch (error) {
		recordStoreQuarantine(storeOptions.quarantineSink, path, quarantineFromError(error));
		console.warn('[document-store] Could not read canonical collation TEI.', {
			path,
			error: errorMessage(error),
		});
		return null;
	}
}

function currentPayload(
	context: CollationFileContext,
	content: CollationContent,
	updatedAt: string
): CollationPayload {
	return {
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
		const [collation, projectName] = await Promise.all([
			loadCollationRecordRow(trx, id),
			loadProjectName(trx, context.projectId),
		]);
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

		const semanticDocument = parseCollationDocument(serializeCollationDocument(document));
		if (!semanticDocument) throw new Error('Invalid collation_document_v1 document.');
		const source = currentPayload(
			context,
			buildCurrentCollationContent(collation, semanticDocument),
			context.createdAt
		);
		const checkpoint = await withProjectWriteLock(context.projectId, async () =>
			commitTeiCollation(
				trx,
				context,
				source,
				{
					collationId: id,
					checkpointId: createId(),
					label: await nextCollationVersionLabel(trx, id),
					createdAt: context.createdAt,
					authorName: '',
					commitMessage: null,
				},
				storeOptions,
				{ projection: true }
			)
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
		const source = await readCurrentPayload(db, context, storeOptions);
		if (!source)
			throw new Error(`Canonical collation file for ${context.collationId} was not found.`);
		const checkpointId = input.checkpointId ?? createId();
		const createdAt = input.createdAt ?? new Date().toISOString();
		const authorName = input.authorName ?? '';
		const commitMessage = input.commitMessage ?? null;
		const label =
			input.label?.trim() || (await nextCollationVersionLabel(db, context.collationId));
		const commit = { ...input, checkpointId, label, createdAt, authorName, commitMessage };
		return commitTeiCollation(db, context, source, commit, storeOptions);
	});
}

async function commitTeiCollation(
	db: DbExecutor,
	context: CollationFileContext,
	source: CollationPayload,
	commit: CollationCommit,
	storeOptions: StoreOperationOptions,
	{ projection = false }: { projection?: boolean } = {}
): Promise<CollationCheckpoint> {
	await assertNoDocumentFileProblem(db, documentCanonicalPath('collation', context.collationId));
	const version = await serializeCollationPayloadTei(
		{ ...source, based_on_checkpoint: null },
		context.projectSettings,
		{
			id: commit.checkpointId,
			label: commit.label,
			note: commit.commitMessage,
			author_name: commit.authorName,
			created_at: commit.createdAt,
			parent_id: context.currentRevisionId,
		}
	);
	const versionPath = documentVersionPath('collation', context.collationId, commit.checkpointId);
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
	await writeTeiCurrent(db, context, { ...source, based_on_checkpoint: head }, storeOptions, {
		projection,
	});
	await upsertDocumentFingerprint(db, versionFingerprint);
	await writeProjectManifestFile(
		db,
		context.projectId,
		{ collations: { [context.collationId]: head } },
		storeOptions
	);
	const checkpoint = await recordCommittedCollationCheckpoint(
		db,
		context.collationId,
		version.contentHash,
		collationPayloadToContent(source),
		commit,
		context.currentRevisionId
	);
	return { ...checkpoint, warnings: [] };
}

async function readCollationVersionContent(
	db: DbExecutor,
	context: CollationFileContext,
	checkpointId: string,
	storeOptions: StoreOperationOptions
): Promise<{ content: CollationContent; contentHash: string }> {
	const teiPath = documentVersionPath('collation', context.collationId, checkpointId);
	const row = await db
		.selectFrom('collation_checkpoints')
		.select('content_hash')
		.where('id', '=', checkpointId)
		.where('collation_id', '=', context.collationId)
		.executeTakeFirst();
	const xml = await readTextFile(
		joinStorePath(projectFolder(context.projectStorageSlug), teiPath),
		storeOptions
	);
	const { payload, version } = parseCollationTeiVersion(xml);
	if (version?.id !== checkpointId || payload.id !== context.collationId)
		throw new Error(
			`Collation Version file ${teiPath} does not record Version ${checkpointId}.`
		);
	const contentHash = await teiContentHash(xml);
	if (contentHash !== row?.content_hash)
		throw new Error('Collation Version file hash does not match the index row.');
	return { content: collationPayloadToContent(payload), contentHash };
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
	return (await readCollationVersionContent(db, context, checkpointId, storeOptions)).content
		.document;
}

export async function restoreCollationVersion(
	db: Kysely<Database>,
	collationId: string,
	checkpointId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<CollationPayload> {
	const context = await loadCollationFileContext(db, collationId);
	const previous = await readCurrentPayload(db, context, storeOptions);
	if (!previous) throw new Error(`Current for collation ${collationId} was not found.`);
	const version = await readCollationVersionContent(db, context, checkpointId, storeOptions);
	const now = new Date().toISOString();
	await replaceCollationCurrent(
		db,
		collationId,
		{
			...version.content,
			based_on_checkpoint: { id: checkpointId, content_hash: version.contentHash },
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
		await writeTeiCurrent(db, context, payload, storeOptions);
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
		const updated = await rewriteTeiVersionNote(
			db,
			context.projectStorageSlug,
			documentVersionPath('collation', collationId, checkpointId),
			checkpointId,
			row.label,
			note,
			storeOptions
		);
		await db
			.updateTable('collation_checkpoints')
			.set({ label: updated.label, commit_message: updated.note })
			.where('id', '=', checkpointId)
			.execute();
	});
}

async function rewriteTeiVersionNote(
	db: DbExecutor,
	projectSlug: string,
	path: string,
	checkpointId: string,
	label: string,
	note: string | null,
	storeOptions: StoreOperationOptions
): Promise<Pick<CollationTeiVersion, 'label' | 'note'>> {
	await assertNoDocumentFileProblem(db, path);
	const storePath = joinStorePath(projectFolder(projectSlug), path);
	const xml = await readTextFile(storePath, storeOptions);
	let updated: Pick<CollationTeiVersion, 'label' | 'note'> | null = null;
	const serialized = await rewriteCollationTeiChanges(xml, changes =>
		changes.map((change): CollationRevisionChange => {
			if (change.type !== 'version') return change;
			updated = { label: change.n || label, note };
			return { ...change, n: updated.label, note };
		})
	);
	if (!updated) throw new Error(`Invalid version file ${path}: no Version change.`);
	await upsertDocumentFingerprint(
		db,
		await writeTeiFile(
			{ projectSlug, path, entityType: 'version', entityId: checkpointId, ...serialized },
			storeOptions
		)
	);
	return updated;
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
	const primaryPayload = await readCurrentPayload(db, context, storeOptions);
	if (primaryPayload) return loadedCollationFromPrimaryPayload(primaryPayload);
	return null;
}

export async function loadCommittedCollationPayloadWithFiles(
	db: Kysely<Database>,
	collationId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<CollationPayload> {
	const context = await loadCollationFileContext(db, collationId);
	const payload = await readCurrentPayload(db, context, storeOptions);
	if (!payload)
		throw new Error(`Canonical committed collation file for ${collationId} was not found.`);
	return payload;
}

/** Reads the canonical file itself, parsing TEI rather than using the index's cached document. */
export async function loadCanonicalCollationPayloadWithFiles(
	db: Kysely<Database>,
	collationId: string,
	storeOptions: StoreOperationOptions = {}
): Promise<CollationPayload> {
	const context = await loadCollationFileContext(db, collationId);
	const payload = await readTeiCurrentFile(context, storeOptions);
	if (!payload) throw new Error(`Canonical collation file for ${collationId} was not found.`);
	return payload;
}

/** The content hash staleness and dirty state compare. */
export async function loadCollationContentHashWithFiles(
	db: Kysely<Database>,
	collationId: string,
	_storeOptions: StoreOperationOptions = {}
): Promise<string> {
	const teiContentHash = await getCollationContentHash(db, collationId);
	if (teiContentHash === null)
		throw new Error(`Canonical collation file for ${collationId} was not found.`);
	await assertNoDocumentFileProblem(db, documentCanonicalPath('collation', collationId));
	return teiContentHash;
}

export async function getCollationVersionStatusWithWorkingFile(
	db: Kysely<Database>,
	collationId: string,
	options: CollationVersionStatusOptions = {},
	_storeOptions: StoreOperationOptions = {}
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
			'collations.group_path as group_path',
			'collations.sort_key as sort_key',
			'collations.status as status',
		])
		.where('collations.id', '=', collationId)
		.executeTakeFirst();
	if (!row) throw new Error(`Collation ${collationId} was not found.`);
	const context = await loadCollationFileContext(db, collationId);
	const workingContentHash = context.teiContentHash;
	if (workingContentHash === null)
		throw new Error(`Canonical collation file for ${collationId} was not found.`);
	const base = {
		projectId: row.project_id,
		projectName: row.project_name,
		collationId,
		title: row.title,
		verseIdentifier: row.verse_identifier,
		groupPath: row.group_path,
		sortKey: row.sort_key,
		workflowStatus: row.status,
		currentCheckpoint: await getCollationCommittedHead(db, collationId),
		witnesses: await getCollationWitnessSourceStatuses(db, collationId),
	};
	return collationVersionStatusFromHash(db, base, workingContentHash, options);
}

async function collationVersionStatusFromHash(
	db: Kysely<Database>,
	base: Omit<
		CollationVersionStatus,
		'workingContentHash' | 'dirtyToCheckpoint' | 'commitState' | 'cloudBackupState'
	>,
	workingContentHash: string,
	options: CollationVersionStatusOptions
): Promise<CollationVersionStatus> {
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
		{ entityType: 'collation', entityId: base.collationId },
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
		teiContentHash: await getCollationContentHash(db, collationId),
		collationId,
		projectId: requireString(row.project_id, 'project id'),
		projectStorageSlug: requireString(row.project_storage_slug, 'project storage slug'),
		projectSettings: parseProjectCollationSettings(row.collation_settings),
		currentRevisionId: emptyToNull(row.current_revision_id),
		currentContentHash: emptyToNull(row.current_content_hash),
		conflictOfCollationId: row.conflict_of_collation_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function loadCollationRecordRow(
	db: DbExecutor,
	collationId: string
): Promise<CollationRecordRow> {
	const row = await db
		.selectFrom('collations')
		.select([
			'id',
			'project_id',
			'title',
			'verse_identifier',
			'group_path',
			'notes',
			'sort_key',
		])
		.where('id', '=', collationId)
		.executeTakeFirst();
	if (!row) throw new Error(`Collation ${collationId} was not found.`);
	return { ...row, id: requireString(row.id, 'collation id') };
}

async function loadProjectName(db: DbExecutor, projectId: string): Promise<string | null> {
	const row = await db
		.selectFrom('projects')
		.select('name')
		.where('id', '=', projectId)
		.executeTakeFirst();
	return row?.name ?? null;
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
	collation: CollationRecordRow,
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
