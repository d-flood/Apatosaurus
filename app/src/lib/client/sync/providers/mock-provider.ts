import {
	CloudProviderError,
	type CloudCredentials,
	type CloudFileMetadata,
	type CloudListResult,
	type CloudProviderCapabilities,
	type CloudProviderErrorCode,
	type CloudStorageProvider,
	type CloudWriteResult,
} from './provider';

export type MockProviderOperation =
	| 'get-auth-url'
	| 'exchange-code'
	| 'refresh-credentials'
	| 'create-folder'
	| 'share-folder'
	| 'list-files'
	| 'download-file'
	| 'create-file'
	| 'update-file'
	| 'delete-file';

export interface MockProviderErrorInjection {
	code: CloudProviderErrorCode;
	message?: string;
	providerDetails?: unknown;
	remaining?: number;
	operations?: MockProviderOperation[];
}

export interface MockCloudStorageProviderOptions {
	pageSize?: number;
	now?: () => string;
	rootFolderId?: string;
}

interface MockCloudEntry {
	id: string;
	parentId: string | null;
	path: string;
	name: string;
	revision: string;
	modifiedAt: string;
	size: number;
	isFolder: boolean;
	isDeleted: boolean;
	content: string;
	version: number;
	createdOrder: number;
}

const DEFAULT_ROOT_FOLDER_ID = 'mock-root';

export class MockCloudStorageProvider implements CloudStorageProvider {
	id = 'mock';
	name = 'Mock Cloud Storage';
	capabilities: CloudProviderCapabilities = {
		supportsFolderSharing: true,
		supportsStableFileIds: true,
		supportsExpectedRevisionDelete: true,
		requiresPathAddressing: false,
		sharingMayBeAsync: false,
	};

	readonly rootFolderId: string;
	private readonly pageSize: number;
	private readonly now: () => string;
	private entries = new Map<string, MockCloudEntry>();
	private idCounter = 0;
	private authCounter = 0;
	private errorInjections: MockProviderErrorInjection[] = [];

	constructor(options: MockCloudStorageProviderOptions = {}) {
		this.rootFolderId = options.rootFolderId ?? DEFAULT_ROOT_FOLDER_ID;
		this.pageSize = options.pageSize ?? 100;
		this.now = options.now ?? (() => new Date().toISOString());
		this.entries.set(this.rootFolderId, {
			id: this.rootFolderId,
			parentId: null,
			path: '',
			name: '',
			revision: 'rev-0',
			modifiedAt: this.now(),
			size: 0,
			isFolder: true,
			isDeleted: false,
			content: '',
			version: 0,
			createdOrder: this.idCounter,
		});
	}

	getAuthUrl(state: string, codeChallenge: string): string {
		this.throwInjectedError('get-auth-url');
		const url = new URL('https://mock.apatosaurus.local/oauth/authorize');
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('state', state);
		url.searchParams.set('code_challenge', codeChallenge);
		url.searchParams.set('code_challenge_method', 'S256');
		return url.toString();
	}

	async exchangeCode(code: string, codeVerifier: string): Promise<CloudCredentials> {
		this.throwInjectedError('exchange-code');
		if (!code || !codeVerifier) throw providerError('reauthorization-required', 'Missing OAuth code.');
		return {
			accessToken: `mock-access-${code}`,
			refreshToken: `mock-refresh-${code}`,
			expiresAt: Date.now() + 3_600_000,
		};
	}

	async refreshCredentials(refreshToken: string): Promise<CloudCredentials> {
		this.throwInjectedError('refresh-credentials');
		if (!refreshToken) throw providerError('reauthorization-required', 'Missing refresh token.');
		return {
			accessToken: `mock-access-refreshed-${this.nextAuthCounter()}`,
			refreshToken,
			expiresAt: Date.now() + 3_600_000,
		};
	}

	async createFolder(folderName: string, parentFolderId = this.rootFolderId): Promise<string> {
		this.throwInjectedError('create-folder');
		const parent = this.requireFolder(parentFolderId);
		const name = normalizeSinglePathSegment(folderName);
		const existing = this.findActiveChild(parent.id, name);
		if (existing) {
			if (!existing.isFolder) throw providerError('conflict', `File already exists at ${existing.path}.`);
			return existing.id;
		}
		return this.createFolderEntry(parent, name).id;
	}

	async shareFolder(
		folderId: string,
		inviteeEmail: string,
		_role: 'viewer' | 'editor',
	): Promise<void> {
		this.throwInjectedError('share-folder');
		this.requireFolder(folderId);
		if (!inviteeEmail.trim()) throw providerError('permission-denied', 'Invitee email is required.');
	}

	async listFiles(
		folderId: string,
		options: { recursive?: boolean; cursor?: string } = {},
	): Promise<CloudListResult> {
		this.throwInjectedError('list-files');
		const folder = this.requireFolder(folderId);
		const start = parseCursor(options.cursor);
		const entries = [...this.entries.values()]
			.filter((entry) => !entry.isDeleted && entry.id !== folder.id)
			.filter((entry) =>
				options.recursive ? this.isDescendantOf(entry, folder.id) : entry.parentId === folder.id,
			)
			.sort(compareEntries);
		const page = entries.slice(start, start + this.pageSize);
		const nextCursor = start + page.length;
		return {
			entries: page.map(toMetadata),
			cursor: nextCursor < entries.length ? String(nextCursor) : undefined,
			hasMore: nextCursor < entries.length,
		};
	}

	async downloadFile(fileId: string): Promise<string> {
		this.throwInjectedError('download-file');
		return this.requireFile(fileId).content;
	}

	async createFile(folderId: string, path: string, content: string): Promise<CloudWriteResult> {
		this.throwInjectedError('create-file');
		const folder = this.requireFolder(folderId);
		const segments = normalizeRelativePath(path);
		const fileName = segments[segments.length - 1];
		const parent = this.ensureFolderPath(folder, segments.slice(0, -1));
		const existing = this.findActiveChild(parent.id, fileName);
		if (existing) throw providerError('conflict', `Cloud entry already exists at ${existing.path}.`);

		const entry = this.createEntry({
			parentId: parent.id,
			path: joinPath(parent.path, fileName),
			name: fileName,
			isFolder: false,
			content,
		});
		return toWriteResult(entry);
	}

	async updateFile(
		fileId: string,
		content: string,
		expectedRevision: string,
	): Promise<CloudWriteResult> {
		this.throwInjectedError('update-file');
		const entry = this.requireFile(fileId);
		if (entry.revision !== expectedRevision) {
			throw providerError('conflict', `Expected revision ${expectedRevision}, found ${entry.revision}.`);
		}
		entry.content = content;
		entry.size = byteSize(content);
		this.bumpRevision(entry);
		return toWriteResult(entry);
	}

	async deleteFile(fileId: string, expectedRevision?: string): Promise<void> {
		this.throwInjectedError('delete-file');
		const entry = this.requireEntry(fileId);
		if (expectedRevision !== undefined && entry.revision !== expectedRevision) {
			throw providerError('conflict', `Expected revision ${expectedRevision}, found ${entry.revision}.`);
		}
		this.markDeleted(entry);
	}

	injectError(injection: MockProviderErrorInjection): void {
		this.errorInjections.push({ ...injection, remaining: injection.remaining ?? 1 });
	}

	failNext(
		code: CloudProviderErrorCode,
		operation?: MockProviderOperation,
		message?: string,
	): void {
		this.injectError({ code, message, operations: operation ? [operation] : undefined });
	}

	clearErrorInjections(): void {
		this.errorInjections = [];
	}

	private throwInjectedError(operation: MockProviderOperation): void {
		const index = this.errorInjections.findIndex(
			(injection) =>
				(injection.remaining ?? 0) > 0 &&
				(!injection.operations || injection.operations.includes(operation)),
		);
		if (index === -1) return;
		const injection = this.errorInjections[index];
		if (Number.isFinite(injection.remaining)) {
			injection.remaining = (injection.remaining ?? 1) - 1;
			if (injection.remaining <= 0) this.errorInjections.splice(index, 1);
		}
		throw providerError(
			injection.code,
			injection.message ?? defaultProviderErrorMessage(injection.code),
			injection.providerDetails,
		);
	}

	private requireEntry(id: string): MockCloudEntry {
		const entry = this.entries.get(id);
		if (!entry || entry.isDeleted) throw providerError('not-found', `Cloud entry ${id} was not found.`);
		return entry;
	}

	private requireFolder(id: string): MockCloudEntry {
		const entry = this.requireEntry(id);
		if (!entry.isFolder) throw providerError('not-found', `Cloud folder ${id} was not found.`);
		return entry;
	}

	private requireFile(id: string): MockCloudEntry {
		const entry = this.requireEntry(id);
		if (entry.isFolder) throw providerError('not-found', `Cloud file ${id} was not found.`);
		return entry;
	}

	private ensureFolderPath(parent: MockCloudEntry, segments: string[]): MockCloudEntry {
		let current = parent;
		for (const segment of segments) {
			const existing = this.findActiveChild(current.id, segment);
			if (existing) {
				if (!existing.isFolder) throw providerError('conflict', `File already exists at ${existing.path}.`);
				current = existing;
				continue;
			}
			current = this.createFolderEntry(current, segment);
		}
		return current;
	}

	private createFolderEntry(parent: MockCloudEntry, name: string): MockCloudEntry {
		return this.createEntry({
			parentId: parent.id,
			path: joinPath(parent.path, name),
			name,
			isFolder: true,
			content: '',
		});
	}

	private createEntry(input: {
		parentId: string;
		path: string;
		name: string;
		isFolder: boolean;
		content: string;
	}): MockCloudEntry {
		const entry: MockCloudEntry = {
			id: this.nextId(input.isFolder ? 'folder' : 'file'),
			parentId: input.parentId,
			path: input.path,
			name: input.name,
			revision: 'rev-1',
			modifiedAt: this.now(),
			size: input.isFolder ? 0 : byteSize(input.content),
			isFolder: input.isFolder,
			isDeleted: false,
			content: input.content,
			version: 1,
			createdOrder: this.idCounter,
		};
		this.entries.set(entry.id, entry);
		return entry;
	}

	private bumpRevision(entry: MockCloudEntry): void {
		entry.version += 1;
		entry.revision = `rev-${entry.version}`;
		entry.modifiedAt = this.now();
	}

	private markDeleted(entry: MockCloudEntry): void {
		entry.isDeleted = true;
		this.bumpRevision(entry);
		if (!entry.isFolder) return;
		for (const child of this.entries.values()) {
			if (!child.isDeleted && this.isDescendantOf(child, entry.id)) this.markDeleted(child);
		}
	}

	private findActiveChild(parentId: string, name: string): MockCloudEntry | null {
		return (
			[...this.entries.values()].find(
				(entry) => !entry.isDeleted && entry.parentId === parentId && entry.name === name,
			) ?? null
		);
	}

	private isDescendantOf(entry: MockCloudEntry, folderId: string): boolean {
		let parentId = entry.parentId;
		while (parentId) {
			if (parentId === folderId) return true;
			parentId = this.entries.get(parentId)?.parentId ?? null;
		}
		return false;
	}

	private nextId(prefix: string): string {
		return `${prefix}-${this.nextCounter()}`;
	}

	private nextCounter(): number {
		this.idCounter += 1;
		return this.idCounter;
	}

	private nextAuthCounter(): number {
		this.authCounter += 1;
		return this.authCounter;
	}
}

function normalizeRelativePath(path: string): string[] {
	const segments = path
		.split('/')
		.map((segment) => segment.trim())
		.filter(Boolean);
	if (segments.length === 0) throw providerError('unknown', 'Cloud file path is required.');
	for (const segment of segments) validatePathSegment(segment);
	return segments;
}

function normalizeSinglePathSegment(segment: string): string {
	const trimmed = segment.trim();
	validatePathSegment(trimmed);
	return trimmed;
}

function validatePathSegment(segment: string): void {
	if (!segment || segment === '.' || segment === '..' || segment.includes('/')) {
		throw providerError('unknown', `Invalid cloud path segment ${JSON.stringify(segment)}.`);
	}
}

function parseCursor(cursor: string | undefined): number {
	if (!cursor) return 0;
	const parsed = Number(cursor);
	if (!Number.isInteger(parsed) || parsed < 0) throw providerError('unknown', 'Invalid list cursor.');
	return parsed;
}

function joinPath(parentPath: string, name: string): string {
	return parentPath ? `${parentPath}/${name}` : name;
}

function byteSize(content: string): number {
	return new TextEncoder().encode(content).byteLength;
}

function toMetadata(entry: MockCloudEntry): CloudFileMetadata {
	return {
		id: entry.id,
		path: entry.path,
		name: entry.name,
		revision: entry.revision,
		modifiedAt: entry.modifiedAt,
		size: entry.size,
		isFolder: entry.isFolder,
		isDeleted: entry.isDeleted || undefined,
	};
}

function toWriteResult(entry: MockCloudEntry): CloudWriteResult {
	return {
		id: entry.id,
		path: entry.path,
		revision: entry.revision,
		modifiedAt: entry.modifiedAt,
		size: entry.size,
	};
}

function compareEntries(left: MockCloudEntry, right: MockCloudEntry): number {
	return left.path.localeCompare(right.path, undefined, { sensitivity: 'base', numeric: true }) || left.createdOrder - right.createdOrder;
}

function providerError(
	code: CloudProviderErrorCode,
	message: string,
	providerDetails?: unknown,
): CloudProviderError {
	return new CloudProviderError(code, message, providerDetails);
}

function defaultProviderErrorMessage(code: CloudProviderErrorCode): string {
	switch (code) {
		case 'conflict':
			return 'Mock provider conflict.';
		case 'permission-denied':
			return 'Mock provider permission denied.';
		case 'rate-limited':
			return 'Mock provider rate limit exceeded.';
		case 'not-found':
			return 'Mock provider entry not found.';
		case 'reauthorization-required':
			return 'Mock provider reauthorization required.';
		case 'provider-unavailable':
			return 'Mock provider unavailable.';
		case 'unknown':
			return 'Mock provider error.';
	}
}
