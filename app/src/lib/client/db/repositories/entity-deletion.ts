import type { Kysely, Transaction } from 'kysely';

import {
	TOMBSTONE_CURRENT_VERSION,
	TOMBSTONE_FORMAT,
	collationPrimaryFile,
	deleteFile,
	readCanonicalDocument,
	readTextFile,
	sealDocument,
	serializeSealedDocument,
	tombstoneFile,
	transcriptionPrimaryFile,
	writeTextFileAtomic,
	type StoreOperationOptions,
	type TombstonePayload,
} from '$lib/client/store';

import type { Database } from '../types.generated';
import { createId } from './id';
import { writeProjectManifestFile } from './project-files';
import { withProjectWriteLock } from './project-locks';

type EntityType = 'project-transcription' | 'collation';
type DbTransaction = Transaction<Database>;

export interface DeleteEntityWithFilesInput {
	deletedAt?: string;
	deletedBy?: string;
	tombstoneId?: string;
}

interface EntityDeletionContext {
	entityType: EntityType;
	entityId: string;
	indexEntityId: string;
	projectId: string;
	currentRevisionId: string;
	cloudPath: string;
	primaryPath: string;
	tombstonePath: string;
}

export async function deleteTranscriptionWithFiles(
	db: Kysely<Database>,
	transcriptionId: string,
	input: DeleteEntityWithFilesInput = {},
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	const lockContext = await loadTranscriptionDeletionContext(db, transcriptionId);
	await withProjectWriteLock(lockContext.projectId, async () =>
		deleteEntityWithFiles(
			db,
			await loadTranscriptionDeletionContext(db, transcriptionId),
			input,
			storeOptions
		)
	);
}

export async function deleteCollationWithFiles(
	db: Kysely<Database>,
	collationId: string,
	input: DeleteEntityWithFilesInput = {},
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	const lockContext = await loadCollationDeletionContext(db, collationId);
	await withProjectWriteLock(lockContext.projectId, async () =>
		deleteEntityWithFiles(
			db,
			await loadCollationDeletionContext(db, collationId),
			input,
			storeOptions
		)
	);
}

async function deleteEntityWithFiles(
	db: Kysely<Database>,
	context: EntityDeletionContext,
	input: DeleteEntityWithFilesInput,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const tombstone = await ensureTombstoneFile(context, input, storeOptions);
	await db.transaction().execute(async trx => {
		await upsertTombstoneRow(trx, tombstone);
		await deleteEntityIndexRows(trx, context);
		await trx
			.updateTable('projects')
			.set({ updated_at: tombstone.deleted_at })
			.where('id', '=', context.projectId)
			.execute();
		await writeProjectManifestFile(trx, context.projectId, {}, storeOptions);
	});
	await deletePrimaryFileBestEffort(context, storeOptions);
}

async function loadTranscriptionDeletionContext(
	db: Kysely<Database>,
	transcriptionId: string
): Promise<EntityDeletionContext> {
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
			'transcriptions.project_id as project_id',
			'projects.storage_slug as project_storage_slug',
			'transcriptions.current_revision_id as current_revision_id',
		])
		.where('transcriptions.id', '=', transcriptionId)
		.executeTakeFirst();
	if (!row) throw new Error(`Transcription ${transcriptionId} was not found.`);
	const projectTranscriptionId = requireString(
		row.project_transcription_id,
		'project transcription id'
	);
	const projectStorageSlug = requireString(row.project_storage_slug, 'project storage slug');
	return {
		entityType: 'project-transcription',
		entityId: projectTranscriptionId,
		indexEntityId: transcriptionId,
		projectId: row.project_id,
		currentRevisionId: row.current_revision_id || '',
		cloudPath: `transcriptions/${projectTranscriptionId}.json`,
		primaryPath: transcriptionPrimaryFile(projectStorageSlug, projectTranscriptionId),
		tombstonePath: tombstoneFile(
			projectStorageSlug,
			'project-transcription',
			projectTranscriptionId
		),
	};
}

async function loadCollationDeletionContext(
	db: Kysely<Database>,
	collationId: string
): Promise<EntityDeletionContext> {
	const row = await db
		.selectFrom('collations')
		.innerJoin('projects', 'projects.id', 'collations.project_id')
		.select([
			'collations.project_id as project_id',
			'projects.storage_slug as project_storage_slug',
			'collations.current_revision_id as current_revision_id',
		])
		.where('collations.id', '=', collationId)
		.executeTakeFirst();
	if (!row) throw new Error(`Collation ${collationId} was not found.`);
	const projectStorageSlug = requireString(row.project_storage_slug, 'project storage slug');
	return {
		entityType: 'collation',
		entityId: collationId,
		indexEntityId: collationId,
		projectId: row.project_id,
		currentRevisionId: row.current_revision_id || '',
		cloudPath: `collations/${collationId}.json`,
		primaryPath: collationPrimaryFile(projectStorageSlug, collationId),
		tombstonePath: tombstoneFile(projectStorageSlug, 'collation', collationId),
	};
}

async function ensureTombstoneFile(
	context: EntityDeletionContext,
	input: DeleteEntityWithFilesInput,
	storeOptions: StoreOperationOptions
): Promise<TombstonePayload> {
	try {
		const raw = await readTextFile(context.tombstonePath, storeOptions);
		const result = await readCanonicalDocument<TombstonePayload>(TOMBSTONE_FORMAT, raw);
		if (result.ok && tombstoneMatchesContext(result.payload, context)) return result.payload;
		throw new Error(`Refusing to overwrite existing tombstone file ${context.tombstonePath}.`);
	} catch (error) {
		if (!isMissingFileError(error)) throw error;
	}

	const payload: TombstonePayload = {
		id: input.tombstoneId ?? createId(),
		project_id: context.projectId,
		entity_type: context.entityType,
		entity_id: context.entityId,
		cloud_path: context.cloudPath,
		deletion_revision_id: context.currentRevisionId,
		deleted_by: input.deletedBy ?? '',
		deleted_at: input.deletedAt ?? new Date().toISOString(),
	};
	await writeSealedJsonFile(context.tombstonePath, payload, storeOptions);
	return payload;
}

async function writeSealedJsonFile(
	path: string,
	payload: TombstonePayload,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const document = await sealDocument(TOMBSTONE_FORMAT, TOMBSTONE_CURRENT_VERSION, payload);
	await writeTextFileAtomic(path, serializeSealedDocument(document), storeOptions);
}

function tombstoneMatchesContext(
	payload: TombstonePayload,
	context: EntityDeletionContext
): boolean {
	return (
		payload.project_id === context.projectId &&
		payload.entity_type === context.entityType &&
		payload.entity_id === context.entityId &&
		payload.cloud_path === context.cloudPath
	);
}

async function upsertTombstoneRow(trx: DbTransaction, tombstone: TombstonePayload): Promise<void> {
	await trx
		.insertInto('sync_tombstones')
		.values({
			id: tombstone.id,
			project_id: tombstone.project_id,
			entity_type: tombstone.entity_type,
			entity_id: tombstone.entity_id,
			cloud_path: tombstone.cloud_path,
			deletion_revision_id: tombstone.deletion_revision_id,
			deleted_by: tombstone.deleted_by,
			deleted_at: tombstone.deleted_at,
		})
		.onConflict(oc =>
			oc.columns(['project_id', 'entity_type', 'entity_id']).doUpdateSet({
				id: tombstone.id,
				cloud_path: tombstone.cloud_path,
				deletion_revision_id: tombstone.deletion_revision_id,
				deleted_by: tombstone.deleted_by,
				deleted_at: tombstone.deleted_at,
			})
		)
		.execute();
}

async function deleteEntityIndexRows(
	trx: DbTransaction,
	context: EntityDeletionContext
): Promise<void> {
	if (context.entityType === 'project-transcription') {
		const result = await trx
			.deleteFrom('transcriptions')
			.where('id', '=', context.indexEntityId)
			.executeTakeFirst();
		if (Number(result.numDeletedRows) === 0)
			throw new Error(`Transcription ${context.indexEntityId} was not found.`);
		return;
	}
	const result = await trx
		.deleteFrom('collations')
		.where('id', '=', context.indexEntityId)
		.executeTakeFirst();
	if (Number(result.numDeletedRows) === 0)
		throw new Error(`Collation ${context.indexEntityId} was not found.`);
}

async function deletePrimaryFileBestEffort(
	context: EntityDeletionContext,
	storeOptions: StoreOperationOptions
): Promise<void> {
	try {
		await deleteFile(context.primaryPath, storeOptions);
	} catch (error) {
		if (isMissingFileError(error)) return;
		console.warn('[document-store] Could not remove deleted entity primary file.', {
			entityType: context.entityType,
			entityId: context.entityId,
			path: context.primaryPath,
			error: errorMessage(error),
		});
	}
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
