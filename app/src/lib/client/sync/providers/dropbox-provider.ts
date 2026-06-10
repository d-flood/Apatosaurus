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

type DropboxFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface DropboxStorageProviderOptions {
	clientId: string;
	redirectUri: string;
	credentials?: CloudCredentials;
	scopes?: string[];
	rootPath?: string;
	fetch?: DropboxFetch;
	now?: () => number;
	onCredentialsUpdated?: (credentials: CloudCredentials) => void | Promise<void>;
	tokenRefreshLeewayMs?: number;
	shareJobMaxPolls?: number;
	shareJobPollDelayMs?: number;
}

interface DropboxTokenResponse {
	access_token?: unknown;
	expires_in?: unknown;
	refresh_token?: unknown;
}

interface DropboxListResponse {
	entries?: unknown;
	cursor?: unknown;
	has_more?: unknown;
}

type DropboxMetadata = DropboxFileMetadata | DropboxFolderMetadata | DropboxDeletedMetadata;

interface DropboxFileMetadata {
	'.tag': 'file';
	name: string;
	id?: string;
	path_lower?: string;
	path_display?: string;
	rev: string;
	server_modified: string;
	size: number;
}

interface DropboxFolderMetadata {
	'.tag': 'folder';
	name: string;
	id?: string;
	path_lower?: string;
	path_display?: string;
}

interface DropboxDeletedMetadata {
	'.tag': 'deleted';
	name: string;
	path_lower?: string;
	path_display?: string;
}

interface DropboxShareFolderResponse {
	'.tag'?: unknown;
	shared_folder_id?: unknown;
	async_job_id?: unknown;
}

interface DropboxShareJobStatusResponse {
	'.tag'?: unknown;
	shared_folder_id?: unknown;
}

interface DropboxErrorDetails {
	status: number;
	operation: DropboxOperation;
	errorSummary?: string;
	errorTag?: string;
	error?: unknown;
	requestId?: string | null;
	retryAfter?: string | null;
	body?: unknown;
}

interface DropboxCursorToken {
	provider: 'dropbox';
	cursor: string;
	basePath: string;
}

type DropboxOperation =
	| 'token-exchange'
	| 'token-refresh'
	| 'create-folder'
	| 'share-folder'
	| 'add-folder-member'
	| 'list-files'
	| 'download-file'
	| 'create-file'
	| 'update-file'
	| 'delete-file'
	| 'get-metadata';

const DROPBOX_AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const DROPBOX_API_BASE_URL = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT_BASE_URL = 'https://content.dropboxapi.com/2';
const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const DEFAULT_ROOT_PATH = '/Apatosaurus/Projects';
const DEFAULT_TOKEN_REFRESH_LEEWAY_MS = 60_000;
const DEFAULT_SHARE_JOB_MAX_POLLS = 5;
const DEFAULT_SHARE_JOB_POLL_DELAY_MS = 1_000;
const FOLDER_MODIFIED_AT = '1970-01-01T00:00:00.000Z';

export class DropboxStorageProvider implements CloudStorageProvider {
	id = 'dropbox';
	name = 'Dropbox';
	capabilities: CloudProviderCapabilities = {
		supportsFolderSharing: true,
		supportsStableFileIds: false,
		supportsExpectedRevisionDelete: true,
		requiresPathAddressing: true,
		sharingMayBeAsync: true,
	};

	readonly rootPath: string;
	private credentials?: CloudCredentials;
	private readonly clientId: string;
	private readonly redirectUri: string;
	private readonly scopes: string[];
	private readonly fetch: DropboxFetch;
	private readonly now: () => number;
	private readonly onCredentialsUpdated?: (credentials: CloudCredentials) => void | Promise<void>;
	private readonly tokenRefreshLeewayMs: number;
	private readonly shareJobMaxPolls: number;
	private readonly shareJobPollDelayMs: number;

	constructor(options: DropboxStorageProviderOptions) {
		if (!options.clientId.trim()) throw new Error('Dropbox client ID is required.');
		if (!options.redirectUri.trim()) throw new Error('Dropbox redirect URI is required.');
		const fetchImplementation = options.fetch ?? globalThis.fetch?.bind(globalThis);
		if (!fetchImplementation) throw new Error('Dropbox provider requires fetch support.');

		this.clientId = options.clientId.trim();
		this.redirectUri = options.redirectUri.trim();
		this.credentials = cloneCredentials(options.credentials);
		this.scopes = normalizeScopes(options.scopes);
		this.rootPath = normalizeDropboxPath(options.rootPath ?? DEFAULT_ROOT_PATH);
		this.fetch = fetchImplementation;
		this.now = options.now ?? (() => Date.now());
		this.onCredentialsUpdated = options.onCredentialsUpdated;
		this.tokenRefreshLeewayMs = options.tokenRefreshLeewayMs ?? DEFAULT_TOKEN_REFRESH_LEEWAY_MS;
		this.shareJobMaxPolls = options.shareJobMaxPolls ?? DEFAULT_SHARE_JOB_MAX_POLLS;
		this.shareJobPollDelayMs = options.shareJobPollDelayMs ?? DEFAULT_SHARE_JOB_POLL_DELAY_MS;
	}

	getAuthUrl(state: string, codeChallenge: string): string {
		const url = new URL(DROPBOX_AUTHORIZE_URL);
		url.searchParams.set('client_id', this.clientId);
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('code_challenge', codeChallenge);
		url.searchParams.set('code_challenge_method', 'S256');
		url.searchParams.set('token_access_type', 'offline');
		url.searchParams.set('state', state);
		url.searchParams.set('redirect_uri', this.redirectUri);
		if (this.scopes.length > 0) url.searchParams.set('scope', this.scopes.join(' '));
		return url.toString();
	}

	async exchangeCode(code: string, codeVerifier: string): Promise<CloudCredentials> {
		if (!code.trim())
			throw providerError(
				'reauthorization-required',
				'Dropbox authorization code is required.'
			);
		if (!codeVerifier.trim()) {
			throw providerError(
				'reauthorization-required',
				'Dropbox PKCE code verifier is required.'
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
		if (!refreshToken.trim())
			throw providerError('reauthorization-required', 'Dropbox refresh token is required.');
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

	async createFolder(folderName: string, parentFolderId = this.rootPath): Promise<string> {
		const path = joinDropboxPath(parentFolderId, folderName);
		try {
			const response = await this.requestApi<{ metadata?: unknown }>(
				'files/create_folder_v2',
				{
					path,
					autorename: false,
				},
				'create-folder'
			);
			const metadata = requireDropboxMetadata(response.metadata, 'create-folder');
			return metadataPathHandle(metadata);
		} catch (error) {
			if (isExistingDropboxFolderConflict(error)) return path.toLowerCase();
			throw error;
		}
	}

	async shareFolder(
		folderId: string,
		inviteeEmail: string,
		role: 'viewer' | 'editor'
	): Promise<void> {
		const email = inviteeEmail.trim();
		if (!email) throw providerError('permission-denied', 'Dropbox invitee email is required.');

		const shareResult = await this.requestApi<DropboxShareFolderResponse>(
			'sharing/share_folder',
			{ path: normalizeDropboxPath(folderId) },
			'share-folder'
		);
		const sharedFolderId = await this.resolveSharedFolderId(shareResult);
		await this.requestApi(
			'sharing/add_folder_member',
			{
				shared_folder_id: sharedFolderId,
				members: [
					{
						member: { '.tag': 'email', email },
						access_level: { '.tag': role },
					},
				],
				quiet: false,
			},
			'add-folder-member'
		);
	}

	async listFiles(
		folderId: string,
		options: { recursive?: boolean; cursor?: string } = {}
	): Promise<CloudListResult> {
		const decodedCursor = decodeDropboxCursor(options.cursor);
		const basePath = decodedCursor?.basePath ?? normalizeDropboxPath(folderId);
		let cursor = decodedCursor?.cursor;
		const entries: CloudFileMetadata[] = [];
		let hasMore = true;

		while (hasMore) {
			const page = cursor
				? await this.requestApi<DropboxListResponse>(
						'files/list_folder/continue',
						{ cursor },
						'list-files'
					)
				: await this.requestApi<DropboxListResponse>(
						'files/list_folder',
						{
							path: basePath,
							recursive: options.recursive ?? false,
							include_deleted: false,
							include_mounted_folders: true,
							include_non_downloadable_files: true,
						},
						'list-files'
					);
			entries.push(...parseDropboxEntries(page.entries, basePath));
			cursor = requireString(page.cursor, 'Dropbox list cursor', 'list-files');
			hasMore = page.has_more === true;
		}

		return {
			entries,
			cursor: cursor
				? encodeDropboxCursor({ provider: 'dropbox', cursor, basePath })
				: undefined,
			hasMore: false,
		};
	}

	async downloadFile(fileId: string): Promise<string> {
		const accessToken = await this.getAccessTokenForRequest();
		return this.requestText(
			`${DROPBOX_CONTENT_BASE_URL}/files/download`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Dropbox-API-Arg': JSON.stringify({ path: normalizeDropboxPath(fileId) }),
				},
			},
			'download-file'
		);
	}

	async createFile(folderId: string, path: string, content: string): Promise<CloudWriteResult> {
		const fullPath = joinDropboxPath(folderId, path);
		const metadata = await this.upload(fullPath, content, { '.tag': 'add' }, 'create-file');
		return toWriteResult(metadata, normalizeDropboxPath(folderId));
	}

	async updateFile(
		fileId: string,
		content: string,
		expectedRevision: string
	): Promise<CloudWriteResult> {
		if (!expectedRevision.trim()) {
			throw providerError('conflict', 'Dropbox expected revision is required for updates.');
		}
		const metadata = await this.upload(
			normalizeDropboxPath(fileId),
			content,
			{ '.tag': 'update', update: expectedRevision },
			'update-file'
		);
		return toWriteResult(metadata, this.rootPath);
	}

	async deleteFile(fileId: string, expectedRevision?: string): Promise<void> {
		const path = normalizeDropboxPath(fileId);
		if (expectedRevision !== undefined) {
			const metadata = await this.getMetadata(path);
			if (metadata['.tag'] !== 'file' || metadata.rev !== expectedRevision) {
				throw providerError('conflict', 'Dropbox file revision changed before delete.', {
					expectedRevision,
					actualRevision: metadata['.tag'] === 'file' ? metadata.rev : undefined,
				});
			}
		}
		await this.requestApi('files/delete_v2', { path }, 'delete-file');
	}

	private async requestToken(
		params: Record<string, string>,
		operation: 'token-exchange' | 'token-refresh',
		fallbackRefreshToken?: string
	): Promise<CloudCredentials> {
		const body = new URLSearchParams(params);
		const response = await this.requestJson<DropboxTokenResponse>(
			DROPBOX_TOKEN_URL,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body,
			},
			operation
		);
		return parseCredentials(response, this.now(), fallbackRefreshToken, operation);
	}

	private async resolveSharedFolderId(response: DropboxShareFolderResponse): Promise<string> {
		if (response['.tag'] === 'complete') {
			return requireString(
				response.shared_folder_id,
				'Dropbox shared folder ID',
				'share-folder'
			);
		}
		if (response['.tag'] !== 'async_job_id') {
			throw providerError(
				'unknown',
				'Dropbox share_folder returned an unexpected response.',
				response
			);
		}

		const asyncJobId = requireString(
			response.async_job_id,
			'Dropbox share job ID',
			'share-folder'
		);
		for (let attempt = 0; attempt < this.shareJobMaxPolls; attempt += 1) {
			if (attempt > 0 && this.shareJobPollDelayMs > 0) await delay(this.shareJobPollDelayMs);
			const status = await this.requestApi<DropboxShareJobStatusResponse>(
				'sharing/check_share_job_status',
				{ async_job_id: asyncJobId },
				'share-folder'
			);
			if (status['.tag'] === 'complete') {
				return requireString(
					status.shared_folder_id,
					'Dropbox shared folder ID',
					'share-folder'
				);
			}
			if (status['.tag'] === 'failed') {
				throw providerError('unknown', 'Dropbox share_folder async job failed.', status);
			}
		}

		throw providerError('provider-unavailable', 'Dropbox folder sharing is still pending.', {
			asyncJobId,
			pending: true,
		});
	}

	private async getMetadata(path: string): Promise<DropboxMetadata> {
		return requireDropboxMetadata(
			await this.requestApi(
				'files/get_metadata',
				{
					path,
					include_deleted: false,
					include_media_info: false,
					include_has_explicit_shared_members: false,
				},
				'get-metadata'
			),
			'get-metadata'
		);
	}

	private async upload(
		path: string,
		content: string,
		mode: { '.tag': 'add' } | { '.tag': 'update'; update: string },
		operation: 'create-file' | 'update-file'
	): Promise<DropboxFileMetadata> {
		const accessToken = await this.getAccessTokenForRequest();
		const metadata = await this.requestJson<unknown>(
			`${DROPBOX_CONTENT_BASE_URL}/files/upload`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/octet-stream',
					'Dropbox-API-Arg': JSON.stringify({
						path,
						mode,
						autorename: false,
						mute: false,
					}),
				},
				body: content,
			},
			operation
		);
		const fileMetadata = requireDropboxMetadata(metadata, operation);
		if (fileMetadata['.tag'] !== 'file') {
			throw providerError(
				'unknown',
				'Dropbox upload did not return file metadata.',
				fileMetadata
			);
		}
		return fileMetadata;
	}

	private async requestApi<T>(
		endpoint: string,
		body: unknown,
		operation: DropboxOperation
	): Promise<T> {
		const accessToken = await this.getAccessTokenForRequest();
		return this.requestJson<T>(
			`${DROPBOX_API_BASE_URL}/${endpoint}`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
			},
			operation
		);
	}

	private async requestJson<T>(
		url: string,
		init: RequestInit,
		operation: DropboxOperation
	): Promise<T> {
		const response = await this.fetchResponse(url, init, operation);
		if (response.status === 204) return undefined as T;
		const text = await response.text();
		if (!text.trim()) return undefined as T;
		try {
			return JSON.parse(text) as T;
		} catch {
			throw providerError('unknown', `Dropbox ${operation} returned invalid JSON.`, {
				status: response.status,
				operation,
			});
		}
	}

	private async requestText(
		url: string,
		init: RequestInit,
		operation: DropboxOperation
	): Promise<string> {
		const response = await this.fetchResponse(url, init, operation);
		return response.text();
	}

	private async fetchResponse(
		url: string,
		init: RequestInit,
		operation: DropboxOperation
	): Promise<Response> {
		let response: Response;
		try {
			response = await this.fetch(url, init);
		} catch (error) {
			throw providerError('provider-unavailable', `Dropbox ${operation} request failed.`, {
				operation,
				cause: error instanceof Error ? error.message : String(error),
			});
		}
		if (!response.ok) throw await mapDropboxError(response, operation);
		return response;
	}

	private async getAccessTokenForRequest(): Promise<string> {
		if (!this.credentials?.accessToken) {
			throw providerError('reauthorization-required', 'Dropbox credentials are missing.');
		}
		if (
			this.credentials.expiresAt &&
			this.credentials.expiresAt <= this.now() + this.tokenRefreshLeewayMs
		) {
			if (!this.credentials.refreshToken) {
				throw providerError(
					'reauthorization-required',
					'Dropbox refresh token is missing.'
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
	response: DropboxTokenResponse,
	now: number,
	fallbackRefreshToken: string | undefined,
	operation: DropboxOperation
): CloudCredentials {
	if (typeof response.access_token !== 'string' || !response.access_token) {
		throw providerError('unknown', 'Dropbox token response did not include an access token.', {
			operation,
		});
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

function parseDropboxEntries(entries: unknown, basePath: string): CloudFileMetadata[] {
	if (!Array.isArray(entries)) return [];
	return entries.map(entry => toMetadata(requireDropboxMetadata(entry, 'list-files'), basePath));
}

function toMetadata(metadata: DropboxMetadata, basePath: string): CloudFileMetadata {
	const path = metadataDisplayPath(metadata);
	const id = metadataPathHandle(metadata);
	return {
		id,
		path: relativeDropboxPath(path, basePath),
		name: metadata.name,
		revision: metadata['.tag'] === 'file' ? metadata.rev : id,
		modifiedAt: metadata['.tag'] === 'file' ? metadata.server_modified : FOLDER_MODIFIED_AT,
		size: metadata['.tag'] === 'file' ? metadata.size : 0,
		isFolder: metadata['.tag'] === 'folder',
		isDeleted: metadata['.tag'] === 'deleted' || undefined,
	};
}

function toWriteResult(metadata: DropboxFileMetadata, basePath: string): CloudWriteResult {
	return {
		id: metadataPathHandle(metadata),
		path: relativeDropboxPath(metadataDisplayPath(metadata), basePath),
		revision: metadata.rev,
		modifiedAt: metadata.server_modified,
		size: metadata.size,
	};
}

function requireDropboxMetadata(value: unknown, operation: DropboxOperation): DropboxMetadata {
	if (!value || typeof value !== 'object') {
		throw providerError('unknown', 'Dropbox response did not include metadata.', { operation });
	}
	const metadata = value as Partial<DropboxMetadata>;
	if (
		metadata['.tag'] === 'file' &&
		typeof metadata.name === 'string' &&
		typeof metadata.rev === 'string'
	) {
		return metadata as DropboxFileMetadata;
	}
	if (metadata['.tag'] === 'folder' && typeof metadata.name === 'string') {
		return metadata as DropboxFolderMetadata;
	}
	if (metadata['.tag'] === 'deleted' && typeof metadata.name === 'string') {
		return metadata as DropboxDeletedMetadata;
	}
	throw providerError('unknown', 'Dropbox response metadata had an unexpected shape.', {
		operation,
		metadata,
	});
}

function metadataPathHandle(metadata: DropboxMetadata): string {
	const id = metadata['.tag'] === 'deleted' ? undefined : metadata.id;
	return normalizeDropboxPath(
		metadata.path_lower ?? metadata.path_display ?? id ?? metadata.name
	).toLowerCase();
}

function metadataDisplayPath(metadata: DropboxMetadata): string {
	return normalizeDropboxPath(metadata.path_display ?? metadata.path_lower ?? metadata.name);
}

function normalizeDropboxPath(path: string): string {
	const trimmed = path.trim();
	if (!trimmed || trimmed === '/') return '';
	const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
	const normalized = prefixed.replace(/\/+/g, '/').replace(/\/$/, '');
	for (const segment of normalized.split('/').filter(Boolean)) {
		if (segment === '.' || segment === '..') {
			throw providerError(
				'unknown',
				`Invalid Dropbox path segment ${JSON.stringify(segment)}.`
			);
		}
	}
	return normalized;
}

function normalizeRelativeDropboxPath(path: string): string {
	const segments = path
		.trim()
		.split('/')
		.map(segment => segment.trim())
		.filter(Boolean);
	if (segments.length === 0) throw providerError('unknown', 'Dropbox file path is required.');
	for (const segment of segments) {
		if (segment === '.' || segment === '..') {
			throw providerError(
				'unknown',
				`Invalid Dropbox path segment ${JSON.stringify(segment)}.`
			);
		}
	}
	return segments.join('/');
}

function joinDropboxPath(parentPath: string, childPath: string): string {
	const parent = normalizeDropboxPath(parentPath);
	const child = normalizeRelativeDropboxPath(childPath);
	return normalizeDropboxPath(parent ? `${parent}/${child}` : child);
}

function relativeDropboxPath(path: string, basePath: string): string {
	const normalizedPath = normalizeDropboxPath(path);
	const normalizedBase = normalizeDropboxPath(basePath);
	if (!normalizedBase) return normalizedPath.replace(/^\//, '');
	if (normalizedPath.toLowerCase() === normalizedBase.toLowerCase()) return '';
	const basePrefix = `${normalizedBase}/`.toLowerCase();
	if (normalizedPath.toLowerCase().startsWith(basePrefix)) {
		return normalizedPath.slice(normalizedBase.length + 1);
	}
	return normalizedPath.replace(/^\//, '');
}

function encodeDropboxCursor(token: DropboxCursorToken): string {
	return JSON.stringify(token);
}

function decodeDropboxCursor(cursor: string | undefined): DropboxCursorToken | null {
	if (!cursor) return null;
	try {
		const parsed: unknown = JSON.parse(cursor);
		if (!parsed || typeof parsed !== 'object') return null;
		const token = parsed as Partial<DropboxCursorToken>;
		if (
			token.provider !== 'dropbox' ||
			typeof token.cursor !== 'string' ||
			typeof token.basePath !== 'string'
		) {
			return null;
		}
		return {
			provider: 'dropbox',
			cursor: token.cursor,
			basePath: normalizeDropboxPath(token.basePath),
		};
	} catch {
		return null;
	}
}

function requireString(value: unknown, label: string, operation: DropboxOperation): string {
	if (typeof value !== 'string' || !value) {
		throw providerError('unknown', `${label} was missing from the Dropbox response.`, {
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

async function mapDropboxError(
	response: Response,
	operation: DropboxOperation
): Promise<CloudProviderError> {
	const bodyText = await response.text();
	const parsedBody = parseResponseBody(bodyText);
	const body =
		typeof parsedBody === 'object' && parsedBody !== null
			? (parsedBody as Record<string, unknown>)
			: {};
	const errorSummary = typeof body.error_summary === 'string' ? body.error_summary : undefined;
	const errorTag = getDropboxErrorTag(body.error);
	const details: DropboxErrorDetails = {
		status: response.status,
		operation,
		errorSummary,
		errorTag,
		error: body.error,
		requestId: response.headers.get('x-dropbox-request-id'),
		retryAfter: response.headers.get('retry-after'),
		body: parsedBody,
	};
	const code = mapDropboxErrorCode(response.status, body, errorSummary, errorTag);
	return providerError(code, dropboxErrorMessage(code, operation), details);
}

function parseResponseBody(text: string): unknown {
	if (!text.trim()) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function getDropboxErrorTag(error: unknown): string | undefined {
	if (!error || typeof error !== 'object') return undefined;
	const tag = (error as Record<string, unknown>)['.tag'];
	return typeof tag === 'string' ? tag : undefined;
}

function mapDropboxErrorCode(
	status: number,
	body: Record<string, unknown>,
	errorSummary: string | undefined,
	errorTag: string | undefined
): CloudProviderErrorCode {
	const summary = errorSummary?.toLowerCase() ?? '';
	const oauthError = typeof body.error === 'string' ? body.error : undefined;
	if (status === 401 || oauthError === 'invalid_grant' || oauthError === 'invalid_token') {
		return 'reauthorization-required';
	}
	if (status === 403 || oauthError === 'invalid_scope' || summary.includes('no_permission')) {
		return 'permission-denied';
	}
	if (status === 429 || summary.includes('too_many_write_operations')) return 'rate-limited';
	if (status >= 500) return 'provider-unavailable';
	if (status === 409) {
		if (
			summary.includes('not_found') ||
			summary.includes('/not_file') ||
			summary.includes('/not_folder')
		) {
			return 'not-found';
		}
		if (summary.includes('no_write_permission')) return 'permission-denied';
		if (summary.includes('conflict') || errorTag === 'path') return 'conflict';
	}
	if (status === 404) return 'not-found';
	return 'unknown';
}

function dropboxErrorMessage(code: CloudProviderErrorCode, operation: DropboxOperation): string {
	switch (code) {
		case 'conflict':
			return `Dropbox ${operation} conflict.`;
		case 'permission-denied':
			return `Dropbox ${operation} permission denied.`;
		case 'rate-limited':
			return `Dropbox ${operation} rate limited.`;
		case 'not-found':
			return `Dropbox ${operation} target was not found.`;
		case 'reauthorization-required':
			return `Dropbox ${operation} requires reauthorization.`;
		case 'provider-unavailable':
			return `Dropbox ${operation} is unavailable.`;
		case 'unknown':
			return `Dropbox ${operation} failed.`;
	}
}

function isExistingDropboxFolderConflict(error: unknown): boolean {
	if (!(error instanceof CloudProviderError) || error.code !== 'conflict') return false;
	const details = error.providerDetails;
	if (!details || typeof details !== 'object') return false;
	const summary = (details as { errorSummary?: unknown }).errorSummary;
	return typeof summary === 'string' && summary.toLowerCase().includes('conflict/folder');
}

function providerError(
	code: CloudProviderErrorCode,
	message: string,
	providerDetails?: unknown
): CloudProviderError {
	return new CloudProviderError(code, message, providerDetails);
}

function delay(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}
