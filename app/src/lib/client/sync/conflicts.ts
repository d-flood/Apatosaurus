import { nanoid } from 'nanoid';
import type { Kysely, Selectable, Transaction } from 'kysely';

import type {
	CollationArtifacts,
	CollationReadingWitnesses,
	CollationReadings,
	CollationTokens,
	CollationVariationUnits,
	CollationWitnesses,
	Collations,
	Database,
	IiifCanvasAnnotations,
	IiifManifestSources,
	ProjectTranscriptions,
	SyncTombstones,
	TranscriptionPageCanvasLinks,
	Transcriptions,
	TranscriptionVerseIndex,
} from '$lib/client/db/types.generated';
import {
	buildCollationHashPayload,
	buildTranscriptionHashPayload,
	canonicalJson,
	hashCanonicalPayload,
	loadProjectTranscriptionSnapshot,
	loadSerializedCollation,
} from '$lib/client/db/repositories/revisions';
import { projectRelativeCloudPaths } from './cloud-files';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export type SyncEntityType = 'project-transcription' | 'collation';

export interface SyncEntityHead {
	revisionId: string;
	contentHash: string;
}

export type CommittedHeadSyncClassification =
	| 'in_sync'
	| 'local_only_change'
	| 'remote_only_change'
	| 'local_remote_conflict';

export interface ClassifyCommittedHeadSyncInput {
	localHead: SyncEntityHead;
	remoteHead: SyncEntityHead;
	lastSyncedHead: SyncEntityHead;
}

export type TombstoneResolution = 'tombstone_wins' | 'delete_edit_conflict';

export type TombstoneApplicationOutcome =
	| 'entity_missing'
	| 'tombstone_wins'
	| 'delete_edit_conflict';

export interface TombstoneData {
	id: string;
	project_id: string | null;
	entity_type: string;
	entity_id: string;
	cloud_path: string;
	deletion_revision_id: string;
	deleted_by: string;
	deleted_at: string;
}

export interface CreateTombstoneInput {
	id?: string;
	projectId?: string | null;
	entityId: string;
	cloudPath?: string;
	deletionRevisionId?: string;
	deletedBy?: string;
	deletedAt?: string;
}

export interface TombstoneApplicationResult {
	outcome: TombstoneApplicationOutcome;
	tombstone: TombstoneData;
	entityRevisionId: string;
}

export interface PreserveDraftCheckpointInput {
	checkpointId?: string;
	authorName?: string;
	commitMessage?: string | null;
	createdAt?: string;
}

export interface PreserveProjectTranscriptionDraftInput extends PreserveDraftCheckpointInput {
	projectTranscriptionId: string;
}

export interface PreserveCollationDraftInput extends PreserveDraftCheckpointInput {
	collationId: string;
}

export interface DraftCheckpointResult {
	checkpointId: string;
	parentCheckpointId: string | null;
	contentHash: string;
}

export interface CreateProjectTranscriptionConflictCopyInput {
	projectTranscriptionId: string;
	conflictProjectTranscriptionId?: string;
	conflictTranscriptionId?: string;
	checkpointId?: string;
	actorName?: string;
	now?: string;
}

export interface ProjectTranscriptionConflictCopyResult {
	projectTranscriptionId: string;
	transcriptionId: string;
	currentRevisionId: string;
	currentContentHash: string;
	title: string;
	siglum: string;
}

export interface CreateCollationConflictCopyInput {
	collationId: string;
	conflictCollationId?: string;
	checkpointId?: string;
	actorName?: string;
	now?: string;
}

export interface CollationConflictCopyResult {
	collationId: string;
	currentRevisionId: string;
	currentContentHash: string;
	title: string;
}

export function classifyCommittedHeadSync(
	input: ClassifyCommittedHeadSyncInput
): CommittedHeadSyncClassification {
	if (headsEqual(input.localHead, input.remoteHead)) return 'in_sync';
	const localChanged = !headsEqual(input.localHead, input.lastSyncedHead);
	const remoteChanged = !headsEqual(input.remoteHead, input.lastSyncedHead);
	if (localChanged && remoteChanged) return 'local_remote_conflict';
	if (localChanged) return 'local_only_change';
	if (remoteChanged) return 'remote_only_change';
	return 'in_sync';
}

export async function createProjectTranscriptionTombstone(
	db: Kysely<Database>,
	input: CreateTombstoneInput
): Promise<TombstoneData> {
	return db.transaction().execute(async trx => {
		const entity = await loadProjectTranscriptionEntity(trx, input.entityId);
		const projectId = entity?.link.project_id ?? input.projectId ?? null;
		if (!projectId) throw new Error(`Project transcription ${input.entityId} was not found.`);
		const tombstone = await upsertTombstone(trx, {
			id: input.id ?? createId(),
			project_id: projectId,
			entity_type: 'project-transcription',
			entity_id: input.entityId,
			cloud_path:
				input.cloudPath ?? projectRelativeCloudPaths().transcriptions(input.entityId),
			deletion_revision_id:
				input.deletionRevisionId ?? entity?.transcription.current_revision_id ?? '',
			deleted_by: input.deletedBy ?? '',
			deleted_at: input.deletedAt ?? new Date().toISOString(),
		});
		if (entity) await deleteProjectTranscriptionEntity(trx, entity);
		return tombstone;
	});
}

export async function createCollationTombstone(
	db: Kysely<Database>,
	input: CreateTombstoneInput
): Promise<TombstoneData> {
	return db.transaction().execute(async trx => {
		const collation = await trx
			.selectFrom('collations')
			.selectAll()
			.where('id', '=', input.entityId)
			.executeTakeFirst();
		const projectId = collation?.project_id ?? input.projectId ?? null;
		const tombstone = await upsertTombstone(trx, {
			id: input.id ?? createId(),
			project_id: projectId,
			entity_type: 'collation',
			entity_id: input.entityId,
			cloud_path: input.cloudPath ?? projectRelativeCloudPaths().collations(input.entityId),
			deletion_revision_id: input.deletionRevisionId ?? collation?.current_revision_id ?? '',
			deleted_by: input.deletedBy ?? '',
			deleted_at: input.deletedAt ?? new Date().toISOString(),
		});
		if (collation)
			await trx.deleteFrom('collations').where('id', '=', input.entityId).execute();
		return tombstone;
	});
}

export async function classifyTombstoneAgainstProjectTranscription(
	db: DbExecutor,
	tombstone: TombstoneData
): Promise<TombstoneResolution | 'entity_missing'> {
	const entity = await loadProjectTranscriptionEntity(db, tombstone.entity_id);
	if (!entity) return 'entity_missing';
	return classifyTombstoneRevision(
		db,
		'project-transcription',
		entity.transcription.id,
		entity.transcription.current_revision_id,
		tombstone.deletion_revision_id
	);
}

export async function classifyTombstoneAgainstCollation(
	db: DbExecutor,
	tombstone: TombstoneData
): Promise<TombstoneResolution | 'entity_missing'> {
	const collation = await db
		.selectFrom('collations')
		.select(['id', 'current_revision_id'])
		.where('id', '=', tombstone.entity_id)
		.executeTakeFirst();
	if (!collation) return 'entity_missing';
	return classifyTombstoneRevision(
		db,
		'collation',
		requireId(collation.id, 'collation'),
		collation.current_revision_id,
		tombstone.deletion_revision_id
	);
}

export async function applyProjectTranscriptionTombstone(
	db: Kysely<Database>,
	tombstone: TombstoneData
): Promise<TombstoneApplicationResult> {
	return db.transaction().execute(async trx => {
		const saved = await upsertTombstone(trx, tombstone);
		const entity = await loadProjectTranscriptionEntity(trx, tombstone.entity_id);
		if (!entity) return { outcome: 'entity_missing', tombstone: saved, entityRevisionId: '' };
		const resolution = await classifyTombstoneRevision(
			trx,
			'project-transcription',
			entity.transcription.id,
			entity.transcription.current_revision_id,
			tombstone.deletion_revision_id
		);
		if (resolution === 'delete_edit_conflict') {
			return {
				outcome: 'delete_edit_conflict',
				tombstone: saved,
				entityRevisionId: entity.transcription.current_revision_id,
			};
		}
		await deleteProjectTranscriptionEntity(trx, entity);
		return {
			outcome: 'tombstone_wins',
			tombstone: saved,
			entityRevisionId: entity.transcription.current_revision_id,
		};
	});
}

export async function applyCollationTombstone(
	db: Kysely<Database>,
	tombstone: TombstoneData
): Promise<TombstoneApplicationResult> {
	return db.transaction().execute(async trx => {
		const saved = await upsertTombstone(trx, tombstone);
		const collation = await trx
			.selectFrom('collations')
			.select(['id', 'current_revision_id'])
			.where('id', '=', tombstone.entity_id)
			.executeTakeFirst();
		if (!collation)
			return { outcome: 'entity_missing', tombstone: saved, entityRevisionId: '' };
		const entityRevisionId = collation.current_revision_id;
		const resolution = await classifyTombstoneRevision(
			trx,
			'collation',
			requireId(collation.id, 'collation'),
			entityRevisionId,
			tombstone.deletion_revision_id
		);
		if (resolution === 'delete_edit_conflict') {
			return { outcome: 'delete_edit_conflict', tombstone: saved, entityRevisionId };
		}
		await trx.deleteFrom('collations').where('id', '=', tombstone.entity_id).execute();
		return { outcome: 'tombstone_wins', tombstone: saved, entityRevisionId };
	});
}

export async function preserveProjectTranscriptionDraftCheckpoint(
	db: Kysely<Database>,
	input: PreserveProjectTranscriptionDraftInput
): Promise<DraftCheckpointResult | null> {
	return db.transaction().execute(async trx => {
		const snapshot = await loadProjectTranscriptionSnapshot(trx, input.projectTranscriptionId);
		const head = await trx
			.selectFrom('transcriptions')
			.select(['current_revision_id', 'current_content_hash'])
			.where('id', '=', snapshot.id)
			.executeTakeFirstOrThrow();
		const payload = buildTranscriptionHashPayload(snapshot);
		const contentHash = await hashCanonicalPayload(payload);
		if (head.current_content_hash && contentHash === head.current_content_hash) return null;

		const checkpointId = input.checkpointId ?? createId();
		const parentCheckpointId = head.current_revision_id || null;
		await trx
			.insertInto('transcription_checkpoints')
			.values({
				id: checkpointId,
				transcription_id: snapshot.id,
				parent_checkpoint_id: parentCheckpointId,
				format: snapshot.format,
				payload: canonicalJson(payload),
				content_hash: contentHash,
				is_committed: 0,
				commit_message: input.commitMessage ?? 'Local draft before remote replacement',
				author_name: input.authorName ?? '',
				created_at: input.createdAt ?? new Date().toISOString(),
			})
			.execute();
		return { checkpointId, parentCheckpointId, contentHash };
	});
}

export async function preserveCollationDraftCheckpoint(
	db: Kysely<Database>,
	input: PreserveCollationDraftInput
): Promise<DraftCheckpointResult | null> {
	return db.transaction().execute(async trx => {
		const collation = await loadSerializedCollation(trx, input.collationId);
		const head = await trx
			.selectFrom('collations')
			.select(['current_revision_id', 'current_content_hash'])
			.where('id', '=', collation.id)
			.executeTakeFirstOrThrow();
		const payload = buildCollationHashPayload(collation);
		const contentHash = await hashCanonicalPayload(payload);
		if (head.current_content_hash && contentHash === head.current_content_hash) return null;

		const checkpointId = input.checkpointId ?? createId();
		const parentCheckpointId = head.current_revision_id || null;
		await trx
			.insertInto('collation_checkpoints')
			.values({
				id: checkpointId,
				collation_id: collation.id,
				parent_checkpoint_id: parentCheckpointId,
				payload: canonicalJson(payload),
				content_hash: contentHash,
				is_committed: 0,
				commit_message: input.commitMessage ?? 'Local draft before remote replacement',
				author_name: input.authorName ?? '',
				created_at: input.createdAt ?? new Date().toISOString(),
			})
			.execute();
		return { checkpointId, parentCheckpointId, contentHash };
	});
}

export async function createProjectTranscriptionConflictCopy(
	db: Kysely<Database>,
	input: CreateProjectTranscriptionConflictCopyInput
): Promise<ProjectTranscriptionConflictCopyResult> {
	return db.transaction().execute(async trx => {
		const entity = await loadProjectTranscriptionEntity(trx, input.projectTranscriptionId);
		if (!entity)
			throw new Error(`Project transcription ${input.projectTranscriptionId} was not found.`);

		const now = input.now ?? new Date().toISOString();
		const conflictTranscriptionId = input.conflictTranscriptionId ?? createId();
		const conflictProjectTranscriptionId = input.conflictProjectTranscriptionId ?? createId();
		const suffix = conflictSuffix(input.actorName);
		const title = appendConflictSuffix(entity.transcription.title, suffix);
		const siglum = appendConflictSuffix(
			entity.transcription.siglum || entity.transcription.title,
			suffix
		);
		await trx
			.insertInto('transcriptions')
			.values({
				...entity.transcription,
				id: conflictTranscriptionId,
				scope_type: 'project_snapshot',
				project_id: entity.link.project_id,
				origin_type: 'conflict_copy',
				origin_project_id: entity.link.project_id,
				origin_transcription_id: entity.transcription.id,
				origin_revision_id: entity.transcription.current_revision_id,
				origin_content_hash: entity.transcription.current_content_hash,
				current_revision_id: '',
				current_content_hash: '',
				title,
				siglum,
				created_at: now,
				updated_at: now,
			})
			.execute();
		await trx
			.insertInto('project_transcriptions')
			.values({
				id: conflictProjectTranscriptionId,
				project_id: entity.link.project_id,
				transcription_id: conflictTranscriptionId,
				canonical_transcription_id: entity.link.canonical_transcription_id,
				added_at: now,
				added_by_id: null,
			})
			.execute();
		await copyTranscriptionChildRows(
			trx,
			entity.transcription.id,
			conflictTranscriptionId,
			now
		);
		const checkpoint = await createCommittedCheckpointForProjectTranscriptionCopy(
			trx,
			conflictProjectTranscriptionId,
			input.checkpointId ?? createId(),
			input.actorName ?? '',
			now
		);
		return {
			projectTranscriptionId: conflictProjectTranscriptionId,
			transcriptionId: conflictTranscriptionId,
			currentRevisionId: checkpoint.checkpointId,
			currentContentHash: checkpoint.contentHash,
			title,
			siglum,
		};
	});
}

export async function createCollationConflictCopy(
	db: Kysely<Database>,
	input: CreateCollationConflictCopyInput
): Promise<CollationConflictCopyResult> {
	return db.transaction().execute(async trx => {
		const source = await trx
			.selectFrom('collations')
			.selectAll()
			.where('id', '=', input.collationId)
			.executeTakeFirst();
		if (!source) throw new Error(`Collation ${input.collationId} was not found.`);

		const now = input.now ?? new Date().toISOString();
		const conflictCollationId = input.conflictCollationId ?? createId();
		const title = appendConflictSuffix(source.title, conflictSuffix(input.actorName));
		await trx
			.insertInto('collations')
			.values({
				...source,
				id: conflictCollationId,
				current_revision_id: '',
				current_content_hash: '',
				title,
				created_at: now,
				updated_at: now,
			})
			.execute();
		await copyCollationChildRows(
			trx,
			requireId(source.id, 'collation'),
			conflictCollationId,
			now
		);
		const checkpoint = await createCommittedCheckpointForCollationCopy(
			trx,
			conflictCollationId,
			input.checkpointId ?? createId(),
			input.actorName ?? '',
			now
		);
		return {
			collationId: conflictCollationId,
			currentRevisionId: checkpoint.checkpointId,
			currentContentHash: checkpoint.contentHash,
			title,
		};
	});
}

function headsEqual(left: SyncEntityHead, right: SyncEntityHead): boolean {
	return left.revisionId === right.revisionId && left.contentHash === right.contentHash;
}

async function classifyTombstoneRevision(
	db: DbExecutor,
	entityType: SyncEntityType,
	entityId: string,
	entityRevisionId: string,
	deletionRevisionId: string
): Promise<TombstoneResolution> {
	if (!entityRevisionId) return 'tombstone_wins';
	if (!deletionRevisionId) return 'delete_edit_conflict';
	if (entityRevisionId === deletionRevisionId) return 'tombstone_wins';
	if (await isRevisionAncestor(db, entityType, entityId, entityRevisionId, deletionRevisionId)) {
		return 'tombstone_wins';
	}
	return 'delete_edit_conflict';
}

async function isRevisionAncestor(
	db: DbExecutor,
	entityType: SyncEntityType,
	entityId: string,
	ancestorRevisionId: string,
	descendantRevisionId: string
): Promise<boolean> {
	if (ancestorRevisionId === descendantRevisionId) return true;
	let current: string | null = descendantRevisionId;
	const seen = new Set<string>();
	while (current && !seen.has(current)) {
		seen.add(current);
		const parent: string | null =
			entityType === 'project-transcription'
				? await loadTranscriptionCheckpointParent(db, entityId, current)
				: await loadCollationCheckpointParent(db, entityId, current);
		if (parent === ancestorRevisionId) return true;
		current = parent;
	}
	return false;
}

async function loadTranscriptionCheckpointParent(
	db: DbExecutor,
	transcriptionId: string,
	checkpointId: string
): Promise<string | null> {
	const row = await db
		.selectFrom('transcription_checkpoints')
		.select('parent_checkpoint_id')
		.where('id', '=', checkpointId)
		.where('transcription_id', '=', transcriptionId)
		.executeTakeFirst();
	return row?.parent_checkpoint_id ?? null;
}

async function loadCollationCheckpointParent(
	db: DbExecutor,
	collationId: string,
	checkpointId: string
): Promise<string | null> {
	const row = await db
		.selectFrom('collation_checkpoints')
		.select('parent_checkpoint_id')
		.where('id', '=', checkpointId)
		.where('collation_id', '=', collationId)
		.executeTakeFirst();
	return row?.parent_checkpoint_id ?? null;
}

async function upsertTombstone(db: DbExecutor, tombstone: TombstoneData): Promise<TombstoneData> {
	await db
		.insertInto('sync_tombstones')
		.values(tombstone)
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
	const row = await db
		.selectFrom('sync_tombstones')
		.selectAll()
		.where('id', '=', tombstone.id)
		.executeTakeFirstOrThrow();
	return mapTombstone(row);
}

interface ProjectTranscriptionEntity {
	link: Selectable<ProjectTranscriptions> & { id: string };
	transcription: Selectable<Transcriptions> & { id: string };
}

async function loadProjectTranscriptionEntity(
	db: DbExecutor,
	projectTranscriptionId: string
): Promise<ProjectTranscriptionEntity | null> {
	const link = await db
		.selectFrom('project_transcriptions')
		.selectAll()
		.where('id', '=', projectTranscriptionId)
		.executeTakeFirst();
	if (!link) return null;
	const transcription = await db
		.selectFrom('transcriptions')
		.selectAll()
		.where('id', '=', link.transcription_id)
		.executeTakeFirst();
	if (!transcription) return null;
	return {
		link: { ...link, id: requireId(link.id, 'project transcription') },
		transcription: { ...transcription, id: requireId(transcription.id, 'transcription') },
	};
}

async function deleteProjectTranscriptionEntity(
	db: DbExecutor,
	entity: ProjectTranscriptionEntity
): Promise<void> {
	await db.deleteFrom('project_transcriptions').where('id', '=', entity.link.id).execute();
	if (
		entity.transcription.scope_type === 'project_snapshot' &&
		entity.transcription.project_id === entity.link.project_id
	) {
		await db
			.deleteFrom('transcriptions')
			.where('id', '=', entity.transcription.id)
			.where('scope_type', '=', 'project_snapshot')
			.execute();
	}
}

async function copyTranscriptionChildRows(
	db: DbExecutor,
	sourceTranscriptionId: string,
	targetTranscriptionId: string,
	now: string
): Promise<void> {
	const verseRows = await db
		.selectFrom('transcription_verse_index')
		.selectAll()
		.where('transcription_id', '=', sourceTranscriptionId)
		.execute();
	if (verseRows.length > 0) {
		const copiedRows: Selectable<TranscriptionVerseIndex>[] = verseRows.map(row => ({
			...row,
			id: createId(),
			transcription_id: targetTranscriptionId,
			last_indexed_at: now,
		}));
		await db.insertInto('transcription_verse_index').values(copiedRows).execute();
	}

	const manifestRows = await db
		.selectFrom('iiif_manifest_sources')
		.selectAll()
		.where('transcription_id', '=', sourceTranscriptionId)
		.execute();
	const manifestIdMap = new Map<string, string>();
	const copiedManifestRows: Selectable<IiifManifestSources>[] = manifestRows.map(row => {
		const nextId = createId();
		manifestIdMap.set(requireId(row.id, 'manifest source'), nextId);
		return { ...row, id: nextId, transcription_id: targetTranscriptionId };
	});
	if (copiedManifestRows.length > 0)
		await db.insertInto('iiif_manifest_sources').values(copiedManifestRows).execute();

	const pageLinkRows = await db
		.selectFrom('transcription_page_canvas_links')
		.selectAll()
		.where('transcription_id', '=', sourceTranscriptionId)
		.execute();
	const copiedPageLinkRows: Selectable<TranscriptionPageCanvasLinks>[] = pageLinkRows.flatMap(
		row => {
			const manifestSourceId = manifestIdMap.get(row.manifest_source_id);
			return manifestSourceId
				? [
						{
							...row,
							id: createId(),
							transcription_id: targetTranscriptionId,
							manifest_source_id: manifestSourceId,
						},
					]
				: [];
		}
	);
	if (copiedPageLinkRows.length > 0)
		await db.insertInto('transcription_page_canvas_links').values(copiedPageLinkRows).execute();

	const annotationRows = await db
		.selectFrom('iiif_canvas_annotations')
		.selectAll()
		.where('transcription_id', '=', sourceTranscriptionId)
		.execute();
	const copiedAnnotationRows: Selectable<IiifCanvasAnnotations>[] = annotationRows.flatMap(
		row => {
			const manifestSourceId = manifestIdMap.get(row.manifest_source_id);
			return manifestSourceId
				? [
						{
							...row,
							id: createId(),
							transcription_id: targetTranscriptionId,
							manifest_source_id: manifestSourceId,
						},
					]
				: [];
		}
	);
	if (copiedAnnotationRows.length > 0)
		await db.insertInto('iiif_canvas_annotations').values(copiedAnnotationRows).execute();
}

async function copyCollationChildRows(
	db: DbExecutor,
	sourceCollationId: string,
	targetCollationId: string,
	now: string
): Promise<void> {
	const artifactRows = await db
		.selectFrom('collation_artifacts')
		.selectAll()
		.where('collation_id', '=', sourceCollationId)
		.execute();
	if (artifactRows.length > 0) {
		const copiedRows: Selectable<CollationArtifacts>[] = artifactRows.map(row => ({
			...row,
			id: createId(),
			collation_id: targetCollationId,
			created_at: now,
		}));
		await db.insertInto('collation_artifacts').values(copiedRows).execute();
	}

	const witnessRows = await db
		.selectFrom('collation_witnesses')
		.selectAll()
		.where('collation_id', '=', sourceCollationId)
		.execute();
	if (witnessRows.length > 0) {
		const copiedRows: Selectable<CollationWitnesses>[] = witnessRows.map(row => ({
			...row,
			id: createId(),
			collation_id: targetCollationId,
		}));
		await db.insertInto('collation_witnesses').values(copiedRows).execute();
	}

	const tokenRows = await db
		.selectFrom('collation_tokens')
		.selectAll()
		.where('collation_id', '=', sourceCollationId)
		.execute();
	if (tokenRows.length > 0) {
		const copiedRows: Selectable<CollationTokens>[] = tokenRows.map(row => ({
			...row,
			id: createId(),
			collation_id: targetCollationId,
		}));
		await db.insertInto('collation_tokens').values(copiedRows).execute();
	}

	const variationUnitRows = await db
		.selectFrom('collation_variation_units')
		.selectAll()
		.where('collation_id', '=', sourceCollationId)
		.execute();
	const variationUnitIdMap = new Map<string, string>();
	if (variationUnitRows.length > 0) {
		const copiedRows: Selectable<CollationVariationUnits>[] = variationUnitRows.map(row => {
			const nextId = createId();
			variationUnitIdMap.set(requireId(row.id, 'variation unit'), nextId);
			return { ...row, id: nextId, collation_id: targetCollationId };
		});
		await db.insertInto('collation_variation_units').values(copiedRows).execute();
	}

	const sourceVariationUnitIds = [...variationUnitIdMap.keys()];
	if (sourceVariationUnitIds.length === 0) return;
	const readingRows = await db
		.selectFrom('collation_readings')
		.selectAll()
		.where('variation_unit_id', 'in', sourceVariationUnitIds)
		.execute();
	const readingIdMap = new Map<string, string>();
	if (readingRows.length > 0) {
		const copiedRows: Selectable<CollationReadings>[] = readingRows.flatMap(row => {
			const variationUnitId = variationUnitIdMap.get(row.variation_unit_id);
			if (!variationUnitId) return [];
			const nextId = createId();
			readingIdMap.set(requireId(row.id, 'reading'), nextId);
			return [{ ...row, id: nextId, variation_unit_id: variationUnitId }];
		});
		if (copiedRows.length > 0)
			await db.insertInto('collation_readings').values(copiedRows).execute();
	}

	const sourceReadingIds = [...readingIdMap.keys()];
	if (sourceReadingIds.length === 0) return;
	const readingWitnessRows = await db
		.selectFrom('collation_reading_witnesses')
		.selectAll()
		.where('reading_id', 'in', sourceReadingIds)
		.execute();
	if (readingWitnessRows.length > 0) {
		const copiedRows: Selectable<CollationReadingWitnesses>[] = readingWitnessRows.flatMap(
			row => {
				const readingId = readingIdMap.get(row.reading_id);
				return readingId ? [{ ...row, id: createId(), reading_id: readingId }] : [];
			}
		);
		if (copiedRows.length > 0)
			await db.insertInto('collation_reading_witnesses').values(copiedRows).execute();
	}
}

async function createCommittedCheckpointForProjectTranscriptionCopy(
	db: DbExecutor,
	projectTranscriptionId: string,
	checkpointId: string,
	authorName: string,
	now: string
): Promise<{ checkpointId: string; contentHash: string }> {
	const snapshot = await loadProjectTranscriptionSnapshot(db, projectTranscriptionId);
	const payload = buildTranscriptionHashPayload(snapshot);
	const contentHash = await hashCanonicalPayload(payload);
	await db
		.insertInto('transcription_checkpoints')
		.values({
			id: checkpointId,
			transcription_id: snapshot.id,
			parent_checkpoint_id: null,
			format: snapshot.format,
			payload: canonicalJson(payload),
			content_hash: contentHash,
			is_committed: 1,
			commit_message: 'Conflicted copy',
			author_name: authorName,
			created_at: now,
		})
		.execute();
	await db
		.updateTable('transcriptions')
		.set({ current_revision_id: checkpointId, current_content_hash: contentHash })
		.where('id', '=', snapshot.id)
		.execute();
	return { checkpointId, contentHash };
}

async function createCommittedCheckpointForCollationCopy(
	db: DbExecutor,
	collationId: string,
	checkpointId: string,
	authorName: string,
	now: string
): Promise<{ checkpointId: string; contentHash: string }> {
	const collation = await loadSerializedCollation(db, collationId);
	const payload = buildCollationHashPayload(collation);
	const contentHash = await hashCanonicalPayload(payload);
	await db
		.insertInto('collation_checkpoints')
		.values({
			id: checkpointId,
			collation_id: collation.id,
			parent_checkpoint_id: null,
			payload: canonicalJson(payload),
			content_hash: contentHash,
			is_committed: 1,
			commit_message: 'Conflicted copy',
			author_name: authorName,
			created_at: now,
		})
		.execute();
	await db
		.updateTable('collations')
		.set({ current_revision_id: checkpointId, current_content_hash: contentHash })
		.where('id', '=', collation.id)
		.execute();
	return { checkpointId, contentHash };
}

function mapTombstone(row: Selectable<SyncTombstones>): TombstoneData {
	return {
		id: requireId(row.id, 'tombstone'),
		project_id: row.project_id,
		entity_type: row.entity_type,
		entity_id: row.entity_id,
		cloud_path: row.cloud_path,
		deletion_revision_id: row.deletion_revision_id,
		deleted_by: row.deleted_by,
		deleted_at: row.deleted_at,
	};
}

function appendConflictSuffix(value: string, suffix: string): string {
	return `${value.trim() || 'Untitled'} ${suffix}`;
}

function conflictSuffix(actorName: string | undefined): string {
	const actor = actorName?.trim();
	return actor ? `(Conflicted Copy from ${actor})` : '(Conflicted Copy)';
}

function requireId(value: string | null, label: string): string {
	if (!value) throw new Error(`Missing ${label} id.`);
	return value;
}

function createId(): string {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: nanoid();
}
