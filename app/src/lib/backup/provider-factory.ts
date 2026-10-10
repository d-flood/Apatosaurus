import {
	getProjectLocation,
	listStorageAccounts,
	type StorageAccount,
} from '$lib/storage/project-locations';
import { loadLocalFolderHandle } from './local-folder-handles';
import { LocalFolderStorageProvider } from './providers/local-folder-provider';
import { E2eSharedFolderStorageProvider } from './providers/e2e-shared-folder-provider';
import { DropboxStorageProvider } from './providers/dropbox-provider';
import { GoogleDriveStorageProvider } from './providers/google-drive-provider';
import { CloudProviderError, type CloudStorageProvider } from './providers/provider';
import { accountTokens } from './storage-account-auth';

const useE2eSharedFolder = import.meta.env.VITE_E2E_SHARED_FOLDER === '1';

export async function createProviderForLocation(locationId: string): Promise<CloudStorageProvider> {
	const location = await getProjectLocation(locationId);
	if (!location) throw new Error('Project location was not found. Reconnect the folder.');
	if (location.accountId) {
		const account = (await listStorageAccounts()).find(
			candidate => candidate.id === location.accountId
		);
		if (!account?.signedIn) {
			throw new CloudProviderError(
				'reauthorization-required',
				'Storage account is signed out. Reconnect the account.'
			);
		}
		return createAccountProvider(account, location.rootFolderId, location.sharedDriveId);
	}
	return createDeviceProvider(await loadLocalFolderHandle(location.id));
}

export function createAccountProvider(
	account: Pick<StorageAccount, 'id' | 'provider' | 'rootNamespaceId'>,
	rootFolderId: string,
	sharedDriveId?: string
): CloudStorageProvider {
	const tokens = accountTokens(account.id, account.provider);
	return account.provider === 'google'
		? new GoogleDriveStorageProvider({ driveRootId: rootFolderId, sharedDriveId, tokens })
		: new DropboxStorageProvider({
				rootPath: rootFolderId,
				tokens,
				rootNamespaceId: account.rootNamespaceId,
			});
}

export function createDeviceProvider(
	handle: FileSystemDirectoryHandle | null
): CloudStorageProvider {
	if (useE2eSharedFolder) return new E2eSharedFolderStorageProvider();
	if (!handle) throw new Error('Local folder permission is required. Reconnect the folder.');
	return new LocalFolderStorageProvider(handle);
}
