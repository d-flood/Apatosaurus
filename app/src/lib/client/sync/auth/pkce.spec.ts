import { describe, expect, it } from 'vitest';

import {
	consumePkceAuthorization,
	createCodeChallenge,
	createPkceAuthorizationRequest,
	generateCodeVerifier,
	generatePkceState,
	removeOAuthCallbackParams,
	storePkceAuthorization,
	validatePkceCallback,
	type PkceSessionStore,
} from './pkce';

describe('PKCE helpers', () => {
	it('generates browser-safe verifier and S256 challenge values', async () => {
		const verifier = generateCodeVerifier();
		const state = generatePkceState();
		const challenge = await createCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');

		expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
		expect(state).toMatch(/^[A-Za-z0-9_-]{22,}$/);
		expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
	});

	it('stores pending authorization and validates callback state before code exchange', async () => {
		const store = new MemoryPkceSessionStore();
		const pending = await createPkceAuthorizationRequest('mock', '2026-06-10T12:00:00.000Z');
		storePkceAuthorization(store, pending);

		const stored = consumePkceAuthorization(store);
		const valid = validatePkceCallback(
			new URLSearchParams({ code: 'auth-code', state: pending.state }),
			stored,
			'mock'
		);
		const mismatch = validatePkceCallback(
			new URLSearchParams({ code: 'auth-code', state: 'wrong' }),
			pending,
			'mock'
		);

		expect(valid).toEqual({
			ok: true,
			providerId: 'mock',
			code: 'auth-code',
			state: pending.state,
			codeVerifier: pending.codeVerifier,
		});
		expect(mismatch).toEqual({ ok: false, error: 'state-mismatch' });
		expect(consumePkceAuthorization(store)).toBeNull();
	});

	it('recognizes provider callback errors and strips OAuth query parameters', () => {
		const url = new URL(
			'https://app.example/callback?code=abc&state=state&error=access_denied&error_description=Denied&view=sync'
		);

		expect(validatePkceCallback(url, null)).toEqual({
			ok: false,
			error: 'provider-error',
			description: 'Denied',
		});
		expect(removeOAuthCallbackParams(url).toString()).toBe(
			'https://app.example/callback?view=sync'
		);
	});
});

class MemoryPkceSessionStore implements PkceSessionStore {
	private values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}
}
