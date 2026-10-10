import { CloudProviderError } from './provider';
import type { AccessTokenSource } from './dropbox-provider';

interface FakeEntry {
	pathDisplay: string;
	isFolder: boolean;
	content: string;
	rev: string;
	modifiedAt: string;
}

export class FakeDropboxApi {
	pageSize = 2;
	calls: string[] = [];
	missingPathRoot: string[] = [];
	private entries = new Map<string, FakeEntry>();
	private validTokens = new Set<string>();
	private refreshRevoked = false;
	private counter = 0;
	private currentToken: string | null = null;
	private cursors = new Map<string, { entries: object[]; offset: number }>();
	private failures: Array<{ endpoint: string; status: number }> = [];

	constructor(private readonly options: { rootNamespaceId?: string } = {}) {}

	readonly tokens: AccessTokenSource = {
		getAccessToken: async () => this.currentToken ?? this.issueToken(),
		refreshAccessToken: async () => {
			if (this.refreshRevoked) {
				throw new CloudProviderError('reauthorization-required', 'Reconnect Dropbox.');
			}
			return this.issueToken();
		},
	};

	readonly fetch: typeof fetch = async (input, init) => {
		const url = new URL(String(input));
		const endpoint = url.pathname.replace(/^\/2\//, '');
		this.calls.push(endpoint);
		const token = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '');
		if (!token || !this.validTokens.has(token)) {
			return Response.json({ error_summary: 'expired_access_token/' }, { status: 401 });
		}
		if (this.options.rootNamespaceId) {
			const pathRoot = new Headers(init?.headers).get('Dropbox-API-Path-Root');
			const expected = { '.tag': 'root', root: this.options.rootNamespaceId };
			if (!pathRoot || JSON.stringify(JSON.parse(pathRoot)) !== JSON.stringify(expected)) {
				this.missingPathRoot.push(endpoint);
				return Response.json({ error_summary: 'invalid_path_root/' }, { status: 400 });
			}
		}
		const failure = this.failures.findIndex(candidate => candidate.endpoint === endpoint);
		if (failure !== -1) {
			const [{ status }] = this.failures.splice(failure, 1);
			return Response.json({ error_summary: 'too_many_requests/' }, { status });
		}
		const arg = new Headers(init?.headers).get('Dropbox-API-Arg');
		const args = JSON.parse(arg ?? String(init?.body ?? 'null'));
		return this.handle(endpoint, args, arg ? String(init?.body ?? '') : '');
	};

	expireAccessTokens(): void {
		this.validTokens.clear();
	}

	revoke(): void {
		this.validTokens.clear();
		this.refreshRevoked = true;
	}

	failNext(endpoint: string, status: number): void {
		this.failures.push({ endpoint, status });
	}

	private issueToken(): string {
		this.currentToken = `access-${++this.counter}`;
		this.validTokens.add(this.currentToken);
		return this.currentToken;
	}

	private handle(endpoint: string, args: Record<string, unknown>, body: string): Response {
		switch (endpoint) {
			case 'files/list_folder':
				return this.listFolder(String(args.path), args.recursive === true);
			case 'files/list_folder/continue':
				return this.page(String(args.cursor));
			case 'files/download': {
				const entry = this.entries.get(lower(String(args.path)));
				if (!entry || entry.isFolder) return notFound('path');
				return new Response(entry.content);
			}
			case 'files/upload':
				return this.upload(String(args.path), args.mode as UploadMode, body);
			case 'files/delete_v2':
				return this.delete(String(args.path), args.parent_rev as string | undefined);
			case 'files/create_folder_v2': {
				const existing = this.entries.get(lower(String(args.path)));
				if (existing) {
					return conflict(`path/conflict/${existing.isFolder ? 'folder' : 'file'}/`);
				}
				return Response.json({
					metadata: this.metadata(this.ensureFolder(String(args.path))),
				});
			}
			case 'files/get_metadata': {
				const entry = this.entries.get(lower(String(args.path)));
				return entry ? Response.json(this.metadata(entry)) : notFound('path');
			}
			default:
				return Response.json({ error_summary: 'unknown_endpoint/' }, { status: 400 });
		}
	}

	private listFolder(path: string, recursive: boolean): Response {
		const folder = lower(path);
		if (folder && !this.entries.get(folder)?.isFolder) return notFound('path');
		const entries = [...this.entries.entries()]
			.filter(([key]) =>
				recursive
					? key === folder || key.startsWith(`${folder}/`)
					: parent(key) === folder && key !== folder
			)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([, entry]) => this.metadata(entry));
		const cursor = `cursor-${++this.counter}`;
		this.cursors.set(cursor, { entries, offset: 0 });
		return this.page(cursor);
	}

	private page(cursor: string): Response {
		const state = this.cursors.get(cursor);
		if (!state) return Response.json({ error_summary: 'reset/' }, { status: 409 });
		const entries = state.entries.slice(state.offset, state.offset + this.pageSize);
		state.offset += entries.length;
		return Response.json({
			entries,
			cursor,
			has_more: state.offset < state.entries.length,
		});
	}

	private upload(path: string, mode: UploadMode, content: string): Response {
		const key = lower(path);
		const existing = this.entries.get(key);
		if (mode === 'add' && existing) return conflict('path/conflict/file/');
		if (mode !== 'add' && (!existing || existing.rev !== mode.update)) {
			return conflict('path/conflict/file/');
		}
		if (parent(path)) this.ensureFolder(parent(path));
		const entry: FakeEntry = {
			pathDisplay: path,
			isFolder: false,
			content,
			rev: `0${(++this.counter).toString(16).padStart(8, '0')}`,
			modifiedAt: new Date(Date.UTC(2026, 9, 3, 12, 0, this.counter)).toISOString(),
		};
		this.entries.set(key, entry);
		return Response.json(this.metadata(entry));
	}

	private delete(path: string, parentRev: string | undefined): Response {
		const key = lower(path);
		const entry = this.entries.get(key);
		if (!entry) return notFound('path_lookup');
		if (parentRev && entry.rev !== parentRev) return notFound('path_lookup');
		for (const candidate of [...this.entries.keys()]) {
			if (candidate === key || candidate.startsWith(`${key}/`))
				this.entries.delete(candidate);
		}
		return Response.json({ metadata: this.metadata(entry) });
	}

	private ensureFolder(path: string): FakeEntry {
		const segments = path.split('/').filter(Boolean);
		let current = '';
		let entry: FakeEntry | undefined;
		for (const segment of segments) {
			current = `${current}/${segment}`;
			entry = this.entries.get(lower(current));
			if (!entry) {
				entry = {
					pathDisplay: current,
					isFolder: true,
					content: '',
					rev: '',
					modifiedAt: '',
				};
				this.entries.set(lower(current), entry);
			}
		}
		if (!entry) throw new Error('The Dropbox root is not an entry.');
		return entry;
	}

	private metadata(entry: FakeEntry): object {
		const name = entry.pathDisplay.slice(entry.pathDisplay.lastIndexOf('/') + 1);
		const common = {
			name,
			path_lower: lower(entry.pathDisplay),
			path_display: entry.pathDisplay,
		};
		return entry.isFolder
			? { '.tag': 'folder', ...common }
			: {
					'.tag': 'file',
					...common,
					rev: entry.rev,
					server_modified: entry.modifiedAt,
					size: new TextEncoder().encode(entry.content).byteLength,
				};
	}
}

type UploadMode = 'add' | { '.tag': 'update'; update: string };

function lower(path: string): string {
	return path.toLowerCase();
}

function parent(path: string): string {
	return path.slice(0, path.lastIndexOf('/'));
}

function notFound(prefix: string): Response {
	return conflict(`${prefix}/not_found/`);
}

function conflict(summary: string): Response {
	return Response.json({ error_summary: summary }, { status: 409 });
}
