import type { FormatRegistration, MigrationRegistry, ReadDocumentResult } from '../migrate-on-read';
import { createMigrationRegistry } from '../migrate-on-read';
import {
	sealDocument,
	serializeSealedDocument,
	type JsonObject,
	type SealedDocument,
} from '../envelope';
import {
	cbgmAnalysisRelativeFiles,
	projectManifestRelativeFile,
	tombstoneRelativeFile,
} from '../layout';
import { invalidShape, quarantineFromError } from '../quarantine';
import {
	PROJECT_MANIFEST_FORMAT,
	projectManifestFormatRegistration,
	projectManifestSchemaVersion,
	type ProjectManifestPayload,
} from './project-manifest';
import { TOMBSTONE_FORMAT, tombstoneFormatRegistration } from './tombstone';
import { CBGM_ANALYSIS_FORMAT, cbgmAnalysisFormatRegistration } from './cbgm-analysis';

export {
	PROJECT_MANIFEST_CURRENT_VERSION,
	PROJECT_MANIFEST_FORMAT,
	projectManifestSchemaVersion,
	type ProjectManifestForkProvenance,
	type ProjectManifestPayload,
	type ProjectManifestCollationHead,
	type ProjectManifestRevisionHead,
	type ProjectManifestTombstoneHead,
	type ProjectManifestTranscriptionHead,
} from './project-manifest';
export type { ProjectTranscriptionPayload } from './project-transcription';
export {
	collationPayloadToContent,
	parseCollationPayloadTei,
	parseCollationTeiVersion,
	parseCollationTeiVersionHeader,
	serializeCollationPayloadTei,
	type CollationContent,
	type CollationPayload,
	type CollationTeiVersion,
} from './collation';
export {
	TOMBSTONE_CURRENT_VERSION,
	TOMBSTONE_FORMAT,
	tombstonedProjectPaths,
	type TombstonePayload,
} from './tombstone';
export {
	CBGM_ANALYSIS_CURRENT_VERSION,
	CBGM_ANALYSIS_ENTITY_TYPE,
	CBGM_ANALYSIS_FORMAT,
	type CbgmAnalysisCollation,
	type CbgmAnalysisMetadata,
	type CbgmAnalysisSettings,
	type CbgmCoherenceState,
	type CbgmComputingDevice,
	type CbgmGlobalStemmaState,
	type CbgmUndecidedReading,
} from './cbgm-analysis';
export {
	parseTranscriptionTei,
	parseTranscriptionTeiVersion,
	rewriteTranscriptionTeiVersion,
	serializeTranscriptionTei,
	serializeTranscriptionTeiWithRecord,
	splitTranscriptionTeiIiif,
	type SerializedTranscriptionTei,
	type TranscriptionTeiRecord,
	type TranscriptionTeiVersion,
} from './transcription-tei';

export const canonicalFormatRegistrations: FormatRegistration<JsonObject>[] = [
	projectManifestFormatRegistration as unknown as FormatRegistration<JsonObject>,
	tombstoneFormatRegistration as unknown as FormatRegistration<JsonObject>,
	cbgmAnalysisFormatRegistration as unknown as FormatRegistration<JsonObject>,
];

let canonicalRegistry: MigrationRegistry | null = null;

function registerCanonicalFormats(registry: MigrationRegistry): void {
	for (const registration of canonicalFormatRegistrations) {
		registry.registerFormat(
			registration.format,
			registration.currentVersion,
			registration.upgraders,
			registration.validate,
			registration.validateIntegrity,
			registration.directUpgraders
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
	if (/^tombstones\/[^/]+--[^/]+\.json$/.test(path)) return TOMBSTONE_FORMAT;
	if (/^cbgm\/[^/]+\.json$/.test(path)) return CBGM_ANALYSIS_FORMAT;
	return null;
}

function assertCanonicalReadContext(
	format: string,
	payload: JsonObject,
	context: CanonicalReadContext
): void {
	const record = payload as Record<string, unknown>;
	if (
		context.projectId &&
		format === PROJECT_MANIFEST_FORMAT &&
		record.id !== context.projectId
	) {
		throw invalidShape(
			'Project manifest belongs to a different project.',
			context.projectId,
			record.id
		);
	}
	if (
		context.projectId &&
		format === CBGM_ANALYSIS_FORMAT &&
		record.project_id !== context.projectId
	) {
		throw invalidShape(
			'CBGM analysis belongs to a different project.',
			context.projectId,
			record.project_id
		);
	}
	if (!context.projectPath) return;
	let expected: string;
	if (format === PROJECT_MANIFEST_FORMAT) expected = projectManifestRelativeFile();
	else if (format === TOMBSTONE_FORMAT) {
		expected = tombstoneRelativeFile(String(record.entity_type), String(record.entity_id));
	} else if (format === CBGM_ANALYSIS_FORMAT) {
		expected = cbgmAnalysisRelativeFiles(String(record.id)).metadata;
	} else return;
	if (context.projectPath !== expected) {
		throw invalidShape(
			`Canonical document path must be ${expected}.`,
			expected,
			context.projectPath
		);
	}
}

async function sealCanonicalDocument<TPayload extends JsonObject>(
	format: string,
	payload: TPayload
): Promise<SealedDocument<TPayload>> {
	const registration = canonicalFormatRegistrations.find(
		candidate => candidate.format === format
	);
	if (!registration) throw new Error(`Format ${format} is not registered.`);
	const validated = registration.validate(payload) as TPayload;
	const schemaVersion =
		format === PROJECT_MANIFEST_FORMAT
			? projectManifestSchemaVersion(validated as unknown as ProjectManifestPayload)
			: registration.currentVersion;
	await registration.validateIntegrity?.(validated, schemaVersion);
	return sealDocument(format, schemaVersion, validated);
}

export async function serializeCanonicalDocument<TPayload extends JsonObject>(
	format: string,
	payload: TPayload
): Promise<string> {
	return serializeSealedDocument(await sealCanonicalDocument(format, payload));
}
