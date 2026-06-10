import { describe, expect, it } from 'vitest';

import { CloudProviderError, isCloudProviderError } from './provider';
import { DropboxStorageProvider } from './dropbox-provider';

interface FetchCall {
	url: string;
	init: RequestInit;
}

describe('dropbox storage provider', () => {
	it('builds PKCE auth URLs and exchanges tokens without a client secret', async () => {
		const calls: FetchCall[] = [];
		const provider = new DropboxStorageProvider({
			clientId: 'dropbox-client-id',
			redirectUri: 'https://app.example/oauth/dropbox',
			scopes: ['files.content.write', 'files.content.read'],
			now: () => 1_000,
			fetch: async (input, init = {}) => {
				calls.push({ url: String(input), init });
				return jsonResponse({
					access_token: 'access-token',
					refresh_token: 'refresh-token',
					expires_in: 3600,
				});
			},
		});

		const authUrl = new URL(provider.getAuthUrl('state-value', 'challenge-value'));
		const credentials = await provider.exchangeCode('auth-code', 'code-verifier');
		const tokenParams = searchParamsBody(calls[0].init);

		expect(authUrl.origin + authUrl.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
		expect(authUrl.searchParams.get('client_id')).toBe('dropbox-client-id');
		expect(authUrl.searchParams.get('response_type')).toBe('code');
		expect(authUrl.searchParams.get('code_challenge')).toBe('challenge-value');
		expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
		expect(authUrl.searchParams.get('token_access_type')).toBe('offline');
		expect(authUrl.searchParams.get('state')).toBe('state-value');
		expect(authUrl.searchParams.get('redirect_uri')).toBe('https://app.example/oauth/dropbox');
		expect(authUrl.searchParams.get('scope')).toBe('files.content.read files.content.write');
		expect(authUrl.searchParams.has('client_secret')).toBe(false);
		expect(calls[0].url).toBe('https://api.dropboxapi.com/oauth2/token');
		expect(tokenParams.get('grant_type')).toBe('authorization_code');
		expect(tokenParams.get('code')).toBe('auth-code');
		expect(tokenParams.get('client_id')).toBe('dropbox-client-id');
		expect(tokenParams.get('code_verifier')).toBe('code-verifier');
		expect(tokenParams.has('client_secret')).toBe(false);
		expect(credentials).toEqual({
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
			expiresAt: 3_601_000,
		});
		expect(provider.getCredentials()).toEqual(credentials);
	});

	it('refreshes expired credentials before file calls and stores rotated refresh tokens', async () => {
		const updates: unknown[] = [];
		const calls: FetchCall[] = [];
		const provider = new DropboxStorageProvider({
			clientId: 'dropbox-client-id',
			redirectUri: 'https://app.example/oauth/dropbox',
			credentials: {
				accessToken: 'expired-access-token',
				refreshToken: 'old-refresh-token',
				expiresAt: 5_000,
			},
			now: () => 10_000,
			tokenRefreshLeewayMs: 0,
			onCredentialsUpdated: credentials => {
				updates.push(credentials);
			},
			fetch: async (input, init = {}) => {
				calls.push({ url: String(input), init });
				const url = String(input);
				if (url.endsWith('/oauth2/token')) {
					return jsonResponse({
						access_token: 'fresh-access-token',
						refresh_token: 'rotated-refresh-token',
						expires_in: 1800,
					});
				}
				return jsonResponse({ entries: [], cursor: 'list-cursor', has_more: false });
			},
		});

		const result = await provider.listFiles('/Apatosaurus/Projects/project-1', {
			recursive: true,
		});
		const refreshParams = searchParamsBody(calls[0].init);
		const listHeaders = new Headers(calls[1].init.headers);

		expect(refreshParams.get('grant_type')).toBe('refresh_token');
		expect(refreshParams.get('refresh_token')).toBe('old-refresh-token');
		expect(listHeaders.get('Authorization')).toBe('Bearer fresh-access-token');
		expect(updates).toEqual([
			{
				accessToken: 'fresh-access-token',
				refreshToken: 'rotated-refresh-token',
				expiresAt: 1_810_000,
			},
		]);
		expect(provider.getCredentials()).toEqual(updates[0]);
		expect(result).toMatchObject({ entries: [], hasMore: false });
	});

	it('aggregates recursive list_folder pages and returns project-relative paths', async () => {
		const calls: FetchCall[] = [];
		const provider = providerWithFetch(async (input, init = {}) => {
			calls.push({ url: String(input), init });
			const url = String(input);
			if (url.endsWith('/files/list_folder')) {
				return jsonResponse({
					entries: [
						fileMetadata(
							'/Apatosaurus/Projects/project-1/project.json',
							'rev-project',
							21
						),
					],
					cursor: 'cursor-1',
					has_more: true,
				});
			}
			return jsonResponse({
				entries: [
					folderMetadata('/Apatosaurus/Projects/project-1/transcriptions'),
					fileMetadata(
						'/Apatosaurus/Projects/project-1/transcriptions/a.json',
						'rev-a',
						1
					),
				],
				cursor: 'cursor-2',
				has_more: false,
			});
		});

		const result = await provider.listFiles('/Apatosaurus/Projects/project-1', {
			recursive: true,
		});
		const firstBody = jsonBody(calls[0].init);
		const continueBody = jsonBody(calls[1].init);

		expect(calls.map(call => new URL(call.url).pathname)).toEqual([
			'/2/files/list_folder',
			'/2/files/list_folder/continue',
		]);
		expect(firstBody).toMatchObject({
			path: '/Apatosaurus/Projects/project-1',
			recursive: true,
		});
		expect(continueBody).toEqual({ cursor: 'cursor-1' });
		expect(result.entries.map(entry => entry.path)).toEqual([
			'project.json',
			'transcriptions',
			'transcriptions/a.json',
		]);
		expect(result.entries[0]).toMatchObject({
			id: '/apatosaurus/projects/project-1/project.json',
			revision: 'rev-project',
			size: 21,
			isFolder: false,
		});
		expect(result.cursor).toBe(
			JSON.stringify({
				provider: 'dropbox',
				cursor: 'cursor-2',
				basePath: '/Apatosaurus/Projects/project-1',
			})
		);
		expect(result.hasMore).toBe(false);
	});

	it('creates, updates, downloads, and revision-guards deletes by Dropbox path', async () => {
		const calls: FetchCall[] = [];
		const provider = providerWithFetch(async (input, init = {}) => {
			calls.push({ url: String(input), init });
			const url = String(input);
			if (url.endsWith('/files/upload')) {
				const apiArg = dropboxApiArg(init);
				const revision = isDropboxUpdateMode(apiArg.mode) ? 'rev-updated' : 'rev-created';
				return jsonResponse(
					fileMetadata(String(apiArg.path), revision, stringBody(init).length)
				);
			}
			if (url.endsWith('/files/download')) return textResponse('downloaded-content');
			if (url.endsWith('/files/get_metadata')) {
				return jsonResponse(
					fileMetadata(
						'/Apatosaurus/Projects/project-1/transcriptions/a.json',
						'rev-updated',
						1
					)
				);
			}
			return jsonResponse({
				metadata: fileMetadata(
					'/Apatosaurus/Projects/project-1/transcriptions/a.json',
					'rev-deleted',
					0
				),
			});
		});

		const created = await provider.createFile(
			'/Apatosaurus/Projects/project-1',
			'transcriptions/A.json',
			'A'
		);
		const updated = await provider.updateFile(created.id, 'B', created.revision);
		const downloaded = await provider.downloadFile(updated.id);
		await provider.deleteFile(updated.id, updated.revision);
		const createArg = dropboxApiArg(calls[0].init);
		const updateArg = dropboxApiArg(calls[1].init);
		const downloadArg = dropboxApiArg(calls[2].init);
		const metadataBody = jsonBody(calls[3].init);
		const deleteBody = jsonBody(calls[4].init);

		expect(createArg).toEqual({
			path: '/Apatosaurus/Projects/project-1/transcriptions/A.json',
			mode: { '.tag': 'add' },
			autorename: false,
			mute: false,
		});
		expect(created).toEqual({
			id: '/apatosaurus/projects/project-1/transcriptions/a.json',
			path: 'transcriptions/A.json',
			revision: 'rev-created',
			modifiedAt: '2026-06-10T12:00:00.000Z',
			size: 1,
		});
		expect(updateArg).toEqual({
			path: '/apatosaurus/projects/project-1/transcriptions/a.json',
			mode: { '.tag': 'update', update: 'rev-created' },
			autorename: false,
			mute: false,
		});
		expect(updated.revision).toBe('rev-updated');
		expect(downloadArg).toEqual({
			path: '/apatosaurus/projects/project-1/transcriptions/a.json',
		});
		expect(downloaded).toBe('downloaded-content');
		expect(metadataBody).toMatchObject({
			path: '/apatosaurus/projects/project-1/transcriptions/a.json',
			include_deleted: false,
		});
		expect(deleteBody).toEqual({
			path: '/apatosaurus/projects/project-1/transcriptions/a.json',
		});
	});

	it('maps expected-revision upload conflicts to typed provider conflicts', async () => {
		const provider = providerWithFetch(async () =>
			jsonResponse(
				{
					error_summary: 'path/conflict/file/...',
					error: { '.tag': 'path', path: { '.tag': 'conflict' } },
				},
				409
			)
		);

		let conflictError: unknown;
		try {
			await provider.updateFile(
				'/Apatosaurus/Projects/project-1/project.json',
				'content',
				'rev-old'
			);
		} catch (error) {
			conflictError = error;
		}

		expect(conflictError).toBeInstanceOf(CloudProviderError);
		expect(isCloudProviderError(conflictError, 'conflict')).toBe(true);
		expect(conflictError).toMatchObject({
			providerDetails: {
				status: 409,
				errorSummary: 'path/conflict/file/...',
			},
		});
	});

	it('maps Dropbox auth, permission, rate limit, missing path, and network errors', async () => {
		const cases: Array<{ status: number; body: unknown; code: string }> = [
			{
				status: 401,
				body: { error_summary: 'expired_access_token/...' },
				code: 'reauthorization-required',
			},
			{
				status: 403,
				body: { error_summary: 'no_permission/...' },
				code: 'permission-denied',
			},
			{ status: 429, body: { error_summary: 'too_many_requests/...' }, code: 'rate-limited' },
			{ status: 409, body: { error_summary: 'path/not_found/...' }, code: 'not-found' },
		];

		for (const testCase of cases) {
			const provider = providerWithFetch(async () =>
				jsonResponse(testCase.body, testCase.status)
			);
			await expect(
				provider.listFiles('/Apatosaurus/Projects/project-1')
			).rejects.toMatchObject({
				code: testCase.code,
			});
		}

		const unavailableProvider = providerWithFetch(async () => {
			throw new TypeError('network down');
		});

		await expect(
			unavailableProvider.downloadFile('/Apatosaurus/Projects/project-1/project.json')
		).rejects.toMatchObject({
			code: 'provider-unavailable',
		});
	});
});

function providerWithFetch(fetch: (input: string | URL, init?: RequestInit) => Promise<Response>) {
	return new DropboxStorageProvider({
		clientId: 'dropbox-client-id',
		redirectUri: 'https://app.example/oauth/dropbox',
		credentials: {
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
			expiresAt: Date.now() + 3_600_000,
		},
		fetch,
	});
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function textResponse(body: string, status = 200): Response {
	return new Response(body, { status });
}

function fileMetadata(path: string, revision: string, size: number) {
	return {
		'.tag': 'file',
		name: path.split('/').pop() ?? '',
		id: `id:${path.toLowerCase()}`,
		path_lower: path.toLowerCase(),
		path_display: path,
		rev: revision,
		server_modified: '2026-06-10T12:00:00.000Z',
		size,
	};
}

function folderMetadata(path: string) {
	return {
		'.tag': 'folder',
		name: path.split('/').pop() ?? '',
		id: `id:${path.toLowerCase()}`,
		path_lower: path.toLowerCase(),
		path_display: path,
	};
}

function searchParamsBody(init: RequestInit): URLSearchParams {
	if (init.body instanceof URLSearchParams) return init.body;
	if (typeof init.body === 'string') return new URLSearchParams(init.body);
	throw new Error('Expected URLSearchParams request body.');
}

function jsonBody(init: RequestInit): Record<string, unknown> {
	if (typeof init.body !== 'string') throw new Error('Expected JSON request body.');
	return JSON.parse(init.body) as Record<string, unknown>;
}

function dropboxApiArg(init: RequestInit): Record<string, unknown> {
	const raw = new Headers(init.headers).get('Dropbox-API-Arg');
	if (!raw) throw new Error('Expected Dropbox-API-Arg header.');
	return JSON.parse(raw) as Record<string, unknown>;
}

function stringBody(init: RequestInit): string {
	if (typeof init.body !== 'string') throw new Error('Expected string request body.');
	return init.body;
}

function isDropboxUpdateMode(value: unknown): value is { '.tag': 'update'; update: string } {
	return Boolean(
		value &&
		typeof value === 'object' &&
		(value as Record<string, unknown>)['.tag'] === 'update'
	);
}
