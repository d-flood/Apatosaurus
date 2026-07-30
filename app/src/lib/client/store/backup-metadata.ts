import {
	assertEnvelopeHash,
	openEnvelope,
	sealDocument,
	serializeSealedDocument,
	type JsonObject,
	type JsonValue,
} from './envelope';
import { backupMetadataFile } from './layout';
import { readTextFile, writeTextFileAtomic, type StoreOperationOptions } from './opfs-store';
import { invalidShape, quarantineFromError } from './quarantine';

export const BACKUP_METADATA_FORMAT = 'apatosaurus.backup-metadata';
export const BACKUP_METADATA_CURRENT_VERSION = 1;

export interface ProjectBackupMetadataRecord {
	projectId: string;
	lastExportedAt: string | null;
}

interface BackupMetadataPayload extends JsonObject {
	projects: JsonValue[];
}

export async function getProjectBackupMetadata(
	projectId: string,
	options: StoreOperationOptions = {}
): Promise<ProjectBackupMetadataRecord> {
	const records = await readBackupMetadata(options);
	return records.find(record => record.projectId === projectId) ?? { projectId, lastExportedAt: null };
}

export async function recordProjectZipExport(
	projectId: string,
	exportedAt: string,
	options: StoreOperationOptions = {}
): Promise<ProjectBackupMetadataRecord> {
	const records = await readBackupMetadata(options);
	const next = { projectId: requireNonEmpty(projectId, 'projectId'), lastExportedAt: exportedAt };
	await writeBackupMetadata(
		[...records.filter(record => record.projectId !== projectId), next],
		options
	);
	return next;
}

async function readBackupMetadata(options: StoreOperationOptions): Promise<ProjectBackupMetadataRecord[]> {
	let raw: string;
	try {
		raw = await readTextFile(backupMetadataFile(), options);
	} catch (error) {
		if (isMissingFileError(error)) return [];
		throw error;
	}

	try {
		const opened = openEnvelope(raw);
		if (opened.header.format !== BACKUP_METADATA_FORMAT) {
			throw invalidShape(
				`Backup metadata file format ${opened.header.format} does not match ${BACKUP_METADATA_FORMAT}.`,
				BACKUP_METADATA_FORMAT,
				opened.header.format
			);
		}
		if (opened.header.schema_version !== BACKUP_METADATA_CURRENT_VERSION) {
			throw invalidShape('Unsupported backup metadata schema_version.');
		}
		await assertEnvelopeHash(opened, BACKUP_METADATA_FORMAT);
		return validateBackupMetadataPayload(opened.payload);
	} catch (error) {
		const quarantine = quarantineFromError(error);
		throw new Error(`Could not read backup metadata: ${quarantine.message}`, { cause: error });
	}
}

async function writeBackupMetadata(
	records: ProjectBackupMetadataRecord[],
	options: StoreOperationOptions
): Promise<void> {
	const payload: BackupMetadataPayload = {
		projects: records.map(record => ({
			project_id: record.projectId,
			last_exported_at: record.lastExportedAt,
		})),
	};
	const document = await sealDocument(
		BACKUP_METADATA_FORMAT,
		BACKUP_METADATA_CURRENT_VERSION,
		payload
	);
	await writeTextFileAtomic(backupMetadataFile(), serializeSealedDocument(document), options);
}

function validateBackupMetadataPayload(payload: JsonObject): ProjectBackupMetadataRecord[] {
	if (!Array.isArray(payload.projects)) throw invalidShape('Backup metadata payload must include projects.');
	return payload.projects.map((value, index) => validateProjectMetadata(value, index));
}

function validateProjectMetadata(value: JsonValue, index: number): ProjectBackupMetadataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw invalidShape(`Backup metadata project at index ${index} must be an object.`);
	}
	const record = value as Record<string, JsonValue>;
	return {
		projectId: readString(record, 'project_id', index),
		lastExportedAt: readNullableString(record, 'last_exported_at', index),
	};
}

function readString(record: Record<string, JsonValue>, key: string, index: number): string {
	const value = record[key];
	if (typeof value !== 'string' || !value.trim()) {
		throw invalidShape(`Backup metadata project ${index} ${key} must be a non-empty string.`);
	}
	return value;
}

function readNullableString(record: Record<string, JsonValue>, key: string, index: number): string | null {
	const value = record[key];
	if (value === null) return null;
	if (typeof value !== 'string') {
		throw invalidShape(`Backup metadata project ${index} ${key} must be a string or null.`);
	}
	return value;
}

function requireNonEmpty(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${label} is required.`);
	return trimmed;
}

function isMissingFileError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return error instanceof Error && /not found/i.test(error.message);
}
