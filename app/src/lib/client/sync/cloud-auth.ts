import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { listCloudConnections, upsertCloudConnection } from '$lib/client/db/client';
import type { CloudConnectionRecord } from '$lib/client/db/repositories/cloud-connections';
import { notificationCenter } from '$lib/client/notification-center.svelte';
import {
	consumePkceAuthorization,
	createPkceAuthorizationRequest,
	parsePkceCallbackParams,
	removeOAuthCallbackParams,
	storePkceAuthorization,
	validatePkceCallback,
} from './auth/pkce';
import { DropboxStorageProvider } from './providers/dropbox-provider';

export const DROPBOX_PROVIDER_ID = 'dropbox';

const DROPBOX_SCOPES = [
	'account_info.read',
	'files.content.read',
	'files.content.write',
	'files.metadata.read',
	'files.metadata.write',
	'sharing.write',
];

interface DropboxAuthConfig {
	clientId: string;
	redirectUri: string;
	scopes: string[];
}

interface DropboxAccount {
	accountId: string;
	label: string;
}

export function getDropboxAuthConfig(): DropboxAuthConfig {
	return {
		clientId: env.PUBLIC_DROPBOX_CLIENT_ID?.trim() ?? '',
		redirectUri: env.PUBLIC_DROPBOX_REDIRECT_URI?.trim() || defaultDropboxRedirectUri(),
		scopes: DROPBOX_SCOPES,
	};
}

export function isDropboxAuthConfigured(): boolean {
	return getDropboxAuthConfig().clientId.length > 0;
}

export async function startDropboxPkceFlow(): Promise<void> {
	if (!browser) return;
	const config = getDropboxAuthConfig();
	if (!config.clientId) {
		throw new Error('Set PUBLIC_DROPBOX_CLIENT_ID before connecting Dropbox.');
	}

	const provider = createDropboxProvider(config);
	const authorization = await createPkceAuthorizationRequest(provider.id);
	storePkceAuthorization(sessionStorage, authorization);
	window.location.assign(provider.getAuthUrl(authorization.state, authorization.codeChallenge));
}

export async function handleDropboxPkceCallback(): Promise<CloudConnectionRecord | null> {
	if (!browser) return null;
	const url = new URL(window.location.href);
	const callbackParams = parsePkceCallbackParams(url);
	if (!callbackParams.code && !callbackParams.error && !callbackParams.state) return null;

	const pending = consumePkceAuthorization(sessionStorage);
	const validation = validatePkceCallback(url, pending, DROPBOX_PROVIDER_ID);
	replaceOAuthCallbackUrl(url);

	if (!validation.ok) {
		throw new Error(pkceValidationMessage(validation.error, validation.description));
	}

	const config = getDropboxAuthConfig();
	if (!config.clientId) {
		throw new Error('Set PUBLIC_DROPBOX_CLIENT_ID before completing Dropbox authorization.');
	}

	const provider = createDropboxProvider(config);
	const credentials = await provider.exchangeCode(validation.code, validation.codeVerifier);
	const account = await fetchDropboxAccount(credentials.accessToken);
	const connection = await upsertCloudConnection({
		providerId: DROPBOX_PROVIDER_ID,
		providerAccountId: account.accountId,
		accountEmail: account.label,
		scopes: config.scopes,
		credentials,
	});

	notificationCenter.upsert({
		id: 'dropbox-connected',
		title: 'Dropbox connected',
		message: `Connected ${connection.accountEmail}.`,
		tone: 'success',
	});
	return connection;
}

export async function getDropboxConnection(): Promise<CloudConnectionRecord | null> {
	const connections = await listCloudConnections();
	return connections.find(connection => connection.providerId === DROPBOX_PROVIDER_ID) ?? null;
}

function createDropboxProvider(config: DropboxAuthConfig): DropboxStorageProvider {
	return new DropboxStorageProvider({
		clientId: config.clientId,
		redirectUri: config.redirectUri,
		scopes: config.scopes,
	});
}

async function fetchDropboxAccount(accessToken: string): Promise<DropboxAccount> {
	const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
		},
		body: 'null',
	});
	const body: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(dropboxAccountErrorMessage(body));
	}

	const record = isRecord(body) ? body : {};
	const name = isRecord(record.name) ? readString(record.name.display_name) : '';
	const email = readString(record.email);
	const accountId = readString(record.account_id) || email || DROPBOX_PROVIDER_ID;
	return {
		accountId,
		label: email || name || 'Dropbox account',
	};
}

function replaceOAuthCallbackUrl(url: URL): void {
	window.history.replaceState(window.history.state, '', removeOAuthCallbackParams(url));
}

function defaultDropboxRedirectUri(): string {
	return browser ? `${window.location.origin}/projects` : '';
}

function pkceValidationMessage(error: string, description?: string): string {
	if (error === 'provider-error') return description || 'Dropbox authorization was denied.';
	if (error === 'missing-session')
		return 'Dropbox authorization session was not found. Start the connection again.';
	if (error === 'provider-mismatch')
		return 'Dropbox authorization returned for the wrong provider.';
	if (error === 'state-mismatch')
		return 'Dropbox authorization state did not match. Start the connection again.';
	if (error === 'missing-code') return 'Dropbox did not return an authorization code.';
	return 'Dropbox authorization callback was invalid.';
}

function dropboxAccountErrorMessage(body: unknown): string {
	if (isRecord(body)) {
		const summary = readString(body.error_summary);
		if (summary) return `Dropbox connected, but account lookup failed: ${summary}`;
	}
	return 'Dropbox connected, but account lookup failed.';
}

function readString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
