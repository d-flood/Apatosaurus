import type { DocumentUpgrader, FormatRegistration } from '../migrate-on-read';
import type { JsonObject, JsonValue, SealedDocument } from '../envelope';
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
	readNullableString,
	readObjectValue,
	readString,
} from './validation';

export const PROJECT_MANIFEST_FORMAT = 'apatosaurus.project-manifest';
export const PROJECT_MANIFEST_CURRENT_VERSION = 1;
export const projectManifestUpgraders: DocumentUpgrader[] = [];

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
	manifest_content_hash: string;
	transcriptions: ProjectManifestTranscriptionHead[];
	collations: ProjectManifestCollationHead[];
	tombstones: ProjectManifestTombstoneHead[];
	created_at: string;
	updated_at: string;
};

export type ProjectManifestDocument = SealedDocument<
	ProjectManifestPayload,
	typeof PROJECT_MANIFEST_FORMAT
>;

export const PROJECT_MANIFEST_FIXTURE: ProjectManifestPayload = {
	id: 'project-1',
	name: 'Default Project',
	description: 'Fixture project',
	charter: '',
	collation_settings: { regularize: false },
	manifest_content_hash: 'sha256:e08119724306ed74a77e9748563d84ef8ac69d6064c0ee9a83859a6ff2b78e67',
	transcriptions: [
		{
			project_transcription_id: 'pt-1',
			transcription_id: 'tx-1',
			current_revision: { id: 'tx-cp-1', content_hash: 'sha256:tx' },
			title: 'Witness A',
			siglum: 'A',
			primary_path: 'transcriptions/pt-1.json',
		},
	],
	collations: [
		{
			collation_id: 'col-1',
			current_revision: { id: 'col-cp-1', content_hash: 'sha256:col' },
			title: 'John 1:1',
			verse_identifier: 'John 1:1',
			primary_path: 'collations/col-1.json',
		},
	],
	tombstones: [],
	created_at: '2026-07-03T00:00:00.000Z',
	updated_at: '2026-07-03T00:00:00.000Z',
};

export function validateProjectManifestPayload(payload: JsonObject): ProjectManifestPayload {
	const record = payload as Record<string, unknown>;
	return {
		id: readString(record, 'id'),
		name: readString(record, 'name'),
		description: readString(record, 'description'),
		charter: readString(record, 'charter'),
		collation_settings: readJsonValue(record, 'collation_settings'),
		manifest_content_hash: readString(record, 'manifest_content_hash'),
		transcriptions: readProjectManifestTranscriptionHeads(record, 'transcriptions'),
		collations: readProjectManifestCollationHeads(record, 'collations'),
		tombstones: readProjectManifestTombstoneHeads(record, 'tombstones'),
		created_at: readString(record, 'created_at'),
		updated_at: readString(record, 'updated_at'),
	};
}

export const projectManifestFormatRegistration: FormatRegistration<ProjectManifestPayload> = {
	format: PROJECT_MANIFEST_FORMAT,
	currentVersion: PROJECT_MANIFEST_CURRENT_VERSION,
	upgraders: projectManifestUpgraders,
	validate: validateProjectManifestPayload,
	validateIntegrity: assertProjectManifestIntegrity,
};

export async function assertProjectManifestIntegrity(payload: ProjectManifestPayload): Promise<void> {
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
