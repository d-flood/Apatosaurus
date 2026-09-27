import { describe, expect, it } from 'vitest';

import {
	assertEnvelopeHash,
	openEnvelope,
	sealDocument,
	serializeSealedDocument,
	type JsonObject,
} from './envelope';

describe('document envelope helpers', () => {
	it('seals, serializes, opens, and verifies a payload hash', async () => {
		const payload = { title: 'Codex', metadata: { b: 'second', a: 'first' } } satisfies JsonObject;

		const document = await sealDocument('apatosaurus.test', 1, payload);
		const opened = openEnvelope(serializeSealedDocument(document));

		expect(document).toMatchObject({
			format: 'apatosaurus.test',
			schema_version: 1,
			content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
		});
		expect(opened.payload).toEqual(payload);
		await expect(assertEnvelopeHash(opened)).resolves.toBeUndefined();
	});

	it('reports invalid JSON, invalid shape, and hash mismatches', async () => {
		const document = await sealDocument('apatosaurus.test', 1, { title: 'Codex' });

		expect(() => openEnvelope('{')).toThrow('Document is not valid JSON');
		await expect(sealDocument('apatosaurus.test', 1, { format: 'payload-value' })).rejects.toMatchObject({
			code: 'invalid_shape',
		});
		await expect(
			assertEnvelopeHash(openEnvelope({ ...document, title: 'Tampered Codex' }))
		).rejects.toMatchObject({ code: 'hash_mismatch' });
	});
});
