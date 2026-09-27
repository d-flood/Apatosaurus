import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject } from '../envelope';
import { readDraftMetadata, type CanonicalDraftMetadata } from './common';
import { upgradeAlphaWorkingCollation } from './alpha-collation';
import { readCollationPayload, type CollationContent } from './collation';

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
		...readCollationPayload(record, false),
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
