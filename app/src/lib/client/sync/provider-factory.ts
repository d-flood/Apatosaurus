import type { CloudConnectionRecord } from '$lib/client/db/repositories/cloud-connections';
import { loadLocalFolderHandle } from './local-folder-handles';
import { LocalFolderStorageProvider, LOCAL_FOLDER_PROVIDER_ID } from './providers/local-folder-provider';
import { MockCloudStorageProvider, MOCK_PROVIDER_ID } from './providers/mock-provider';
import type { CloudStorageProvider } from './providers/provider';

export async function createProviderForConnection(
	connection: CloudConnectionRecord
): Promise<CloudStorageProvider> {
	if (connection.providerId === LOCAL_FOLDER_PROVIDER_ID) {
		const handle = await loadLocalFolderHandle(connection.id);
		if (!handle) throw new Error('Local folder permission is required. Reconnect the folder.');
		return new LocalFolderStorageProvider(handle);
	}

	if (connection.providerId === MOCK_PROVIDER_ID) return new MockCloudStorageProvider();

	throw new Error(`Backup provider ${connection.providerId} is not supported.`);
}
