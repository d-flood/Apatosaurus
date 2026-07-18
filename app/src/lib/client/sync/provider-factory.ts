import type { CloudConnectionRecord } from '$lib/client/db/repositories/cloud-connections';
import { getSyncTarget } from '$lib/client/store';
import { loadLocalFolderHandle } from './local-folder-handles';
import { LocalFolderStorageProvider, LOCAL_FOLDER_PROVIDER_ID } from './providers/local-folder-provider';
import { E2eSharedFolderStorageProvider } from './providers/e2e-shared-folder-provider';
import { MockCloudStorageProvider, MOCK_PROVIDER_ID } from './providers/mock-provider';
import type { CloudStorageProvider } from './providers/provider';

const useE2eSharedFolder = import.meta.env.VITE_E2E_SHARED_FOLDER === '1';

export async function createProviderForConnection(
	connection: CloudConnectionRecord
): Promise<CloudStorageProvider> {
	if (connection.providerId === LOCAL_FOLDER_PROVIDER_ID) {
		if (useE2eSharedFolder) return new E2eSharedFolderStorageProvider();
		const handle = await loadLocalFolderHandle(connection.id);
		if (!handle) throw new Error('Local folder permission is required. Reconnect the folder.');
		return new LocalFolderStorageProvider(handle);
	}

	if (connection.providerId === MOCK_PROVIDER_ID) return new MockCloudStorageProvider();

	throw new Error(`Backup provider ${connection.providerId} is not supported.`);
}

export async function createProviderForSyncTarget(targetId: string): Promise<CloudStorageProvider> {
	const target = await getSyncTarget(targetId);
	if (!target) throw new Error('Sync folder target was not found. Reconnect the folder.');
	if (useE2eSharedFolder) return new E2eSharedFolderStorageProvider();
	const handle = await loadLocalFolderHandle(target.handleRef);
	if (!handle) throw new Error('Local folder permission is required. Reconnect the folder.');
	return new LocalFolderStorageProvider(handle);
}
