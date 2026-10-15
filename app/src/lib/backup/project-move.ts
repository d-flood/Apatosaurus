import type { Kysely } from 'kysely';
import type { Database } from '$lib/db/types.generated';
import { hashContent } from '$lib/storage/content-hash';
import { upsertProjectPlacements, type DeletedNotice } from '$lib/storage/project-locations';
import {
	isBinaryProjectFile,
	listProjectArchiveFiles,
	normalizeSlashes,
	type ProjectArchiveFile,
} from './project-archive';
import {
	DELETED_MARKER_FILE,
	MOVED_MARKER_FILE,
	serializeDeletedMarker,
	serializeMovedMarker,
} from './moved-marker';
import { placementSyncContext } from './backup-status';
import { mapConcurrently } from './map-concurrently';
import { backupProject, recordSyncedFile, type SyncManagerOptions } from './sync-manager';
import {
	isCloudProviderError,
	type CloudFileMetadata,
	type CloudStorageProvider,
} from './providers/provider';

export interface MoveEndpoint {
	provider: CloudStorageProvider;
	rootFolderId: string;
	locationId: string;
	folderName: string;
}

export interface MoveProjectInput {
	projectId: string;
	source: MoveEndpoint | null;
	destination: MoveEndpoint & { label: string };
	movedBy: string;
}

export async function moveProject(
	db: Kysely<Database>,
	input: MoveProjectInput,
	options: SyncManagerOptions = {}
): Promise<void> {
	const storeOptions = options.storeOptions ?? {};
	const exclusive = options.exclusive ?? (work => work());
	const { source, destination } = input;
	if (source) {
		const synced = await backupProject(
			db,
			source.provider,
			{
				projectId: input.projectId,
				connectionId: source.locationId,
				cloudFolderId: source.folderName,
				cloudFolderPath: source.folderName,
			},
			options
		);
		if (synced.moved)
			throw new Error(`This project was already moved by ${synced.moved.movedBy}.`);
		if (synced.uiState !== 'synced') {
			throw new Error('Finish syncing this project before moving it.');
		}
	}

	const files = await exclusive(() =>
		listProjectArchiveFiles(db, input.projectId, { storeOptions })
	);
	const folder = await createEmptyFolder(destination);
	let copied: CloudFileMetadata[];
	try {
		for (const file of files) {
			await destination.provider.createFile(folder.id, file.path, file.content);
		}
		copied = await verifyCopy(destination.provider, folder, files);
	} catch (error) {
		await removeFolderContents(destination.provider, folder, null).catch(() => undefined);
		throw error;
	}

	const placement = {
		projectId: input.projectId,
		locationId: destination.locationId,
		folderName: destination.folderName,
		needsLocationChoice: false,
	};
	const syncedAt = options.now?.() ?? new Date().toISOString();
	await exclusive(async () => {
		await upsertProjectPlacements([placement], storeOptions);
		for (const [index, file] of files.entries()) {
			await recordSyncedFile(
				db,
				placementSyncContext(placement),
				file,
				copied[index]!,
				syncedAt
			);
		}
		if (!source) return;
		await db
			.deleteFrom('sync_file_fingerprints')
			.where('target_id', '=', source.locationId)
			.where('project_id', '=', input.projectId)
			.execute();
	});
	if (!source) return;
	await retireSourceFolder(
		source,
		MOVED_MARKER_FILE,
		serializeMovedMarker({
			movedAt: options.now?.() ?? new Date().toISOString(),
			movedBy: input.movedBy,
			destinationLabel: destination.label,
		})
	);
}

export async function deleteProjectFromLocation(
	location: MoveEndpoint,
	notice: DeletedNotice
): Promise<void> {
	await retireSourceFolder(location, DELETED_MARKER_FILE, serializeDeletedMarker(notice));
}

async function createEmptyFolder(
	destination: MoveProjectInput['destination']
): Promise<CloudFileMetadata> {
	const { provider, rootFolderId, folderName } = destination;
	const existing = await findChildFolder(provider, rootFolderId, folderName);
	if (existing && (await listAll(provider, existing.id, false)).length > 0) {
		throw new Error(`${destination.label} already has a folder named ${folderName}.`);
	}
	if (existing) return existing;
	await provider.createFolder(folderName, rootFolderId);
	const created = await findChildFolder(provider, rootFolderId, folderName);
	if (!created) throw new Error(`Could not create ${folderName} in ${destination.label}.`);
	return created;
}

async function verifyCopy(
	provider: CloudStorageProvider,
	folder: CloudFileMetadata,
	files: readonly ProjectArchiveFile[]
): Promise<CloudFileMetadata[]> {
	const copied = new Map(
		(await listAll(provider, folder.id, true))
			.filter(entry => !entry.isFolder)
			.map(entry => [relativePath(entry, folder), entry])
	);
	return mapConcurrently(files, async file => {
		const entry = copied.get(file.path);
		if (
			!entry ||
			(await hashContent(
				isBinaryProjectFile(file.path)
					? await provider.downloadFileBytes(entry.id)
					: await provider.downloadFile(entry.id)
			)) !== (await hashContent(file.content))
		) {
			throw new Error(`Move could not verify ${file.path} at the destination.`);
		}
		return entry;
	});
}

/** The marker goes first so other devices stop syncing before the files disappear. */
async function retireSourceFolder(
	source: MoveEndpoint,
	markerFile: string,
	content: string
): Promise<void> {
	const folder = await findChildFolder(source.provider, source.rootFolderId, source.folderName);
	if (!folder) return;
	const existing = (await listAll(source.provider, folder.id, false)).find(
		entry => !entry.isFolder && entry.name === markerFile
	);
	if (existing) await source.provider.updateFile(existing.id, content, existing.revision);
	else await source.provider.createFile(folder.id, markerFile, content);
	await removeFolderContents(source.provider, folder, markerFile);
}

async function removeFolderContents(
	provider: CloudStorageProvider,
	folder: CloudFileMetadata,
	keep: string | null
): Promise<void> {
	const entries = await listAll(provider, folder.id, true);
	for (const entry of entries.filter(entry => !entry.isFolder)) {
		if (keep !== null && relativePath(entry, folder) === keep) continue;
		await provider.deleteFile(entry.id);
	}
	const folders = entries
		.filter(entry => entry.isFolder)
		.sort((left, right) => right.path.length - left.path.length);
	if (keep === null) folders.push(folder);
	for (const entry of folders) await deleteIgnoringMissing(provider, entry.id);
}

async function deleteIgnoringMissing(provider: CloudStorageProvider, id: string): Promise<void> {
	try {
		await provider.deleteFile(id);
	} catch (error) {
		if (!isCloudProviderError(error, 'not-found')) throw error;
	}
}

async function findChildFolder(
	provider: CloudStorageProvider,
	parentId: string,
	name: string
): Promise<CloudFileMetadata | null> {
	return (
		(await listAll(provider, parentId, false)).find(
			entry => entry.isFolder && entry.name === name
		) ?? null
	);
}

async function listAll(
	provider: CloudStorageProvider,
	folderId: string,
	recursive: boolean
): Promise<CloudFileMetadata[]> {
	const entries: CloudFileMetadata[] = [];
	let cursor: string | undefined;
	do {
		const page = await provider.listFiles(folderId, { recursive, cursor });
		entries.push(...page.entries.filter(entry => !entry.isDeleted));
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return entries;
}

function relativePath(entry: CloudFileMetadata, folder: CloudFileMetadata): string {
	const path = normalizeSlashes(entry.path);
	const root = normalizeSlashes(folder.path);
	return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}
