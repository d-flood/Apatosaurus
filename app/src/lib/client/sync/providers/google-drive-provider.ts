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

type GoogleDriveFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface GoogleDriveStorageProviderOptions {
	clientId: string;
	redirectUri: string;
	credentials?: CloudCredentials;
	scopes?: string[];
	rootFolderId?: string;
	fetch?: GoogleDriveFetch;
	now?: () => number;
	onCredentialsUpdated?: (credentials: CloudCredentials) => void | Promise<void>;
	tokenRefreshLeewayMs?: number;
	pageSize?: number;
}

interface GoogleTokenResponse {
	access_token?: unknown;
	expires_in?: unknown;
	refresh_token?: unknown;
}

interface GoogleDriveListResponse {
	files?: unknown;
	nextPageToken?: unknown;
}

interface GoogleDriveFile {
	id?: unknown;
	name?: unknown;
	mimeType?: unknown;
	parents?: unknown;
	modifiedTime?: unknown;
	size?: unknown;
	version?: unknown;
	headRevisionId?: unknown;
	appProperties?: unknown;
	trashed?: unknown;
}

interface GoogleDriveFileWithEtag {
	file: GoogleDriveFile;
	etag?: string;
}

interface GoogleDriveErrorDetails {
	status: number;
	operation: GoogleDriveOperation;
	error?: unknown;
	message?: string;
	reason?: string;
	requestId?: string | null;
	uploadId?: string | null;
	retryAfter?: string | null;
	body?: unknown;
}

type GoogleDriveOperation =
	| 'token-exchange'
	| 'token-refresh'
	| 'create-folder'
	| 'share-folder'
	| 'list-files'
	| 'download-file'
	| 'create-file'
	| 'update-file'
	| 'delete-file'
	| 'get-metadata'
	| 'find-folder';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3';
const GOOGLE_DRIVE_UPLOAD_BASE_URL = 'https://www.googleapis.com/upload/drive/v3';
const GOOGLE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const DEFAULT_ROOT_FOLDER_ID = 'root';
const DEFAULT_TOKEN_REFRESH_LEEWAY_MS = 60_000;
const DEFAULT_PAGE_SIZE = 1_000;
const FOLDER_MODIFIED_AT = '1970-01-01T00:00:00.000Z';
const APATOSAURUS_PATH_PROPERTY = 'apatosaurusPath';
const DRIVE_FILE_FIELDS =
	'id,name,mimeType,parents,modifiedTime,size,version,headRevisionId,appProperties,trashed';
const DEFAULT_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

export class GoogleDriveStorageProvider implements CloudStorageProvider {
	id = 'google-drive';
	name = 'Google Drive';
	capabilities: CloudProviderCapabilities = {
		supportsFolderSharing: true,
		supportsStableFileIds: true,
		supportsExpectedRevisionDelete: true,
		requiresPathAddressing: false,
		sharingMayBeAsync: false,
	};

	readonly rootFolderId: string;
	private credentials?: CloudCredentials;
	private readonly clientId: string;
	private readonly redirectUri: string;
	private readonly scopes: string[];
	private readonly fetch: GoogleDriveFetch;
	private readonly now: () => number;
	private readonly onCredentialsUpdated?: (credentials: CloudCredentials) => void | Promise<void>;
	private readonly tokenRefreshLeewayMs: number;
	private readonly pageSize: number;

	constructor(options: GoogleDriveStorageProviderOptions) {
		if (!options.clientId.trim()) throw new Error('Google Drive client ID is required.');
		if (!options.redirectUri.trim()) throw new Error('Google Drive redirect URI is required.');
		const fetchImplementation = options.fetch ?? globalThis.fetch?.bind(globalThis);
		if (!fetchImplementation) throw new Error('Google Drive provider requires fetch support.');

		this.clientId = options.clientId.trim();
		this.redirectUri = options.redirectUri.trim();
		this.credentials = cloneCredentials(options.credentials);
		this.scopes = normalizeScopes(options.scopes ?? DEFAULT_SCOPES);
		this.rootFolderId = normalizeDriveId(options.rootFolderId ?? DEFAULT_ROOT_FOLDER_ID);
		this.fetch = fetchImplementation;
		this.now = options.now ?? (() => Date.now());
		this.onCredentialsUpdated = options.onCredentialsUpdated;
		this.tokenRefreshLeewayMs = options.tokenRefreshLeewayMs ?? DEFAULT_TOKEN_REFRESH_LEEWAY_MS;
		this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
	}

	getAuthUrl(state: string, codeChallenge: string): string {
		const url = new URL(GOOGLE_AUTHORIZE_URL);
		url.searchParams.set('client_id', this.clientId);
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('code_challenge', codeChallenge);
		url.searchParams.set('code_challenge_method', 'S256');
		url.searchParams.set('access_type', 'offline');
		url.searchParams.set('prompt', 'consent');
		url.searchParams.set('include_granted_scopes', 'true');
		url.searchParams.set('state', state);
		url.searchParams.set('redirect_uri', this.redirectUri);
		if (this.scopes.length > 0) url.searchParams.set('scope', this.scopes.join(' '));
		return url.toString();
	}

	async exchangeCode(code: string, codeVerifier: string): Promise<CloudCredentials> {
		if (!code.trim()) {
			throw providerError(
				'reauthorization-required',
				'Google Drive authorization code is required.'
			);
		}
		if (!codeVerifier.trim()) {
			throw providerError(
				'reauthorization-required',
				'Google Drive PKCE code verifier is required.'
			);
		}

		const credentials = await this.requestToken(
			{
				code,
				grant_type: 'authorization_code',
				client_id: this.clientId,
				code_verifier: codeVerifier,
				redirect_uri: this.redirectUri,
			},
			'token-exchange'
		);
		await this.updateCredentials(credentials);
		return credentials;
	}

	async refreshCredentials(refreshToken: string): Promise<CloudCredentials> {
		if (!refreshToken.trim()) {
			throw providerError(
				'reauthorization-required',
				'Google Drive refresh token is required.'
			);
		}
		const credentials = await this.requestToken(
			{
				refresh_token: refreshToken,
				grant_type: 'refresh_token',
				client_id: this.clientId,
			},
			'token-refresh',
			refreshToken
		);
		await this.updateCredentials(credentials);
		return credentials;
	}

	setCredentials(credentials: CloudCredentials | undefined): void {
		this.credentials = cloneCredentials(credentials);
	}

	getCredentials(): CloudCredentials | undefined {
		return cloneCredentials(this.credentials);
	}

	async createFolder(folderName: string, parentFolderId = this.rootFolderId): Promise<string> {
		const parentId = normalizeDriveId(parentFolderId);
		const name = normalizePathSegment(folderName, 'Google Drive folder name');
		const existing = await this.findFolderByName(parentId, name);
		if (existing) return requireDriveFileId(existing, 'find-folder');
		return this.createDriveFolder(name, parentId, name);
	}

	async shareFolder(
		folderId: string,
		inviteeEmail: string,
		role: 'viewer' | 'editor'
	): Promise<void> {
		const email = inviteeEmail.trim();
		if (!email)
			throw providerError('permission-denied', 'Google Drive invitee email is required.');
		await this.requestJson(
			`${GOOGLE_DRIVE_API_BASE_URL}/files/${encodeURIComponent(normalizeDriveId(folderId))}/permissions?sendNotificationEmail=true&fields=id`,
			{
				method: 'POST',
				headers: await this.authJsonHeaders(),
				body: JSON.stringify({
					role: role === 'editor' ? 'writer' : 'reader',
					type: 'user',
					emailAddress: email,
				}),
			},
			'share-folder'
		);
	}

	async listFiles(
		folderId: string,
		options: { recursive?: boolean; cursor?: string } = {}
	): Promise<CloudListResult> {
		const rootId = normalizeDriveId(folderId);
		const recursive = options.recursive ?? false;
		const entries: CloudFileMetadata[] = [];
		const queue: Array<{ id: string; path: string }> = [{ id: rootId, path: '' }];

		for (let index = 0; index < queue.length; index += 1) {
			const current = queue[index];
			let pageToken: string | undefined;
			do {
				const page = await this.listFolderPage(current.id, pageToken);
				const files = parseDriveFiles(page.files, 'list-files');
				for (const file of files) {
					if (file.trashed === true) continue;
					const metadata = toMetadata(file, current.path);
					entries.push(metadata);
					if (recursive && metadata.isFolder)
						queue.push({ id: metadata.id, path: metadata.path });
				}
				pageToken = typeof page.nextPageToken === 'string' ? page.nextPageToken : undefined;
			} while (pageToken);

			if (!recursive) break;
		}

		return {
			entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
			hasMore: false,
		};
	}

	async downloadFile(fileId: string): Promise<string> {
		const accessToken = await this.getAccessTokenForRequest();
		const url = driveFileUrl(normalizeDriveId(fileId));
		url.searchParams.set('alt', 'media');
		return this.requestText(
			url.toString(),
			{
				method: 'GET',
				headers: { Authorization: `Bearer ${accessToken}` },
			},
			'download-file'
		);
	}

	async createFile(folderId: string, path: string, content: string): Promise<CloudWriteResult> {
		const segments = normalizeRelativePath(path, 'Google Drive file path');
		const fileName = segments[segments.length - 1];
		const parent = await this.ensureFolderPath(folderId, segments.slice(0, -1));
		const relativePath = joinPath(parent.path, fileName);
		const { body, boundary } = createMultipartBody(
			{
				name: fileName,
				mimeType: 'application/json',
				parents: [parent.id],
				appProperties: { [APATOSAURUS_PATH_PROPERTY]: relativePath },
			},
			content
		);
		const url = new URL(`${GOOGLE_DRIVE_UPLOAD_BASE_URL}/files`);
		url.searchParams.set('uploadType', 'multipart');
		url.searchParams.set('fields', DRIVE_FILE_FIELDS);
		url.searchParams.set('supportsAllDrives', 'true');
		const file = requireDriveFile(
			await this.requestJson(
				url.toString(),
				{
					method: 'POST',
					headers: {
						...(await this.authHeaders()),
						'Content-Type': `multipart/related; boundary=${boundary}`,
					},
					body,
				},
				'create-file'
			),
			'create-file'
		);
		return toWriteResult(file, relativePath);
	}

	async updateFile(
		fileId: string,
		content: string,
		expectedRevision: string
	): Promise<CloudWriteResult> {
		if (!expectedRevision.trim()) {
			throw providerError(
				'conflict',
				'Google Drive expected revision is required for updates.'
			);
		}
		const current = await this.getDriveFileWithEtag(fileId, 'update-file');
		const actualRevision = driveRevision(current.file, 'update-file');
		if (actualRevision !== expectedRevision) {
			throw providerError('conflict', 'Google Drive file revision changed before update.', {
				expectedRevision,
				actualRevision,
			});
		}

		const url = driveUploadFileUrl(normalizeDriveId(fileId));
		url.searchParams.set('uploadType', 'media');
		url.searchParams.set('fields', DRIVE_FILE_FIELDS);
		const headers = {
			...(await this.authHeaders()),
			'Content-Type': 'application/json',
			...(current.etag ? { 'If-Match': current.etag } : {}),
		};
		const updated = requireDriveFile(
			await this.requestJson(
				url.toString(),
				{
					method: 'PATCH',
					headers,
					body: content,
				},
				'update-file'
			),
			'update-file'
		);
		return toWriteResult(updated, drivePath(current.file, '', 'update-file'));
	}

	async deleteFile(fileId: string, expectedRevision?: string): Promise<void> {
		const current = expectedRevision
			? await this.getDriveFileWithEtag(fileId, 'delete-file')
			: undefined;
		if (current && driveRevision(current.file, 'delete-file') !== expectedRevision) {
			throw providerError('conflict', 'Google Drive file revision changed before delete.', {
				expectedRevision,
				actualRevision: driveRevision(current.file, 'delete-file'),
			});
		}

		const url = driveFileUrl(normalizeDriveId(fileId));
		const headers = {
			...(await this.authHeaders()),
			...(current?.etag ? { 'If-Match': current.etag } : {}),
		};
		await this.requestJson(
			url.toString(),
			{
				method: 'DELETE',
				headers,
			},
			'delete-file'
		);
	}

	private async requestToken(
		params: Record<string, string>,
		operation: 'token-exchange' | 'token-refresh',
		fallbackRefreshToken?: string
	): Promise<CloudCredentials> {
		const body = new URLSearchParams(params);
		const response = await this.requestJson<GoogleTokenResponse>(
			GOOGLE_TOKEN_URL,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body,
			},
			operation
		);
		return parseCredentials(response, this.now(), fallbackRefreshToken, operation);
	}

	private async ensureFolderPath(
		parentFolderId: string,
		segments: string[]
	): Promise<{ id: string; path: string }> {
		let current = { id: normalizeDriveId(parentFolderId), path: '' };
		for (const segment of segments) {
			const name = normalizePathSegment(segment, 'Google Drive folder path segment');
			const nextPath = joinPath(current.path, name);
			const existing = await this.findFolderByName(current.id, name);
			current = {
				id: existing
					? requireDriveFileId(existing, 'find-folder')
					: await this.createDriveFolder(name, current.id, nextPath),
				path: nextPath,
			};
		}
		return current;
	}

	private async createDriveFolder(
		name: string,
		parentId: string,
		relativePath: string
	): Promise<string> {
		const folder = requireDriveFile(
			await this.requestJson(
				`${GOOGLE_DRIVE_API_BASE_URL}/files?fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}&supportsAllDrives=true`,
				{
					method: 'POST',
					headers: await this.authJsonHeaders(),
					body: JSON.stringify({
						name,
						mimeType: GOOGLE_FOLDER_MIME_TYPE,
						parents: [parentId],
						appProperties: { [APATOSAURUS_PATH_PROPERTY]: relativePath },
					}),
				},
				'create-folder'
			),
			'create-folder'
		);
		return requireDriveFileId(folder, 'create-folder');
	}

	private async findFolderByName(
		parentId: string,
		name: string
	): Promise<GoogleDriveFile | null> {
		const url = new URL(`${GOOGLE_DRIVE_API_BASE_URL}/files`);
		url.searchParams.set(
			'q',
			`'${escapeDriveQueryValue(parentId)}' in parents and name = '${escapeDriveQueryValue(name)}' and mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and trashed = false`
		);
		url.searchParams.set('pageSize', '1');
		url.searchParams.set('fields', `files(${DRIVE_FILE_FIELDS})`);
		url.searchParams.set('supportsAllDrives', 'true');
		url.searchParams.set('includeItemsFromAllDrives', 'true');
		const response = await this.requestJson<GoogleDriveListResponse>(
			url.toString(),
			{
				method: 'GET',
				headers: await this.authHeaders(),
			},
			'find-folder'
		);
		return parseDriveFiles(response.files, 'find-folder')[0] ?? null;
	}

	private async listFolderPage(
		folderId: string,
		pageToken: string | undefined
	): Promise<GoogleDriveListResponse> {
		const url = new URL(`${GOOGLE_DRIVE_API_BASE_URL}/files`);
		url.searchParams.set(
			'q',
			`'${escapeDriveQueryValue(folderId)}' in parents and trashed = false`
		);
		url.searchParams.set('pageSize', String(this.pageSize));
		url.searchParams.set('fields', `nextPageToken,files(${DRIVE_FILE_FIELDS})`);
		url.searchParams.set('orderBy', 'folder,name');
		url.searchParams.set('supportsAllDrives', 'true');
		url.searchParams.set('includeItemsFromAllDrives', 'true');
		if (pageToken) url.searchParams.set('pageToken', pageToken);
		return this.requestJson<GoogleDriveListResponse>(
			url.toString(),
			{
				method: 'GET',
				headers: await this.authHeaders(),
			},
			'list-files'
		);
	}

	private async getDriveFileWithEtag(
		fileId: string,
		operation: GoogleDriveOperation
	): Promise<GoogleDriveFileWithEtag> {
		const accessToken = await this.getAccessTokenForRequest();
		const url = driveFileUrl(normalizeDriveId(fileId));
		url.searchParams.set('fields', DRIVE_FILE_FIELDS);
		const response = await this.fetchResponse(
			url.toString(),
			{
				method: 'GET',
				headers: { Authorization: `Bearer ${accessToken}` },
			},
			operation
		);
		return {
			file: requireDriveFile(await parseJsonResponse(response, operation), operation),
			etag: response.headers.get('etag') ?? undefined,
		};
	}

	private async requestJson<T>(
		url: string,
		init: RequestInit,
		operation: GoogleDriveOperation
	): Promise<T> {
		const response = await this.fetchResponse(url, init, operation);
		if (response.status === 204) return undefined as T;
		return parseJsonResponse(response, operation) as Promise<T>;
	}

	private async requestText(
		url: string,
		init: RequestInit,
		operation: GoogleDriveOperation
	): Promise<string> {
		const response = await this.fetchResponse(url, init, operation);
		return response.text();
	}

	private async fetchResponse(
		url: string,
		init: RequestInit,
		operation: GoogleDriveOperation
	): Promise<Response> {
		let response: Response;
		try {
			response = await this.fetch(url, init);
		} catch (error) {
			throw providerError(
				'provider-unavailable',
				`Google Drive ${operation} request failed.`,
				{
					operation,
					cause: error instanceof Error ? error.message : String(error),
				}
			);
		}
		if (!response.ok) throw await mapGoogleDriveError(response, operation);
		return response;
	}

	private async authHeaders(): Promise<Record<string, string>> {
		return { Authorization: `Bearer ${await this.getAccessTokenForRequest()}` };
	}

	private async authJsonHeaders(): Promise<Record<string, string>> {
		return {
			...(await this.authHeaders()),
			'Content-Type': 'application/json',
		};
	}

	private async getAccessTokenForRequest(): Promise<string> {
		if (!this.credentials?.accessToken) {
			throw providerError(
				'reauthorization-required',
				'Google Drive credentials are missing.'
			);
		}
		if (
			this.credentials.expiresAt &&
			this.credentials.expiresAt <= this.now() + this.tokenRefreshLeewayMs
		) {
			if (!this.credentials.refreshToken) {
				throw providerError(
					'reauthorization-required',
					'Google Drive refresh token is missing.'
				);
			}
			const refreshed = await this.refreshCredentials(this.credentials.refreshToken);
			return refreshed.accessToken;
		}
		return this.credentials.accessToken;
	}

	private async updateCredentials(credentials: CloudCredentials): Promise<void> {
		this.credentials = cloneCredentials(credentials);
		if (this.onCredentialsUpdated) await this.onCredentialsUpdated(credentials);
	}
}

function parseCredentials(
	response: GoogleTokenResponse,
	now: number,
	fallbackRefreshToken: string | undefined,
	operation: GoogleDriveOperation
): CloudCredentials {
	if (typeof response.access_token !== 'string' || !response.access_token) {
		throw providerError(
			'unknown',
			'Google Drive token response did not include an access token.',
			{
				operation,
			}
		);
	}
	return {
		accessToken: response.access_token,
		refreshToken:
			typeof response.refresh_token === 'string' && response.refresh_token
				? response.refresh_token
				: fallbackRefreshToken,
		expiresAt:
			typeof response.expires_in === 'number' && Number.isFinite(response.expires_in)
				? now + response.expires_in * 1000
				: undefined,
	};
}

async function parseJsonResponse(
	response: Response,
	operation: GoogleDriveOperation
): Promise<unknown> {
	const text = await response.text();
	if (!text.trim()) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		throw providerError('unknown', `Google Drive ${operation} returned invalid JSON.`, {
			status: response.status,
			operation,
		});
	}
}

function parseDriveFiles(files: unknown, operation: GoogleDriveOperation): GoogleDriveFile[] {
	if (!Array.isArray(files)) return [];
	return files.map(file => requireDriveFile(file, operation));
}

function requireDriveFile(value: unknown, operation: GoogleDriveOperation): GoogleDriveFile {
	if (!value || typeof value !== 'object') {
		throw providerError('unknown', 'Google Drive response did not include file metadata.', {
			operation,
		});
	}
	const file = value as GoogleDriveFile;
	if (typeof file.id === 'string' && typeof file.name === 'string') return file;
	throw providerError('unknown', 'Google Drive file metadata had an unexpected shape.', {
		operation,
		file,
	});
}

function requireDriveFileId(file: GoogleDriveFile, operation: GoogleDriveOperation): string {
	return requireString(file.id, 'Google Drive file ID', operation);
}

function toMetadata(file: GoogleDriveFile, parentPath: string): CloudFileMetadata {
	const id = requireDriveFileId(file, 'list-files');
	const name = requireString(file.name, 'Google Drive file name', 'list-files');
	const isFolder = file.mimeType === GOOGLE_FOLDER_MIME_TYPE;
	return {
		id,
		path: drivePath(file, parentPath, 'list-files'),
		name,
		revision: driveRevision(file, 'list-files'),
		modifiedAt: typeof file.modifiedTime === 'string' ? file.modifiedTime : FOLDER_MODIFIED_AT,
		size: isFolder ? 0 : driveFileSize(file.size),
		isFolder,
	};
}

function toWriteResult(file: GoogleDriveFile, fallbackPath: string): CloudWriteResult {
	return {
		id: requireDriveFileId(file, 'create-file'),
		path: drivePath(file, '', 'create-file') || fallbackPath,
		revision: driveRevision(file, 'create-file'),
		modifiedAt:
			typeof file.modifiedTime === 'string' ? file.modifiedTime : new Date(0).toISOString(),
		size: driveFileSize(file.size),
	};
}

function drivePath(
	file: GoogleDriveFile,
	parentPath: string,
	operation: GoogleDriveOperation
): string {
	const propertyPath = readAppPropertyPath(file.appProperties);
	if (propertyPath) return propertyPath;
	const name = requireString(file.name, 'Google Drive file name', operation);
	return joinPath(parentPath, name);
}

function driveRevision(file: GoogleDriveFile, operation: GoogleDriveOperation): string {
	const version = revisionValue(file.version);
	if (version) return version;
	const headRevisionId = revisionValue(file.headRevisionId);
	if (headRevisionId) return headRevisionId;
	return requireDriveFileId(file, operation);
}

function revisionValue(value: unknown): string | undefined {
	if (typeof value === 'string' && value) return value;
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	return undefined;
}

function driveFileSize(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return 0;
}

function createMultipartBody(
	metadata: Record<string, unknown>,
	content: string
): { body: string; boundary: string } {
	const boundary = 'apatosaurus-google-drive-boundary';
	return {
		boundary,
		body: [
			`--${boundary}`,
			'Content-Type: application/json; charset=UTF-8',
			'',
			JSON.stringify(metadata),
			`--${boundary}`,
			'Content-Type: application/json; charset=UTF-8',
			'',
			content,
			`--${boundary}--`,
			'',
		].join('\r\n'),
	};
}

function readAppPropertyPath(value: unknown): string | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const path = (value as Record<string, unknown>)[APATOSAURUS_PATH_PROPERTY];
	if (typeof path !== 'string' || !path.trim()) return undefined;
	return normalizeRelativePath(path, 'Google Drive app property path').join('/');
}

function normalizeDriveId(id: string): string {
	const trimmed = id.trim();
	if (!trimmed) throw providerError('unknown', 'Google Drive file ID is required.');
	return trimmed;
}

function normalizeRelativePath(path: string, label: string): string[] {
	const segments = path
		.trim()
		.split('/')
		.map(segment => segment.trim())
		.filter(Boolean);
	if (segments.length === 0) throw providerError('unknown', `${label} is required.`);
	return segments.map(segment => normalizePathSegment(segment, label));
}

function normalizePathSegment(segment: string, label: string): string {
	const trimmed = segment.trim();
	if (!trimmed || trimmed.includes('/') || trimmed === '.' || trimmed === '..') {
		throw providerError('unknown', `Invalid ${label} ${JSON.stringify(segment)}.`);
	}
	return trimmed;
}

function joinPath(parentPath: string, childName: string): string {
	const child = normalizePathSegment(childName, 'Google Drive path segment');
	if (!parentPath.trim()) return child;
	return `${normalizeRelativePath(parentPath, 'Google Drive parent path').join('/')}/${child}`;
}

function driveFileUrl(fileId: string): URL {
	const url = new URL(`${GOOGLE_DRIVE_API_BASE_URL}/files/${encodeURIComponent(fileId)}`);
	url.searchParams.set('supportsAllDrives', 'true');
	return url;
}

function driveUploadFileUrl(fileId: string): URL {
	const url = new URL(`${GOOGLE_DRIVE_UPLOAD_BASE_URL}/files/${encodeURIComponent(fileId)}`);
	url.searchParams.set('supportsAllDrives', 'true');
	return url;
}

function escapeDriveQueryValue(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function requireString(value: unknown, label: string, operation: GoogleDriveOperation): string {
	if (typeof value !== 'string' || !value) {
		throw providerError('unknown', `${label} was missing from the Google Drive response.`, {
			operation,
		});
	}
	return value;
}

function normalizeScopes(scopes: string[] | undefined): string[] {
	return [...new Set((scopes ?? []).map(scope => scope.trim()).filter(Boolean))].sort();
}

function cloneCredentials(credentials: CloudCredentials | undefined): CloudCredentials | undefined {
	return credentials ? { ...credentials } : undefined;
}

async function mapGoogleDriveError(
	response: Response,
	operation: GoogleDriveOperation
): Promise<CloudProviderError> {
	const bodyText = await response.text();
	const parsedBody = parseResponseBody(bodyText);
	const body =
		typeof parsedBody === 'object' && parsedBody !== null
			? (parsedBody as Record<string, unknown>)
			: {};
	const error = body.error;
	const oauthError = typeof error === 'string' ? error : undefined;
	const errorObject =
		error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined;
	const message = googleDriveErrorMessageFromBody(body, errorObject);
	const reason = googleDriveErrorReason(errorObject) ?? oauthError;
	const details: GoogleDriveErrorDetails = {
		status: response.status,
		operation,
		error,
		message,
		reason,
		requestId: response.headers.get('x-request-id'),
		uploadId: response.headers.get('x-guploader-uploadid'),
		retryAfter: response.headers.get('retry-after'),
		body: parsedBody,
	};
	const code = mapGoogleDriveErrorCode(response.status, oauthError, reason, message, errorObject);
	return providerError(code, googleDriveErrorMessage(code, operation), details);
}

function parseResponseBody(text: string): unknown {
	if (!text.trim()) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function googleDriveErrorMessageFromBody(
	body: Record<string, unknown>,
	errorObject: Record<string, unknown> | undefined
): string | undefined {
	if (typeof errorObject?.message === 'string') return errorObject.message;
	if (typeof body.error_description === 'string') return body.error_description;
	return undefined;
}

function googleDriveErrorReason(
	errorObject: Record<string, unknown> | undefined
): string | undefined {
	const errors = errorObject?.errors;
	if (Array.isArray(errors)) {
		const firstReason = errors
			.map(entry =>
				entry && typeof entry === 'object'
					? (entry as Record<string, unknown>).reason
					: undefined
			)
			.find((reason): reason is string => typeof reason === 'string' && reason.length > 0);
		if (firstReason) return firstReason;
	}
	if (typeof errorObject?.status === 'string') return errorObject.status;
	return undefined;
}

function mapGoogleDriveErrorCode(
	status: number,
	oauthError: string | undefined,
	reason: string | undefined,
	message: string | undefined,
	errorObject: Record<string, unknown> | undefined
): CloudProviderErrorCode {
	const normalizedReason = reason?.toLowerCase() ?? '';
	const normalizedMessage = message?.toLowerCase() ?? '';
	const normalizedStatus =
		typeof errorObject?.status === 'string' ? errorObject.status.toLowerCase() : '';
	if (status === 401 || oauthError === 'invalid_grant' || oauthError === 'invalid_token') {
		return 'reauthorization-required';
	}
	if (
		status === 429 ||
		normalizedReason.includes('ratelimit') ||
		normalizedStatus === 'resource_exhausted'
	) {
		return 'rate-limited';
	}
	if (status === 404 || normalizedReason === 'notfound') return 'not-found';
	if (status === 409 || status === 412 || normalizedReason === 'conditionnotmet')
		return 'conflict';
	if (status === 403 || oauthError === 'invalid_scope') return 'permission-denied';
	if (status >= 500) return 'provider-unavailable';
	if (normalizedMessage.includes('permission')) return 'permission-denied';
	return 'unknown';
}

function googleDriveErrorMessage(
	code: CloudProviderErrorCode,
	operation: GoogleDriveOperation
): string {
	switch (code) {
		case 'conflict':
			return `Google Drive ${operation} conflict.`;
		case 'permission-denied':
			return `Google Drive ${operation} permission denied.`;
		case 'rate-limited':
			return `Google Drive ${operation} rate limited.`;
		case 'not-found':
			return `Google Drive ${operation} target was not found.`;
		case 'reauthorization-required':
			return `Google Drive ${operation} requires reauthorization.`;
		case 'provider-unavailable':
			return `Google Drive ${operation} is unavailable.`;
		case 'unknown':
			return `Google Drive ${operation} failed.`;
	}
}

function providerError(
	code: CloudProviderErrorCode,
	message: string,
	providerDetails?: unknown
): CloudProviderError {
	return new CloudProviderError(code, message, providerDetails);
}
