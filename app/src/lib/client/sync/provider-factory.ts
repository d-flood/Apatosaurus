import type { CloudConnectionRecord } from '$lib/client/db/repositories/cloud-connections';
import { loadLocalFolderHandle } from './local-folder-handles';
import { DropboxStorageProvider } from './providers/dropbox-provider';
import { LocalFolderStorageProvider, LOCAL_FOLDER_PROVIDER_ID } from './providers/local-folder-provider';
import type { CloudCredentials, CloudStorageProvider } from './providers/provider';

export interface ProviderFactoryOptions {
	onCredentialsUpdated?: (credentials: CloudCredentials) => void | Promise<void>;
}

export async function createProviderForConnection(
	connection: CloudConnectionRecord,
	options: ProviderFactoryOptions = {}
): Promise<CloudStorageProvider> {
	if (connection.providerId === 'dropbox') {
		const clientId = import.meta.env.PUBLIC_DROPBOX_CLIENT_ID?.trim() ?? '';
		if (!clientId) throw new Error('Set PUBLIC_DROPBOX_CLIENT_ID before backing up to Dropbox.');
		return new DropboxStorageProvider({
			clientId,
			redirectUri: dropboxRedirectUri(),
			scopes: connection.scopes,
			credentials: connection.credentials,
			onCredentialsUpdated: options.onCredentialsUpdated,
		});
	}

	if (connection.providerId === LOCAL_FOLDER_PROVIDER_ID) {
		const handle = await loadLocalFolderHandle(connection.id);
		if (!handle) throw new Error('Local folder permission is required. Reconnect the folder.');
		return new LocalFolderStorageProvider(handle);
	}

	throw new Error(`Backup provider ${connection.providerId} is not supported yet.`);
}

function dropboxRedirectUri(): string {
	return import.meta.env.PUBLIC_DROPBOX_REDIRECT_URI?.trim() || 'http://localhost/projects';
}
