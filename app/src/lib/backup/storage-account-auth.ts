import type { StorageAccount } from '$lib/storage/project-locations';
import type { AccessTokenSource } from './providers/dropbox-provider';
import { CloudProviderError } from './providers/provider';

type Provider = StorageAccount['provider'];

interface IssuedToken {
	accessToken: string;
	expiresAt: string;
	scopes: string[];
}

export interface AccountProfile {
	displayName: string;
	email: string;
	rootNamespaceId?: string;
	homePath?: string;
}

const EXPIRY_MARGIN_MS = 60_000;
const issued = new Map<string, Promise<IssuedToken>>();

export function providerLabel(provider: Provider): string {
	return provider === 'google' ? 'Google Drive' : 'Dropbox';
}

export function beginSignIn(
	provider: Provider,
	options: { scopes?: string; loginHint?: string } = {}
): void {
	const params = new URLSearchParams({
		...(options.scopes ? { scopes: options.scopes } : {}),
		...(options.loginHint ? { login_hint: options.loginHint } : {}),
	});
	window.location.assign(`/auth/${provider}/start${params.size ? `?${params}` : ''}`);
}

export function accountTokens(accountId: string, provider: Provider): AccessTokenSource {
	return {
		getAccessToken: async () => (await issueToken(accountId, provider, false)).accessToken,
		refreshAccessToken: async () => (await issueToken(accountId, provider, true)).accessToken,
	};
}

export async function issueToken(
	accountId: string,
	provider: Provider,
	force: boolean
): Promise<IssuedToken> {
	const cached = issued.get(accountId);
	if (cached && !force) {
		const token = await cached.catch(() => null);
		if (token && Date.parse(token.expiresAt) - EXPIRY_MARGIN_MS > Date.now()) return token;
	}
	const request = requestToken(accountId, provider);
	issued.set(accountId, request);
	request.catch(() => issued.delete(accountId));
	return request;
}

export async function fetchDropboxProfile(accessToken: string): Promise<AccountProfile> {
	const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
		method: 'POST',
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!response.ok) throw new Error(`Dropbox profile could not be loaded (${response.status}).`);
	const profile = (await response.json()) as {
		name: { display_name: string };
		email: string;
		root_info: { '.tag': string; root_namespace_id: string; home_path?: string };
	};
	const team = profile.root_info['.tag'] === 'team';
	return {
		displayName: profile.name.display_name,
		email: profile.email,
		...(team
			? {
					rootNamespaceId: profile.root_info.root_namespace_id,
					homePath: profile.root_info.home_path,
				}
			: {}),
	};
}

export async function fetchGoogleProfile(accessToken: string): Promise<AccountProfile> {
	const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!response.ok) throw new Error(`Google profile could not be loaded (${response.status}).`);
	const profile = (await response.json()) as { name?: string; email: string };
	return { displayName: profile.name || profile.email, email: profile.email };
}

async function requestToken(accountId: string, provider: Provider): Promise<IssuedToken> {
	let response: Response;
	try {
		response = await fetch(`/auth/${provider}/token`, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ accountId }),
		});
	} catch (error) {
		throw new CloudProviderError(
			'provider-unavailable',
			'Sign-in service is unreachable.',
			error
		);
	}
	if (response.status === 401) {
		throw new CloudProviderError(
			'reauthorization-required',
			'Storage account access expired. Reconnect the account.'
		);
	}
	if (!response.ok) {
		throw new CloudProviderError(
			'provider-unavailable',
			`Sign-in service failed (${response.status}).`
		);
	}
	return (await response.json()) as IssuedToken;
}
