import {
	CloudProviderError,
	isCloudProviderError,
	LOCATION_ROOT_FOLDER_ID,
	type CloudFileMetadata,
	type CloudListResult,
	type CloudProviderCapabilities,
	type CloudProviderErrorCode,
	type CloudStorageProvider,
	type CloudWriteResult,
} from './provider';

const API = 'https://api.dropboxapi.com/2';
const CONTENT_API = 'https://content.dropboxapi.com/2';

export interface AccessTokenSource {
	getAccessToken(): Promise<string>;
	refreshAccessToken(): Promise<string>;
}

export interface DropboxStorageProviderOptions {
	rootPath: string;
	tokens: AccessTokenSource;
	rootNamespaceId?: string;
	fetch?: typeof fetch;
	pageSize?: number;
}

interface DropboxMetadata {
	'.tag': 'file' | 'folder' | 'deleted';
	name: string;
	path_lower: string;
	path_display: string;
	rev?: string;
	server_modified?: string;
	size?: number;
}

interface DropboxListResult {
	entries: DropboxMetadata[];
	cursor: string;
	has_more: boolean;
}

export class DropboxStorageProvider implements CloudStorageProvider {
	id = 'dropbox';
	name = 'Dropbox';
	capabilities: CloudProviderCapabilities = { supportsExpectedRevisionDelete: true };

	readonly rootFolderId = LOCATION_ROOT_FOLDER_ID;
	private readonly rootPath: string;
	private readonly fetch: typeof fetch;

	constructor(private readonly options: DropboxStorageProviderOptions) {
		this.rootPath = options.rootPath.replace(/\/+$/, '');
		this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
	}

	async createFolder(folderName: string, parentFolderId = this.rootFolderId): Promise<string> {
		const id = joinId(parentFolderId, normalizeSegments(folderName).join('/'));
		try {
			await this.rpc('files/create_folder_v2', { path: this.apiPath(id), autorename: false });
		} catch (error) {
			if (!isCloudProviderError(error, 'conflict')) throw error;
			const existing = await this.metadata(id);
			if (existing?.['.tag'] !== 'folder') throw error;
		}
		return id;
	}

	async listFiles(
		folderId: string,
		options: { recursive?: boolean; cursor?: string } = {}
	): Promise<CloudListResult> {
		const folderPath = this.apiPath(folderId).toLowerCase();
		const result = (
			options.cursor
				? await this.rpc('files/list_folder/continue', { cursor: options.cursor })
				: await this.rpc('files/list_folder', {
						path: this.apiPath(folderId),
						recursive: options.recursive === true,
						include_deleted: false,
						...(this.options.pageSize ? { limit: this.options.pageSize } : {}),
					})
		) as DropboxListResult;
		return {
			entries: result.entries
				.filter(entry => entry.path_lower !== folderPath)
				.map(entry => this.toMetadata(entry)),
			cursor: result.cursor,
			hasMore: result.has_more,
		};
	}

	async downloadFile(fileId: string): Promise<string> {
		const response = await this.request(`${CONTENT_API}/files/download`, {
			'Dropbox-API-Arg': headerJson({ path: this.apiPath(fileId) }),
		});
		return response.text();
	}

	async createFile(folderId: string, path: string, content: string): Promise<CloudWriteResult> {
		return this.upload(joinId(folderId, normalizeSegments(path).join('/')), content, 'add');
	}

	async updateFile(
		fileId: string,
		content: string,
		expectedRevision: string
	): Promise<CloudWriteResult> {
		return this.upload(fileId, content, { '.tag': 'update', update: expectedRevision });
	}

	async deleteFile(fileId: string, expectedRevision?: string): Promise<void> {
		try {
			await this.rpc('files/delete_v2', {
				path: this.apiPath(fileId),
				...(expectedRevision ? { parent_rev: expectedRevision } : {}),
			});
		} catch (error) {
			if (!expectedRevision || !isCloudProviderError(error)) throw error;
			if (!['not-found', 'conflict', 'unknown'].includes(error.code)) throw error;
			const current = await this.metadata(fileId);
			if (current && current.rev !== expectedRevision) {
				throw new CloudProviderError(
					'conflict',
					`Expected revision ${expectedRevision}, found ${current.rev}.`
				);
			}
			throw error;
		}
	}

	private async upload(
		id: string,
		content: string,
		mode: 'add' | { '.tag': 'update'; update: string }
	): Promise<CloudWriteResult> {
		const response = await this.request(
			`${CONTENT_API}/files/upload`,
			{
				'Content-Type': 'application/octet-stream',
				'Dropbox-API-Arg': headerJson({
					path: this.apiPath(id),
					mode,
					autorename: false,
					mute: true,
					strict_conflict: true,
				}),
			},
			content
		);
		const entry = this.toMetadata((await response.json()) as DropboxMetadata);
		return {
			id: entry.id,
			path: entry.path,
			revision: entry.revision,
			modifiedAt: entry.modifiedAt,
			size: entry.size,
		};
	}

	private async metadata(id: string): Promise<DropboxMetadata | null> {
		try {
			return (await this.rpc('files/get_metadata', {
				path: this.apiPath(id),
			})) as DropboxMetadata;
		} catch (error) {
			if (isCloudProviderError(error, 'not-found')) return null;
			throw error;
		}
	}

	private async rpc(endpoint: string, args: unknown): Promise<unknown> {
		const response = await this.request(
			`${API}/${endpoint}`,
			{ 'Content-Type': 'application/json' },
			JSON.stringify(args)
		);
		return response.json();
	}

	private async request(
		url: string,
		headers: Record<string, string>,
		body?: string
	): Promise<Response> {
		let response = await this.send(
			url,
			headers,
			body,
			await this.options.tokens.getAccessToken()
		);
		if (response.status === 401) {
			response = await this.send(
				url,
				headers,
				body,
				await this.options.tokens.refreshAccessToken()
			);
		}
		if (response.ok) return response;
		throw await responseError(response);
	}

	private async send(
		url: string,
		headers: Record<string, string>,
		body: string | undefined,
		accessToken: string
	): Promise<Response> {
		try {
			return await this.fetch(url, {
				method: 'POST',
				headers: {
					...headers,
					...(this.options.rootNamespaceId
						? {
								'Dropbox-API-Path-Root': JSON.stringify({
									'.tag': 'root',
									root: this.options.rootNamespaceId,
								}),
							}
						: {}),
					Authorization: `Bearer ${accessToken}`,
				},
				body,
			});
		} catch (error) {
			throw new CloudProviderError('provider-unavailable', 'Dropbox is unreachable.', error);
		}
	}

	private apiPath(id: string): string {
		return id === LOCATION_ROOT_FOLDER_ID ? this.rootPath : `${this.rootPath}/${id}`;
	}

	private toMetadata(entry: DropboxMetadata): CloudFileMetadata {
		const path = entry.path_display.slice(this.rootPath.length + 1);
		return {
			id: path,
			path,
			name: entry.name,
			revision: entry.rev ?? entry['.tag'],
			modifiedAt: entry.server_modified ?? new Date(0).toISOString(),
			size: entry.size ?? 0,
			isFolder: entry['.tag'] === 'folder',
			isDeleted: entry['.tag'] === 'deleted' || undefined,
		};
	}
}

async function responseError(response: Response): Promise<CloudProviderError> {
	const text = await response.text();
	const summary = errorSummary(text);
	return new CloudProviderError(errorCode(response.status, summary), `Dropbox: ${summary}`, {
		status: response.status,
		body: text,
	});
}

function errorSummary(text: string): string {
	try {
		return (JSON.parse(text) as { error_summary?: string }).error_summary ?? text;
	} catch {
		return text;
	}
}

function errorCode(status: number, summary: string): CloudProviderErrorCode {
	if (status === 401) return 'reauthorization-required';
	if (status === 403) return 'permission-denied';
	if (status === 429) return 'rate-limited';
	if (status >= 500) return 'provider-unavailable';
	if (status !== 409) return 'unknown';
	if (/not_found/.test(summary)) return 'not-found';
	if (/conflict/.test(summary)) return 'conflict';
	if (/no_write_permission|insufficient_space|disallowed_name/.test(summary)) {
		return 'permission-denied';
	}
	return 'unknown';
}

/** Dropbox-API-Arg must be ASCII, so non-ASCII characters are JSON-escaped. */
function headerJson(value: unknown): string {
	return JSON.stringify(value).replace(
		/[\u007f-￿]/g,
		char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
	);
}

function normalizeSegments(path: string): string[] {
	const segments = path
		.split('/')
		.map(segment => segment.trim())
		.filter(Boolean);
	if (segments.length === 0 || segments.some(segment => segment === '.' || segment === '..')) {
		throw new CloudProviderError('unknown', `Invalid Dropbox path ${JSON.stringify(path)}.`);
	}
	return segments;
}

function joinId(parentId: string, relative: string): string {
	return parentId === LOCATION_ROOT_FOLDER_ID ? relative : `${parentId}/${relative}`;
}
