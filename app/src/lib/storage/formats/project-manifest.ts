import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject, JsonValue } from '../envelope';
import { invalidShape } from '../quarantine';
import {
	collationPrimaryRelativeFile,
	tombstoneRelativeFile,
	transcriptionPrimaryRelativeFile,
} from '../layout';
import {
	assertContentHashMatches,
	readArray,
	readJsonValue,
	readObjectValue,
	readString,
} from './validation';

export const PROJECT_MANIFEST_FORMAT = 'apatosaurus.project-manifest';
export const PROJECT_MANIFEST_CURRENT_VERSION = 2;
const projectManifestUpgraders: DocumentUpgrader[] = [upgradeProjectManifestV1];

export type ProjectManifestForkProvenance = JsonObject & {
	source_project_id: string;
	source_manifest_content_hash: string;
	source_manifest_schema_version: number;
};

export type ProjectManifestRevisionHead = JsonObject & {
	id: string;
	content_hash: string;
};

export type ProjectManifestTranscriptionHead = JsonObject & {
	project_transcription_id: string;
	transcription_id: string;
	current_revision: ProjectManifestRevisionHead | null;
	title: string;
	siglum: string;
	primary_path: string;
};

export type ProjectManifestCollationHead = JsonObject & {
	collation_id: string;
	current_revision: ProjectManifestRevisionHead | null;
	title: string;
	verse_identifier: string;
	primary_path: string;
};

export type ProjectManifestTombstoneHead = JsonObject & {
	tombstone_id: string;
	entity_type: string;
	entity_id: string;
	deletion_revision_id: string;
	content_hash: string;
	primary_path: string;
	deleted_at: string;
};

export type ProjectManifestPayload = JsonObject & {
	id: string;
	name: string;
	description: string;
	charter: string;
	collation_settings: JsonValue;
	forked_from: ProjectManifestForkProvenance | null;
	manifest_content_hash: string;
	transcriptions: ProjectManifestTranscriptionHead[];
	collations: ProjectManifestCollationHead[];
	tombstones: ProjectManifestTombstoneHead[];
	created_at: string;
	updated_at: string;
};

function validateProjectManifestPayload(payload: JsonObject): ProjectManifestPayload {
	const record = payload as Record<string, unknown>;
	return {
		id: readString(record, 'id'),
		name: readString(record, 'name'),
		description: readString(record, 'description'),
		charter: readString(record, 'charter'),
		collation_settings: readJsonValue(record, 'collation_settings'),
		forked_from: readProjectManifestForkProvenance(record, 'forked_from'),
		manifest_content_hash: readString(record, 'manifest_content_hash'),
		transcriptions: readProjectManifestTranscriptionHeads(record, 'transcriptions'),
		collations: readProjectManifestCollationHeads(record, 'collations'),
		tombstones: readProjectManifestTombstoneHeads(record, 'tombstones'),
		created_at: readString(record, 'created_at'),
		updated_at: readString(record, 'updated_at'),
	};
}

function upgradeProjectManifestV1(payload: JsonObject): JsonObject {
	return { ...payload, forked_from: null };
}

function readProjectManifestForkProvenance(
	record: Record<string, unknown>,
	key: string
): ProjectManifestForkProvenance | null {
	const value = record[key];
	if (value === null) return null;
	const provenance = readObjectValue(value, key);
	const schemaVersion = provenance.source_manifest_schema_version;
	if (!Number.isInteger(schemaVersion) || Number(schemaVersion) < 1) {
		throw invalidShape(`${key}.source_manifest_schema_version must be a positive integer.`);
	}
	return {
		source_project_id: readString(provenance, 'source_project_id'),
		source_manifest_content_hash: readString(provenance, 'source_manifest_content_hash'),
		source_manifest_schema_version: Number(schemaVersion),
	};
}

export const projectManifestFormatRegistration: FormatRegistration<ProjectManifestPayload> = {
	format: PROJECT_MANIFEST_FORMAT,
	currentVersion: PROJECT_MANIFEST_CURRENT_VERSION,
	upgraders: projectManifestUpgraders,
	validate: validateProjectManifestPayload,
	validateIntegrity: assertProjectManifestIntegrity,
};

async function assertProjectManifestIntegrity(payload: ProjectManifestPayload): Promise<void> {
	for (const head of payload.transcriptions) {
		assertCanonicalPath(
			head.primary_path,
			transcriptionPrimaryRelativeFile(head.project_transcription_id),
			`Transcription ${head.project_transcription_id}`
		);
	}
	for (const head of payload.collations) {
		assertCanonicalPath(
			head.primary_path,
			collationPrimaryRelativeFile(head.collation_id),
			`Collation ${head.collation_id}`
		);
	}
	for (const head of payload.tombstones) {
		assertCanonicalPath(
			head.primary_path,
			tombstoneRelativeFile(head.entity_type, head.entity_id),
			`Tombstone ${head.tombstone_id}`
		);
	}
	await assertContentHashMatches(
		{
			project_id: payload.id,
			transcriptions: payload.transcriptions,
			collations: payload.collations,
			tombstones: payload.tombstones,
		},
		payload.manifest_content_hash,
		`Project manifest ${payload.id}`
	);
}

function assertCanonicalPath(actual: string, expected: string, label: string): void {
	if (actual !== expected) {
		throw invalidShape(`${label} primary_path must be ${expected}.`, expected, actual);
	}
}

function readProjectManifestRevisionHead(
	record: Record<string, unknown>,
	key: string
): ProjectManifestRevisionHead | null {
	const value = record[key];
	if (value === null) return null;
	const revision = readObjectValue(value, key);
	return {
		id: readString(revision, 'id'),
		content_hash: readString(revision, 'content_hash'),
	};
}

function readProjectManifestTranscriptionHeads(
	record: Record<string, unknown>,
	key: string
): ProjectManifestTranscriptionHead[] {
	return readArray(record, key).map((entry, index) => {
		const row = readObjectValue(entry, `${key}[${index}]`);
		return {
			project_transcription_id: readString(row, 'project_transcription_id'),
			transcription_id: readString(row, 'transcription_id'),
			current_revision: readProjectManifestRevisionHead(row, 'current_revision'),
			title: readString(row, 'title'),
			siglum: readString(row, 'siglum'),
			primary_path: readString(row, 'primary_path'),
		};
	});
}

function readProjectManifestCollationHeads(
	record: Record<string, unknown>,
	key: string
): ProjectManifestCollationHead[] {
	return readArray(record, key).map((entry, index) => {
		const row = readObjectValue(entry, `${key}[${index}]`);
		return {
			collation_id: readString(row, 'collation_id'),
			current_revision: readProjectManifestRevisionHead(row, 'current_revision'),
			title: readString(row, 'title'),
			verse_identifier: readString(row, 'verse_identifier'),
			primary_path: readString(row, 'primary_path'),
		};
	});
}

function readProjectManifestTombstoneHeads(
	record: Record<string, unknown>,
	key: string
): ProjectManifestTombstoneHead[] {
	return readArray(record, key).map((entry, index) => {
		const row = readObjectValue(entry, `${key}[${index}]`);
		return {
			tombstone_id: readString(row, 'tombstone_id'),
			entity_type: readString(row, 'entity_type'),
			entity_id: readString(row, 'entity_id'),
			deletion_revision_id: readString(row, 'deletion_revision_id'),
			content_hash: readString(row, 'content_hash'),
			primary_path: readString(row, 'primary_path'),
			deleted_at: readString(row, 'deleted_at'),
		};
	});
}
