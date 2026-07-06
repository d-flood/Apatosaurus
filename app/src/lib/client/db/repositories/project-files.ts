import type { Kysely, Transaction } from 'kysely';

import {
	PROJECT_MANIFEST_CURRENT_VERSION,
	PROJECT_MANIFEST_FORMAT,
	projectManifestFile,
	sealDocument,
	serializeSealedDocument,
	writeTextFileAtomic,
	type JsonValue,
	type ProjectManifestCollationHead,
	type ProjectManifestPayload,
	type ProjectManifestRevisionHead,
	type ProjectManifestTombstoneHead,
	type ProjectManifestTranscriptionHead,
	type StoreOperationOptions,
} from '$lib/client/store';
import { hashCanonicalPayload } from '$lib/client/sync/canonical-json';

import type { Database } from '../types.generated';
import { getProject } from './projects';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export interface ProjectManifestHeadOverrides {
	transcriptions?: Record<string, ProjectManifestRevisionHead | null>;
	collations?: Record<string, ProjectManifestRevisionHead | null>;
}

export async function writeProjectManifestFile(
	db: DbExecutor,
	projectId: string,
	overrides: ProjectManifestHeadOverrides = {},
	storeOptions: StoreOperationOptions = {}
): Promise<ProjectManifestPayload> {
	const project = await getProject(db, projectId);
	if (!project) throw new Error(`Project ${projectId} was not found.`);

	const [transcriptions, collations, tombstones] = await Promise.all([
		listProjectManifestTranscriptionHeads(db, projectId, overrides.transcriptions ?? {}),
		listProjectManifestCollationHeads(db, projectId, overrides.collations ?? {}),
		listProjectManifestTombstoneHeads(db, projectId),
	]);
	const manifestContentHash = await hashCanonicalPayload({
		project_id: project.id,
		transcriptions,
		collations,
		tombstones,
	});
	const payload: ProjectManifestPayload = {
		id: project.id,
		name: project.name,
		description: project.description,
		charter: project.charter,
		collation_settings: project.collationSettings as JsonValue,
		manifest_content_hash: manifestContentHash,
		transcriptions,
		collations,
		tombstones,
		created_at: project.createdAt,
		updated_at: project.updatedAt,
	};
	const document = await sealDocument(
		PROJECT_MANIFEST_FORMAT,
		PROJECT_MANIFEST_CURRENT_VERSION,
		payload
	);
	await writeTextFileAtomic(
		projectManifestFile(project.storageSlug),
		serializeSealedDocument(document),
		storeOptions
	);
	return payload;
}

async function listProjectManifestTranscriptionHeads(
	db: DbExecutor,
	projectId: string,
	overrides: Record<string, ProjectManifestRevisionHead | null>
): Promise<ProjectManifestTranscriptionHead[]> {
	const rows = await db
		.selectFrom('project_transcriptions')
		.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
		.select([
			'project_transcriptions.id as project_transcription_id',
			'project_transcriptions.transcription_id as transcription_id',
			'transcriptions.current_revision_id as current_revision_id',
			'transcriptions.current_content_hash as current_content_hash',
			'transcriptions.title as title',
			'transcriptions.siglum as siglum',
		])
		.where('project_transcriptions.project_id', '=', projectId)
		.orderBy('project_transcriptions.id', 'asc')
		.execute();
	return rows.map(row => {
		const projectTranscriptionId = requireId(
			row.project_transcription_id,
			'project transcription'
		);
		return {
			project_transcription_id: projectTranscriptionId,
			transcription_id: row.transcription_id,
			current_revision:
				projectTranscriptionId in overrides
					? overrides[projectTranscriptionId]
					: revisionHead(row.current_revision_id, row.current_content_hash),
			title: row.title,
			siglum: row.siglum,
			primary_path: `transcriptions/${projectTranscriptionId}.json`,
		};
	});
}

async function listProjectManifestCollationHeads(
	db: DbExecutor,
	projectId: string,
	overrides: Record<string, ProjectManifestRevisionHead | null>
): Promise<ProjectManifestCollationHead[]> {
	const rows = await db
		.selectFrom('collations')
		.select(['id', 'current_revision_id', 'current_content_hash', 'title', 'verse_identifier'])
		.where('project_id', '=', projectId)
		.orderBy('id', 'asc')
		.execute();
	return rows.map(row => {
		const collationId = requireId(row.id, 'collation');
		return {
			collation_id: collationId,
			current_revision:
				collationId in overrides
					? overrides[collationId]
					: revisionHead(row.current_revision_id, row.current_content_hash),
			title: row.title,
			verse_identifier: row.verse_identifier,
			primary_path: `collations/${collationId}.json`,
		};
	});
}

async function listProjectManifestTombstoneHeads(
	db: DbExecutor,
	projectId: string
): Promise<ProjectManifestTombstoneHead[]> {
	const rows = await db
		.selectFrom('sync_tombstones')
		.selectAll()
		.where('project_id', '=', projectId)
		.orderBy('id', 'asc')
		.execute();
	return Promise.all(
		rows.map(async row => {
			const tombstoneId = requireId(row.id, 'tombstone');
			return {
				tombstone_id: tombstoneId,
				entity_type: row.entity_type,
				entity_id: row.entity_id,
				deletion_revision_id: row.deletion_revision_id,
				content_hash: await hashCanonicalPayload({
					id: tombstoneId,
					project_id: row.project_id,
					entity_type: row.entity_type,
					entity_id: row.entity_id,
					cloud_path: row.cloud_path,
					deletion_revision_id: row.deletion_revision_id,
					deleted_by: row.deleted_by,
					deleted_at: row.deleted_at,
				}),
				primary_path: `tombstones/${row.entity_type}--${row.entity_id}.json`,
				deleted_at: row.deleted_at,
			};
		})
	);
}

function revisionHead(
	revisionId: string | null,
	contentHash: string | null
): ProjectManifestRevisionHead | null {
	return revisionId && contentHash ? { id: revisionId, content_hash: contentHash } : null;
}

function requireId(value: string | null, label: string): string {
	if (!value) throw new Error(`Missing ${label} id.`);
	return value;
}
