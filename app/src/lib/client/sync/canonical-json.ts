export function canonicalJson(value: unknown): string {
	return serializeCanonicalValue(value, '$');
}

export async function hashCanonicalPayload(value: unknown): Promise<string> {
	const digest = await globalThis.crypto?.subtle?.digest(
		'SHA-256',
		new TextEncoder().encode(canonicalJson(value))
	);
	if (!digest) throw new Error('SHA-256 hashing requires Web Crypto support.');
	return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

function serializeCanonicalValue(value: unknown, path: string): string {
	if (value === null) return 'null';
	if (typeof value === 'string') return JSON.stringify(normalizeString(value));
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'number') {
		if (!Number.isFinite(value))
			throw new Error(`Cannot canonicalize non-finite number at ${path}.`);
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry, index) => serializeCanonicalValue(entry, `${path}[${index}]`)).join(',')}]`;
	}
	if (typeof value === 'object')
		return serializeCanonicalObject(value as Record<string, unknown>, path);
	throw new Error(`Cannot canonicalize ${typeof value} at ${path}.`);
}

function serializeCanonicalObject(value: Record<string, unknown>, path: string): string {
	const entries = Object.entries(value).map(
		([key, entry]) => [normalizeString(key), entry] as const
	);
	const keys = new Set<string>();
	for (const [key] of entries) {
		if (keys.has(key))
			throw new Error(
				`Cannot canonicalize duplicate normalized key ${JSON.stringify(key)} at ${path}.`
			);
		keys.add(key);
	}
	entries.sort(([a], [b]) => compareCodePoints(a, b));
	return `{${entries
		.map(
			([key, entry]) =>
				`${JSON.stringify(key)}:${serializeCanonicalValue(entry, `${path}.${key}`)}`
		)
		.join(',')}}`;
}

function normalizeString(value: string): string {
	return value.normalize('NFC').replace(/\r\n?/g, '\n');
}

function compareCodePoints(left: string, right: string): number {
	const leftCodePoints = Array.from(left);
	const rightCodePoints = Array.from(right);
	const length = Math.min(leftCodePoints.length, rightCodePoints.length);
	for (let index = 0; index < length; index += 1) {
		const leftPoint = leftCodePoints[index].codePointAt(0) ?? 0;
		const rightPoint = rightCodePoints[index].codePointAt(0) ?? 0;
		if (leftPoint !== rightPoint) return leftPoint - rightPoint;
	}
	return leftCodePoints.length - rightCodePoints.length;
}

function bytesToHex(bytes: Uint8Array): string {
	return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
