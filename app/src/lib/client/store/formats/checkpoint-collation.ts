import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject, SealedDocument } from '../envelope';
import { invalidShape } from '../quarantine';
import { assertContentHashMatches } from './validation';
import {
	COLLATION_FIXTURE,
	readCollationContent,
	upgradeLegacyCollationContent,
	type CollationContent,
} from './collation';
import {
	COLLATION_HISTORY_ENTITY_TYPE,
	readCheckpointBasePayload,
	readHistoryEntityType,
	type CheckpointBasePayload,
} from './checkpoint-utils';

export const COLLATION_CHECKPOINT_FORMAT = 'apatosaurus.checkpoint.collation';
export const COLLATION_CHECKPOINT_CURRENT_VERSION = 2;
export const collationCheckpointUpgraders: DocumentUpgrader[] = [
	async payload => {
		const record = payload as Record<string, unknown>;
		const base = readCheckpointBasePayload(record, COLLATION_HISTORY_ENTITY_TYPE);
		await assertContentHashMatches(
			base.payload,
			base.payload_content_hash,
			`Checkpoint ${base.checkpoint_id}`
		);
		return {
			...base,
			entity_type: readHistoryEntityType(
				record,
				'entity_type',
				COLLATION_HISTORY_ENTITY_TYPE
			),
			payload: upgradeLegacyCollationContent(base.payload as Record<string, unknown>),
		};
	},
];

export type CollationCheckpointPayload = CheckpointBasePayload & {
	entity_type: 'collation';
	payload: CollationContent;
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
	payload: (() => {
		const {
			current_revision: _,
			created_at: _createdAt,
			updated_at: _updatedAt,
			...content
		} = COLLATION_FIXTURE;
		return content;
	})(),
};

export const COLLATION_CHECKPOINT_OLD_SHAPE_FIXTURE = {
	schema_version: 1,
	...COLLATION_CHECKPOINT_FIXTURE,
	content_hash: COLLATION_CHECKPOINT_FIXTURE.payload_content_hash,
};

export function validateCollationCheckpointPayload(
	payload: JsonObject
): CollationCheckpointPayload {
	const record = payload as Record<string, unknown>;
	const base = readCheckpointBasePayload(record, COLLATION_HISTORY_ENTITY_TYPE);
	return {
		...base,
		entity_type: readHistoryEntityType(record, 'entity_type', COLLATION_HISTORY_ENTITY_TYPE),
		payload: readCollationContent(base.payload as Record<string, unknown>),
	};
}

export async function assertCollationCheckpointPayloadIntegrity(
	payload: CollationCheckpointPayload,
	originalVersion = COLLATION_CHECKPOINT_CURRENT_VERSION
): Promise<void> {
	if (originalVersion >= COLLATION_CHECKPOINT_CURRENT_VERSION) {
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
		upgraders: collationCheckpointUpgraders,
		validate: validateCollationCheckpointPayload,
	};
