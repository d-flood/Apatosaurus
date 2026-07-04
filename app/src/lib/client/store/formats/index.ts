import type { FormatRegistration, MigrationRegistry, ReadDocumentResult } from '../migrate-on-read';
import { createMigrationRegistry } from '../migrate-on-read';
import type { JsonObject } from '../envelope';
import { projectManifestFormatRegistration } from './project-manifest';
import { projectTranscriptionFormatRegistration } from './project-transcription';
import { collationFormatRegistration } from './collation';
import { transcriptionCheckpointFormatRegistration } from './checkpoint-transcription';
import { collationCheckpointFormatRegistration } from './checkpoint-collation';
import { tombstoneFormatRegistration } from './tombstone';
import { workingTranscriptionFormatRegistration } from './working-transcription';
import { workingCollationFormatRegistration } from './working-collation';

export {
	PROJECT_MANIFEST_CURRENT_VERSION,
	PROJECT_MANIFEST_FIXTURE,
	PROJECT_MANIFEST_FORMAT,
	projectManifestFormatRegistration,
	type ProjectManifestDocument,
	type ProjectManifestPayload,
	type ProjectManifestCollationHead,
	type ProjectManifestRevisionHead,
	type ProjectManifestTombstoneHead,
	type ProjectManifestTranscriptionHead,
} from './project-manifest';
export {
	PROJECT_TRANSCRIPTION_CURRENT_VERSION,
	PROJECT_TRANSCRIPTION_FIXTURE,
	PROJECT_TRANSCRIPTION_FORMAT,
	PROJECT_TRANSCRIPTION_OLD_SHAPE_FIXTURE,
	assertProjectTranscriptionRevisionHash,
	projectTranscriptionFormatRegistration,
	projectTranscriptionPayloadToSnapshot,
	type ProjectTranscriptionDocument,
	type ProjectTranscriptionOrigin,
	type ProjectTranscriptionPayload,
} from './project-transcription';
export {
	COLLATION_CURRENT_VERSION,
	COLLATION_FIXTURE,
	COLLATION_FORMAT,
	assertCollationRevisionHash,
	collationFormatRegistration,
	collationPayloadToSerializedCollation,
	type CollationDocument,
	type CollationPayload,
} from './collation';
export {
	TRANSCRIPTION_CHECKPOINT_CURRENT_VERSION,
	TRANSCRIPTION_CHECKPOINT_FIXTURE,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	TRANSCRIPTION_CHECKPOINT_OLD_SHAPE_FIXTURE,
	assertTranscriptionCheckpointPayloadIntegrity,
	transcriptionCheckpointFormatRegistration,
	type TranscriptionCheckpointDocument,
	type TranscriptionCheckpointPayload,
} from './checkpoint-transcription';
export {
	COLLATION_CHECKPOINT_CURRENT_VERSION,
	COLLATION_CHECKPOINT_FIXTURE,
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_CHECKPOINT_OLD_SHAPE_FIXTURE,
	assertCollationCheckpointPayloadIntegrity,
	collationCheckpointFormatRegistration,
	type CollationCheckpointDocument,
	type CollationCheckpointPayload,
} from './checkpoint-collation';
export {
	TOMBSTONE_CURRENT_VERSION,
	TOMBSTONE_FIXTURE,
	TOMBSTONE_FORMAT,
	tombstoneFormatRegistration,
	type TombstoneDocument,
	type TombstonePayload,
} from './tombstone';
export {
	WORKING_TRANSCRIPTION_CURRENT_VERSION,
	WORKING_TRANSCRIPTION_FIXTURE,
	WORKING_TRANSCRIPTION_FORMAT,
	workingTranscriptionFormatRegistration,
	type WorkingTranscriptionDocument,
	type WorkingTranscriptionPayload,
} from './working-transcription';
export {
	WORKING_COLLATION_CURRENT_VERSION,
	WORKING_COLLATION_FIXTURE,
	WORKING_COLLATION_FORMAT,
	workingCollationFormatRegistration,
	type WorkingCollationDocument,
	type WorkingCollationPayload,
} from './working-collation';
export { transcriptionDocumentToTei, collationDocumentToTei } from './tei';

export const canonicalFormatRegistrations: FormatRegistration<JsonObject>[] = [
	projectManifestFormatRegistration as FormatRegistration<JsonObject>,
	projectTranscriptionFormatRegistration as FormatRegistration<JsonObject>,
	collationFormatRegistration as FormatRegistration<JsonObject>,
	transcriptionCheckpointFormatRegistration as FormatRegistration<JsonObject>,
	collationCheckpointFormatRegistration as FormatRegistration<JsonObject>,
	tombstoneFormatRegistration as FormatRegistration<JsonObject>,
	workingTranscriptionFormatRegistration as FormatRegistration<JsonObject>,
	workingCollationFormatRegistration as FormatRegistration<JsonObject>,
];

let canonicalRegistry: MigrationRegistry | null = null;

export function registerCanonicalFormats(registry: MigrationRegistry): void {
	for (const registration of canonicalFormatRegistrations) {
		registry.registerFormat(
			registration.format,
			registration.currentVersion,
			registration.upgraders,
			registration.validate
		);
	}
}

export function createCanonicalFormatRegistry(): MigrationRegistry {
	const registry = createMigrationRegistry();
	registerCanonicalFormats(registry);
	return registry;
}

export function readCanonicalDocument<TPayload extends JsonObject = JsonObject>(
	format: string,
	raw: string | unknown
): Promise<ReadDocumentResult<TPayload>> {
	canonicalRegistry ??= createCanonicalFormatRegistry();
	return canonicalRegistry.readDocument<TPayload>(format, raw);
}
