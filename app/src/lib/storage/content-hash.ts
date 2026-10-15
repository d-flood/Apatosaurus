export async function hashContent(content: string | Uint8Array): Promise<string> {
	const digest = await globalThis.crypto?.subtle?.digest(
		'SHA-256',
		typeof content === 'string'
			? new TextEncoder().encode(content)
			: (content as Uint8Array<ArrayBuffer>)
	);
	if (!digest) throw new Error('SHA-256 hashing requires Web Crypto support.');
	return `sha256:${[...new Uint8Array(digest)]
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('')}`;
}
