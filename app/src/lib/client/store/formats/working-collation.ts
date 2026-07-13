import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject, SealedDocument } from '../envelope';
import { readDraftMetadata, type CanonicalDraftMetadata } from './common';
import {
	COLLATION_FIXTURE,
	readCollationPayload,
	upgradeLegacyCollationContent,
	type CollationContent,
} from './collation';
import { readString } from './validation';

export const WORKING_COLLATION_FORMAT = 'apatosaurus.working.collation';
export const WORKING_COLLATION_CURRENT_VERSION = 2;
export const workingCollationUpgraders: DocumentUpgrader[] = [
	payload => {
		const record = payload as Record<string, unknown>;
		return {
			...upgradeLegacyCollationContent(record),
			created_at: readString(record, 'created_at'),
			updated_at: readString(record, 'updated_at'),
			draft: record.draft as JsonObject,
		};
	},
];

export type WorkingCollationPayload = CollationContent &
	JsonObject & {
		created_at: string;
		updated_at: string;
		draft: CanonicalDraftMetadata;
	};

export type WorkingCollationDocument = SealedDocument<
	WorkingCollationPayload,
	typeof WORKING_COLLATION_FORMAT
>;

const { current_revision: _currentRevision, ...workingCollationBase } = COLLATION_FIXTURE;

export const WORKING_COLLATION_FIXTURE: WorkingCollationPayload = {
	...workingCollationBase,
	draft: {
		base_revision_id: 'col-cp-1',
		base_content_hash: 'sha256:col',
		saved_at: '2026-07-03T00:05:00.000Z',
		author_name: 'Editor',
	},
};

export function validateWorkingCollationPayload(payload: JsonObject): WorkingCollationPayload {
	const record = payload as Record<string, unknown>;
	return {
		...readCollationPayload(record, false),
		draft: readDraftMetadata(record, 'draft'),
	};
}

export const workingCollationFormatRegistration: FormatRegistration<WorkingCollationPayload> = {
	format: WORKING_COLLATION_FORMAT,
	currentVersion: WORKING_COLLATION_CURRENT_VERSION,
	upgraders: workingCollationUpgraders,
	validate: validateWorkingCollationPayload,
};
