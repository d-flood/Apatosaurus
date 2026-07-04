import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject, SealedDocument } from '../envelope';
import { readDraftMetadata, type CanonicalDraftMetadata } from './common';
import {
	PROJECT_TRANSCRIPTION_FIXTURE,
	readProjectTranscriptionPayload,
	type ProjectTranscriptionPayload,
} from './project-transcription';

export const WORKING_TRANSCRIPTION_FORMAT = 'apatosaurus.working.transcription';
export const WORKING_TRANSCRIPTION_CURRENT_VERSION = 1;
export const workingTranscriptionUpgraders: DocumentUpgrader[] = [];

export type WorkingTranscriptionPayload = Omit<ProjectTranscriptionPayload, 'current_revision'> &
	JsonObject & {
		draft: CanonicalDraftMetadata;
	};

export type WorkingTranscriptionDocument = SealedDocument<
	WorkingTranscriptionPayload,
	typeof WORKING_TRANSCRIPTION_FORMAT
>;

const { current_revision: _currentRevision, ...workingTranscriptionBase } = PROJECT_TRANSCRIPTION_FIXTURE;

export const WORKING_TRANSCRIPTION_FIXTURE: WorkingTranscriptionPayload = {
	...workingTranscriptionBase,
	draft: {
		base_revision_id: 'tx-cp-1',
		base_content_hash: 'sha256:tx',
		saved_at: '2026-07-03T00:05:00.000Z',
		author_name: 'Editor',
	},
};

export function validateWorkingTranscriptionPayload(payload: JsonObject): WorkingTranscriptionPayload {
	const record = payload as Record<string, unknown>;
	return {
		...readProjectTranscriptionPayload(record, false),
		draft: readDraftMetadata(record, 'draft'),
	};
}

export const workingTranscriptionFormatRegistration: FormatRegistration<WorkingTranscriptionPayload> =
	{
		format: WORKING_TRANSCRIPTION_FORMAT,
		currentVersion: WORKING_TRANSCRIPTION_CURRENT_VERSION,
		upgraders: workingTranscriptionUpgraders,
		validate: validateWorkingTranscriptionPayload,
	};
