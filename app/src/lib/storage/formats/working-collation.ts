import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject } from '../envelope';
import { readDraftMetadata, type CanonicalDraftMetadata } from './common';
import { upgradeAlphaWorkingCollation } from './alpha-collation';
import { readCollationContent, type CollationContent } from './collation';
import { readString } from './validation';

export const WORKING_COLLATION_FORMAT = 'apatosaurus.working.collation';
export const WORKING_COLLATION_CURRENT_VERSION = 4;

const workingCollationUpgraders: DocumentUpgrader[] = [];

export type WorkingCollationPayload = CollationContent &
	JsonObject & {
		created_at: string;
		updated_at: string;
		draft: CanonicalDraftMetadata;
	};

function validateWorkingCollationPayload(payload: JsonObject): WorkingCollationPayload {
	const record = payload as Record<string, unknown>;
	return {
		...readCollationContent(record),
		created_at: readString(record, 'created_at'),
		updated_at: readString(record, 'updated_at'),
		draft: readDraftMetadata(record, 'draft'),
	};
}

export const workingCollationFormatRegistration: FormatRegistration<WorkingCollationPayload> = {
	format: WORKING_COLLATION_FORMAT,
	currentVersion: WORKING_COLLATION_CURRENT_VERSION,
	upgraders: workingCollationUpgraders,
	directUpgraders: { 2: upgradeAlphaWorkingCollation },
	validate: validateWorkingCollationPayload,
};
