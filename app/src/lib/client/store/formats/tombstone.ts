import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject, SealedDocument } from '../envelope';
import { readNullableString, readString } from './validation';

export const TOMBSTONE_FORMAT = 'apatosaurus.tombstone';
export const TOMBSTONE_CURRENT_VERSION = 1;
export const tombstoneUpgraders: DocumentUpgrader[] = [];

export type TombstonePayload = JsonObject & {
	id: string;
	project_id: string | null;
	entity_type: string;
	entity_id: string;
	cloud_path: string;
	deletion_revision_id: string;
	deleted_by: string;
	deleted_at: string;
};

export type TombstoneDocument = SealedDocument<TombstonePayload, typeof TOMBSTONE_FORMAT>;

export const TOMBSTONE_FIXTURE: TombstonePayload = {
	id: 'tombstone-1',
	project_id: 'project-1',
	entity_type: 'project-transcription',
	entity_id: 'pt-deleted',
	cloud_path: 'transcriptions/pt-deleted.json',
	deletion_revision_id: 'tx-cp-deleted',
	deleted_by: 'editor@example.com',
	deleted_at: '2026-07-03T00:00:00.000Z',
};

export function validateTombstonePayload(payload: JsonObject): TombstonePayload {
	const record = payload as Record<string, unknown>;
	return {
		id: readString(record, 'id'),
		project_id: readNullableString(record, 'project_id'),
		entity_type: readString(record, 'entity_type'),
		entity_id: readString(record, 'entity_id'),
		cloud_path: readString(record, 'cloud_path'),
		deletion_revision_id: readString(record, 'deletion_revision_id'),
		deleted_by: readString(record, 'deleted_by'),
		deleted_at: readString(record, 'deleted_at'),
	};
}

export const tombstoneFormatRegistration: FormatRegistration<TombstonePayload> = {
	format: TOMBSTONE_FORMAT,
	currentVersion: TOMBSTONE_CURRENT_VERSION,
	upgraders: tombstoneUpgraders,
	validate: validateTombstonePayload,
};
