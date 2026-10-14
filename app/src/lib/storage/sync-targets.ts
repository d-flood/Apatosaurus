import { assertEnvelopeHash, openEnvelope, type JsonObject, type JsonValue } from './envelope';
import { syncTargetsFile } from './layout';
import { readTextFile, type StoreOperationOptions } from './opfs-store';
import { invalidShape, quarantineFromError } from './quarantine';

const SYNC_TARGETS_FORMAT = 'apatosaurus.sync-targets';
const SYNC_TARGETS_CURRENT_VERSION = 1;

export interface SyncTargetRecord {
	targetId: string;
	projectId: string;
	handleRef: string;
	folderDisplayPath: string;
	enabled: boolean;
	connectedAt: string;
	updatedAt: string;
	lastSyncedAt: string | null;
}

export async function listSyncTargets(
	projectId?: string,
	options: StoreOperationOptions = {}
): Promise<SyncTargetRecord[]> {
	const targets = await readSyncTargets(options);
	return (projectId ? targets.filter(target => target.projectId === projectId) : targets).sort(
		(left, right) =>
			left.projectId.localeCompare(right.projectId) ||
			left.targetId.localeCompare(right.targetId)
	);
}

async function readSyncTargets(options: StoreOperationOptions): Promise<SyncTargetRecord[]> {
	let raw: string;
	try {
		raw = await readTextFile(syncTargetsFile(), options);
	} catch (error) {
		if (isMissingFileError(error)) return [];
		throw error;
	}

	try {
		const opened = openEnvelope(raw);
		if (opened.header.format !== SYNC_TARGETS_FORMAT) {
			throw invalidShape(
				`Sync targets file format ${opened.header.format} does not match ${SYNC_TARGETS_FORMAT}.`,
				SYNC_TARGETS_FORMAT,
				opened.header.format
			);
		}
		if (opened.header.schema_version !== SYNC_TARGETS_CURRENT_VERSION) {
			throw invalidShape('Unsupported sync targets schema_version.');
		}
		await assertEnvelopeHash(opened, SYNC_TARGETS_FORMAT);
		return validateTargetsPayload(opened.payload);
	} catch (error) {
		const quarantine = quarantineFromError(error);
		throw new Error(`Could not read sync targets: ${quarantine.message}`, { cause: error });
	}
}

function validateTargetsPayload(payload: JsonObject): SyncTargetRecord[] {
	if (!Array.isArray(payload.targets))
		throw invalidShape('Sync targets payload must include targets.');
	return payload.targets.map((value, index) => validateTarget(value, index));
}

function validateTarget(value: JsonValue, index: number): SyncTargetRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw invalidShape(`Sync target at index ${index} must be an object.`);
	}
	const record = value as Record<string, JsonValue>;
	return {
		targetId: readString(record, 'target_id', index),
		projectId: readString(record, 'project_id', index),
		handleRef: readString(record, 'handle_ref', index),
		folderDisplayPath: readString(record, 'folder_display_path', index),
		enabled: readBoolean(record, 'enabled', index),
		connectedAt: readString(record, 'connected_at', index),
		updatedAt: readString(record, 'updated_at', index),
		lastSyncedAt: readNullableString(record, 'last_synced_at', index),
	};
}

function readString(record: Record<string, JsonValue>, key: string, index: number): string {
	const value = record[key];
	if (typeof value !== 'string' || !value.trim()) {
		throw invalidShape(`Sync target ${index} ${key} must be a non-empty string.`);
	}
	return value;
}

function readNullableString(
	record: Record<string, JsonValue>,
	key: string,
	index: number
): string | null {
	const value = record[key];
	if (value === null) return null;
	if (typeof value !== 'string') {
		throw invalidShape(`Sync target ${index} ${key} must be a string or null.`);
	}
	return value;
}

function readBoolean(record: Record<string, JsonValue>, key: string, index: number): boolean {
	const value = record[key];
	if (typeof value !== 'boolean') {
		throw invalidShape(`Sync target ${index} ${key} must be a boolean.`);
	}
	return value;
}

function isMissingFileError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return error instanceof Error && /not found/i.test(error.message);
}
