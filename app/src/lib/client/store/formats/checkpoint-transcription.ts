import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject, JsonValue, SealedDocument } from '../envelope';
import { invalidShape } from '../quarantine';
import { assertContentHashMatches, readString } from './validation';
import {
	readCheckpointBasePayload,
	readHistoryEntityType,
	type CheckpointBasePayload,
	TRANSCRIPTION_HISTORY_ENTITY_TYPE,
} from './checkpoint-utils';

export const TRANSCRIPTION_CHECKPOINT_FORMAT = 'apatosaurus.checkpoint.transcription';
export const TRANSCRIPTION_CHECKPOINT_CURRENT_VERSION = 1;
export const transcriptionCheckpointUpgraders: DocumentUpgrader[] = [];

export type TranscriptionCheckpointPayload = CheckpointBasePayload & {
	entity_type: 'project-transcription';
	payload_transcription_id: string;
	content_format: string;
	payload: JsonValue;
};

export type TranscriptionCheckpointDocument = SealedDocument<
	TranscriptionCheckpointPayload,
	typeof TRANSCRIPTION_CHECKPOINT_FORMAT
>;

export const TRANSCRIPTION_CHECKPOINT_FIXTURE: TranscriptionCheckpointPayload = {
	checkpoint_id: 'tx-cp-1',
	entity_type: 'project-transcription',
	entity_id: 'pt-1',
	payload_transcription_id: 'tx-1',
	parent_checkpoint_id: null,
	payload_content_hash: 'sha256:payload-placeholder',
	content_format: 'normalized_ast_v3',
	commit_message: 'Initial commit',
	author_name: 'Editor',
	created_at: '2026-07-03T00:00:00.000Z',
	payload: {
		project_transcription_id: 'pt-1',
		id: 'tx-1',
		format: 'normalized_ast_v3',
		title: 'Witness A',
		siglum: 'A',
		description: '',
		content_json: { type: 'transcriptionDocument', pages: [] },
		owner: null,
		is_public: false,
		tags: [],
		transcriber: 'Editor',
		repository: 'Repository',
		settlement: 'City',
		language: 'grc',
		iiif_manifest_sources: [],
		page_canvas_links: [],
		canvas_annotations: [],
	},
};

export const TRANSCRIPTION_CHECKPOINT_OLD_SHAPE_FIXTURE = {
	schema_version: 1,
	...TRANSCRIPTION_CHECKPOINT_FIXTURE,
	content_hash: TRANSCRIPTION_CHECKPOINT_FIXTURE.payload_content_hash,
	format: TRANSCRIPTION_CHECKPOINT_FIXTURE.content_format,
};

export function validateTranscriptionCheckpointPayload(
	payload: JsonObject
): TranscriptionCheckpointPayload {
	const record = payload as Record<string, unknown>;
	const base = readCheckpointBasePayload(record, TRANSCRIPTION_HISTORY_ENTITY_TYPE);
	return {
		...base,
		entity_type: readHistoryEntityType(record, 'entity_type', TRANSCRIPTION_HISTORY_ENTITY_TYPE),
		payload_transcription_id: readString(record, 'payload_transcription_id'),
		content_format: readString(record, 'content_format'),
	};
}

export async function assertTranscriptionCheckpointPayloadIntegrity(
	payload: TranscriptionCheckpointPayload
): Promise<void> {
	await assertContentHashMatches(
		payload.payload,
		payload.payload_content_hash,
		`Checkpoint ${payload.checkpoint_id}`
	);
	const nestedPayload = payload.payload;
	if (!nestedPayload || typeof nestedPayload !== 'object' || Array.isArray(nestedPayload)) {
		throw invalidShape('Transcription checkpoint payload must be an object.');
	}
	const record = nestedPayload as Record<string, unknown>;
	if (record.project_transcription_id !== payload.entity_id) {
		throw invalidShape(
			'Transcription checkpoint payload project_transcription_id does not match entity_id.'
		);
	}
	if (record.id !== payload.payload_transcription_id) {
		throw invalidShape(
			'Transcription checkpoint payload id does not match payload_transcription_id.'
		);
	}
}

export const transcriptionCheckpointFormatRegistration: FormatRegistration<TranscriptionCheckpointPayload> =
	{
		format: TRANSCRIPTION_CHECKPOINT_FORMAT,
		currentVersion: TRANSCRIPTION_CHECKPOINT_CURRENT_VERSION,
		upgraders: transcriptionCheckpointUpgraders,
		validate: validateTranscriptionCheckpointPayload,
	};
