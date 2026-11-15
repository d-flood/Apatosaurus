import { DOMParser } from '@xmldom/xmldom';
import type { Document as XmlDocument } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';

import { hashCanonicalPayload } from '../canonical-json';

import { sealDocument, serializeSealedDocument, type JsonObject } from '../envelope';
import {
	CBGM_ANALYSIS_FORMAT,
	PROJECT_MANIFEST_CURRENT_VERSION,
	PROJECT_MANIFEST_FORMAT,
	TOMBSTONE_FORMAT,
	canonicalFormatRegistrations,
	createCanonicalFormatRegistry,
	readCanonicalDocument,
	serializeCanonicalDocument,
	serializeTranscriptionTei,
} from './index';
import projectManifestV1Input from './fixtures/project-manifest-v1.input.json';
import projectManifestV2Expected from './fixtures/project-manifest-v2.expected.json';
import projectManifestV2Input from './fixtures/project-manifest-v2.input.json';
import projectManifestV3Expected from './fixtures/project-manifest-v3.expected.json';
import projectManifestV4Input from './fixtures/project-manifest-v4.input.json';
import projectManifestV5Expected from './fixtures/project-manifest-v5.expected.json';
import projectManifestV5Input from './fixtures/project-manifest-v5.input.json';
import projectManifestV6Expected from './fixtures/project-manifest-v6.expected.json';
import projectManifestV3Input from './fixtures/project-manifest-v3.input.json';
import projectManifestV4Expected from './fixtures/project-manifest-v4.expected.json';
import {
	PROJECT_MANIFEST_FIXTURE,
	PROJECT_TRANSCRIPTION_FIXTURE,
	TOMBSTONE_FIXTURE,
} from '$lib/storage/formats/payload-fixtures';

const FORMAT_FIXTURES = [
	{
		format: PROJECT_MANIFEST_FORMAT,
		version: PROJECT_MANIFEST_CURRENT_VERSION,
		payload: PROJECT_MANIFEST_FIXTURE,
	},
	{ format: TOMBSTONE_FORMAT, version: 1, payload: TOMBSTONE_FIXTURE },
] as const;

describe('canonical store formats', () => {
	it('upgrades v5 project manifests with manual witness descriptions unchanged', async () => {
		expect(
			await readCanonicalDocument(
				PROJECT_MANIFEST_FORMAT,
				await sealDocument(PROJECT_MANIFEST_FORMAT, 5, projectManifestV5Input)
			)
		).toMatchObject({
			ok: true,
			upgraded: true,
			originalVersion: 5,
			payload: projectManifestV6Expected,
		});
	});

	it('upgrades v4 project manifests with suffixless reading types unchanged', async () => {
		expect(
			await readCanonicalDocument(
				PROJECT_MANIFEST_FORMAT,
				await sealDocument(PROJECT_MANIFEST_FORMAT, 4, projectManifestV4Input)
			)
		).toMatchObject({
			ok: true,
			upgraded: true,
			originalVersion: 4,
			payload: projectManifestV5Expected,
		});
	});

	it('registers all canonical formats with migrate-on-read', () => {
		expect(canonicalFormatRegistrations.map(registration => registration.format)).toEqual([
			PROJECT_MANIFEST_FORMAT,
			TOMBSTONE_FORMAT,
			CBGM_ANALYSIS_FORMAT,
		]);
	});

	it('round-trips every format through envelope serialization and registry reads', async () => {
		const registry = createCanonicalFormatRegistry();
		for (const { format, version, payload } of FORMAT_FIXTURES) {
			const sealed = await sealDocument(format, version, payload as JsonObject);
			const serialized = serializeSealedDocument(sealed);
			const read = await registry.readDocument(format, serialized);
			const resealed = await sealDocument(format, version, payload as JsonObject);

			expect(read).toMatchObject({ ok: true, upgraded: false, originalVersion: version });
			if (!read.ok) throw new Error(`Expected ${format} fixture to read.`);
			expect(read.payload).toEqual(payload);
			expect(resealed.content_hash).toBe(sealed.content_hash);
		}
	});

	it('migrates project manifests from v1 with no fork provenance', async () => {
		const legacy = await sealDocument(PROJECT_MANIFEST_FORMAT, 1, projectManifestV1Input);
		const read = await readCanonicalDocument(
			PROJECT_MANIFEST_FORMAT,
			serializeSealedDocument(legacy)
		);

		expect(read).toMatchObject({ ok: true, upgraded: true, originalVersion: 1 });
		if (!read.ok) throw new Error('Expected project manifest v1 fixture to migrate.');
		expect(read.payload).toEqual(projectManifestV2Expected);
	});

	it('upgrades v2 manifests with reading tags unchanged', async () => {
		const result = await readCanonicalDocument(
			PROJECT_MANIFEST_FORMAT,
			await sealDocument(PROJECT_MANIFEST_FORMAT, 2, projectManifestV2Input)
		);
		expect(result).toMatchObject({
			ok: true,
			upgraded: true,
			originalVersion: 2,
			payload: projectManifestV3Expected,
		});
	});

	it('upgrades v3 project manifests with manual-witness fixtures', async () => {
		expect(
			await readCanonicalDocument(
				PROJECT_MANIFEST_FORMAT,
				await sealDocument(PROJECT_MANIFEST_FORMAT, 3, projectManifestV3Input)
			)
		).toMatchObject({
			ok: true,
			upgraded: true,
			originalVersion: 3,
			payload: projectManifestV4Expected,
		});
	});

	it('rejects a resealed manifest whose head path is not canonical', async () => {
		const payload = {
			...PROJECT_MANIFEST_FIXTURE,
			transcriptions: [
				{
					...PROJECT_MANIFEST_FIXTURE.transcriptions[0],
					primary_path: 'transcriptions/wrong.json',
				},
			],
		};
		payload.manifest_content_hash = await hashCanonicalPayload({
			project_id: payload.id,
			transcriptions: payload.transcriptions,
			collations: payload.collations,
			tombstones: payload.tombstones,
		});
		const document = await sealDocument(PROJECT_MANIFEST_FORMAT, 1, payload);

		await expect(
			readCanonicalDocument(PROJECT_MANIFEST_FORMAT, document)
		).resolves.toMatchObject({
			ok: false,
			quarantine: { code: 'invalid_shape' },
		});
	});

	it('rejects a canonical tombstone read from the alternate tombstone-id path', async () => {
		const bytes = await serializeCanonicalDocument(TOMBSTONE_FORMAT, TOMBSTONE_FIXTURE);

		await expect(
			readCanonicalDocument(TOMBSTONE_FORMAT, bytes, {
				projectPath: `tombstones/${TOMBSTONE_FIXTURE.id}.json`,
			})
		).resolves.toMatchObject({ ok: false, quarantine: { code: 'invalid_shape' } });
	});
});

describe('transcription TEI serializer', () => {
	it('serializes project transcription documents as well-formed TEI', async () => {
		const { xml } = await serializeTranscriptionTei(PROJECT_TRANSCRIPTION_FIXTURE);
		const doc = parseXml(xml);

		expect(doc.getElementsByTagName('TEI')).toHaveLength(1);
		expect(doc.getElementsByTagName('title')[0]?.textContent).toBe('Witness A');
	});

	it('cites each used reference edition from the document by id', async () => {
		const fixture = transcriptionWithEditions(['edition-one', 'user-missing-device'], {
			'user-missing-device': 'Missing-device edition attribution',
		});
		const doc = parseXml((await serializeTranscriptionTei(fixture)).xml);

		expect(
			referenceEditionEntries(doc).map(node => [
				node.getAttribute('xml:id'),
				node.textContent,
			])
		).toEqual([
			['edition-one', ''],
			['user-missing-device', 'Missing-device edition attribution'],
		]);
	});

	it('writes no reference edition list when none were used', async () => {
		const withoutSet = await serializeTranscriptionTei(PROJECT_TRANSCRIPTION_FIXTURE);
		const withEmptySet = await serializeTranscriptionTei(transcriptionWithEditions([]));

		expect(withEmptySet.xml).toBe(withoutSet.xml);
		expect(withoutSet.xml).not.toContain('<listBibl');
	});
});

function parseXml(xml: string): XmlDocument {
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
	return doc;
}

function transcriptionWithEditions(
	referenceEditionsUsed: string[],
	referenceEditionAttributions?: Record<string, string>
) {
	return {
		...PROJECT_TRANSCRIPTION_FIXTURE,
		content_json: {
			type: 'transcriptionDocument',
			pages: [],
			...(referenceEditionsUsed.length > 0 ? { referenceEditionsUsed } : {}),
			...(referenceEditionAttributions ? { referenceEditionAttributions } : {}),
		},
	};
}

function referenceEditionEntries(doc: XmlDocument) {
	return Array.from(doc.getElementsByTagName('bibl')).filter(
		node => node.getAttribute('type') === 'referenceEdition'
	);
}
