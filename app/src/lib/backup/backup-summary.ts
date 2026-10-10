import type { Kysely } from 'kysely';
import type { Database } from '$lib/db/types.generated';
import { isTranscriptionDirty } from '$lib/db/repositories/revisions';
import { getCollationVersionStatusWithWorkingFile } from '$lib/db/repositories/collation-files';
import type { StoreOperationOptions } from '$lib/storage/opfs-store';
import type { SyncEntityHead } from './conflicts';
import type { SyncEntityReference, SyncEntityType } from './backup-status';
import { projectRelativePaths } from '$lib/storage/layout';

export interface LocalEntityState {
	entityType: SyncEntityType;
	entityId: string;
	projectId: string;
	primaryPath: string;
	head: SyncEntityHead;
	dirty: boolean;
	hasCommittedHead: boolean;
}

export async function loadLocalEntity(
	db: Kysely<Database>,
	reference: SyncEntityReference,
	storeOptions: StoreOperationOptions = {}
): Promise<LocalEntityState> {
	if (reference.entityType === 'project-transcription') {
		const row = await db
			.selectFrom('project_transcriptions')
			.innerJoin(
				'transcriptions',
				'transcriptions.id',
				'project_transcriptions.transcription_id'
			)
			.select([
				'project_transcriptions.project_id as project_id',
				'transcriptions.current_revision_id as current_revision_id',
				'transcriptions.current_content_hash as current_content_hash',
			])
			.where('project_transcriptions.id', '=', reference.entityId)
			.executeTakeFirst();
		if (!row) throw new Error(`Project transcription ${reference.entityId} was not found.`);
		const head = {
			revisionId: row.current_revision_id,
			contentHash: row.current_content_hash,
		};
		return {
			entityType: reference.entityType,
			entityId: reference.entityId,
			projectId: row.project_id,
			primaryPath: primaryPathFor(reference.entityType, reference.entityId),
			head,
			dirty: await isTranscriptionDirty(db, reference.entityId),
			hasCommittedHead: hasHead(head),
		};
	}

	const row = await db
		.selectFrom('collations')
		.select(['project_id', 'current_revision_id', 'current_content_hash'])
		.where('id', '=', reference.entityId)
		.executeTakeFirst();
	if (!row) throw new Error(`Collation ${reference.entityId} was not found.`);
	if (!row.project_id)
		throw new Error(`Collation ${reference.entityId} is not attached to a project.`);
	const head = {
		revisionId: row.current_revision_id,
		contentHash: row.current_content_hash,
	};
	return {
		entityType: reference.entityType,
		entityId: reference.entityId,
		projectId: row.project_id,
		primaryPath: primaryPathFor(reference.entityType, reference.entityId),
		head,
		dirty: (
			await getCollationVersionStatusWithWorkingFile(
				db,
				reference.entityId,
				{},
				{
					...storeOptions,
					allowIndexFallback: false,
				}
			)
		).dirtyToCheckpoint,
		hasCommittedHead: hasHead(head),
	};
}

export function primaryPathFor(entityType: SyncEntityType, entityId: string): string {
	const paths = projectRelativePaths();
	return entityType === 'project-transcription'
		? paths.transcriptions(entityId)
		: paths.collations(entityId);
}

function hasHead(head: SyncEntityHead): boolean {
	return Boolean(head.revisionId && head.contentHash);
}
