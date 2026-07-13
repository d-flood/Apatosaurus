import type { FormatRegistration, MigrationRegistry, ReadDocumentResult } from '../migrate-on-read';
import { createMigrationRegistry } from '../migrate-on-read';
import {
	sealDocument,
	serializeSealedDocument,
	type JsonObject,
	type SealedDocument,
} from '../envelope';
import {
	collationCheckpointRelativeFile,
	collationPrimaryRelativeFile,
	collationWorkingRelativeFile,
	projectManifestRelativeFile,
	tombstoneRelativeFile,
	transcriptionCheckpointRelativeFile,
	transcriptionPrimaryRelativeFile,
	transcriptionWorkingRelativeFile,
} from '../layout';
import { invalidShape, quarantineFromError } from '../quarantine';
import { PROJECT_MANIFEST_FORMAT, projectManifestFormatRegistration } from './project-manifest';
import {
	PROJECT_TRANSCRIPTION_FORMAT,
	projectTranscriptionFormatRegistration,
} from './project-transcription';
import { COLLATION_FORMAT, collationFormatRegistration } from './collation';
import {
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	transcriptionCheckpointFormatRegistration,
} from './checkpoint-transcription';
import {
	COLLATION_CHECKPOINT_FORMAT,
	collationCheckpointFormatRegistration,
} from './checkpoint-collation';
import { TOMBSTONE_FORMAT, tombstoneFormatRegistration } from './tombstone';
import {
	WORKING_TRANSCRIPTION_FORMAT,
	workingTranscriptionFormatRegistration,
} from './working-transcription';
import {
	WORKING_COLLATION_FORMAT,
	workingCollationFormatRegistration,
} from './working-collation';

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
	collationPayloadToContent,
	type CollationContent,
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
	projectManifestFormatRegistration as unknown as FormatRegistration<JsonObject>,
	projectTranscriptionFormatRegistration as unknown as FormatRegistration<JsonObject>,
	collationFormatRegistration as unknown as FormatRegistration<JsonObject>,
	transcriptionCheckpointFormatRegistration as unknown as FormatRegistration<JsonObject>,
	collationCheckpointFormatRegistration as unknown as FormatRegistration<JsonObject>,
	tombstoneFormatRegistration as unknown as FormatRegistration<JsonObject>,
	workingTranscriptionFormatRegistration as unknown as FormatRegistration<JsonObject>,
	workingCollationFormatRegistration as unknown as FormatRegistration<JsonObject>,
];

let canonicalRegistry: MigrationRegistry | null = null;

export function registerCanonicalFormats(registry: MigrationRegistry): void {
	for (const registration of canonicalFormatRegistrations) {
		registry.registerFormat(
			registration.format,
			registration.currentVersion,
			registration.upgraders,
			registration.validate,
			registration.validateIntegrity
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
	raw: string | unknown,
	context: CanonicalReadContext = {}
): Promise<ReadDocumentResult<TPayload>> {
	canonicalRegistry ??= createCanonicalFormatRegistry();
	return canonicalRegistry.readDocument<TPayload>(format, raw).then(result => {
		if (!result.ok) return result;
		try {
			assertCanonicalReadContext(format, result.payload, context);
			return result;
		} catch (error) {
			return { ok: false, quarantine: quarantineFromError(error) };
		}
	});
}

export interface CanonicalReadContext {
	projectPath?: string;
	projectId?: string;
}

export function canonicalFormatForProjectPath(path: string): string | null {
	if (path === projectManifestRelativeFile()) return PROJECT_MANIFEST_FORMAT;
	if (/^transcriptions\/[^/]+\.working\.json$/.test(path)) return WORKING_TRANSCRIPTION_FORMAT;
	if (/^transcriptions\/[^/]+\.json$/.test(path)) return PROJECT_TRANSCRIPTION_FORMAT;
	if (/^collations\/[^/]+\.working\.json$/.test(path)) return WORKING_COLLATION_FORMAT;
	if (/^collations\/[^/]+\.json$/.test(path)) return COLLATION_FORMAT;
	if (/^history\/transcriptions\/[^/]+\/[^/]+\.json$/.test(path)) {
		return TRANSCRIPTION_CHECKPOINT_FORMAT;
	}
	if (/^history\/collations\/[^/]+\/[^/]+\.json$/.test(path)) {
		return COLLATION_CHECKPOINT_FORMAT;
	}
	if (/^tombstones\/[^/]+--[^/]+\.json$/.test(path)) return TOMBSTONE_FORMAT;
	return null;
}

function assertCanonicalReadContext(
	format: string,
	payload: JsonObject,
	context: CanonicalReadContext
): void {
	const record = payload as Record<string, unknown>;
	if (context.projectId && format === PROJECT_MANIFEST_FORMAT && record.id !== context.projectId) {
		throw invalidShape('Project manifest belongs to a different project.', context.projectId, record.id);
	}
	if (
		context.projectId &&
		(format === COLLATION_FORMAT || format === WORKING_COLLATION_FORMAT) &&
		record.project_id !== context.projectId
	) {
		throw invalidShape('Collation belongs to a different project.', context.projectId, record.project_id);
	}
	if (!context.projectPath) return;
	let expected: string;
	if (format === PROJECT_MANIFEST_FORMAT) expected = projectManifestRelativeFile();
	else if (format === PROJECT_TRANSCRIPTION_FORMAT) {
		expected = transcriptionPrimaryRelativeFile(String(record.project_transcription_id));
	} else if (format === WORKING_TRANSCRIPTION_FORMAT) {
		expected = transcriptionWorkingRelativeFile(String(record.project_transcription_id));
	} else if (format === COLLATION_FORMAT) {
		expected = collationPrimaryRelativeFile(String(record.id));
	} else if (format === WORKING_COLLATION_FORMAT) {
		expected = collationWorkingRelativeFile(String(record.id));
	} else if (format === TRANSCRIPTION_CHECKPOINT_FORMAT) {
		expected = transcriptionCheckpointRelativeFile(
			String(record.entity_id),
			String(record.checkpoint_id)
		);
	} else if (format === COLLATION_CHECKPOINT_FORMAT) {
		expected = collationCheckpointRelativeFile(String(record.entity_id), String(record.checkpoint_id));
	} else if (format === TOMBSTONE_FORMAT) {
		expected = tombstoneRelativeFile(String(record.entity_type), String(record.entity_id));
	} else return;
	if (context.projectPath !== expected) {
		throw invalidShape(`Canonical document path must be ${expected}.`, expected, context.projectPath);
	}
}

export async function sealCanonicalDocument<TPayload extends JsonObject>(
	format: string,
	payload: TPayload
): Promise<SealedDocument<TPayload>> {
	const registration = canonicalFormatRegistrations.find(candidate => candidate.format === format);
	if (!registration) throw new Error(`Format ${format} is not registered.`);
	const validated = registration.validate(payload) as TPayload;
	await registration.validateIntegrity?.(validated, registration.currentVersion);
	return sealDocument(format, registration.currentVersion, validated);
}

export async function serializeCanonicalDocument<TPayload extends JsonObject>(
	format: string,
	payload: TPayload
): Promise<string> {
	return serializeSealedDocument(await sealCanonicalDocument(format, payload));
}
