import { canonicalJson, hashCanonicalPayload } from '$lib/client/sync/canonical-json';
import { hashMismatch, invalidJson, invalidShape } from './quarantine';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export interface DocumentEnvelopeHeader<TFormat extends string = string> {
	format: TFormat;
	schema_version: number;
	content_hash: string;
}

export type SealedDocument<
	TPayload extends JsonObject = JsonObject,
	TFormat extends string = string,
> = DocumentEnvelopeHeader<TFormat> & TPayload;

export interface OpenedEnvelope<
	TPayload extends JsonObject = JsonObject,
	TFormat extends string = string,
> {
	document: SealedDocument<TPayload, TFormat>;
	header: DocumentEnvelopeHeader<TFormat>;
	payload: TPayload;
}

const RESERVED_ENVELOPE_FIELDS = new Set(['format', 'schema_version', 'content_hash']);

export async function sealDocument<TPayload extends JsonObject, TFormat extends string>(
	format: TFormat,
	schemaVersion: number,
	payload: TPayload
): Promise<SealedDocument<TPayload, TFormat>> {
	validateFormat(format);
	validateSchemaVersion(schemaVersion);
	assertPayloadObject(payload);
	assertPayloadHasNoReservedFields(payload);
	return {
		format,
		schema_version: schemaVersion,
		content_hash: await hashCanonicalPayload(payload),
		...payload,
	};
}

export function openEnvelope(raw: string | unknown): OpenedEnvelope {
	const value = typeof raw === 'string' ? parseJson(raw) : raw;
	const record = readObject(value, 'Document');
	const format = readString(record, 'format');
	const schemaVersion = readSchemaVersion(record);
	const contentHash = readString(record, 'content_hash');
	const payload = payloadFromRecord(record);

	return {
		document: record as SealedDocument,
		header: {
			format,
			schema_version: schemaVersion,
			content_hash: contentHash,
		},
		payload,
	};
}

export async function assertEnvelopeHash(opened: OpenedEnvelope, label = 'Document'): Promise<void> {
	let actualHash: string;
	try {
		actualHash = await hashCanonicalPayload(opened.payload);
	} catch (error) {
		throw invalidShape(`${label} payload is not canonicalizable: ${errorMessage(error)}`);
	}
	if (actualHash !== opened.header.content_hash) {
		throw hashMismatch(
			`${label} content hash mismatch.`,
			opened.header.content_hash,
			actualHash
		);
	}
}

export function serializeSealedDocument(document: DocumentEnvelopeHeader & object): string {
	return canonicalJson(document);
}

export function payloadFromEnvelope<TPayload extends JsonObject = JsonObject>(
	document: SealedDocument
): TPayload {
	return payloadFromRecord(document as Record<string, unknown>) as TPayload;
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch (error) {
		throw invalidJson(`Document is not valid JSON: ${errorMessage(error)}`);
	}
}

function payloadFromRecord(record: Record<string, unknown>): JsonObject {
	const payload: Record<string, JsonValue> = {};
	for (const [key, value] of Object.entries(record)) {
		if (RESERVED_ENVELOPE_FIELDS.has(key)) continue;
		assertJsonValue(value, key);
		payload[key] = value;
	}
	try {
		canonicalJson(payload);
	} catch (error) {
		throw invalidShape(`Document payload is not canonicalizable: ${errorMessage(error)}`);
	}
	return payload;
}

function assertPayloadObject(payload: JsonObject): void {
	readObject(payload, 'Document payload');
	try {
		canonicalJson(payload);
	} catch (error) {
		throw invalidShape(`Document payload is not canonicalizable: ${errorMessage(error)}`);
	}
}

function assertPayloadHasNoReservedFields(payload: JsonObject): void {
	for (const key of RESERVED_ENVELOPE_FIELDS) {
		if (key in payload) throw invalidShape(`Document payload cannot include reserved field ${key}.`);
	}
}

function assertJsonValue(value: unknown, path: string): asserts value is JsonValue {
	try {
		canonicalJson(value);
	} catch (error) {
		throw invalidShape(`${path} is not canonicalizable JSON: ${errorMessage(error)}`);
	}
}

function readObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw invalidShape(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== 'string') throw invalidShape(`${key} must be a string.`);
	return value;
}

function readSchemaVersion(record: Record<string, unknown>): number {
	const value = record.schema_version;
	if (!Number.isInteger(value) || (value as number) < 1) {
		throw invalidShape('schema_version must be a positive integer.');
	}
	return value as number;
}

function validateFormat(format: string): void {
	if (!format.trim()) throw invalidShape('format is required.');
}

function validateSchemaVersion(version: number): void {
	if (!Number.isInteger(version) || version < 1) {
		throw invalidShape('schema_version must be a positive integer.');
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
