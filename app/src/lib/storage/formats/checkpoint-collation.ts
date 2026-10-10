import type { FormatRegistration } from '../migrate-on-read';
import type { JsonObject } from '../envelope';
import { invalidShape } from '../quarantine';
import { upgradeAlphaCollationCheckpoint } from './alpha-collation';
import { assertContentHashMatches } from './validation';
import { readCollationContent, type CollationContent } from './collation';
import {
	addVersionMetadata,
	COLLATION_HISTORY_ENTITY_TYPE,
	readCheckpointBasePayload,
	readHistoryEntityType,
	type CheckpointBasePayload,
} from './checkpoint-utils';

export const COLLATION_CHECKPOINT_FORMAT = 'apatosaurus.checkpoint.collation';
export const COLLATION_CHECKPOINT_CURRENT_VERSION = 5;
const FIRST_HASH_STABLE_VERSION = 4;

export type CollationCheckpointPayload = CheckpointBasePayload & {
	entity_type: 'collation';
	payload: CollationContent;
};

function validateCollationCheckpointPayload(payload: JsonObject): CollationCheckpointPayload {
	const record = payload as Record<string, unknown>;
	const base = readCheckpointBasePayload(record, COLLATION_HISTORY_ENTITY_TYPE);
	return {
		...base,
		entity_type: readHistoryEntityType(record, 'entity_type', COLLATION_HISTORY_ENTITY_TYPE),
		payload: readCollationContent(base.payload as Record<string, unknown>),
	};
}

async function assertCollationCheckpointPayloadIntegrity(
	payload: CollationCheckpointPayload,
	originalVersion = COLLATION_CHECKPOINT_CURRENT_VERSION
): Promise<void> {
	if (originalVersion >= FIRST_HASH_STABLE_VERSION) {
		await assertContentHashMatches(
			payload.payload,
			payload.payload_content_hash,
			`Checkpoint ${payload.checkpoint_id}`
		);
	}
	const nestedPayload = payload.payload;
	if (!nestedPayload || typeof nestedPayload !== 'object' || Array.isArray(nestedPayload)) {
		throw invalidShape('Collation checkpoint payload must be an object.');
	}
	if ((nestedPayload as Record<string, unknown>).id !== payload.entity_id) {
		throw invalidShape('Collation checkpoint payload id does not match entity_id.');
	}
}

export const collationCheckpointFormatRegistration: FormatRegistration<CollationCheckpointPayload> =
	{
		format: COLLATION_CHECKPOINT_FORMAT,
		currentVersion: COLLATION_CHECKPOINT_CURRENT_VERSION,
		upgraders: [],
		directUpgraders: {
			2: async payload => addVersionMetadata(await upgradeAlphaCollationCheckpoint(payload)),
			4: addVersionMetadata,
		},
		validate: validateCollationCheckpointPayload,
		validateIntegrity: assertCollationCheckpointPayloadIntegrity,
	};
