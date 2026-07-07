import { browser } from '$app/environment';
import {
	emitLocalDbInvalidation,
	listCloudConnections,
	upsertCloudConnection,
} from '$lib/client/db/client';
import type { CloudConnectionRecord } from '$lib/client/db/repositories/cloud-connections';
import { notificationCenter } from '$lib/client/notification-center.svelte';
import {
	getSyncTarget,
	listSyncTargets,
	removeSyncTarget,
	upsertSyncTarget,
	type SyncTargetRecord,
} from '$lib/client/store';
import {
	deleteLocalFolderHandle,
	getDirectoryPicker,
	hasLocalFolderReadWritePermission,
	isLocalFolderProviderSupported,
	persistLocalFolderHandle,
} from './local-folder-handles';
import { LOCAL_FOLDER_PROVIDER_ID } from './providers/local-folder-provider';

export { isLocalFolderProviderSupported };

export interface BackupConnectionSnapshot {
	localFolderConnection: CloudConnectionRecord | null;
}

export async function getBackupConnections(): Promise<BackupConnectionSnapshot> {
	return { localFolderConnection: await getLocalFolderConnection() };
}

export async function connectLocalFolder(): Promise<CloudConnectionRecord> {
	if (!browser || !isLocalFolderProviderSupported()) {
		throw new Error('Folder sync is not supported in this browser.');
	}
	const picker = getDirectoryPicker();
	if (!picker) throw new Error('Directory picker is unavailable in this browser.');

	const handle = await picker({ mode: 'readwrite' });
	const granted = await hasLocalFolderReadWritePermission(handle, true);
	if (!granted) throw new Error('Read/write permission was not granted for the selected folder.');

	const connection = await upsertCloudConnection({
		providerId: LOCAL_FOLDER_PROVIDER_ID,
		providerAccountId: handle.name || LOCAL_FOLDER_PROVIDER_ID,
		accountEmail: handle.name || 'Local folder',
		scopes: ['files.content.read', 'files.content.write'],
	});
	await persistLocalFolderHandle(connection.id, handle);
	notificationCenter.upsert({
		id: 'local-folder-connected',
		title: 'Sync folder connected',
		message: `Connected ${connection.accountEmail}.`,
		tone: 'success',
	});
	return connection;
}

export async function getLocalFolderConnection(): Promise<CloudConnectionRecord | null> {
	const connections = await listCloudConnections();
	return (
		connections.find(connection => connection.providerId === LOCAL_FOLDER_PROVIDER_ID) ?? null
	);
}

export async function disconnectLocalFolderConnection(connectionId: string): Promise<boolean> {
	await deleteLocalFolderHandle(connectionId);
	const { disconnectCloudConnection } = await import('$lib/client/db/client');
	return disconnectCloudConnection(connectionId);
}

export async function listProjectSyncTargets(projectId: string): Promise<SyncTargetRecord[]> {
	return listSyncTargets(projectId);
}

export async function connectProjectSyncFolder(projectId: string): Promise<SyncTargetRecord> {
	const handle = await pickLocalFolderHandle();
	const now = new Date().toISOString();
	const targetId = createId();
	await persistLocalFolderHandle(targetId, handle);
	const target = await upsertSyncTarget({
		targetId,
		projectId,
		handleRef: targetId,
		folderDisplayPath: handle.name || 'Local folder',
		enabled: true,
		connectedAt: now,
		updatedAt: now,
	});
	emitLocalDbInvalidation('sync-targets');
	notificationCenter.upsert({
		id: `sync-folder-connected-${projectId}`,
		title: 'Sync folder connected',
		message: `Connected ${target.folderDisplayPath}.`,
		tone: 'success',
	});
	return target;
}

export async function reconnectProjectSyncFolder(targetId: string): Promise<SyncTargetRecord> {
	const target = await getSyncTarget(targetId);
	if (!target) throw new Error('Sync folder target was not found.');
	const handle = await pickLocalFolderHandle();
	const now = new Date().toISOString();
	await persistLocalFolderHandle(target.handleRef, handle);
	const updated = await upsertSyncTarget({
		...target,
		folderDisplayPath: handle.name || target.folderDisplayPath,
		enabled: true,
		updatedAt: now,
	});
	emitLocalDbInvalidation('sync-targets');
	return updated;
}

export async function disconnectProjectSyncFolder(targetId: string): Promise<boolean> {
	const target = await getSyncTarget(targetId);
	if (target) await deleteLocalFolderHandle(target.handleRef);
	const removed = await removeSyncTarget(targetId);
	if (removed) emitLocalDbInvalidation('sync-targets');
	return removed;
}

async function pickLocalFolderHandle(): Promise<FileSystemDirectoryHandle> {
	if (!browser || !isLocalFolderProviderSupported()) {
		throw new Error('Folder sync is not supported in this browser.');
	}
	const picker = getDirectoryPicker();
	if (!picker) throw new Error('Directory picker is unavailable in this browser.');
	const handle = await picker({ mode: 'readwrite' });
	const granted = await hasLocalFolderReadWritePermission(handle, true);
	if (!granted) throw new Error('Read/write permission was not granted for the selected folder.');
	return handle;
}

function createId(): string {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
