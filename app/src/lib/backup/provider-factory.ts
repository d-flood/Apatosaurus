import { getSyncTarget } from '$lib/storage/sync-targets';
import { loadLocalFolderHandle } from './local-folder-handles';
import { LocalFolderStorageProvider } from './providers/local-folder-provider';
import { E2eSharedFolderStorageProvider } from './providers/e2e-shared-folder-provider';
import type { CloudStorageProvider } from './providers/provider';

const useE2eSharedFolder = import.meta.env.VITE_E2E_SHARED_FOLDER === '1';

export async function createProviderForSyncTarget(targetId: string): Promise<CloudStorageProvider> {
	const target = await getSyncTarget(targetId);
	if (!target) throw new Error('Sync folder target was not found. Reconnect the folder.');
	if (useE2eSharedFolder) return new E2eSharedFolderStorageProvider();
	const handle = await loadLocalFolderHandle(target.handleRef);
	if (!handle) throw new Error('Local folder permission is required. Reconnect the folder.');
	return new LocalFolderStorageProvider(handle);
}
