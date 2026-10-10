import {
	assertEnvelopeHash,
	openEnvelope,
	sealDocument,
	serializeSealedDocument,
	type JsonObject,
	type JsonValue,
} from './envelope';
import {
	projectLocationsFile,
	projectPlacementsFile,
	removedProjectsFile,
	storageAccountsFile,
	syncTargetsFile,
} from './layout';
import {
	deleteFile,
	readTextFile,
	writeTextFileAtomic,
	type StoreOperationOptions,
} from './opfs-store';
import { invalidShape, quarantineFromError } from './quarantine';
import { listSyncTargets } from './sync-targets';

export interface StorageAccount {
	id: string;
	provider: 'google' | 'dropbox';
	displayName: string;
	email: string;
	grantedScopes: string[];
	signedIn: boolean;
	rootNamespaceId?: string;
}

export interface ProjectLocation {
	id: string;
	accountId: string | null;
	kind: 'personal' | 'team' | 'device';
	rootFolderId: string;
	displayPath: string;
	sharedDriveId?: string;
}

export interface MovedNotice {
	movedAt: string;
	movedBy: string;
	destinationLabel: string;
}

export interface DeletedNotice {
	deletedAt: string;
	deletedBy: string;
}

export interface ProjectPlacement {
	projectId: string;
	locationId: string | null;
	folderName: string | null;
	needsLocationChoice: boolean;
	moved?: MovedNotice;
	deleted?: DeletedNotice;
}

export interface RemovedProject {
	locationId: string;
	projectId: string;
	folderName: string;
}

export type PlacedProject = ProjectPlacement & { locationId: string; folderName: string };

export function isPlacedProject(placement: ProjectPlacement): placement is PlacedProject {
	return Boolean(placement.locationId && placement.folderName);
}

interface AppListFile<T> {
	path: () => string;
	format: string;
	key: string;
	toJson: (record: T) => JsonValue;
	fromJson: (record: Record<string, JsonValue>) => T;
}

const accountsFile: AppListFile<StorageAccount> = {
	path: storageAccountsFile,
	format: 'apatosaurus.storage-accounts',
	key: 'accounts',
	toJson: account => ({
		id: account.id,
		provider: account.provider,
		display_name: account.displayName,
		email: account.email,
		granted_scopes: account.grantedScopes,
		signed_in: account.signedIn,
		...(account.rootNamespaceId ? { root_namespace_id: account.rootNamespaceId } : {}),
	}),
	fromJson: record => ({
		id: readString(record, 'id'),
		provider: readEnum(record, 'provider', ['google', 'dropbox']),
		displayName: readString(record, 'display_name'),
		email: readString(record, 'email'),
		grantedScopes: readStringArray(record, 'granted_scopes'),
		signedIn: readBoolean(record, 'signed_in'),
		...(record.root_namespace_id === undefined
			? {}
			: { rootNamespaceId: readString(record, 'root_namespace_id') }),
	}),
};

const locationsFile: AppListFile<ProjectLocation> = {
	path: projectLocationsFile,
	format: 'apatosaurus.project-locations',
	key: 'locations',
	toJson: location => ({
		id: location.id,
		account_id: location.accountId,
		kind: location.kind,
		root_folder_id: location.rootFolderId,
		display_path: location.displayPath,
		...(location.sharedDriveId ? { shared_drive_id: location.sharedDriveId } : {}),
	}),
	fromJson: record => ({
		id: readString(record, 'id'),
		accountId: readNullableString(record, 'account_id'),
		kind: readEnum(record, 'kind', ['personal', 'team', 'device']),
		rootFolderId: readString(record, 'root_folder_id'),
		displayPath: readString(record, 'display_path'),
		...(record.shared_drive_id === undefined
			? {}
			: { sharedDriveId: readString(record, 'shared_drive_id') }),
	}),
};

const placementsFile: AppListFile<ProjectPlacement> = {
	path: projectPlacementsFile,
	format: 'apatosaurus.project-placements',
	key: 'placements',
	toJson: placement => ({
		project_id: placement.projectId,
		location_id: placement.locationId,
		folder_name: placement.folderName,
		needs_location_choice: placement.needsLocationChoice,
		...(placement.moved
			? {
					moved: {
						moved_at: placement.moved.movedAt,
						moved_by: placement.moved.movedBy,
						destination_label: placement.moved.destinationLabel,
					},
				}
			: {}),
		...(placement.deleted
			? {
					deleted: {
						deleted_at: placement.deleted.deletedAt,
						deleted_by: placement.deleted.deletedBy,
					},
				}
			: {}),
	}),
	fromJson: record => ({
		projectId: readString(record, 'project_id'),
		locationId: readNullableString(record, 'location_id'),
		folderName: readNullableString(record, 'folder_name'),
		needsLocationChoice: readBoolean(record, 'needs_location_choice'),
		...(record.moved === undefined ? {} : { moved: readMovedNotice(record.moved) }),
		...(record.deleted === undefined ? {} : { deleted: readDeletedNotice(record.deleted) }),
	}),
};

const removedFile: AppListFile<RemovedProject> = {
	path: removedProjectsFile,
	format: 'apatosaurus.removed-projects',
	key: 'removed',
	toJson: removed => ({
		location_id: removed.locationId,
		project_id: removed.projectId,
		folder_name: removed.folderName,
	}),
	fromJson: record => ({
		locationId: readString(record, 'location_id'),
		projectId: readString(record, 'project_id'),
		folderName: readString(record, 'folder_name'),
	}),
};

export function listStorageAccounts(
	options: StoreOperationOptions = {}
): Promise<StorageAccount[]> {
	return readList(accountsFile, options);
}

export async function upsertStorageAccount(
	account: StorageAccount,
	options: StoreOperationOptions = {}
): Promise<StorageAccount> {
	const accounts = await listStorageAccounts(options);
	await writeList(
		accountsFile,
		[...accounts.filter(existing => existing.id !== account.id), account],
		options
	);
	return account;
}

export function listProjectLocations(
	options: StoreOperationOptions = {}
): Promise<ProjectLocation[]> {
	return readList(locationsFile, options);
}

export async function getProjectLocation(
	locationId: string,
	options: StoreOperationOptions = {}
): Promise<ProjectLocation | null> {
	return (
		(await listProjectLocations(options)).find(location => location.id === locationId) ?? null
	);
}

export async function upsertProjectLocation(
	location: ProjectLocation,
	options: StoreOperationOptions = {}
): Promise<ProjectLocation> {
	const locations = await listProjectLocations(options);
	await writeList(
		locationsFile,
		[...locations.filter(existing => existing.id !== location.id), location],
		options
	);
	return location;
}

export function listProjectPlacements(
	options: StoreOperationOptions = {}
): Promise<ProjectPlacement[]> {
	return readList(placementsFile, options);
}

export async function upsertProjectPlacements(
	placements: ProjectPlacement[],
	options: StoreOperationOptions = {}
): Promise<void> {
	if (placements.length === 0) return;
	const replaced = new Set(placements.map(placement => placement.projectId));
	const existing = await listProjectPlacements(options);
	await writeList(
		placementsFile,
		[...existing.filter(placement => !replaced.has(placement.projectId)), ...placements],
		options
	);
}

export async function deleteProjectPlacements(
	projectIds: readonly string[],
	options: StoreOperationOptions = {}
): Promise<void> {
	if (projectIds.length === 0) return;
	const removed = new Set(projectIds);
	const existing = await listProjectPlacements(options);
	await writeList(
		placementsFile,
		existing.filter(placement => !removed.has(placement.projectId)),
		options
	);
}

export function listRemovedProjects(
	options: StoreOperationOptions = {}
): Promise<RemovedProject[]> {
	return readList(removedFile, options);
}

export async function addRemovedProjects(
	removed: readonly RemovedProject[],
	options: StoreOperationOptions = {}
): Promise<void> {
	if (removed.length === 0) return;
	const key = (entry: RemovedProject) => `${entry.locationId}:${entry.projectId}`;
	const added = new Set(removed.map(key));
	const existing = await listRemovedProjects(options);
	await writeList(
		removedFile,
		[...existing.filter(entry => !added.has(key(entry))), ...removed],
		options
	);
}

export async function clearRemovedProjects(
	locationIds: readonly string[],
	options: StoreOperationOptions = {}
): Promise<void> {
	const cleared = new Set(locationIds);
	const existing = await listRemovedProjects(options);
	if (!existing.some(entry => cleared.has(entry.locationId))) return;
	await writeList(
		removedFile,
		existing.filter(entry => !cleared.has(entry.locationId)),
		options
	);
}

export function bindPersonalLocation(
	locations: readonly ProjectLocation[],
	accountId: string,
	markerId: string,
	rootFolderId: string,
	displayPath: string
): ProjectLocation {
	if (locations.some(location => location.id === markerId && location.accountId !== accountId)) {
		throw new Error('This folder belongs to another storage account on this device.');
	}
	return { id: markerId, accountId, kind: 'personal', rootFolderId, displayPath };
}

/** Never touches the old folders: only the app's records of them are dropped. */
export async function upgradeSyncTargetsToPlacements(
	deleteFolderHandle: (handleRef: string) => Promise<void>,
	options: StoreOperationOptions = {}
): Promise<boolean> {
	if (!(await fileExists(syncTargetsFile(), options))) return false;
	const targets = await listSyncTargets(undefined, options);
	const projectIds = [...new Set(targets.map(target => target.projectId))];
	await upsertProjectPlacements(
		projectIds.map(projectId => ({
			projectId,
			locationId: null,
			folderName: null,
			needsLocationChoice: true,
		})),
		options
	);
	for (const target of targets) await deleteFolderHandle(target.handleRef);
	await deleteFile(syncTargetsFile(), options);
	return true;
}

async function readList<T>(file: AppListFile<T>, options: StoreOperationOptions): Promise<T[]> {
	let raw: string;
	try {
		raw = await readTextFile(file.path(), options);
	} catch (error) {
		if (isMissingFileError(error)) return [];
		throw error;
	}
	try {
		const opened = openEnvelope(raw);
		if (opened.header.format !== file.format) {
			throw invalidShape(
				`${file.path()} format ${opened.header.format} does not match ${file.format}.`,
				file.format,
				opened.header.format
			);
		}
		if (opened.header.schema_version !== 1) {
			throw invalidShape(`Unsupported ${file.path()} schema_version.`);
		}
		await assertEnvelopeHash(opened, file.format);
		const records = opened.payload[file.key];
		if (!Array.isArray(records)) throw invalidShape(`${file.path()} must include ${file.key}.`);
		return records.map(record => {
			if (!record || typeof record !== 'object' || Array.isArray(record)) {
				throw invalidShape(`${file.path()} ${file.key} must be objects.`);
			}
			return file.fromJson(record);
		});
	} catch (error) {
		const quarantine = quarantineFromError(error);
		throw new Error(`Could not read ${file.path()}: ${quarantine.message}`, { cause: error });
	}
}

async function writeList<T>(
	file: AppListFile<T>,
	records: T[],
	options: StoreOperationOptions
): Promise<void> {
	const payload: JsonObject = { [file.key]: records.map(file.toJson) };
	const document = await sealDocument(file.format, 1, payload);
	await writeTextFileAtomic(file.path(), serializeSealedDocument(document), options);
}

async function fileExists(path: string, options: StoreOperationOptions): Promise<boolean> {
	try {
		await readTextFile(path, options);
		return true;
	} catch (error) {
		if (isMissingFileError(error)) return false;
		throw error;
	}
}

function readString(record: Record<string, JsonValue>, key: string): string {
	const value = record[key];
	if (typeof value !== 'string' || !value.trim()) {
		throw invalidShape(`${key} must be a non-empty string.`);
	}
	return value;
}

function readNullableString(record: Record<string, JsonValue>, key: string): string | null {
	const value = record[key];
	if (value === null) return null;
	return readString(record, key);
}

function readMovedNotice(value: JsonValue): MovedNotice {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw invalidShape('moved must be an object.');
	}
	return {
		movedAt: readString(value, 'moved_at'),
		movedBy: readString(value, 'moved_by'),
		destinationLabel: readString(value, 'destination_label'),
	};
}

function readDeletedNotice(value: JsonValue): DeletedNotice {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw invalidShape('deleted must be an object.');
	}
	return {
		deletedAt: readString(value, 'deleted_at'),
		deletedBy: readString(value, 'deleted_by'),
	};
}

function readBoolean(record: Record<string, JsonValue>, key: string): boolean {
	const value = record[key];
	if (typeof value !== 'boolean') throw invalidShape(`${key} must be a boolean.`);
	return value;
}

function readStringArray(record: Record<string, JsonValue>, key: string): string[] {
	const value = record[key];
	if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
		throw invalidShape(`${key} must be a list of strings.`);
	}
	return value as string[];
}

function readEnum<T extends string>(
	record: Record<string, JsonValue>,
	key: string,
	allowed: readonly T[]
): T {
	const value = readString(record, key);
	if (!allowed.includes(value as T)) throw invalidShape(`${key} must be one of ${allowed}.`);
	return value as T;
}

function isMissingFileError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return error instanceof Error && /not found/i.test(error.message);
}
