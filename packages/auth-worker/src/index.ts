import { base64UrlDecode, base64UrlEncode, seal, unseal } from './seal';

export interface Env {
	APP_ORIGIN: string;
	COOKIE_SECRET: string;
	DROPBOX_CLIENT_ID: string;
	DROPBOX_CLIENT_SECRET: string;
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;
}

interface AccountCookie {
	provider: string;
	accountId: string;
	refreshToken: string;
	scopes: string[];
	issuedAt: string;
}

interface PendingSignIn {
	provider: string;
	state: string;
	verifier: string;
	returnTo: string;
}

interface TokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	scope?: string;
	account_id?: string;
	id_token?: string;
	error?: string;
}

interface OAuthProvider {
	authorizeUrl: string;
	tokenUrl: string;
	defaultScopes: string;
	extraScopes: Record<string, string>;
	authorizeParams: Record<string, string>;
	clientId: (env: Env) => string;
	clientSecret: (env: Env) => string;
	accountId: (token: TokenResponse) => string | null;
	revoke: (accessToken: string) => Promise<void>;
}

const providers: Record<string, OAuthProvider> = {
	dropbox: {
		authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
		tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
		defaultScopes:
			'account_info.read files.metadata.read files.metadata.write files.content.read files.content.write',
		extraScopes: {},
		authorizeParams: { token_access_type: 'offline' },
		clientId: env => env.DROPBOX_CLIENT_ID,
		clientSecret: env => env.DROPBOX_CLIENT_SECRET,
		accountId: token => (token.account_id ? `dropbox:${token.account_id}` : null),
		revoke: async accessToken => {
			await fetch('https://api.dropboxapi.com/2/auth/token/revoke', {
				method: 'POST',
				headers: { Authorization: `Bearer ${accessToken}` },
			});
		},
	},
	google: {
		authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
		tokenUrl: 'https://oauth2.googleapis.com/token',
		defaultScopes: 'openid email profile https://www.googleapis.com/auth/drive.file',
		extraScopes: { drive: 'https://www.googleapis.com/auth/drive' },
		authorizeParams: {
			access_type: 'offline',
			include_granted_scopes: 'true',
			prompt: 'consent',
		},
		clientId: env => env.GOOGLE_CLIENT_ID,
		clientSecret: env => env.GOOGLE_CLIENT_SECRET,
		accountId: token => {
			const sub = idTokenSubject(token.id_token);
			return sub ? `google:${sub}` : null;
		},
		revoke: async accessToken => {
			await fetch('https://oauth2.googleapis.com/revoke', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ token: accessToken }),
			});
		},
	},
};

const PENDING_COOKIE = '__Host-sa-pending';
const ACCOUNT_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;
const PENDING_COOKIE_MAX_AGE = 10 * 60;
const DEFAULT_RETURN_TO = '/data';

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === '/auth/signout' && request.method === 'POST') {
			return signOut(request, env);
		}
		const match = /^\/auth\/([a-z]+)\/(start|callback|token)$/.exec(url.pathname);
		const provider = match ? providers[match[1]] : undefined;
		if (!match || !provider) return json({ error: 'not-found' }, 404);
		const [, providerName, action] = match;
		if (action === 'start' && request.method === 'GET') {
			return start(url, env, providerName, provider);
		}
		if (action === 'callback' && request.method === 'GET') {
			return callback(request, url, env, providerName, provider);
		}
		if (action === 'token' && request.method === 'POST') {
			return token(request, env, providerName, provider);
		}
		return json({ error: 'method-not-allowed' }, 405);
	},
};

async function start(
	url: URL,
	env: Env,
	providerName: string,
	provider: OAuthProvider
): Promise<Response> {
	const extra = splitScopes(url.searchParams.get('scopes') ?? undefined).map(
		name => (Object.hasOwn(provider.extraScopes, name) ? provider.extraScopes[name] : undefined)
	);
	if (extra.some(scope => !scope)) return json({ error: 'unknown-scope' }, 400);
	const loginHint = url.searchParams.get('login_hint');
	const state = randomToken();
	const verifier = randomToken();
	const challenge = base64UrlEncode(
		new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
	);
	const authorize = new URL(provider.authorizeUrl);
	for (const [key, value] of Object.entries({
		client_id: provider.clientId(env),
		response_type: 'code',
		redirect_uri: redirectUri(env, providerName),
		state,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		scope: [provider.defaultScopes, ...extra].join(' '),
		...provider.authorizeParams,
		...(loginHint ? { login_hint: loginHint } : {}),
	})) {
		authorize.searchParams.set(key, value);
	}
	const pending: PendingSignIn = {
		provider: providerName,
		state,
		verifier,
		returnTo: returnPath(url.searchParams.get('return_to')),
	};
	return redirect(authorize.toString(), [
		cookie(PENDING_COOKIE, await seal(pending, env.COOKIE_SECRET), PENDING_COOKIE_MAX_AGE),
	]);
}

async function callback(
	request: Request,
	url: URL,
	env: Env,
	providerName: string,
	provider: OAuthProvider
): Promise<Response> {
	const clearPending = cookie(PENDING_COOKIE, '', 0);
	const pendingValue = readCookie(request, PENDING_COOKIE);
	const pending = pendingValue
		? await unseal<PendingSignIn>(pendingValue, env.COOKIE_SECRET)
		: null;
	const returnTo = pending?.returnTo ?? DEFAULT_RETURN_TO;
	const code = url.searchParams.get('code');
	if (
		!pending ||
		pending.provider !== providerName ||
		pending.state !== url.searchParams.get('state') ||
		!code
	) {
		return redirect(
			appRedirect(env, returnTo, { 'auth-error': url.searchParams.get('error') ?? 'state' }),
			[clearPending]
		);
	}
	const exchanged = await requestToken(provider, env, {
		grant_type: 'authorization_code',
		code,
		redirect_uri: redirectUri(env, providerName),
		code_verifier: pending.verifier,
	});
	const accountId = exchanged.ok ? provider.accountId(exchanged.body) : null;
	if (!exchanged.ok || !accountId || !exchanged.body.refresh_token) {
		return redirect(appRedirect(env, returnTo, { 'auth-error': 'exchange' }), [clearPending]);
	}
	const account: AccountCookie = {
		provider: providerName,
		accountId,
		refreshToken: exchanged.body.refresh_token,
		scopes: splitScopes(exchanged.body.scope),
		issuedAt: new Date().toISOString(),
	};
	return redirect(appRedirect(env, returnTo, { account: accountId, provider: providerName }), [
		clearPending,
		cookie(
			accountCookieName(accountId),
			await seal(account, env.COOKIE_SECRET),
			ACCOUNT_COOKIE_MAX_AGE
		),
	]);
}

async function token(
	request: Request,
	env: Env,
	providerName: string,
	provider: OAuthProvider
): Promise<Response> {
	const account = await readAccount(request, env);
	if (!account || account.provider !== providerName) return reauthorizationRequired();
	const refreshed = await requestToken(provider, env, {
		grant_type: 'refresh_token',
		refresh_token: account.refreshToken,
	});
	if (refreshed.status >= 400 && refreshed.status < 500) return reauthorizationRequired();
	if (!refreshed.ok || !refreshed.body.access_token) {
		return json({ error: 'provider-unavailable' }, 502);
	}
	return json({
		accessToken: refreshed.body.access_token,
		expiresAt: new Date(Date.now() + (refreshed.body.expires_in ?? 0) * 1000).toISOString(),
		scopes: refreshed.body.scope ? splitScopes(refreshed.body.scope) : account.scopes,
	});
}

async function signOut(request: Request, env: Env): Promise<Response> {
	const accountId = await readAccountId(request);
	if (!accountId) return json({ error: 'account-required' }, 400);
	const account = await readAccount(request, env);
	const provider = account ? providers[account.provider] : undefined;
	if (account && provider) await revoke(provider, env, account).catch(() => undefined);
	return new Response(null, {
		status: 204,
		headers: { 'Set-Cookie': cookie(accountCookieName(accountId), '', 0) },
	});
}

async function revoke(provider: OAuthProvider, env: Env, account: AccountCookie): Promise<void> {
	const refreshed = await requestToken(provider, env, {
		grant_type: 'refresh_token',
		refresh_token: account.refreshToken,
	});
	if (refreshed.ok && refreshed.body.access_token) {
		await provider.revoke(refreshed.body.access_token);
	}
}

async function readAccount(request: Request, env: Env): Promise<AccountCookie | null> {
	const accountId = await readAccountId(request);
	if (!accountId) return null;
	const value = readCookie(request, accountCookieName(accountId));
	if (!value) return null;
	const account = await unseal<AccountCookie>(value, env.COOKIE_SECRET);
	return account?.accountId === accountId ? account : null;
}

async function readAccountId(request: Request): Promise<string | null> {
	try {
		const body = (await request.clone().json()) as { accountId?: unknown };
		return typeof body.accountId === 'string' && body.accountId ? body.accountId : null;
	} catch {
		return null;
	}
}

async function requestToken(
	provider: OAuthProvider,
	env: Env,
	params: Record<string, string>
): Promise<{ ok: boolean; status: number; body: TokenResponse }> {
	const response = await fetch(provider.tokenUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			...params,
			client_id: provider.clientId(env),
			client_secret: provider.clientSecret(env),
		}),
	});
	let body: TokenResponse = {};
	try {
		body = (await response.json()) as TokenResponse;
	} catch {
		body = {};
	}
	return { ok: response.ok, status: response.status, body };
}

function accountCookieName(accountId: string): string {
	return `__Host-sa-${base64UrlEncode(new TextEncoder().encode(accountId))}`;
}

function cookie(name: string, value: string, maxAge: number): string {
	return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request: Request, name: string): string | null {
	for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
		const [key, ...value] = part.trim().split('=');
		if (key === name) return value.join('=');
	}
	return null;
}

function redirectUri(env: Env, providerName: string): string {
	return `${env.APP_ORIGIN}/auth/${providerName}/callback`;
}

function returnPath(value: string | null): string {
	return value?.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
		? value
		: DEFAULT_RETURN_TO;
}

function appRedirect(env: Env, returnTo: string, params: Record<string, string>): string {
	return `${env.APP_ORIGIN}${returnTo}#${new URLSearchParams(params)}`;
}

function redirect(location: string, cookies: string[]): Response {
	const headers = new Headers({ Location: location });
	for (const value of cookies) headers.append('Set-Cookie', value);
	return new Response(null, { status: 302, headers });
}

function json(body: unknown, status = 200): Response {
	return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function reauthorizationRequired(): Response {
	return json({ error: 'reauthorization-required' }, 401);
}

function splitScopes(scope: string | undefined): string[] {
	return (scope ?? '').split(/\s+/).filter(Boolean);
}

/** The ID token comes straight from Google's token endpoint over TLS, so its signature need not be checked (OIDC Core 3.1.3.7). */
function idTokenSubject(idToken: string | undefined): string | null {
	try {
		const payload = JSON.parse(
			new TextDecoder().decode(base64UrlDecode(idToken?.split('.')[1] ?? ''))
		) as { sub?: unknown };
		return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
	} catch {
		return null;
	}
}

function randomToken(): string {
	return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}
