import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject } from '../envelope';
import { readDraftMetadata, type CanonicalDraftMetadata } from './common';
import {
	readProjectTranscriptionContent,
	type ProjectTranscriptionContentPayload,
} from './project-transcription';

export const WORKING_TRANSCRIPTION_FORMAT = 'apatosaurus.working.transcription';
export const WORKING_TRANSCRIPTION_CURRENT_VERSION = 1;
const workingTranscriptionUpgraders: DocumentUpgrader[] = [];

export type WorkingTranscriptionPayload = ProjectTranscriptionContentPayload & {
	draft: CanonicalDraftMetadata;
};

function validateWorkingTranscriptionPayload(payload: JsonObject): WorkingTranscriptionPayload {
	const record = payload as Record<string, unknown>;
	return {
		...readProjectTranscriptionContent(record),
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
