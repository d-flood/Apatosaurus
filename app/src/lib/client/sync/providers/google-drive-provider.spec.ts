import { describe, expect, it } from 'vitest';

import { CloudProviderError, isCloudProviderError } from './provider';
import { GoogleDriveStorageProvider } from './google-drive-provider';

interface FetchCall {
	url: string;
	init: RequestInit;
}

describe('google drive storage provider', () => {
	it('builds PKCE auth URLs and exchanges tokens without a client secret', async () => {
		const calls: FetchCall[] = [];
		const provider = new GoogleDriveStorageProvider({
			clientId: 'google-client-id',
			redirectUri: 'https://app.example/oauth/google-drive',
			scopes: [
				'https://www.googleapis.com/auth/drive.metadata.readonly',
				'https://www.googleapis.com/auth/drive.file',
			],
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

		expect(authUrl.origin + authUrl.pathname).toBe(
			'https://accounts.google.com/o/oauth2/v2/auth'
		);
		expect(authUrl.searchParams.get('client_id')).toBe('google-client-id');
		expect(authUrl.searchParams.get('response_type')).toBe('code');
		expect(authUrl.searchParams.get('code_challenge')).toBe('challenge-value');
		expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
		expect(authUrl.searchParams.get('access_type')).toBe('offline');
		expect(authUrl.searchParams.get('prompt')).toBe('consent');
		expect(authUrl.searchParams.get('include_granted_scopes')).toBe('true');
		expect(authUrl.searchParams.get('state')).toBe('state-value');
		expect(authUrl.searchParams.get('redirect_uri')).toBe(
			'https://app.example/oauth/google-drive'
		);
		expect(authUrl.searchParams.get('scope')).toBe(
			'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly'
		);
		expect(authUrl.searchParams.has('client_secret')).toBe(false);
		expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
		expect(tokenParams.get('grant_type')).toBe('authorization_code');
		expect(tokenParams.get('code')).toBe('auth-code');
		expect(tokenParams.get('client_id')).toBe('google-client-id');
		expect(tokenParams.get('code_verifier')).toBe('code-verifier');
		expect(tokenParams.get('redirect_uri')).toBe('https://app.example/oauth/google-drive');
		expect(tokenParams.has('client_secret')).toBe(false);
		expect(credentials).toEqual({
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
			expiresAt: 3_601_000,
		});
		expect(provider.getCredentials()).toEqual(credentials);
	});

	it('refreshes expired credentials before Drive file calls', async () => {
		const updates: unknown[] = [];
		const calls: FetchCall[] = [];
		const provider = new GoogleDriveStorageProvider({
			clientId: 'google-client-id',
			redirectUri: 'https://app.example/oauth/google-drive',
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
				if (url === 'https://oauth2.googleapis.com/token') {
					return jsonResponse({
						access_token: 'fresh-access-token',
						refresh_token: 'rotated-refresh-token',
						expires_in: 1800,
					});
				}
				return jsonResponse({ files: [] });
			},
		});

		const result = await provider.listFiles('project-folder', { recursive: true });
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
		expect(result).toEqual({ entries: [], hasMore: false });
	});

	it('creates folders by ID and maps Apatosaurus share roles to Drive permissions', async () => {
		const calls: FetchCall[] = [];
		const provider = providerWithFetch(async (input, init = {}) => {
			calls.push({ url: String(input), init });
			const url = new URL(String(input));
			if (url.pathname === '/drive/v3/files' && init.method === 'GET')
				return jsonResponse({ files: [] });
			if (url.pathname === '/drive/v3/files' && init.method === 'POST') {
				return jsonResponse(
					driveFolder({
						id: 'project-folder',
						name: 'Project',
						parents: ['parent-folder'],
						path: 'Project',
					})
				);
			}
			return jsonResponse({ id: 'permission-1' });
		});

		const folderId = await provider.createFolder('Project', 'parent-folder');
		await provider.shareFolder(folderId, 'collaborator@google.com', 'editor');

		expect(provider.capabilities).toMatchObject({
			supportsStableFileIds: true,
			requiresPathAddressing: false,
			sharingMayBeAsync: false,
		});
		expect(folderId).toBe('project-folder');
		expect(jsonBody(calls[1].init)).toEqual({
			name: 'Project',
			mimeType: 'application/vnd.google-apps.folder',
			parents: ['parent-folder'],
			appProperties: { apatosaurusPath: 'Project' },
		});
		expect(new URL(calls[2].url).pathname).toBe('/drive/v3/files/project-folder/permissions');
		expect(jsonBody(calls[2].init)).toEqual({
			role: 'writer',
			type: 'user',
			emailAddress: 'collaborator@google.com',
		});
	});

	it('creates nested files, revision-guards updates and deletes, and downloads by Drive ID', async () => {
		const calls: FetchCall[] = [];
		const provider = providerWithFetch(async (input, init = {}) => {
			calls.push({ url: String(input), init });
			const url = new URL(String(input));
			if (url.pathname === '/drive/v3/files' && init.method === 'GET')
				return jsonResponse({ files: [] });
			if (url.pathname === '/drive/v3/files' && init.method === 'POST') {
				const body = jsonBody(init);
				return jsonResponse(
					driveFolder({
						id: `folder-${String(body.name)}`,
						name: String(body.name),
						parents: Array.isArray(body.parents) ? (body.parents as string[]) : [],
						path: (body.appProperties as { apatosaurusPath: string }).apatosaurusPath,
					})
				);
			}
			if (url.pathname === '/upload/drive/v3/files' && init.method === 'POST') {
				return jsonResponse(
					driveFile({
						id: 'file-cp',
						name: 'cp.json',
						parents: ['folder-col-1'],
						path: 'history/collations/col-1/cp.json',
						version: '7',
						size: '1',
					})
				);
			}
			if (
				url.pathname === '/drive/v3/files/file-cp' &&
				init.method === 'GET' &&
				url.searchParams.get('alt') !== 'media'
			) {
				return jsonResponse(
					driveFile({
						id: 'file-cp',
						name: 'cp.json',
						path: 'history/collations/col-1/cp.json',
						version: '7',
						size: '1',
					}),
					200,
					{ etag: '"etag-7"' }
				);
			}
			if (url.pathname === '/upload/drive/v3/files/file-cp') {
				return jsonResponse(
					driveFile({
						id: 'file-cp',
						name: 'cp.json',
						path: 'history/collations/col-1/cp.json',
						version: '8',
						size: '1',
					})
				);
			}
			if (
				url.pathname === '/drive/v3/files/file-cp' &&
				url.searchParams.get('alt') === 'media'
			) {
				return textResponse('downloaded-content');
			}
			return new Response(null, { status: 204 });
		});

		const created = await provider.createFile(
			'project-folder',
			'history/collations/col-1/cp.json',
			'A'
		);
		const updated = await provider.updateFile(created.id, 'B', created.revision);
		const downloaded = await provider.downloadFile(updated.id);
		await provider.deleteFile(updated.id);
		const multipartBody = stringBody(calls[6].init);
		const updateHeaders = new Headers(calls[8].init.headers);
		const updateUrl = new URL(calls[8].url);
		const downloadUrl = new URL(calls[9].url);
		const deleteUrl = new URL(calls[10].url);

		expect(created).toEqual({
			id: 'file-cp',
			path: 'history/collations/col-1/cp.json',
			revision: '7',
			modifiedAt: '2026-06-10T12:00:00.000Z',
			size: 1,
		});
		expect(new Headers(calls[6].init.headers).get('Content-Type')).toContain(
			'multipart/related'
		);
		expect(multipartBody).toContain('"apatosaurusPath":"history/collations/col-1/cp.json"');
		expect(multipartBody).toContain('\r\nA\r\n');
		expect(updateUrl.pathname).toBe('/upload/drive/v3/files/file-cp');
		expect(updateUrl.searchParams.get('uploadType')).toBe('media');
		expect(updateHeaders.get('If-Match')).toBe('"etag-7"');
		expect(stringBody(calls[8].init)).toBe('B');
		expect(updated.revision).toBe('8');
		expect(downloadUrl.pathname).toBe('/drive/v3/files/file-cp');
		expect(downloadUrl.searchParams.get('alt')).toBe('media');
		expect(downloaded).toBe('downloaded-content');
		expect(deleteUrl.pathname).toBe('/drive/v3/files/file-cp');
		expect(calls[10].init.method).toBe('DELETE');
	});

	it('returns recursive project-relative listings from Drive IDs', async () => {
		const provider = providerWithFetch(async input => {
			const url = new URL(String(input));
			const q = url.searchParams.get('q') ?? '';
			if (q.includes("'project-folder' in parents")) {
				return jsonResponse({
					files: [
						driveFile({
							id: 'file-project',
							name: 'project.json',
							path: 'project.json',
							version: '11',
							size: '21',
						}),
						driveFolder({
							id: 'folder-transcriptions',
							name: 'transcriptions',
							parents: ['project-folder'],
						}),
					],
				});
			}
			if (q.includes("'folder-transcriptions' in parents")) {
				return jsonResponse({
					files: [
						driveFile({
							id: 'file-a',
							name: 'a.json',
							parents: ['folder-transcriptions'],
							version: '12',
							size: '1',
						}),
					],
				});
			}
			return jsonResponse({ files: [] });
		});

		const result = await provider.listFiles('project-folder', { recursive: true });

		expect(result).toMatchObject({ hasMore: false });
		expect(result.entries.map(entry => entry.path)).toEqual([
			'project.json',
			'transcriptions',
			'transcriptions/a.json',
		]);
		expect(result.entries[0]).toMatchObject({
			id: 'file-project',
			revision: '11',
			size: 21,
			isFolder: false,
		});
		expect(result.entries[1]).toMatchObject({
			id: 'folder-transcriptions',
			revision: '1',
			isFolder: true,
		});
	});

	it('maps Drive precondition failures and provider errors to typed errors', async () => {
		const conflictProvider = providerWithFetch(async (input, init = {}) => {
			const url = new URL(String(input));
			if (url.pathname === '/drive/v3/files/file-1' && init.method === 'GET') {
				return jsonResponse(
					driveFile({ id: 'file-1', name: 'project.json', version: 'old-rev' }),
					200,
					{
						etag: '"old-etag"',
					}
				);
			}
			return jsonResponse(
				{
					error: {
						code: 412,
						message: 'Precondition failed',
						errors: [{ reason: 'conditionNotMet' }],
					},
				},
				412
			);
		});

		let conflictError: unknown;
		try {
			await conflictProvider.updateFile('file-1', 'content', 'old-rev');
		} catch (error) {
			conflictError = error;
		}

		expect(conflictError).toBeInstanceOf(CloudProviderError);
		expect(isCloudProviderError(conflictError, 'conflict')).toBe(true);
		expect(conflictError).toMatchObject({
			providerDetails: {
				status: 412,
				reason: 'conditionNotMet',
			},
		});

		const cases: Array<{ status: number; body: unknown; code: string }> = [
			{
				status: 401,
				body: { error: { message: 'Invalid Credentials' } },
				code: 'reauthorization-required',
			},
			{
				status: 403,
				body: { error: { errors: [{ reason: 'insufficientFilePermissions' }] } },
				code: 'permission-denied',
			},
			{
				status: 429,
				body: { error: { errors: [{ reason: 'rateLimitExceeded' }] } },
				code: 'rate-limited',
			},
			{
				status: 404,
				body: { error: { errors: [{ reason: 'notFound' }] } },
				code: 'not-found',
			},
		];

		for (const testCase of cases) {
			const provider = providerWithFetch(async () =>
				jsonResponse(testCase.body, testCase.status)
			);
			await expect(provider.listFiles('project-folder')).rejects.toMatchObject({
				code: testCase.code,
			});
		}

		const unavailableProvider = providerWithFetch(async () => {
			throw new TypeError('network down');
		});

		await expect(unavailableProvider.downloadFile('file-1')).rejects.toMatchObject({
			code: 'provider-unavailable',
		});
	});
});

function providerWithFetch(fetch: (input: string | URL, init?: RequestInit) => Promise<Response>) {
	return new GoogleDriveStorageProvider({
		clientId: 'google-client-id',
		redirectUri: 'https://app.example/oauth/google-drive',
		credentials: {
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
			expiresAt: Date.now() + 3_600_000,
		},
		fetch,
	});
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...headers },
	});
}

function textResponse(body: string, status = 200): Response {
	return new Response(body, { status });
}

function driveFile(input: {
	id: string;
	name: string;
	parents?: string[];
	path?: string;
	version?: string;
	size?: string;
}) {
	return {
		id: input.id,
		name: input.name,
		mimeType: 'application/json',
		parents: input.parents ?? [],
		modifiedTime: '2026-06-10T12:00:00.000Z',
		size: input.size ?? '0',
		version: input.version ?? '1',
		appProperties: input.path ? { apatosaurusPath: input.path } : undefined,
	};
}

function driveFolder(input: { id: string; name: string; parents?: string[]; path?: string }) {
	return {
		id: input.id,
		name: input.name,
		mimeType: 'application/vnd.google-apps.folder',
		parents: input.parents ?? [],
		modifiedTime: '2026-06-10T12:00:00.000Z',
		version: '1',
		appProperties: input.path ? { apatosaurusPath: input.path } : undefined,
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

function stringBody(init: RequestInit): string {
	if (typeof init.body !== 'string') throw new Error('Expected string request body.');
	return init.body;
}
