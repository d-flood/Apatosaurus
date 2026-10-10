import type { AccessTokenSource } from './dropbox-provider';
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

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,mimeType,parents,headRevisionId,modifiedTime,size,trashed';
const WALK_CURSOR = 'walk:';
const CHANGES_CURSOR = 'changes:';

export interface GoogleDriveStorageProviderOptions {
	driveRootId: string;
	sharedDriveId?: string;
	tokens: AccessTokenSource;
	fetch?: typeof fetch;
	pageSize?: number;
}

interface DriveFile {
	id: string;
	name: string;
	mimeType: string;
	parents?: string[];
	headRevisionId?: string;
	modifiedTime?: string;
	size?: string;
	trashed?: boolean;
}

export interface DriveFolder {
	name: string;
	sharedDriveId?: string;
}

interface DriveChange {
	fileId: string;
	removed?: boolean;
	file?: DriveFile;
}

interface DriveRequest {
	params?: Record<string, string>;
	headers?: Record<string, string>;
	body?: string;
}

interface WalkState {
	startPageToken: string;
	recursive: boolean;
	queue: Array<{ driveId: string; path: string; pageToken?: string }>;
}

export class GoogleDriveStorageProvider implements CloudStorageProvider {
	id = 'google';
	name = 'Google Drive';
	capabilities: CloudProviderCapabilities = { supportsExpectedRevisionDelete: true };

	readonly rootFolderId = LOCATION_ROOT_FOLDER_ID;
	private readonly fetch: typeof fetch;
	private readonly driveIds = new Map<string, string>();
	private readonly paths = new Map<string, string>();

	constructor(private readonly options: GoogleDriveStorageProviderOptions) {
		this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
		this.remember(LOCATION_ROOT_FOLDER_ID, options.driveRootId);
	}

	async createFolder(folderName: string, parentFolderId = this.rootFolderId): Promise<string> {
		let path = parentFolderId;
		let parentDriveId = await this.folderDriveId(parentFolderId);
		for (const segment of normalizeSegments(folderName)) {
			path = joinId(path, segment);
			const existing = await this.findChild(parentDriveId, segment);
			if (existing && existing.mimeType !== FOLDER_MIME_TYPE) {
				throw new CloudProviderError('conflict', `${path} is a file, not a folder.`);
			}
			const folder =
				existing ??
				((await this.json('POST', `${API}/files`, {
					body: JSON.stringify({
						name: segment,
						mimeType: FOLDER_MIME_TYPE,
						parents: [parentDriveId],
					}),
					headers: { 'Content-Type': 'application/json' },
					params: { fields: FILE_FIELDS },
				})) as DriveFile);
			this.remember(path, folder.id);
			parentDriveId = folder.id;
		}
		return path;
	}

	async folderDriveId(folderId: string): Promise<string> {
		const driveId = await this.driveId(folderId);
		if (folderId !== LOCATION_ROOT_FOLDER_ID) {
			const file = await this.getFile(driveId);
			if (file.mimeType !== FOLDER_MIME_TYPE) {
				throw new CloudProviderError('not-found', `${folderId} is not a folder.`);
			}
		}
		return driveId;
	}

	async describeFolder(driveFileId: string): Promise<DriveFolder> {
		const file = (await this.json('GET', `${API}/files/${driveFileId}`, {
			params: { fields: 'id,name,mimeType,driveId' },
		})) as DriveFile & { driveId?: string };
		if (file.mimeType !== FOLDER_MIME_TYPE) {
			throw new CloudProviderError('not-found', `${file.name} is not a folder.`);
		}
		return { name: file.name, ...(file.driveId ? { sharedDriveId: file.driveId } : {}) };
	}

	async listFiles(
		folderId: string,
		options: { recursive?: boolean; cursor?: string } = {}
	): Promise<CloudListResult> {
		if (options.cursor?.startsWith(CHANGES_CURSOR)) {
			return this.listChanges(folderId, options.recursive === true, options.cursor);
		}
		const state: WalkState = options.cursor
			? decodeWalk(options.cursor)
			: {
					startPageToken: (
						(await this.json('GET', `${API}/changes/startPageToken`, {
							params: this.changesScope(),
						})) as { startPageToken: string }
					).startPageToken,
					recursive: options.recursive === true,
					queue: [
						{
							driveId: await this.folderDriveId(folderId),
							path: folderId === LOCATION_ROOT_FOLDER_ID ? '' : folderId,
						},
					],
				};
		const [folder] = state.queue;
		const page = (await this.json('GET', `${API}/files`, {
			params: {
				q: `'${escapeQuery(folder.driveId)}' in parents and trashed = false`,
				fields: `nextPageToken,files(${FILE_FIELDS})`,
				orderBy: 'name',
				includeItemsFromAllDrives: 'true',
				...(this.options.pageSize ? { pageSize: String(this.options.pageSize) } : {}),
				...(folder.pageToken ? { pageToken: folder.pageToken } : {}),
			},
		})) as { files: DriveFile[]; nextPageToken?: string };
		const entries = page.files.map(file => {
			const path = folder.path ? `${folder.path}/${file.name}` : file.name;
			this.remember(path, file.id);
			return toMetadata(file, path);
		});
		const queue = [
			...(page.nextPageToken ? [{ ...folder, pageToken: page.nextPageToken }] : []),
			...state.queue.slice(1),
			...(state.recursive
				? entries
						.filter(entry => entry.isFolder)
						.map(entry => ({ driveId: this.driveIds.get(entry.id)!, path: entry.path }))
				: []),
		];
		return queue.length > 0
			? {
					entries,
					cursor: encodeWalk({ ...state, queue }),
					hasMore: true,
				}
			: { entries, cursor: `${CHANGES_CURSOR}${state.startPageToken}`, hasMore: false };
	}

	async downloadFile(fileId: string): Promise<string> {
		const response = await this.request('GET', `${API}/files/${await this.driveId(fileId)}`, {
			params: { alt: 'media' },
		});
		return response.text();
	}

	async createFile(folderId: string, path: string, content: string): Promise<CloudWriteResult> {
		const segments = normalizeSegments(path);
		const name = segments.pop()!;
		const parentId = segments.length
			? await this.createFolder(segments.join('/'), folderId)
			: folderId;
		const parentDriveId = await this.folderDriveId(parentId);
		const id = joinId(parentId, name);
		if (await this.findChild(parentDriveId, name)) {
			throw new CloudProviderError('conflict', `${id} already exists.`);
		}
		const boundary = `apatosaurus-${crypto.randomUUID()}`;
		const file = (await this.json('POST', `${UPLOAD_API}/files`, {
			params: { uploadType: 'multipart', fields: FILE_FIELDS },
			headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
			body: [
				`--${boundary}`,
				'Content-Type: application/json; charset=UTF-8',
				'',
				JSON.stringify({ name, parents: [parentDriveId] }),
				`--${boundary}`,
				'Content-Type: application/octet-stream',
				'',
				content,
				`--${boundary}--`,
			].join('\r\n'),
		})) as DriveFile;
		this.remember(id, file.id);
		return toWriteResult(file, id);
	}

	/** Drive v3 has no ETag/If-Match on files, so the revision is checked just before writing; the race window is covered by Drive's revision history. */
	async updateFile(
		fileId: string,
		content: string,
		expectedRevision: string
	): Promise<CloudWriteResult> {
		const driveId = await this.driveId(fileId);
		await this.assertRevision(driveId, fileId, expectedRevision);
		const file = (await this.json('PATCH', `${UPLOAD_API}/files/${driveId}`, {
			params: { uploadType: 'media', fields: FILE_FIELDS },
			headers: { 'Content-Type': 'application/octet-stream' },
			body: content,
		})) as DriveFile;
		return toWriteResult(file, fileId);
	}

	async deleteFile(fileId: string, expectedRevision?: string): Promise<void> {
		const driveId = await this.driveId(fileId);
		if (expectedRevision) await this.assertRevision(driveId, fileId, expectedRevision);
		await this.request('PATCH', `${API}/files/${driveId}`, {
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ trashed: true }),
		});
		for (const path of [...this.driveIds.keys()]) {
			if (path === fileId || path.startsWith(`${fileId}/`)) this.driveIds.delete(path);
		}
	}

	private async listChanges(
		folderId: string,
		recursive: boolean,
		cursor: string
	): Promise<CloudListResult> {
		const page = (await this.json('GET', `${API}/changes`, {
			params: {
				pageToken: cursor.slice(CHANGES_CURSOR.length),
				fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
				includeItemsFromAllDrives: 'true',
				...this.changesScope(),
				...(this.options.pageSize ? { pageSize: String(this.options.pageSize) } : {}),
			},
		})) as { changes: DriveChange[]; nextPageToken?: string; newStartPageToken?: string };
		const prefix = folderId === LOCATION_ROOT_FOLDER_ID ? '' : `${folderId}/`;
		const entries: CloudFileMetadata[] = [];
		for (const change of page.changes) {
			const deleted = change.removed || !change.file || change.file.trashed;
			const path = deleted ? this.paths.get(change.fileId) : await this.pathOf(change.file!);
			if (!path || path === LOCATION_ROOT_FOLDER_ID || !path.startsWith(prefix)) continue;
			if (!recursive && path.slice(prefix.length).includes('/')) continue;
			if (deleted) {
				this.forget(path);
				entries.push({
					...toMetadata(
						change.file ?? { id: change.fileId, name: '', mimeType: '' },
						path
					),
					isDeleted: true,
				});
			} else {
				this.remember(path, change.fileId);
				entries.push(toMetadata(change.file!, path));
			}
		}
		return {
			entries,
			cursor: `${CHANGES_CURSOR}${page.nextPageToken ?? page.newStartPageToken}`,
			hasMore: Boolean(page.nextPageToken),
		};
	}

	private changesScope(): Record<string, string> {
		return this.options.sharedDriveId ? { driveId: this.options.sharedDriveId } : {};
	}

	private async pathOf(file: DriveFile): Promise<string | undefined> {
		const known = this.paths.get(file.id);
		if (known !== undefined) return known;
		const parentId = file.parents?.[0];
		if (!parentId) return undefined;
		const parent = this.paths.has(parentId)
			? { id: parentId, name: '', mimeType: FOLDER_MIME_TYPE }
			: await this.getFile(parentId).catch(error => {
					if (isCloudProviderError(error, 'not-found')) return null;
					throw error;
				});
		const parentPath = parent ? await this.pathOf(parent) : undefined;
		if (parentPath === undefined) return undefined;
		return parentPath === LOCATION_ROOT_FOLDER_ID ? file.name : `${parentPath}/${file.name}`;
	}

	private async assertRevision(driveId: string, id: string, expectedRevision: string) {
		const current = await this.getFile(driveId);
		if (current.headRevisionId !== expectedRevision) {
			throw new CloudProviderError(
				'conflict',
				`Expected revision ${expectedRevision} of ${id}, found ${current.headRevisionId}.`
			);
		}
	}

	private async driveId(id: string): Promise<string> {
		const cached = this.driveIds.get(id);
		if (cached) return cached;
		let path = LOCATION_ROOT_FOLDER_ID;
		let driveId = this.options.driveRootId;
		for (const segment of normalizeSegments(id)) {
			path = joinId(path, segment);
			const known = this.driveIds.get(path);
			const child = known ? { id: known } : await this.findChild(driveId, segment);
			if (!child) throw new CloudProviderError('not-found', `Google Drive: ${id} not found.`);
			this.remember(path, child.id);
			driveId = child.id;
		}
		return driveId;
	}

	private async findChild(parentDriveId: string, name: string): Promise<DriveFile | null> {
		const page = (await this.json('GET', `${API}/files`, {
			params: {
				q: `'${escapeQuery(parentDriveId)}' in parents and name = '${escapeQuery(name)}' and trashed = false`,
				fields: `files(${FILE_FIELDS})`,
				includeItemsFromAllDrives: 'true',
			},
		})) as { files: DriveFile[] };
		return page.files[0] ?? null;
	}

	private async getFile(driveId: string): Promise<DriveFile> {
		return (await this.json('GET', `${API}/files/${driveId}`, {
			params: { fields: FILE_FIELDS },
		})) as DriveFile;
	}

	private remember(path: string, driveId: string): void {
		this.driveIds.set(path, driveId);
		this.paths.set(driveId, path);
	}

	private forget(path: string): void {
		const driveId = this.driveIds.get(path);
		this.driveIds.delete(path);
		if (driveId) this.paths.delete(driveId);
	}

	private async json(method: string, url: string, init: DriveRequest = {}): Promise<unknown> {
		return (await this.request(method, url, init)).json();
	}

	private async request(method: string, url: string, init: DriveRequest = {}): Promise<Response> {
		const target = new URL(url);
		for (const [key, value] of Object.entries({ ...init.params, supportsAllDrives: 'true' })) {
			target.searchParams.set(key, value);
		}
		const send = async (accessToken: string) => {
			try {
				return await this.fetch(target, {
					method,
					headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
					body: init.body,
				});
			} catch (error) {
				throw new CloudProviderError(
					'provider-unavailable',
					'Google Drive is unreachable.',
					error
				);
			}
		};
		let response = await send(await this.options.tokens.getAccessToken());
		if (response.status === 401) {
			response = await send(await this.options.tokens.refreshAccessToken());
		}
		if (response.ok) return response;
		throw await responseError(response);
	}
}

function toMetadata(file: DriveFile, path: string): CloudFileMetadata {
	const isFolder = file.mimeType === FOLDER_MIME_TYPE;
	return {
		id: path,
		path,
		name: file.name || path.slice(path.lastIndexOf('/') + 1),
		revision: file.headRevisionId ?? (isFolder ? 'folder' : ''),
		modifiedAt: file.modifiedTime ?? new Date(0).toISOString(),
		size: Number(file.size ?? 0),
		isFolder,
	};
}

function toWriteResult(file: DriveFile, path: string): CloudWriteResult {
	const { id, revision, modifiedAt, size } = toMetadata(file, path);
	return { id, path, revision, modifiedAt, size };
}

async function responseError(response: Response): Promise<CloudProviderError> {
	const text = await response.text();
	const error = parseError(text);
	const message = error?.message ?? text;
	const reasons = (error?.errors ?? []).map(detail => detail.reason ?? '');
	return new CloudProviderError(errorCode(response.status, reasons), `Google Drive: ${message}`, {
		status: response.status,
		body: text,
	});
}

function parseError(
	text: string
): { message?: string; errors?: Array<{ reason?: string }> } | undefined {
	try {
		return (JSON.parse(text) as { error?: ReturnType<typeof parseError> }).error;
	} catch {
		return undefined;
	}
}

function errorCode(status: number, reasons: string[]): CloudProviderErrorCode {
	if (status === 401) return 'reauthorization-required';
	if (status === 429) return 'rate-limited';
	if (status === 403) {
		return reasons.some(reason => /rateLimitExceeded/i.test(reason))
			? 'rate-limited'
			: 'permission-denied';
	}
	if (status === 404) return 'not-found';
	if (status === 409 || status === 412) return 'conflict';
	if (status >= 500) return 'provider-unavailable';
	return 'unknown';
}

function encodeWalk(state: WalkState): string {
	return `${WALK_CURSOR}${JSON.stringify(state)}`;
}

function decodeWalk(cursor: string): WalkState {
	if (!cursor.startsWith(WALK_CURSOR)) {
		throw new CloudProviderError('unknown', 'Unrecognised Google Drive cursor.');
	}
	return JSON.parse(cursor.slice(WALK_CURSOR.length)) as WalkState;
}

function escapeQuery(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function normalizeSegments(path: string): string[] {
	const segments = path
		.split('/')
		.map(segment => segment.trim())
		.filter(Boolean);
	if (segments.length === 0 || segments.some(segment => segment === '.' || segment === '..')) {
		throw new CloudProviderError(
			'unknown',
			`Invalid Google Drive path ${JSON.stringify(path)}.`
		);
	}
	return segments;
}

function joinId(parentId: string, relative: string): string {
	return parentId === LOCATION_ROOT_FOLDER_ID ? relative : `${parentId}/${relative}`;
}
