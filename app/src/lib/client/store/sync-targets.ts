import {
	assertEnvelopeHash,
	openEnvelope,
	sealDocument,
	serializeSealedDocument,
	type JsonObject,
	type JsonValue,
} from './envelope';
import { syncTargetsFile } from './layout';
import { readTextFile, writeTextFileAtomic, type StoreOperationOptions } from './opfs-store';
import { invalidShape, quarantineFromError } from './quarantine';

export const SYNC_TARGETS_FORMAT = 'apatosaurus.sync-targets';
export const SYNC_TARGETS_CURRENT_VERSION = 1;

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

export interface UpsertSyncTargetInput {
	targetId?: string;
	projectId: string;
	handleRef?: string;
	folderDisplayPath: string;
	enabled?: boolean;
	connectedAt?: string;
	updatedAt?: string;
	lastSyncedAt?: string | null;
}

interface SyncTargetsPayload extends JsonObject {
	targets: JsonValue[];
}

export async function listSyncTargets(
	projectId?: string,
	options: StoreOperationOptions = {}
): Promise<SyncTargetRecord[]> {
	const targets = await readSyncTargets(options);
	return (projectId ? targets.filter(target => target.projectId === projectId) : targets).sort(
		(left, right) => left.projectId.localeCompare(right.projectId) || left.targetId.localeCompare(right.targetId)
	);
}

export async function getSyncTarget(
	targetId: string,
	options: StoreOperationOptions = {}
): Promise<SyncTargetRecord | null> {
	const targets = await readSyncTargets(options);
	return targets.find(target => target.targetId === targetId) ?? null;
}

export async function upsertSyncTarget(
	input: UpsertSyncTargetInput,
	options: StoreOperationOptions = {}
): Promise<SyncTargetRecord> {
	const now = input.updatedAt ?? new Date().toISOString();
	const targetId = input.targetId?.trim() || createId();
	const handleRef = input.handleRef?.trim() || targetId;
	const existingTargets = await readSyncTargets(options);
	const existing = existingTargets.find(target => target.targetId === targetId);
	const next: SyncTargetRecord = {
		targetId,
		projectId: requireNonEmpty(input.projectId, 'projectId'),
		handleRef,
		folderDisplayPath: requireNonEmpty(input.folderDisplayPath, 'folderDisplayPath'),
		enabled: input.enabled ?? existing?.enabled ?? true,
		connectedAt: input.connectedAt ?? existing?.connectedAt ?? now,
		updatedAt: now,
		lastSyncedAt: input.lastSyncedAt ?? existing?.lastSyncedAt ?? null,
	};

	await writeSyncTargets(
		[...existingTargets.filter(target => target.targetId !== targetId), next],
		options
	);
	return next;
}

export async function updateSyncTargetLastSyncedAt(
	targetId: string,
	lastSyncedAt: string,
	options: StoreOperationOptions = {}
): Promise<SyncTargetRecord> {
	const targets = await readSyncTargets(options);
	const index = targets.findIndex(target => target.targetId === targetId);
	if (index === -1) throw new Error(`Sync target ${targetId} was not found.`);
	const next = {
		...targets[index],
		lastSyncedAt,
		updatedAt: lastSyncedAt,
	};
	targets[index] = next;
	await writeSyncTargets(targets, options);
	return next;
}

export async function setSyncTargetEnabled(
	targetId: string,
	enabled: boolean,
	options: StoreOperationOptions = {}
): Promise<SyncTargetRecord> {
	const targets = await readSyncTargets(options);
	const index = targets.findIndex(target => target.targetId === targetId);
	if (index === -1) throw new Error(`Sync target ${targetId} was not found.`);
	const now = new Date().toISOString();
	const next = { ...targets[index], enabled, updatedAt: now };
	targets[index] = next;
	await writeSyncTargets(targets, options);
	return next;
}

export async function removeSyncTarget(
	targetId: string,
	options: StoreOperationOptions = {}
): Promise<boolean> {
	const targets = await readSyncTargets(options);
	const next = targets.filter(target => target.targetId !== targetId);
	if (next.length === targets.length) return false;
	await writeSyncTargets(next, options);
	return true;
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

async function writeSyncTargets(
	targets: SyncTargetRecord[],
	options: StoreOperationOptions
): Promise<void> {
	const payload: SyncTargetsPayload = {
		targets: targets.map(target => ({
			target_id: target.targetId,
			project_id: target.projectId,
			handle_ref: target.handleRef,
			folder_display_path: target.folderDisplayPath,
			enabled: target.enabled,
			connected_at: target.connectedAt,
			updated_at: target.updatedAt,
			last_synced_at: target.lastSyncedAt,
		})),
	};
	const document = await sealDocument(
		SYNC_TARGETS_FORMAT,
		SYNC_TARGETS_CURRENT_VERSION,
		payload
	);
	await writeTextFileAtomic(syncTargetsFile(), serializeSealedDocument(document), options);
}

function validateTargetsPayload(payload: JsonObject): SyncTargetRecord[] {
	if (!Array.isArray(payload.targets)) throw invalidShape('Sync targets payload must include targets.');
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

function createId(): string {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
