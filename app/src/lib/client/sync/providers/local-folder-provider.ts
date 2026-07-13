import {
	CloudProviderError,
	type CloudFileMetadata,
	type CloudListResult,
	type CloudProviderCapabilities,
	type CloudProviderErrorCode,
	type CloudStorageProvider,
	type CloudWriteResult,
} from './provider';

export const LOCAL_FOLDER_PROVIDER_ID = 'local-folder';
export const LOCAL_FOLDER_ROOT_FOLDER_ID = '.';

export class LocalFolderStorageProvider implements CloudStorageProvider {
	id = LOCAL_FOLDER_PROVIDER_ID;
	name = 'Local folder';
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

	readonly rootFolderId = LOCAL_FOLDER_ROOT_FOLDER_ID;

	constructor(private readonly rootHandle: FileSystemDirectoryHandle) {}

	async createFolder(folderName: string, parentFolderId = this.rootFolderId): Promise<string> {
		const parent = await this.requireDirectory(parentFolderId);
		const name = normalizeSinglePathSegment(folderName);
		try {
			await parent.getDirectoryHandle(name, { create: true });
			return joinPath(parentFolderId, name);
		} catch (error) {
			throw mapHandleError(error, `Could not create local folder ${name}.`);
		}
	}

	async shareFolder(_folderId: string, _inviteeEmail: string, _role: 'viewer' | 'editor'): Promise<void> {
		throw providerError('permission-denied', 'Local folder backup does not support sharing.');
	}

	async listFiles(
		folderId: string,
		options: { recursive?: boolean; cursor?: string } = {}
	): Promise<CloudListResult> {
		if (options.cursor) throw providerError('unknown', 'Local folder provider does not paginate lists.');
		const folder = await this.requireDirectory(folderId);
		const entries: CloudFileMetadata[] = [];
		await this.collectEntries(folder, normalizeFolderId(folderId), options.recursive === true, entries);
		entries.sort(compareMetadata);
		return { entries, hasMore: false };
	}

	async downloadFile(fileId: string): Promise<string> {
		const file = await this.readFile(fileId);
		return file.text();
	}

	async createFile(folderId: string, path: string, content: string): Promise<CloudWriteResult> {
		const folder = await this.requireDirectory(folderId);
		const segments = normalizeRelativePath(path);
		const fileName = segments[segments.length - 1];
		const parent = await this.ensureDirectoryPath(folder, segments.slice(0, -1));
		try {
			await parent.getFileHandle(fileName, { create: false });
			throw providerError('conflict', `Local file already exists at ${joinPath(folderId, path)}.`);
		} catch (error) {
			if (isProviderError(error)) throw error;
			if (!isNotFoundError(error)) {
				throw mapHandleError(error, `Could not check local file ${joinPath(folderId, path)}.`);
			}
		}

		const handle = await parent.getFileHandle(fileName, { create: true });
		await writeTextFile(handle, content);
		return this.toWriteResult(joinPath(folderId, path), await handle.getFile());
	}

	async updateFile(
		fileId: string,
		content: string,
		expectedRevision: string
	): Promise<CloudWriteResult> {
		const handle = await this.requireFileHandle(fileId);
		const currentFile = await getFile(handle, fileId);
		const currentRevision = await hashText(await currentFile.text());
		if (currentRevision !== expectedRevision) {
			throw providerError(
				'conflict',
				`Expected revision ${expectedRevision}, found ${currentRevision}.`
			);
		}

		await writeTextFile(handle, content);
		return this.toWriteResult(fileId, await handle.getFile());
	}

	async deleteFile(fileId: string, expectedRevision?: string): Promise<void> {
		if (expectedRevision !== undefined) {
			const file = await this.readFile(fileId);
			const currentRevision = await hashText(await file.text());
			if (currentRevision !== expectedRevision) {
				throw providerError(
					'conflict',
					`Expected revision ${expectedRevision}, found ${currentRevision}.`
				);
			}
		}

		const segments = normalizeRelativePath(fileId);
		const fileName = segments[segments.length - 1];
		const parentPath = segments.slice(0, -1).join('/');
		const parent = await this.requireDirectory(parentPath || this.rootFolderId);
		try {
			await parent.removeEntry(fileName);
		} catch (error) {
			throw mapHandleError(error, `Could not delete local file ${fileId}.`);
		}
	}

	private async collectEntries(
		folder: FileSystemDirectoryHandle,
		folderPath: string,
		recursive: boolean,
		output: CloudFileMetadata[]
	): Promise<void> {
		try {
			for await (const [name, handle] of folder.entries()) {
				const path = joinPath(folderPath, name);
				if (handle.kind === 'directory') {
					output.push({
						id: path,
						path,
						name,
						revision: 'directory',
						modifiedAt: new Date(0).toISOString(),
						size: 0,
						isFolder: true,
					});
					if (recursive) await this.collectEntries(handle, path, true, output);
					continue;
				}

				const file = await getFile(handle, path);
				output.push(await fileMetadata(path, name, file));
			}
		} catch (error) {
			throw mapHandleError(error, `Could not list local folder ${folderPath}.`);
		}
	}

	private async ensureDirectoryPath(
		parent: FileSystemDirectoryHandle,
		segments: string[]
	): Promise<FileSystemDirectoryHandle> {
		let current = parent;
		for (const segment of segments) {
			try {
				current = await current.getDirectoryHandle(segment, { create: true });
			} catch (error) {
				throw mapHandleError(error, `Could not create local folder ${segment}.`);
			}
		}
		return current;
	}

	private async requireDirectory(path: string): Promise<FileSystemDirectoryHandle> {
		const segments = path === this.rootFolderId ? [] : normalizeRelativePath(path);
		let current = this.rootHandle;
		for (const segment of segments) {
			try {
				current = await current.getDirectoryHandle(segment, { create: false });
			} catch (error) {
				throw mapHandleError(error, `Local folder ${path} was not found.`);
			}
		}
		return current;
	}

	private async requireFileHandle(path: string): Promise<FileSystemFileHandle> {
		const segments = normalizeRelativePath(path);
		const fileName = segments[segments.length - 1];
		const parent = await this.requireDirectory(segments.slice(0, -1).join('/') || this.rootFolderId);
		try {
			return await parent.getFileHandle(fileName, { create: false });
		} catch (error) {
			throw mapHandleError(error, `Local file ${path} was not found.`);
		}
	}

	private async readFile(path: string): Promise<File> {
		const handle = await this.requireFileHandle(path);
		return getFile(handle, path);
	}

	private async toWriteResult(path: string, file: File): Promise<CloudWriteResult> {
		return {
			id: normalizeFileId(path),
			path: normalizeFileId(path),
			revision: await hashText(await file.text()),
			modifiedAt: new Date(file.lastModified).toISOString(),
			size: file.size,
		};
	}
}

function normalizeRelativePath(path: string): string[] {
	const segments = path
		.split('/')
		.map(segment => segment.trim())
		.filter(Boolean);
	if (segments.length === 0) throw providerError('unknown', 'Local file path is required.');
	for (const segment of segments) validatePathSegment(segment);
	return segments;
}

function normalizeSinglePathSegment(segment: string): string {
	const trimmed = segment.trim();
	validatePathSegment(trimmed);
	return trimmed;
}

function normalizeFolderId(path: string): string {
	return path === LOCAL_FOLDER_ROOT_FOLDER_ID ? '' : normalizeFileId(path);
}

function normalizeFileId(path: string): string {
	return normalizeRelativePath(path).join('/');
}

function validatePathSegment(segment: string): void {
	if (!segment || segment === '.' || segment === '..' || segment.includes('/')) {
		throw providerError('unknown', `Invalid local folder path segment ${JSON.stringify(segment)}.`);
	}
}

function joinPath(parentPath: string, name: string): string {
	const parent = parentPath === LOCAL_FOLDER_ROOT_FOLDER_ID ? '' : parentPath.replace(/\/+$/, '');
	const child = name.replace(/^\/+/g, '');
	return parent ? `${parent}/${child}` : child;
}

async function fileMetadata(path: string, name: string, file: File): Promise<CloudFileMetadata> {
	return {
		id: path,
		path,
		name,
		revision: await hashText(await file.text()),
		modifiedAt: new Date(file.lastModified).toISOString(),
		size: file.size,
		isFolder: false,
	};
}

async function writeTextFile(handle: FileSystemFileHandle, content: string): Promise<void> {
	try {
		const writable = await handle.createWritable();
		await writable.write(content);
		await writable.close();
	} catch (error) {
		throw mapHandleError(error, `Could not write local file ${handle.name}.`);
	}
}

async function getFile(handle: FileSystemFileHandle, path: string): Promise<File> {
	try {
		return await handle.getFile();
	} catch (error) {
		throw mapHandleError(error, `Could not read local file ${path}.`);
	}
}

async function hashText(content: string): Promise<string> {
	const digest = await globalThis.crypto?.subtle?.digest('SHA-256', new TextEncoder().encode(content));
	if (!digest) throw providerError('provider-unavailable', 'SHA-256 hashing is unavailable.');
	return `sha256:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function compareMetadata(left: CloudFileMetadata, right: CloudFileMetadata): number {
	return left.path.localeCompare(right.path, undefined, { sensitivity: 'base', numeric: true });
}

function isProviderError(error: unknown): error is CloudProviderError {
	return error instanceof CloudProviderError;
}

function isNotFoundError(error: unknown): boolean {
	return isDomError(error, 'NotFoundError') || isProviderErrorWithCode(error, 'not-found');
}

function isDomError(error: unknown, name: string): boolean {
	return typeof error === 'object' && error !== null && 'name' in error && error.name === name;
}

function isProviderErrorWithCode(error: unknown, code: CloudProviderErrorCode): boolean {
	return error instanceof CloudProviderError && error.code === code;
}

function mapHandleError(error: unknown, fallbackMessage: string): CloudProviderError {
	if (error instanceof CloudProviderError) return error;
	if (isDomError(error, 'NotFoundError')) return providerError('not-found', fallbackMessage, error);
	if (isDomError(error, 'NotAllowedError') || isDomError(error, 'SecurityError')) {
		return providerError('reauthorization-required', fallbackMessage, error);
	}
	return providerError('provider-unavailable', fallbackMessage, error);
}

function providerError(
	code: CloudProviderErrorCode,
	message: string,
	providerDetails?: unknown
): CloudProviderError {
	return new CloudProviderError(code, message, providerDetails);
}
