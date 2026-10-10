import { CloudProviderError } from './provider';
import type { AccessTokenSource } from './dropbox-provider';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

interface FakeFile {
	id: string;
	name: string;
	mimeType: string;
	parents: string[];
	content: string;
	driveId?: string;
	headRevisionId?: string;
	modifiedTime: string;
	trashed?: boolean;
}

export class FakeGoogleDriveApi {
	readonly myDriveId = 'my-drive-root';
	pageSize = 2;
	calls: string[] = [];
	missingSupportsAllDrives: string[] = [];
	changeRequests: URLSearchParams[] = [];
	private files = new Map<string, FakeFile>();
	private changes: Array<{ fileId: string; driveId?: string }> = [];
	private validTokens = new Set<string>();
	private refreshRevoked = false;
	private counter = 0;
	private currentToken: string | null = null;
	private failures: Array<{ call: string; status: number; reason: string }> = [];

	constructor() {
		this.files.set(this.myDriveId, {
			id: this.myDriveId,
			name: 'My Drive',
			mimeType: FOLDER_MIME_TYPE,
			parents: [],
			content: '',
			modifiedTime: this.now(),
		});
	}

	readonly tokens: AccessTokenSource = {
		getAccessToken: async () => this.currentToken ?? this.issueToken(),
		refreshAccessToken: async () => {
			if (this.refreshRevoked) {
				throw new CloudProviderError('reauthorization-required', 'Reconnect Google.');
			}
			return this.issueToken();
		},
	};

	readonly fetch: typeof fetch = async (input, init) => {
		const url = new URL(String(input));
		const method = init?.method ?? 'GET';
		const call = `${method} ${url.pathname.replace('/drive/v3', '')}`;
		this.calls.push(call);
		if (url.searchParams.get('supportsAllDrives') !== 'true') {
			this.missingSupportsAllDrives.push(call);
		}
		const token = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '');
		if (!token || !this.validTokens.has(token)) return driveError(401, 'authError');
		const failure = this.failures.findIndex(candidate => call.startsWith(candidate.call));
		if (failure !== -1) {
			const [{ status, reason }] = this.failures.splice(failure, 1);
			return driveError(status, reason);
		}
		return this.handle(method, url, String(init?.body ?? ''), init?.headers);
	};

	expireAccessTokens(): void {
		this.validTokens.clear();
	}

	revoke(): void {
		this.validTokens.clear();
		this.refreshRevoked = true;
	}

	failNext(call: string, status: number, reason = 'error'): void {
		this.failures.push({ call, status, reason });
	}

	/** Simulates another client writing the file directly. */
	touch(driveId: string, content: string): void {
		const file = this.files.get(driveId);
		if (!file) throw new Error(`No fake Drive file ${driveId}.`);
		this.write(file, content);
	}

	addSharedDrive(name: string): string {
		const id = `shared-drive-${++this.counter}`;
		this.files.set(id, {
			id,
			name,
			mimeType: FOLDER_MIME_TYPE,
			parents: [],
			content: '',
			driveId: id,
			modifiedTime: this.now(),
		});
		return id;
	}

	findByName(name: string): FakeFile | undefined {
		return [...this.files.values()].find(file => file.name === name);
	}

	private issueToken(): string {
		this.currentToken = `access-${++this.counter}`;
		this.validTokens.add(this.currentToken);
		return this.currentToken;
	}

	private handle(
		method: string,
		url: URL,
		body: string,
		headers: HeadersInit | undefined
	): Response {
		const path = url.pathname;
		const params = url.searchParams;
		if (path.startsWith('/drive/v3/changes')) this.changeRequests.push(params);
		if (method === 'GET' && path === '/drive/v3/changes/startPageToken') {
			return Response.json({ startPageToken: String(this.changes.length) });
		}
		if (method === 'GET' && path === '/drive/v3/changes') return this.listChanges(params);
		if (method === 'GET' && path === '/drive/v3/files') return this.listFiles(params);
		if (method === 'POST' && path === '/drive/v3/files') {
			const metadata = JSON.parse(body) as Pick<FakeFile, 'name' | 'mimeType' | 'parents'>;
			return Response.json(this.create(metadata, ''));
		}
		if (method === 'POST' && path === '/upload/drive/v3/files') {
			if (params.get('uploadType') !== 'multipart') return driveError(400, 'badRequest');
			const boundary = /boundary=(.+)$/.exec(
				new Headers(headers).get('Content-Type') ?? ''
			)?.[1];
			const [metadataPart, contentPart] = body
				.split(`--${boundary}`)
				.slice(1, 3)
				.map(part => part.slice(part.indexOf('\r\n\r\n') + 4, -2));
			const metadata = JSON.parse(metadataPart) as Pick<FakeFile, 'name' | 'parents'>;
			return Response.json(
				this.create({ ...metadata, mimeType: 'application/octet-stream' }, contentPart)
			);
		}
		const fileMatch = /^\/(upload\/)?drive\/v3\/files\/([^/]+)$/.exec(path);
		const file = fileMatch ? this.files.get(this.alias(fileMatch[2])) : undefined;
		if (!file) return driveError(404, 'notFound');
		if (method === 'GET') {
			if (params.get('alt') === 'media') {
				return file.mimeType === FOLDER_MIME_TYPE
					? driveError(403, 'fileNotDownloadable')
					: new Response(file.content);
			}
			return Response.json(this.resource(file));
		}
		if (method === 'PATCH' && fileMatch?.[1]) {
			if (params.get('uploadType') !== 'media') return driveError(400, 'badRequest');
			this.write(file, body);
			return Response.json(this.resource(file));
		}
		if (method === 'PATCH') {
			if ((JSON.parse(body) as { trashed?: boolean }).trashed) this.trash(file.id);
			return Response.json(this.resource(file));
		}
		return driveError(400, 'badRequest');
	}

	private listFiles(params: URLSearchParams): Response {
		const query =
			/^'(.+?)' in parents(?: and name = '((?:[^'\\]|\\.)*)')? and trashed = false$/.exec(
				params.get('q') ?? ''
			);
		if (!query) return driveError(400, 'invalidQuery');
		const [, parentAlias, escapedName] = query;
		const parentId = this.alias(parentAlias);
		const name = escapedName?.replace(/\\(.)/g, '$1');
		const matches = [...this.files.values()]
			.filter(
				file =>
					!file.trashed &&
					file.parents.includes(parentId) &&
					(!name || file.name === name)
			)
			.sort((left, right) => left.name.localeCompare(right.name));
		const pageSize = Number(params.get('pageSize') ?? this.pageSize);
		const offset = Number(params.get('pageToken') ?? 0);
		const page = matches.slice(offset, offset + pageSize);
		return Response.json({
			files: page.map(file => this.resource(file)),
			...(offset + pageSize < matches.length
				? { nextPageToken: String(offset + pageSize) }
				: {}),
		});
	}

	private listChanges(params: URLSearchParams): Response {
		const driveId = params.get('driveId') ?? undefined;
		if (driveId && params.get('includeItemsFromAllDrives') !== 'true') {
			return driveError(400, 'invalidParameter');
		}
		const pageSize = Number(params.get('pageSize') ?? this.pageSize);
		let next = Number(params.get('pageToken'));
		const page: typeof this.changes = [];
		while (next < this.changes.length && page.length < pageSize) {
			const change = this.changes[next++];
			if (change.driveId === driveId) page.push(change);
		}
		return Response.json({
			changes: page.map(change => {
				const file = this.files.get(change.fileId);
				return {
					fileId: change.fileId,
					removed: !file,
					...(file ? { file: this.resource(file) } : {}),
				};
			}),
			...(next < this.changes.length
				? { nextPageToken: String(next) }
				: { newStartPageToken: String(next) }),
		});
	}

	private create(
		metadata: Pick<FakeFile, 'name' | 'mimeType' | 'parents'>,
		content: string
	): object {
		const file: FakeFile = {
			id: `drive-${++this.counter}`,
			name: metadata.name,
			mimeType: metadata.mimeType,
			parents: metadata.parents.map(parent => this.alias(parent)),
			content: '',
			driveId: this.files.get(this.alias(metadata.parents[0]))?.driveId,
			modifiedTime: this.now(),
		};
		this.files.set(file.id, file);
		if (file.mimeType === FOLDER_MIME_TYPE) {
			this.changes.push({ fileId: file.id, driveId: file.driveId });
		} else {
			this.write(file, content);
		}
		return this.resource(file);
	}

	private write(file: FakeFile, content: string): void {
		file.content = content;
		file.headRevisionId = `rev-${++this.counter}`;
		file.modifiedTime = this.now();
		this.changes.push({ fileId: file.id, driveId: file.driveId });
	}

	private trash(id: string): void {
		for (const child of [...this.files.values()].filter(file => file.parents.includes(id))) {
			this.trash(child.id);
		}
		const file = this.files.get(id)!;
		file.trashed = true;
		this.changes.push({ fileId: id, driveId: file.driveId });
	}

	private resource(file: FakeFile): object {
		return {
			id: file.id,
			name: file.name,
			mimeType: file.mimeType,
			parents: file.parents,
			modifiedTime: file.modifiedTime,
			trashed: file.trashed ?? false,
			...(file.driveId ? { driveId: file.driveId } : {}),
			...(file.mimeType === FOLDER_MIME_TYPE
				? {}
				: {
						headRevisionId: file.headRevisionId,
						size: String(new TextEncoder().encode(file.content).byteLength),
					}),
		};
	}

	private alias(id: string): string {
		return id === 'root' ? this.myDriveId : id;
	}

	private now(): string {
		return new Date(Date.UTC(2026, 9, 3, 12, 0, this.counter)).toISOString();
	}
}

function driveError(status: number, reason: string): Response {
	return Response.json(
		{ error: { code: status, message: reason, errors: [{ reason }] } },
		{ status }
	);
}
