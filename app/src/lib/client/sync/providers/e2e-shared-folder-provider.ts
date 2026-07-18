import {
	CloudProviderError,
	type CloudFileMetadata,
	type CloudListResult,
	type CloudProviderCapabilities,
	type CloudProviderErrorCode,
	type CloudStorageProvider,
	type CloudWriteResult,
} from './provider';

// Test-only provider used by the Playwright build to give isolated browser contexts one folder.
export class E2eSharedFolderStorageProvider implements CloudStorageProvider {
	id = 'local-folder';
	name = 'E2E shared folder';
	readonly rootFolderId = '.';
	capabilities: CloudProviderCapabilities = {
		supportsFolderSharing: false,
		supportsStableFileIds: true,
		supportsExpectedRevisionDelete: true,
		requiresPathAddressing: true,
		sharingMayBeAsync: false,
		requiresExternalAuthorization: false,
		requiresUserGestureForConnection: true,
		supportsDirectoryHandlePersistence: true,
	};

	async createFolder(folderName: string, parentFolderId = this.rootFolderId): Promise<string> {
		const result = await request<{ id: string }>({
			operation: 'create-folder',
			name: folderName,
			parentId: parentFolderId,
		});
		return result.id;
	}

	async shareFolder(): Promise<void> {
		throw new CloudProviderError(
			'permission-denied',
			'E2E shared folders do not support sharing.'
		);
	}

	async listFiles(
		folderId: string,
		options: { recursive?: boolean; cursor?: string } = {}
	): Promise<CloudListResult> {
		if (options.cursor)
			throw new CloudProviderError('unknown', 'E2E folder lists do not paginate.');
		return request<CloudListResult>({
			operation: 'list-files',
			folderId,
			recursive: options.recursive === true,
		});
	}

	async downloadFile(fileId: string): Promise<string> {
		const result = await request<{ content: string }>({ operation: 'download-file', fileId });
		return result.content;
	}

	async createFile(folderId: string, path: string, content: string): Promise<CloudWriteResult> {
		return request<CloudWriteResult>({
			operation: 'write-file',
			folderId,
			path,
			content,
			createOnly: true,
		});
	}

	async updateFile(
		fileId: string,
		content: string,
		expectedRevision: string
	): Promise<CloudWriteResult> {
		return request<CloudWriteResult>({
			operation: 'write-file',
			fileId,
			content,
			expectedRevision,
		});
	}

	async deleteFile(fileId: string, expectedRevision?: string): Promise<void> {
		await request({ operation: 'delete-file', fileId, expectedRevision });
	}
}

async function request<T = unknown>(body: Record<string, unknown>): Promise<T> {
	const response = await fetch('/__e2e-shared-folder', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	const result = (await response.json()) as T & {
		code?: CloudProviderErrorCode;
		message?: string;
	};
	if (!response.ok) {
		throw new CloudProviderError(
			result.code ?? 'provider-unavailable',
			result.message ?? 'E2E shared folder request failed.'
		);
	}
	return result;
}
