import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject, JsonValue, SealedDocument } from '../envelope';
import { invalidShape } from '../quarantine';
import { assertContentHashMatches } from './validation';
import {
	COLLATION_HISTORY_ENTITY_TYPE,
	readCheckpointBasePayload,
	readHistoryEntityType,
	type CheckpointBasePayload,
} from './checkpoint-utils';

export const COLLATION_CHECKPOINT_FORMAT = 'apatosaurus.checkpoint.collation';
export const COLLATION_CHECKPOINT_CURRENT_VERSION = 1;
export const collationCheckpointUpgraders: DocumentUpgrader[] = [];

export type CollationCheckpointPayload = CheckpointBasePayload & {
	entity_type: 'collation';
	payload: JsonValue;
};

export type CollationCheckpointDocument = SealedDocument<
	CollationCheckpointPayload,
	typeof COLLATION_CHECKPOINT_FORMAT
>;

export const COLLATION_CHECKPOINT_FIXTURE: CollationCheckpointPayload = {
	checkpoint_id: 'col-cp-1',
	entity_type: 'collation',
	entity_id: 'col-1',
	parent_checkpoint_id: null,
	payload_content_hash: 'sha256:payload-placeholder',
	commit_message: 'Initial commit',
	author_name: 'Editor',
	created_at: '2026-07-03T00:00:00.000Z',
	payload: { id: 'col-1', title: 'John 1:1 Collation' },
};

export const COLLATION_CHECKPOINT_OLD_SHAPE_FIXTURE = {
	schema_version: 1,
	...COLLATION_CHECKPOINT_FIXTURE,
	content_hash: COLLATION_CHECKPOINT_FIXTURE.payload_content_hash,
};

export function validateCollationCheckpointPayload(payload: JsonObject): CollationCheckpointPayload {
	const record = payload as Record<string, unknown>;
	return {
		...readCheckpointBasePayload(record, COLLATION_HISTORY_ENTITY_TYPE),
		entity_type: readHistoryEntityType(record, 'entity_type', COLLATION_HISTORY_ENTITY_TYPE),
	};
}

export async function assertCollationCheckpointPayloadIntegrity(
	payload: CollationCheckpointPayload
): Promise<void> {
	await assertContentHashMatches(
		payload.payload,
		payload.payload_content_hash,
		`Checkpoint ${payload.checkpoint_id}`
	);
	const nestedPayload = payload.payload;
	if (!nestedPayload || typeof nestedPayload !== 'object' || Array.isArray(nestedPayload)) {
		throw invalidShape('Collation checkpoint payload must be an object.');
	}
	if ((nestedPayload as Record<string, unknown>).id !== payload.entity_id) {
		throw invalidShape('Collation checkpoint payload id does not match entity_id.');
	}
}

export const collationCheckpointFormatRegistration: FormatRegistration<CollationCheckpointPayload> = {
	format: COLLATION_CHECKPOINT_FORMAT,
	currentVersion: COLLATION_CHECKPOINT_CURRENT_VERSION,
	upgraders: collationCheckpointUpgraders,
	validate: validateCollationCheckpointPayload,
};
