import { browser } from '$app/environment';
import { listCloudConnections, upsertCloudConnection } from '$lib/client/db/client';
import type { CloudConnectionRecord } from '$lib/client/db/repositories/cloud-connections';
import { notificationCenter } from '$lib/client/notification-center.svelte';
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
