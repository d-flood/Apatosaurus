import type { JsonObject, JsonValue } from '../envelope';
import {
	readJsonValue,
	readLiteral,
	readNullableString,
	readString,
} from './validation';

export const TRANSCRIPTION_HISTORY_ENTITY_TYPE = 'project-transcription';
export const COLLATION_HISTORY_ENTITY_TYPE = 'collation';

export type HistoryEntityType =
	| typeof TRANSCRIPTION_HISTORY_ENTITY_TYPE
	| typeof COLLATION_HISTORY_ENTITY_TYPE;

export type CheckpointBasePayload = JsonObject & {
	checkpoint_id: string;
	entity_type: HistoryEntityType;
	entity_id: string;
	parent_checkpoint_id: string | null;
	payload_content_hash: string;
	commit_message: string | null;
	author_name: string;
	created_at: string;
	payload: JsonValue;
};

export function readCheckpointBasePayload(
	record: Record<string, unknown>,
	entityType: HistoryEntityType
): CheckpointBasePayload {
	return {
		checkpoint_id: readString(record, 'checkpoint_id'),
		entity_type: readHistoryEntityType(record, 'entity_type', entityType),
		entity_id: readString(record, 'entity_id'),
		parent_checkpoint_id: readNullableString(record, 'parent_checkpoint_id'),
		payload_content_hash: readString(record, 'payload_content_hash'),
		commit_message: readNullableString(record, 'commit_message'),
		author_name: readString(record, 'author_name'),
		created_at: readString(record, 'created_at'),
		payload: readJsonValue(record, 'payload'),
	};
}

export function readHistoryEntityType<T extends HistoryEntityType>(
	record: Record<string, unknown>,
	key: string,
	expected: T
): T {
	return readLiteral(record, key, expected);
}
