import type { Kysely } from 'kysely';

import type { Database } from '../types.generated';

export interface RemoveLocalProjectInput {
	projectId: string;
	connectionId?: string;
}

export interface RemoveLocalProjectResult {
	projectId: string;
	removedProjectTranscriptions: number;
	removedProjectOwnedTranscriptions: number;
	removedCollations: number;
	removedCheckpoints: number;
	removedSyncMetadata: number;
	removedTombstones: number;
}

export async function removeLocalProject(
	db: Kysely<Database>,
	input: RemoveLocalProjectInput
): Promise<RemoveLocalProjectResult> {
	return db.transaction().execute(async trx => {
		const project = await trx
			.selectFrom('projects')
			.select('id')
			.where('id', '=', input.projectId)
			.executeTakeFirst();
		if (!project) throw new Error(`Project ${input.projectId} was not found.`);

		const projectTranscriptionRows = await trx
			.selectFrom('project_transcriptions')
			.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
			.select([
				'project_transcriptions.id as project_transcription_id',
				'project_transcriptions.transcription_id as transcription_id',
				'transcriptions.scope_type as scope_type',
				'transcriptions.project_id as transcription_project_id',
			])
			.where('project_transcriptions.project_id', '=', input.projectId)
			.execute();
		const projectTranscriptionIds = projectTranscriptionRows.map(row =>
			requireId(row.project_transcription_id, 'project transcription')
		);
		const projectOwnedTranscriptionIds = projectTranscriptionRows
			.filter(
				row =>
					row.scope_type === 'project_snapshot' && row.transcription_project_id === input.projectId
			)
			.map(row => requireId(row.transcription_id, 'project-owned transcription'));

		const collationRows = await trx
			.selectFrom('collations')
			.select('id')
			.where('project_id', '=', input.projectId)
			.execute();
		const collationIds = collationRows.map(row => requireId(row.id, 'collation'));

		let removedCheckpoints = 0;
		if (collationIds.length > 0) {
			removedCheckpoints += await deleteCount(
				trx.deleteFrom('collation_checkpoints').where('collation_id', 'in', collationIds)
			);
			await trx.deleteFrom('collations').where('id', 'in', collationIds).execute();
		}

		if (projectOwnedTranscriptionIds.length > 0) {
			removedCheckpoints += await deleteCount(
				trx
					.deleteFrom('transcription_checkpoints')
					.where('transcription_id', 'in', projectOwnedTranscriptionIds)
			);
		}

		if (projectTranscriptionIds.length > 0) {
			await trx.deleteFrom('project_transcriptions').where('id', 'in', projectTranscriptionIds).execute();
		}
		if (projectOwnedTranscriptionIds.length > 0) {
			await trx
				.deleteFrom('transcriptions')
				.where('id', 'in', projectOwnedTranscriptionIds)
				.where('scope_type', '=', 'project_snapshot')
				.where('project_id', '=', input.projectId)
				.execute();
		}

		const syncMetadataQuery = trx
			.deleteFrom('cloud_sync_metadata')
			.where('scope_type', '=', 'project')
			.where('scope_id', '=', input.projectId);
		const removedSyncMetadata = await deleteCount(syncMetadataQuery);
		const removedTombstones = await deleteCount(
			trx.deleteFrom('sync_tombstones').where('project_id', '=', input.projectId)
		);

		await trx.deleteFrom('cloud_project_folders').where('project_id', '=', input.projectId).execute();
		await trx.deleteFrom('projects').where('id', '=', input.projectId).execute();

		return {
			projectId: input.projectId,
			removedProjectTranscriptions: projectTranscriptionIds.length,
			removedProjectOwnedTranscriptions: projectOwnedTranscriptionIds.length,
			removedCollations: collationIds.length,
			removedCheckpoints,
			removedSyncMetadata,
			removedTombstones,
		};
	});
}

async function deleteCount(query: { executeTakeFirst(): Promise<{ numDeletedRows: bigint | number }> }) {
	const result = await query.executeTakeFirst();
	return Number(result.numDeletedRows);
}

function requireId(value: string | null, label: string): string {
	if (!value) throw new Error(`Missing ${label} ID.`);
	return value;
}
