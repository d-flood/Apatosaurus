/**
 * Frozen reader for the JSON documents projects held before TEI became canonical. Only the
 * conversion to TEI reads them; nothing writes them except the alpha upgrade that precedes it.
 */
import type { FormatRegistration, MigrationRegistry, ReadDocumentResult } from '../migrate-on-read';
import { createMigrationRegistry } from '../migrate-on-read';
import { sealDocument, serializeSealedDocument, type JsonObject } from '../envelope';
import { classifyDocumentPath, legacyDocumentPaths, legacyVersionPath } from '../document-files';
import { invalidShape, quarantineFromError } from '../quarantine';
import {
	canonicalFormatForProjectPath,
	readCanonicalDocument,
	serializeCanonicalDocument,
	type CanonicalReadContext,
} from '../formats';
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
import {
	WORKING_TRANSCRIPTION_FORMAT,
	workingTranscriptionFormatRegistration,
} from './working-transcription';
import { WORKING_COLLATION_FORMAT, workingCollationFormatRegistration } from './working-collation';

export {
	PROJECT_TRANSCRIPTION_CURRENT_VERSION,
	PROJECT_TRANSCRIPTION_FORMAT,
	mergeWorkingTranscription,
	projectTranscriptionPayloadToSnapshot,
	upgradeLegacyIiifManifestSources,
} from './project-transcription';
export { COLLATION_CURRENT_VERSION, COLLATION_FORMAT, mergeWorkingCollation } from './collation';
export {
	TRANSCRIPTION_CHECKPOINT_CURRENT_VERSION,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	type TranscriptionCheckpointPayload,
} from './checkpoint-transcription';
export {
	COLLATION_CHECKPOINT_CURRENT_VERSION,
	COLLATION_CHECKPOINT_FORMAT,
	type CollationCheckpointPayload,
} from './checkpoint-collation';
export {
	WORKING_TRANSCRIPTION_CURRENT_VERSION,
	WORKING_TRANSCRIPTION_FORMAT,
	type WorkingTranscriptionPayload,
} from './working-transcription';
export {
	WORKING_COLLATION_CURRENT_VERSION,
	WORKING_COLLATION_FORMAT,
	type WorkingCollationPayload,
} from './working-collation';
export { legacyCollationContentHash, legacyTranscriptionContentHash } from './legacy-hash';

const legacyFormatRegistrations: FormatRegistration<JsonObject>[] = [
	projectTranscriptionFormatRegistration as unknown as FormatRegistration<JsonObject>,
	collationFormatRegistration as unknown as FormatRegistration<JsonObject>,
	transcriptionCheckpointFormatRegistration as unknown as FormatRegistration<JsonObject>,
	collationCheckpointFormatRegistration as unknown as FormatRegistration<JsonObject>,
	workingTranscriptionFormatRegistration as unknown as FormatRegistration<JsonObject>,
	workingCollationFormatRegistration as unknown as FormatRegistration<JsonObject>,
];

let legacyRegistry: MigrationRegistry | null = null;

function createLegacyFormatRegistry(): MigrationRegistry {
	const registry = createMigrationRegistry();
	for (const registration of legacyFormatRegistrations)
		registry.registerFormat(
			registration.format,
			registration.currentVersion,
			registration.upgraders,
			registration.validate,
			registration.validateIntegrity,
			registration.directUpgraders
		);
	return registry;
}

const LEGACY_FILE_FORMATS = {
	transcription: {
		primary: PROJECT_TRANSCRIPTION_FORMAT,
		working: WORKING_TRANSCRIPTION_FORMAT,
		version: TRANSCRIPTION_CHECKPOINT_FORMAT,
	},
	collation: {
		primary: COLLATION_FORMAT,
		working: WORKING_COLLATION_FORMAT,
		version: COLLATION_CHECKPOINT_FORMAT,
	},
} as const;

/** The JSON document format of a project file, or the canonical format of any other file. */
export function legacyFormatForProjectPath(path: string): string | null {
	const file = classifyDocumentPath(path);
	if (file?.role !== 'legacy') return canonicalFormatForProjectPath(path);
	const formats = LEGACY_FILE_FORMATS[file.kind];
	if (file.versionId) return formats.version;
	return path === legacyDocumentPaths(file.kind, file.entityId).working
		? formats.working
		: formats.primary;
}

function isLegacyFormat(format: string): boolean {
	return legacyFormatRegistrations.some(registration => registration.format === format);
}

export async function readLegacyDocument<TPayload extends JsonObject = JsonObject>(
	format: string,
	raw: string | unknown,
	context: CanonicalReadContext = {}
): Promise<ReadDocumentResult<TPayload>> {
	if (!isLegacyFormat(format)) return readCanonicalDocument<TPayload>(format, raw, context);
	legacyRegistry ??= createLegacyFormatRegistry();
	const result = await legacyRegistry.readDocument<TPayload>(format, raw);
	if (!result.ok) return result;
	try {
		assertLegacyReadContext(format, result.payload, context);
		return result;
	} catch (error) {
		return { ok: false, quarantine: quarantineFromError(error) };
	}
}

export async function serializeLegacyDocument<TPayload extends JsonObject>(
	format: string,
	payload: TPayload
): Promise<string> {
	const registration = legacyFormatRegistrations.find(candidate => candidate.format === format);
	if (!registration) return serializeCanonicalDocument(format, payload);
	const validated = registration.validate(payload) as TPayload;
	await registration.validateIntegrity?.(validated, registration.currentVersion);
	return serializeSealedDocument(
		await sealDocument(format, registration.currentVersion, validated)
	);
}

function assertLegacyReadContext(
	format: string,
	payload: JsonObject,
	context: CanonicalReadContext
): void {
	const record = payload as Record<string, unknown>;
	if (
		context.projectId &&
		(format === COLLATION_FORMAT || format === WORKING_COLLATION_FORMAT) &&
		record.project_id !== context.projectId
	)
		throw invalidShape(
			'Collation belongs to a different project.',
			context.projectId,
			record.project_id
		);
	if (!context.projectPath) return;
	let expected: string;
	if (format === PROJECT_TRANSCRIPTION_FORMAT)
		expected = legacyDocumentPaths(
			'transcription',
			String(record.project_transcription_id)
		).primary;
	else if (format === WORKING_TRANSCRIPTION_FORMAT)
		expected = legacyDocumentPaths(
			'transcription',
			String(record.project_transcription_id)
		).working;
	else if (format === COLLATION_FORMAT)
		expected = legacyDocumentPaths('collation', String(record.id)).primary;
	else if (format === WORKING_COLLATION_FORMAT)
		expected = legacyDocumentPaths('collation', String(record.id)).working;
	else if (format === TRANSCRIPTION_CHECKPOINT_FORMAT)
		expected = legacyVersionPath(
			'transcription',
			String(record.entity_id),
			String(record.checkpoint_id)
		);
	else
		expected = legacyVersionPath(
			'collation',
			String(record.entity_id),
			String(record.checkpoint_id)
		);
	if (context.projectPath !== expected)
		throw invalidShape(
			`Canonical document path must be ${expected}.`,
			expected,
			context.projectPath
		);
}
