export const PKCE_CODE_CHALLENGE_METHOD = 'S256';
export const PKCE_SESSION_STORAGE_KEY = 'apatosaurus.cloud-sync.pkce';

export interface PkceSessionStore {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface PendingPkceAuthorization {
	providerId: string;
	state: string;
	codeVerifier: string;
	createdAt: string;
}

export interface PkceAuthorizationRequest extends PendingPkceAuthorization {
	codeChallenge: string;
	codeChallengeMethod: typeof PKCE_CODE_CHALLENGE_METHOD;
}

export interface PkceCallbackParams {
	code: string | null;
	state: string | null;
	error: string | null;
	errorDescription: string | null;
}

export type PkceCallbackValidationError =
	| 'provider-error'
	| 'missing-session'
	| 'provider-mismatch'
	| 'missing-state'
	| 'state-mismatch'
	| 'missing-code';

export type PkceCallbackValidationResult =
	| {
			ok: true;
			providerId: string;
			code: string;
			state: string;
			codeVerifier: string;
	  }
	| {
			ok: false;
			error: PkceCallbackValidationError;
			description?: string;
	  };

export async function createPkceAuthorizationRequest(
	providerId: string,
	now = new Date().toISOString()
): Promise<PkceAuthorizationRequest> {
	const codeVerifier = generateCodeVerifier();
	return {
		providerId,
		state: generatePkceState(),
		codeVerifier,
		codeChallenge: await createCodeChallenge(codeVerifier),
		codeChallengeMethod: PKCE_CODE_CHALLENGE_METHOD,
		createdAt: now,
	};
}

export function generateCodeVerifier(byteLength = 32): string {
	if (byteLength < 32 || byteLength > 96) {
		throw new Error('PKCE code verifier entropy must be between 32 and 96 bytes.');
	}
	return base64UrlEncode(randomBytes(byteLength));
}

export function generatePkceState(byteLength = 32): string {
	if (byteLength < 16) throw new Error('PKCE state entropy must be at least 16 bytes.');
	return base64UrlEncode(randomBytes(byteLength));
}

export async function createCodeChallenge(codeVerifier: string): Promise<string> {
	const digest = await globalThis.crypto?.subtle?.digest(
		'SHA-256',
		new TextEncoder().encode(codeVerifier)
	);
	if (!digest) throw new Error('PKCE S256 code challenge requires Web Crypto support.');
	return base64UrlEncode(new Uint8Array(digest));
}

export function storePkceAuthorization(
	store: PkceSessionStore,
	pending: PendingPkceAuthorization,
	key = PKCE_SESSION_STORAGE_KEY
): void {
	store.setItem(key, JSON.stringify(pending));
}

export function readPkceAuthorization(
	store: PkceSessionStore,
	key = PKCE_SESSION_STORAGE_KEY
): PendingPkceAuthorization | null {
	const raw = store.getItem(key);
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isPendingPkceAuthorization(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function consumePkceAuthorization(
	store: PkceSessionStore,
	key = PKCE_SESSION_STORAGE_KEY
): PendingPkceAuthorization | null {
	const pending = readPkceAuthorization(store, key);
	store.removeItem(key);
	return pending;
}

export function parsePkceCallbackParams(input: string | URL | URLSearchParams): PkceCallbackParams {
	const params = toSearchParams(input);
	return {
		code: params.get('code'),
		state: params.get('state'),
		error: params.get('error'),
		errorDescription: params.get('error_description'),
	};
}

export function validatePkceCallback(
	input: string | URL | URLSearchParams,
	pending: PendingPkceAuthorization | null,
	expectedProviderId?: string
): PkceCallbackValidationResult {
	const params = parsePkceCallbackParams(input);
	if (params.error) {
		return {
			ok: false,
			error: 'provider-error',
			description: params.errorDescription ?? params.error,
		};
	}
	if (!pending) return { ok: false, error: 'missing-session' };
	if (expectedProviderId && pending.providerId !== expectedProviderId) {
		return { ok: false, error: 'provider-mismatch' };
	}
	if (!params.state) return { ok: false, error: 'missing-state' };
	if (params.state !== pending.state) return { ok: false, error: 'state-mismatch' };
	if (!params.code) return { ok: false, error: 'missing-code' };
	return {
		ok: true,
		providerId: pending.providerId,
		code: params.code,
		state: pending.state,
		codeVerifier: pending.codeVerifier,
	};
}

export function removeOAuthCallbackParams(url: URL): URL {
	const next = new URL(url.toString());
	for (const param of ['code', 'state', 'error', 'error_description', 'error_uri']) {
		next.searchParams.delete(param);
	}
	return next;
}

function randomBytes(byteLength: number): Uint8Array {
	const bytes = new Uint8Array(byteLength);
	if (!globalThis.crypto?.getRandomValues) {
		throw new Error('PKCE values require Web Crypto random values.');
	}
	globalThis.crypto.getRandomValues(bytes);
	return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	const base64 =
		typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function toSearchParams(input: string | URL | URLSearchParams): URLSearchParams {
	if (input instanceof URLSearchParams) return input;
	if (input instanceof URL) return input.searchParams;
	if (/^https?:\/\//i.test(input)) return new URL(input).searchParams;
	return new URLSearchParams(input.startsWith('?') ? input.slice(1) : input);
}

function isPendingPkceAuthorization(value: unknown): value is PendingPkceAuthorization {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.providerId === 'string' &&
		typeof candidate.state === 'string' &&
		typeof candidate.codeVerifier === 'string' &&
		typeof candidate.createdAt === 'string'
	);
}
