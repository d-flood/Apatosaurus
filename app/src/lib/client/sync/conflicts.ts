import { nanoid } from 'nanoid';
import type { Kysely, Selectable, Transaction } from 'kysely';

import type {
	CollationArtifacts,
	CollationReadingWitnesses,
	CollationReadings,
	CollationTokens,
	CollationVariationUnits,
	CollationWitnesses,
	Database,
	IiifCanvasAnnotations,
	IiifManifestSources,
	ProjectTranscriptions,
	TranscriptionPageCanvasLinks,
	Transcriptions,
	TranscriptionVerseIndex,
} from '$lib/client/db/types.generated';
import {
	buildCollationHashPayload,
	buildTranscriptionHashPayload,
	hashCanonicalPayload,
	loadProjectTranscriptionSnapshot,
	loadSerializedCollation,
} from '$lib/client/db/repositories/revisions';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export type SyncEntityType = 'project-transcription' | 'collation';

export interface SyncEntityHead {
	revisionId: string;
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
