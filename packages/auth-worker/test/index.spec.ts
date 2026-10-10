import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import worker, { type Env } from '../src/index';

const APP = 'https://app.example';
const REFRESH_TOKEN = 'refresh-token-secret';
const ACCOUNT_ID = 'dropbox:dbid:AAH4f99';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('auth worker', () => {
	it('signs in with state and PKCE, and never exposes the refresh token', async () => {
		const tokenRequests: URLSearchParams[] = [];
		stubDropbox(async body => {
			tokenRequests.push(body);
			return body.get('grant_type') === 'authorization_code'
				? Response.json({
						access_token: 'access-1',
						refresh_token: REFRESH_TOKEN,
						expires_in: 14400,
						scope: 'account_info.read files.content.write',
						account_id: 'dbid:AAH4f99',
					})
				: Response.json({ access_token: 'access-2', expires_in: 14400 });
		});

		const started = await call(new Request(`${APP}/auth/dropbox/start`));
		expect(started.status).toBe(302);
		const authorize = new URL(started.headers.get('Location') ?? '');
		expect(authorize.origin + authorize.pathname).toBe(
			'https://www.dropbox.com/oauth2/authorize'
		);
		expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
		expect(authorize.searchParams.get('token_access_type')).toBe('offline');
		expect(authorize.searchParams.get('redirect_uri')).toBe(`${APP}/auth/dropbox/callback`);
		const pending = cookiePairs(started);
		expect(pending).toHaveLength(1);

		const callback = await call(
			new Request(
				`${APP}/auth/dropbox/callback?code=code-1&state=${authorize.searchParams.get('state')}`,
				{ headers: { Cookie: pending.join('; ') } }
			)
		);
		expect(callback.status).toBe(302);
		expect(callback.headers.get('Location')).toBe(
			`${APP}/data#account=${encodeURIComponent(ACCOUNT_ID)}&provider=dropbox`
		);
		expect(tokenRequests[0].get('code_verifier')).toBeTruthy();
		const accountCookie = cookiePairs(callback).find(pair => !pair.endsWith('='));
		if (!accountCookie) throw new Error('Expected an account cookie.');
		expect(accountCookie).toMatch(/^__Host-sa-/);

		const issued = await call(
			new Request(`${APP}/auth/dropbox/token`, {
				method: 'POST',
				headers: { Cookie: accountCookie },
				body: JSON.stringify({ accountId: ACCOUNT_ID }),
			})
		);
		expect(issued.status).toBe(200);
		const issuedText = await issued.text();
		expect(JSON.parse(issuedText)).toMatchObject({
			accessToken: 'access-2',
			scopes: ['account_info.read', 'files.content.write'],
		});
		expect(tokenRequests[1].get('refresh_token')).toBe(REFRESH_TOKEN);

		for (const response of [started, callback, issued]) {
			for (const header of response.headers.getSetCookie()) {
				expect(header).not.toContain(REFRESH_TOKEN);
				expect(header).toMatch(/; HttpOnly; Secure; SameSite=Lax/);
			}
		}
		for (const body of [await started.text(), await callback.text(), issuedText]) {
			expect(body).not.toContain(REFRESH_TOKEN);
		}
	});

	it('rejects a tampered account cookie', async () => {
		const fetchSpy = stubDropbox(async () => Response.json({ access_token: 'access' }));
		const accountCookie = await signIn();
		const [name, value] = splitPair(accountCookie);
		const tampered = `${name}=${value.slice(0, -2)}${value.endsWith('AA') ? 'BB' : 'AA'}`;
		fetchSpy.mockClear();

		const response = await requestToken(tampered);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'reauthorization-required' });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('rejects a cookie sealed for a different account', async () => {
		stubDropbox(async () => Response.json({ access_token: 'access' }));
		const [, value] = splitPair(await signIn());
		const otherName = (await signIn('dbid:OTHER')).split('=')[0];

		const response = await requestToken(`${otherName}=${value}`, 'dropbox:dbid:OTHER');

		expect(response.status).toBe(401);
	});

	it('returns reauthorization-required when the provider revoked the refresh token', async () => {
		const accountCookie = await signIn();
		stubDropbox(async () =>
			Response.json(
				{
					error: 'invalid_grant',
					error_description: 'refresh token is invalid or revoked',
				},
				{ status: 400 }
			)
		);

		const response = await requestToken(accountCookie);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'reauthorization-required' });
	});

	it('rejects a callback whose state does not match', async () => {
		const fetchSpy = stubDropbox(async () => Response.json({}));
		const started = await call(new Request(`${APP}/auth/dropbox/start`));

		const callback = await call(
			new Request(`${APP}/auth/dropbox/callback?code=code-1&state=forged`, {
				headers: { Cookie: cookiePairs(started).join('; ') },
			})
		);

		expect(callback.headers.get('Location')).toBe(`${APP}/data#auth-error=state`);
		expect(cookiePairs(callback).every(pair => pair.endsWith('='))).toBe(true);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('signs out by clearing the cookie and revoking at the provider', async () => {
		const accountCookie = await signIn();
		const fetchSpy = stubDropbox(async () => Response.json({ access_token: 'access-3' }));

		const response = await call(
			new Request(`${APP}/auth/signout`, {
				method: 'POST',
				headers: { Cookie: accountCookie },
				body: JSON.stringify({ accountId: ACCOUNT_ID }),
			})
		);

		expect(response.status).toBe(204);
		expect(response.headers.getSetCookie()).toEqual([
			`${accountCookie.split('=')[0]}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
		]);
		expect(fetchSpy.mock.calls.map(([input]) => String(input))).toContain(
			'https://api.dropboxapi.com/2/auth/token/revoke'
		);
	});
});

function call(request: Request): Promise<Response> {
	return worker.fetch(request, env as unknown as Env);
}

function stubDropbox(tokenEndpoint: (body: URLSearchParams) => Promise<Response>) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const url = String(input instanceof Request ? input.url : input);
		if (url === 'https://api.dropboxapi.com/oauth2/token') {
			return tokenEndpoint(new URLSearchParams(String(init?.body)));
		}
		return new Response(null, { status: 200 });
	});
}

async function signIn(dropboxAccountId = 'dbid:AAH4f99'): Promise<string> {
	const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
		Response.json({
			access_token: 'access',
			refresh_token: REFRESH_TOKEN,
			expires_in: 14400,
			account_id: dropboxAccountId,
		})
	);
	const started = await call(new Request(`${APP}/auth/dropbox/start`));
	const state = new URL(started.headers.get('Location') ?? '').searchParams.get('state');
	const callback = await call(
		new Request(`${APP}/auth/dropbox/callback?code=code&state=${state}`, {
			headers: { Cookie: cookiePairs(started).join('; ') },
		})
	);
	spy.mockRestore();
	const accountCookie = cookiePairs(callback).find(pair => !pair.endsWith('='));
	if (!accountCookie) throw new Error('Sign-in did not set an account cookie.');
	return accountCookie;
}

function requestToken(cookie: string, accountId = ACCOUNT_ID): Promise<Response> {
	return call(
		new Request(`${APP}/auth/dropbox/token`, {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ accountId }),
		})
	);
}

function cookiePairs(response: Response): string[] {
	return response.headers.getSetCookie().map(header => header.split(';')[0]);
}

function splitPair(pair: string): [string, string] {
	const index = pair.indexOf('=');
	return [pair.slice(0, index), pair.slice(index + 1)];
}

describe('auth worker: google', () => {
	const GOOGLE_ACCOUNT_ID = 'google:110248495921238986420';

	it('requests exactly the sign-in scopes, offline access and consent', async () => {
		const started = await call(new Request(`${APP}/auth/google/start`));

		const authorize = new URL(started.headers.get('Location') ?? '');
		expect(authorize.origin + authorize.pathname).toBe(
			'https://accounts.google.com/o/oauth2/v2/auth'
		);
		expect(authorize.searchParams.get('scope')).toBe(
			'openid email profile https://www.googleapis.com/auth/drive.file'
		);
		expect(authorize.searchParams.get('access_type')).toBe('offline');
		expect(authorize.searchParams.get('include_granted_scopes')).toBe('true');
		expect(authorize.searchParams.get('prompt')).toBe('consent');
		expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
		expect(authorize.searchParams.get('redirect_uri')).toBe(`${APP}/auth/google/callback`);
	});

	it('signs in as google:<sub>, refreshes, and never exposes the refresh token', async () => {
		const tokenRequests: URLSearchParams[] = [];
		stubGoogle(async body => {
			tokenRequests.push(body);
			return body.get('grant_type') === 'authorization_code'
				? Response.json(googleSignInToken())
				: Response.json({
						access_token: 'google-access-2',
						expires_in: 3599,
						scope: 'openid https://www.googleapis.com/auth/drive.file',
					});
		});

		const accountCookie = await signInWith('google', false);
		const issued = await call(
			new Request(`${APP}/auth/google/token`, {
				method: 'POST',
				headers: { Cookie: accountCookie },
				body: JSON.stringify({ accountId: GOOGLE_ACCOUNT_ID }),
			})
		);

		expect(issued.status).toBe(200);
		const issuedText = await issued.text();
		expect(JSON.parse(issuedText)).toMatchObject({
			accessToken: 'google-access-2',
			scopes: ['openid', 'https://www.googleapis.com/auth/drive.file'],
		});
		expect(tokenRequests.map(body => body.get('grant_type'))).toEqual([
			'authorization_code',
			'refresh_token',
		]);
		expect(tokenRequests[0].get('code_verifier')).toBeTruthy();
		expect(tokenRequests[1].get('refresh_token')).toBe(REFRESH_TOKEN);
		expect(tokenRequests[1].get('client_secret')).toBe('google-secret');
		expect(issuedText).not.toContain(REFRESH_TOKEN);
		expect(accountCookie).not.toContain(REFRESH_TOKEN);
	});

	it('rejects a tampered account cookie', async () => {
		const accountCookie = await signInWith('google');
		const fetchSpy = stubGoogle(async () => Response.json({ access_token: 'access' }));
		const [name, value] = splitPair(accountCookie);
		const tampered = `${name}=${value.slice(0, -2)}${value.endsWith('AA') ? 'BB' : 'AA'}`;

		const response = await call(
			new Request(`${APP}/auth/google/token`, {
				method: 'POST',
				headers: { Cookie: tampered },
				body: JSON.stringify({ accountId: GOOGLE_ACCOUNT_ID }),
			})
		);

		expect(response.status).toBe(401);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('rejects a Dropbox cookie on the Google token route', async () => {
		const accountCookie = await signIn();
		const fetchSpy = stubGoogle(async () => Response.json({ access_token: 'access' }));

		const response = await call(
			new Request(`${APP}/auth/google/token`, {
				method: 'POST',
				headers: { Cookie: accountCookie },
				body: JSON.stringify({ accountId: ACCOUNT_ID }),
			})
		);

		expect(response.status).toBe(401);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns reauthorization-required when Google revoked the refresh token', async () => {
		const accountCookie = await signInWith('google');
		stubGoogle(async () =>
			Response.json(
				{ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
				{ status: 400 }
			)
		);

		const response = await call(
			new Request(`${APP}/auth/google/token`, {
				method: 'POST',
				headers: { Cookie: accountCookie },
				body: JSON.stringify({ accountId: GOOGLE_ACCOUNT_ID }),
			})
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'reauthorization-required' });
	});

	it('fails sign-in when Google returns no ID token subject', async () => {
		stubGoogle(async () =>
			Response.json({ ...googleSignInToken(), id_token: 'not-a-jwt' })
		);
		const started = await call(new Request(`${APP}/auth/google/start`));
		const state = new URL(started.headers.get('Location') ?? '').searchParams.get('state');

		const callback = await call(
			new Request(`${APP}/auth/google/callback?code=code&state=${state}`, {
				headers: { Cookie: cookiePairs(started).join('; ') },
			})
		);

		expect(callback.headers.get('Location')).toBe(`${APP}/data#auth-error=exchange`);
	});

	it('adds exactly the drive scope incrementally and replaces the cookie with the wider grant', async () => {
		const accountCookie = await signInWith('google');
		const started = await call(
			new Request(`${APP}/auth/google/start?scopes=drive&login_hint=ada%40example.org`)
		);

		const authorize = new URL(started.headers.get('Location') ?? '');
		expect(authorize.searchParams.get('scope')).toBe(
			'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive'
		);
		expect(authorize.searchParams.get('include_granted_scopes')).toBe('true');
		expect(authorize.searchParams.get('login_hint')).toBe('ada@example.org');

		const widened = `${googleSignInToken().scope} https://www.googleapis.com/auth/drive`;
		stubGoogle(async body =>
			body.get('grant_type') === 'authorization_code'
				? Response.json({ ...googleSignInToken(), scope: widened })
				: Response.json({ access_token: 'google-access-4', expires_in: 3599 })
		);
		const callback = await call(
			new Request(
				`${APP}/auth/google/callback?code=code&state=${authorize.searchParams.get('state')}`,
				{ headers: { Cookie: cookiePairs(started).join('; ') } }
			)
		);
		const upgraded = cookiePairs(callback).find(pair => !pair.endsWith('='));
		if (!upgraded) throw new Error('Expected an account cookie.');
		expect(splitPair(upgraded)[0]).toBe(splitPair(accountCookie)[0]);
		expect(upgraded).not.toBe(accountCookie);

		const issued = await call(
			new Request(`${APP}/auth/google/token`, {
				method: 'POST',
				headers: { Cookie: upgraded },
				body: JSON.stringify({ accountId: GOOGLE_ACCOUNT_ID }),
			})
		);
		expect(await issued.json()).toMatchObject({
			accessToken: 'google-access-4',
			scopes: widened.split(' '),
		});
	});

	it('rejects scopes the provider does not offer', async () => {
		for (const path of [
			'/auth/google/start?scopes=gmail',
			'/auth/google/start?scopes=constructor',
			'/auth/dropbox/start?scopes=drive',
		]) {
			const response = await call(new Request(`${APP}${path}`));
			expect(response.status).toBe(400);
			expect(response.headers.getSetCookie()).toEqual([]);
		}
	});

	it('signs out by clearing the cookie and revoking at Google', async () => {
		const accountCookie = await signInWith('google');
		const fetchSpy = stubGoogle(async () => Response.json({ access_token: 'google-access-3' }));

		const response = await call(
			new Request(`${APP}/auth/signout`, {
				method: 'POST',
				headers: { Cookie: accountCookie },
				body: JSON.stringify({ accountId: GOOGLE_ACCOUNT_ID }),
			})
		);

		expect(response.status).toBe(204);
		const revoke = fetchSpy.mock.calls.find(
			([input]) => String(input) === 'https://oauth2.googleapis.com/revoke'
		);
		expect(String(revoke?.[1]?.body)).toBe('token=google-access-3');
	});
});

function stubGoogle(tokenEndpoint: (body: URLSearchParams) => Promise<Response>) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const url = String(input instanceof Request ? input.url : input);
		if (url === 'https://oauth2.googleapis.com/token') {
			return tokenEndpoint(new URLSearchParams(String(init?.body)));
		}
		return new Response(null, { status: 200 });
	});
}

function googleSignInToken() {
	const payload = btoa(JSON.stringify({ sub: '110248495921238986420', email: 'ada@example.org' }))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
	return {
		access_token: 'google-access-1',
		refresh_token: REFRESH_TOKEN,
		expires_in: 3599,
		scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file',
		id_token: `eyJhbGciOiJSUzI1NiJ9.${payload}.signature`,
	};
}

async function signInWith(provider: 'google', stubTokenEndpoint = true): Promise<string> {
	const spy = stubTokenEndpoint
		? vi
				.spyOn(globalThis, 'fetch')
				.mockImplementation(async () => Response.json(googleSignInToken()))
		: null;
	const started = await call(new Request(`${APP}/auth/${provider}/start`));
	const state = new URL(started.headers.get('Location') ?? '').searchParams.get('state');
	const callback = await call(
		new Request(`${APP}/auth/${provider}/callback?code=code&state=${state}`, {
			headers: { Cookie: cookiePairs(started).join('; ') },
		})
	);
	spy?.mockRestore();
	expect(callback.headers.get('Location')).toBe(
		`${APP}/data#account=${encodeURIComponent('google:110248495921238986420')}&provider=google`
	);
	const accountCookie = cookiePairs(callback).find(pair => !pair.endsWith('='));
	if (!accountCookie) throw new Error('Sign-in did not set an account cookie.');
	return accountCookie;
}
