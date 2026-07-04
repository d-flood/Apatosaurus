export interface CloudFileMetadata {
	id: string;
	path: string;
	name: string;
	revision: string;
	modifiedAt: string;
	size: number;
	isFolder: boolean;
	isDeleted?: boolean;
}

export interface CloudListResult {
	entries: CloudFileMetadata[];
	cursor?: string;
	hasMore: boolean;
}

export interface CloudWriteResult {
	id: string;
	path: string;
	revision: string;
	modifiedAt: string;
	size: number;
}

export interface CloudProviderCapabilities {
	supportsFolderSharing: boolean;
	supportsStableFileIds: boolean;
	supportsExpectedRevisionDelete: boolean;
	requiresPathAddressing: boolean;
	sharingMayBeAsync: boolean;
	requiresExternalAuthorization: boolean;
	requiresUserGestureForConnection: boolean;
	supportsDirectoryHandlePersistence: boolean;
}

export type CloudProviderErrorCode =
	| 'conflict'
	| 'permission-denied'
	| 'rate-limited'
	| 'not-found'
	| 'reauthorization-required'
	| 'provider-unavailable'
	| 'unknown';

export class CloudProviderError extends Error {
	constructor(
		readonly code: CloudProviderErrorCode,
		message: string,
		readonly providerDetails?: unknown
	) {
		super(message);
		this.name = 'CloudProviderError';
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

export function isCloudProviderError(
	error: unknown,
	code?: CloudProviderErrorCode
): error is CloudProviderError {
	return error instanceof CloudProviderError && (code === undefined || error.code === code);
}

export interface CloudStorageProvider {
	id: string;
	name: string;
	capabilities: CloudProviderCapabilities;

	createFolder(folderName: string, parentFolderId?: string): Promise<string>;
	shareFolder(folderId: string, inviteeEmail: string, role: 'viewer' | 'editor'): Promise<void>;

	listFiles(
		folderId: string,
		options?: { recursive?: boolean; cursor?: string }
	): Promise<CloudListResult>;
	downloadFile(fileId: string): Promise<string>;
	createFile(folderId: string, path: string, content: string): Promise<CloudWriteResult>;
	updateFile(
		fileId: string,
		content: string,
		expectedRevision: string
	): Promise<CloudWriteResult>;
	deleteFile(fileId: string, expectedRevision?: string): Promise<void>;
}
