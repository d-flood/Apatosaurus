import { canonicalJson, hashCanonicalPayload } from '$lib/client/sync/canonical-json';

import type { JsonObject, JsonValue } from '../envelope';
import { hashMismatch, invalidShape } from '../quarantine';

export function readObjectValue(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw invalidShape(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

export function readObjectField(record: Record<string, unknown>, key: string): Record<string, unknown> {
	return readObjectValue(record[key], key);
}

export function readString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== 'string') throw invalidShape(`${key} must be a string.`);
	return value;
}

export function readNullableString(record: Record<string, unknown>, key: string): string | null {
	const value = record[key];
	if (value === null) return null;
	if (typeof value !== 'string') throw invalidShape(`${key} must be a string or null.`);
	return value;
}

export function readBoolean(record: Record<string, unknown>, key: string): boolean {
	const value = record[key];
	if (typeof value !== 'boolean') throw invalidShape(`${key} must be a boolean.`);
	return value;
}

export function readFiniteNumber(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw invalidShape(`${key} must be a finite number.`);
	}
	return value;
}

export function readArray(record: Record<string, unknown>, key: string): unknown[] {
	const value = record[key];
	if (!Array.isArray(value)) throw invalidShape(`${key} must be an array.`);
	return value;
}

export function readStringArray(record: Record<string, unknown>, key: string): string[] {
	return readArray(record, key).map((value, index) => {
		if (typeof value !== 'string') throw invalidShape(`${key}[${index}] must be a string.`);
		return value;
	});
}

export function readJsonValue(record: Record<string, unknown>, key: string): JsonValue {
	const value = record[key];
	try {
		canonicalJson(value);
	} catch (error) {
		throw invalidShape(`${key} is not canonicalizable JSON: ${errorMessage(error)}`);
	}
	return value as JsonValue;
}

export function readLiteral<T extends string>(
	record: Record<string, unknown>,
	key: string,
	expected: T
): T {
	const value = readString(record, key);
	if (value !== expected) throw invalidShape(`${key} must be ${JSON.stringify(expected)}.`);
	return expected;
}

export async function assertContentHashMatches(
	payload: unknown,
	expectedHash: string,
	label: string
): Promise<void> {
	let actualHash: string;
	try {
		actualHash = await hashCanonicalPayload(payload);
	} catch (error) {
		throw invalidShape(`${label} payload is not canonicalizable: ${errorMessage(error)}`);
	}
	if (actualHash !== expectedHash) {
		throw hashMismatch(`${label} content hash mismatch.`, expectedHash, actualHash);
	}
}

export function assertJsonObject(value: unknown, label: string): JsonObject {
	readObjectValue(value, label);
	try {
		canonicalJson(value);
	} catch (error) {
		throw invalidShape(`${label} is not canonicalizable JSON: ${errorMessage(error)}`);
	}
	return value as JsonObject;
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
