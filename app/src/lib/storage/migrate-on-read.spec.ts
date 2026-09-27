import { describe, expect, it } from 'vitest';

import v1Payload from './__fixtures__/synthetic-v1-payload.json';
import v2Payload from './__fixtures__/synthetic-v2-payload.json';
import v3Payload from './__fixtures__/synthetic-v3-payload.json';
import { openEnvelope, sealDocument, type JsonObject } from './envelope';
import {
	createMigrationRegistry,
	type DocumentUpgrader,
	type MigrationRegistry,
} from './migrate-on-read';
import { createQuarantineReport, recordQuarantineResult } from './quarantine';

const FORMAT = 'apatosaurus.synthetic';

type SyntheticPayload = JsonObject & {
	name: string;
	body: JsonObject & { text: string };
	tags: string[];
};

describe('migrate-on-read registry', () => {
	it('chains v1 to v3 upgrades and returns a sealed current document', async () => {
		const registry = syntheticRegistry();
		const v1Document = await sealDocument(FORMAT, 1, v1Payload);

		const result = await registry.readDocument<SyntheticPayload>(FORMAT, v1Document);

		expect(result).toMatchObject({ ok: true, upgraded: true, originalVersion: 1 });
		if (!result.ok) throw new Error('Expected v1 document to upgrade.');
		expect(result.payload).toEqual(v3Payload);
		expect(result.document.schema_version).toBe(3);
		await expect(import('./envelope').then(({ assertEnvelopeHash }) => assertEnvelopeHash(openEnvelope(result.document)))).resolves.toBeUndefined();
	});

	it('upgrades v2 documents and passes current v3 documents through without upgrading', async () => {
		const registry = syntheticRegistry();
		const v2Document = await sealDocument(FORMAT, 2, v2Payload);
		const v3Document = await sealDocument(FORMAT, 3, v3Payload);

		const upgraded = await registry.readDocument<SyntheticPayload>(FORMAT, v2Document);
		const current = await registry.readDocument<SyntheticPayload>(FORMAT, v3Document);

		expect(upgraded).toMatchObject({ ok: true, upgraded: true, originalVersion: 2 });
		expect(current).toMatchObject({ ok: true, upgraded: false, originalVersion: 3 });
		if (!upgraded.ok || !current.ok) throw new Error('Expected valid synthetic documents.');
		expect(upgraded.payload).toEqual(v3Payload);
		expect(current.document).toEqual(v3Document);
	});

	it('returns quarantine codes for invalid JSON, schema versions, shapes, and hashes', async () => {
		const registry = syntheticRegistry();
		const tooNewDocument = await sealDocument(FORMAT, 4, v3Payload);
		const invalidShapeDocument = await sealDocument(FORMAT, 3, {
			name: 42,
			body: { text: 'alpha beta' },
			tags: [],
		});
		const validDocument = await sealDocument(FORMAT, 3, v3Payload);

		const invalidJson = await registry.readDocument(FORMAT, '{');
		const invalidSchemaVersion = await registry.readDocument(FORMAT, tooNewDocument);
		const invalidShape = await registry.readDocument(FORMAT, invalidShapeDocument);
		const hashMismatch = await registry.readDocument(FORMAT, {
			...validDocument,
			name: 'Tampered Synthetic Witness',
		});

		expect(invalidJson).toMatchObject({ ok: false, quarantine: { code: 'invalid_json' } });
		expect(invalidSchemaVersion).toMatchObject({
			ok: false,
			quarantine: { code: 'invalid_schema_version' },
		});
		expect(invalidShape).toMatchObject({ ok: false, quarantine: { code: 'invalid_shape' } });
		expect(hashMismatch).toMatchObject({ ok: false, quarantine: { code: 'hash_mismatch' } });
	});

	it('records failed reads in an in-memory quarantine report', async () => {
		const registry = syntheticRegistry();
		const report = createQuarantineReport();
		const result = await registry.readDocument(FORMAT, '{');

		const recorded = recordQuarantineResult(
			report,
			'projects/default/transcriptions/bad.json',
			result,
			'2026-07-03T00:00:00.000Z'
		);

		expect(recorded).toBe(true);
		expect(report.list()).toEqual([
			expect.objectContaining({
				path: 'projects/default/transcriptions/bad.json',
				timestamp: '2026-07-03T00:00:00.000Z',
				code: 'invalid_json',
			}),
		]);
	});
});

function syntheticRegistry(): MigrationRegistry {
	const registry = createMigrationRegistry();
	registry.registerFormat(FORMAT, 3, [upgradeV1ToV2, upgradeV2ToV3], validateSyntheticPayload);
	return registry;
}

const upgradeV1ToV2: DocumentUpgrader = payload => ({
	title: readString(payload, 'title'),
	body: { text: readString(payload, 'body') },
});

const upgradeV2ToV3: DocumentUpgrader = payload => ({
	name: readString(payload, 'title'),
	body: readObject(payload, 'body'),
	tags: [],
});

function validateSyntheticPayload(payload: JsonObject): SyntheticPayload {
	const body = readObject(payload, 'body');
	const tags = payload.tags;
	if (!Array.isArray(tags) || !tags.every((tag): tag is string => typeof tag === 'string')) {
		throw new Error('tags must be a string array.');
	}
	return {
		name: readString(payload, 'name'),
		body: { text: readString(body, 'text') },
		tags: [...tags],
	};
}

function readObject(payload: JsonObject, key: string): JsonObject {
	const value = payload[key];
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${key} must be an object.`);
	return value as JsonObject;
}

function readString(payload: JsonObject, key: string): string {
	const value = payload[key];
	if (typeof value !== 'string') throw new Error(`${key} must be a string.`);
	return value;
}
