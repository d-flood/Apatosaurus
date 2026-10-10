const IV_BYTES = 12;

export async function seal(payload: unknown, secret: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		await importKey(secret),
		new TextEncoder().encode(JSON.stringify(payload))
	);
	const sealed = new Uint8Array(IV_BYTES + ciphertext.byteLength);
	sealed.set(iv);
	sealed.set(new Uint8Array(ciphertext), IV_BYTES);
	return base64UrlEncode(sealed);
}

export async function unseal<T>(token: string, secret: string): Promise<T | null> {
	try {
		const sealed = base64UrlDecode(token);
		const plaintext = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: sealed.slice(0, IV_BYTES) },
			await importKey(secret),
			sealed.slice(IV_BYTES)
		);
		return JSON.parse(new TextDecoder().decode(plaintext)) as T;
	} catch {
		return null;
	}
}

export function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text: string): Uint8Array {
	const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
	return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function importKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', base64UrlDecode(secret), 'AES-GCM', false, [
		'encrypt',
		'decrypt',
	]);
}
