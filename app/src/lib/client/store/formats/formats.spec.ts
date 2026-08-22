import { DOMParser } from '@xmldom/xmldom';
import type { Document as XmlDocument } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';

import type { ReferenceEditionCatalogEntry } from '$lib/reference-editions/catalog';
import { hashCanonicalPayload } from '../canonical-json';
import { MemoryStoreBackend } from '../memory-store-backend.spec-support';
import { registerUserReferenceEdition } from '../user-reference-editions';

import { sealDocument, serializeSealedDocument, type JsonObject } from '../envelope';
import {
	COLLATION_CHECKPOINT_FIXTURE,
	COLLATION_CHECKPOINT_CURRENT_VERSION,
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_CHECKPOINT_OLD_SHAPE_FIXTURE,
	type CollationCheckpointPayload,
	COLLATION_FIXTURE,
	COLLATION_CURRENT_VERSION,
	COLLATION_FORMAT,
	PROJECT_MANIFEST_FIXTURE,
	PROJECT_MANIFEST_CURRENT_VERSION,
	PROJECT_MANIFEST_FORMAT,
	PROJECT_TRANSCRIPTION_FIXTURE,
	PROJECT_TRANSCRIPTION_FORMAT,
	PROJECT_TRANSCRIPTION_OLD_SHAPE_FIXTURE,
	TOMBSTONE_FIXTURE,
	TOMBSTONE_FORMAT,
	TRANSCRIPTION_CHECKPOINT_FIXTURE,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	TRANSCRIPTION_CHECKPOINT_OLD_SHAPE_FIXTURE,
	WORKING_COLLATION_FIXTURE,
	WORKING_COLLATION_CURRENT_VERSION,
	WORKING_COLLATION_FORMAT,
	WORKING_TRANSCRIPTION_FIXTURE,
	WORKING_TRANSCRIPTION_FORMAT,
	canonicalFormatRegistrations,
	createCanonicalFormatRegistry,
	readCanonicalDocument,
	serializeCanonicalDocument,
	transcriptionDocumentToTei,
	transcriptionDocumentToTeiFromStore,
} from './index';
import {
	collationPayloadToContent,
	type CollationPayload,
} from './collation';
import collationV1Input from './fixtures/collation-v1.input.json';
import workingCollationV1Input from './fixtures/working-collation-v1.input.json';
import checkpointCollationV1Input from './fixtures/checkpoint-collation-v1.input.json';
import projectManifestV1Input from './fixtures/project-manifest-v1.input.json';
import projectManifestV2Expected from './fixtures/project-manifest-v2.expected.json';

const FORMAT_FIXTURES = [
	{
		format: PROJECT_MANIFEST_FORMAT,
		version: PROJECT_MANIFEST_CURRENT_VERSION,
		payload: PROJECT_MANIFEST_FIXTURE,
	},
	{ format: PROJECT_TRANSCRIPTION_FORMAT, version: 1, payload: PROJECT_TRANSCRIPTION_FIXTURE },
	{ format: COLLATION_FORMAT, version: COLLATION_CURRENT_VERSION, payload: COLLATION_FIXTURE },
	{
		format: TRANSCRIPTION_CHECKPOINT_FORMAT,
		version: 1,
		payload: TRANSCRIPTION_CHECKPOINT_FIXTURE,
	},
	{
		format: COLLATION_CHECKPOINT_FORMAT,
		version: COLLATION_CHECKPOINT_CURRENT_VERSION,
		payload: COLLATION_CHECKPOINT_FIXTURE,
	},
	{ format: TOMBSTONE_FORMAT, version: 1, payload: TOMBSTONE_FIXTURE },
	{ format: WORKING_TRANSCRIPTION_FORMAT, version: 1, payload: WORKING_TRANSCRIPTION_FIXTURE },
	{
		format: WORKING_COLLATION_FORMAT,
		version: WORKING_COLLATION_CURRENT_VERSION,
		payload: WORKING_COLLATION_FIXTURE,
	},
] as const;

describe('canonical store formats', () => {
	it('registers all canonical formats with migrate-on-read', () => {
		expect(canonicalFormatRegistrations.map(registration => registration.format)).toEqual([
			PROJECT_MANIFEST_FORMAT,
			PROJECT_TRANSCRIPTION_FORMAT,
			COLLATION_FORMAT,
			TRANSCRIPTION_CHECKPOINT_FORMAT,
			COLLATION_CHECKPOINT_FORMAT,
			TOMBSTONE_FORMAT,
			WORKING_TRANSCRIPTION_FORMAT,
			WORKING_COLLATION_FORMAT,
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

	it('round-trips a complete project file set through the canonical API', async () => {
		const transcription = {
			...PROJECT_TRANSCRIPTION_FIXTURE,
			origin: {
				source_type: 'copied',
				source_project_id: 'source-project',
				source_transcription_id: 'source-tx',
				source_revision_id: 'source-cp',
				source_content_hash: 'sha256:source',
			},
		};
		const tombstoneHash = await hashCanonicalPayload(TOMBSTONE_FIXTURE);
		const manifest = {
			...PROJECT_MANIFEST_FIXTURE,
			transcriptions: [
				{
					...PROJECT_MANIFEST_FIXTURE.transcriptions[0],
					current_revision: {
						id: transcription.current_revision.id,
						content_hash: transcription.current_revision.content_hash,
					},
				},
			],
			collations: [
				{
					...PROJECT_MANIFEST_FIXTURE.collations[0],
					current_revision: {
						id: COLLATION_FIXTURE.current_revision.id,
						content_hash: COLLATION_FIXTURE.current_revision.content_hash,
					},
				},
			],
			tombstones: [
				{
					tombstone_id: TOMBSTONE_FIXTURE.id,
					entity_type: TOMBSTONE_FIXTURE.entity_type,
					entity_id: TOMBSTONE_FIXTURE.entity_id,
					deletion_revision_id: TOMBSTONE_FIXTURE.deletion_revision_id,
					content_hash: tombstoneHash,
					primary_path: `tombstones/${TOMBSTONE_FIXTURE.entity_type}--${TOMBSTONE_FIXTURE.entity_id}.json`,
					deleted_at: TOMBSTONE_FIXTURE.deleted_at,
				},
			],
		};
		manifest.manifest_content_hash = await hashCanonicalPayload({
			project_id: manifest.id,
			transcriptions: manifest.transcriptions,
			collations: manifest.collations,
			tombstones: manifest.tombstones,
		});
		const completeProject = [
			[PROJECT_MANIFEST_FORMAT, manifest],
			[PROJECT_TRANSCRIPTION_FORMAT, transcription],
			[COLLATION_FORMAT, COLLATION_FIXTURE],
			[WORKING_TRANSCRIPTION_FORMAT, WORKING_TRANSCRIPTION_FIXTURE],
			[WORKING_COLLATION_FORMAT, WORKING_COLLATION_FIXTURE],
			[TRANSCRIPTION_CHECKPOINT_FORMAT, TRANSCRIPTION_CHECKPOINT_FIXTURE],
			[COLLATION_CHECKPOINT_FORMAT, COLLATION_CHECKPOINT_FIXTURE],
			[TOMBSTONE_FORMAT, TOMBSTONE_FIXTURE],
		] as const;

		for (const [format, payload] of completeProject) {
			const bytes = await serializeCanonicalDocument(format, payload as JsonObject);
			const result = await readCanonicalDocument(format, bytes);
			expect(result).toMatchObject({ ok: true });
			if (!result.ok) throw new Error(`Expected ${format} to round-trip.`);
			expect(result.payload).toEqual(payload);
		}
	});

	it('rejects stale reserved-field shapes cleanly', async () => {
		const registry = createCanonicalFormatRegistry();

		await expect(
			registry.readDocument(
				PROJECT_TRANSCRIPTION_FORMAT,
				PROJECT_TRANSCRIPTION_OLD_SHAPE_FIXTURE
			)
		).resolves.toMatchObject({ ok: false, quarantine: { code: 'invalid_shape' } });
		await expect(
			registry.readDocument(
				TRANSCRIPTION_CHECKPOINT_FORMAT,
				TRANSCRIPTION_CHECKPOINT_OLD_SHAPE_FIXTURE
			)
		).resolves.toMatchObject({ ok: false, quarantine: { code: 'invalid_shape' } });
		await expect(
			registry.readDocument(
				COLLATION_CHECKPOINT_FORMAT,
				COLLATION_CHECKPOINT_OLD_SHAPE_FIXTURE
			)
		).resolves.toMatchObject({ ok: false, quarantine: { code: 'invalid_shape' } });
	});

	it('rejects canonical collations without a project', async () => {
		const registry = createCanonicalFormatRegistry();
		const document = await sealDocument(COLLATION_FORMAT, COLLATION_CURRENT_VERSION, {
			...COLLATION_FIXTURE,
			project_id: null,
		} as JsonObject);

		await expect(registry.readDocument(COLLATION_FORMAT, document)).resolves.toMatchObject({
			ok: false,
			quarantine: { code: 'invalid_shape' },
		});
	});

	it('quarantines current collations with connectivity in apparatus decisions', async () => {
		for (const connectivity of [10, 0, 'absolute', '0']) {
			const document = await sealDocument(COLLATION_FORMAT, COLLATION_CURRENT_VERSION, {
				...COLLATION_FIXTURE,
				document: {
					...COLLATION_FIXTURE.document,
					apparatus: {
						type: 'apparatus',
						units: [{ decisions: { connectivity } }],
					},
				},
			} as unknown as JsonObject);

			await expect(readCanonicalDocument(COLLATION_FORMAT, document)).resolves.toMatchObject({
				ok: false,
				quarantine: { code: 'invalid_shape' },
			});
		}
	});

	it('rejects v1 primary and working collations without an upgrader to the current format', async () => {
		const registry = createCanonicalFormatRegistry();
		const content = {
			id: COLLATION_FIXTURE.id,
			project_id: COLLATION_FIXTURE.project_id,
			title: COLLATION_FIXTURE.title,
			verse_identifier: COLLATION_FIXTURE.verse_identifier,
			status: COLLATION_FIXTURE.status,
			group_path: COLLATION_FIXTURE.group_path,
			notes: COLLATION_FIXTURE.notes,
			sort_key: COLLATION_FIXTURE.sort_key,
			witnesses: [],
			tokens: [],
			variation_units: [],
			readings: [],
			reading_witnesses: [],
			artifacts: [
				{
					id: 'artifact-1',
					artifact_type: 'collation_document_v1',
					payload: COLLATION_FIXTURE.document,
				},
			],
		};
		const primary = await sealDocument(COLLATION_FORMAT, 1, {
			...content,
			current_revision: COLLATION_FIXTURE.current_revision,
			created_at: COLLATION_FIXTURE.created_at,
			updated_at: COLLATION_FIXTURE.updated_at,
		} as JsonObject);
		const working = await sealDocument(WORKING_COLLATION_FORMAT, 1, {
			...content,
			created_at: COLLATION_FIXTURE.created_at,
			updated_at: COLLATION_FIXTURE.updated_at,
			draft: WORKING_COLLATION_FIXTURE.draft,
		} as JsonObject);
		await expect(registry.readDocument(COLLATION_FORMAT, primary)).resolves.toMatchObject({
			ok: false,
			quarantine: {
				code: 'invalid_schema_version',
				message: 'No upgrader registered for apatosaurus.collation schema_version 1.',
			},
		});

		await expect(
			registry.readDocument(WORKING_COLLATION_FORMAT, working)
		).resolves.toMatchObject({
			ok: false,
			quarantine: {
				code: 'invalid_schema_version',
				message:
					'No upgrader registered for apatosaurus.working.collation schema_version 1.',
			},
		});
	});

	it('rejects the checked-in v1 working collation fixture without an upgrader', async () => {
		await expect(
			readCanonicalDocument(WORKING_COLLATION_FORMAT, workingCollationV1Input)
		).resolves.toMatchObject({
			ok: false,
			quarantine: { code: 'invalid_schema_version' },
		});
	});

	it('rejects the checked-in v1 collation checkpoint fixture without an upgrader', async () => {
		await expect(
			readCanonicalDocument(COLLATION_CHECKPOINT_FORMAT, checkpointCollationV1Input)
		).resolves.toMatchObject({
			ok: false,
			quarantine: { code: 'invalid_schema_version' },
		});
	});

	it('refuses a v3 collation rather than loading its stemma arcs away', async () => {
		const registry = createCanonicalFormatRegistry();
		// v3 held the stemma under `edges` with `sourceReadingId`/`targetReadingId`. The current
		// parser reads `arcs`, so loading this would hydrate to no arcs and save the loss back.
		const payload = {
			...COLLATION_FIXTURE,
			document: {
				...COLLATION_FIXTURE.document,
				stemma: {
					type: 'stemma',
					units: [
						{
							type: 'stemmaUnit',
							id: 'unit:col-1',
							unitId: 'unit:col-1',
							columnId: 'col-1',
							edges: [
								{
									id: 'edge-1',
									sourceReadingId: 'reading-a',
									targetReadingId: 'reading-b',
									directed: true,
								},
							],
						},
					],
				},
			},
		} as unknown as CollationPayload;
		// A correct revision hash, so the version is the only thing that can refuse this document.
		const sealed = await sealDocument(COLLATION_FORMAT, 3, {
			...payload,
			current_revision: {
				...payload.current_revision,
				content_hash: await hashCanonicalPayload(collationPayloadToContent(payload)),
			},
		} as unknown as JsonObject);

		await expect(registry.readDocument(COLLATION_FORMAT, sealed)).resolves.toMatchObject({
			ok: false,
			quarantine: { code: 'invalid_schema_version' },
		});
	});

	it('rejects checked-in apatosaurus.collation v1 fixtures without an upgrader to the current version', async () => {
		await expect(
			readCanonicalDocument(COLLATION_FORMAT, collationV1Input)
		).resolves.toMatchObject({
			ok: false,
			quarantine: { code: 'invalid_schema_version' },
		});
	});

	it('refuses a valid v5 collation because absolute connectivity requires v6', async () => {
		const v5 = await sealDocument(COLLATION_FORMAT, 5, COLLATION_FIXTURE);

		await expect(readCanonicalDocument(COLLATION_FORMAT, v5)).resolves.toMatchObject({
			ok: false,
			quarantine: {
				code: 'invalid_schema_version',
				message: 'No upgrader registered for apatosaurus.collation schema_version 5.',
			},
		});
	});

	it('refuses v3 working collations because they cannot preserve absolute connectivity, and accepts v4', async () => {
		const v3 = await sealDocument(WORKING_COLLATION_FORMAT, 3, WORKING_COLLATION_FIXTURE);

		await expect(readCanonicalDocument(WORKING_COLLATION_FORMAT, v3)).resolves.toMatchObject({
			ok: false,
			quarantine: {
				code: 'invalid_schema_version',
				message:
					'No upgrader registered for apatosaurus.working.collation schema_version 3.',
			},
		});

		const current = await serializeCanonicalDocument(
			WORKING_COLLATION_FORMAT,
			WORKING_COLLATION_FIXTURE
		);
		await expect(
			readCanonicalDocument(WORKING_COLLATION_FORMAT, current)
		).resolves.toMatchObject({
			ok: true,
			upgraded: false,
			originalVersion: 4,
		});
	});

	it('refuses v3 collation checkpoints because they cannot preserve absolute connectivity, and accepts v4', async () => {
		const v3 = await sealDocument(COLLATION_CHECKPOINT_FORMAT, 3, COLLATION_CHECKPOINT_FIXTURE);

		await expect(readCanonicalDocument(COLLATION_CHECKPOINT_FORMAT, v3)).resolves.toMatchObject(
			{
				ok: false,
				quarantine: {
					code: 'invalid_schema_version',
					message:
						'No upgrader registered for apatosaurus.checkpoint.collation schema_version 3.',
				},
			}
		);

		const current = await serializeCanonicalDocument(
			COLLATION_CHECKPOINT_FORMAT,
			COLLATION_CHECKPOINT_FIXTURE
		);
		const result = await readCanonicalDocument<CollationCheckpointPayload>(
			COLLATION_CHECKPOINT_FORMAT,
			current
		);

		expect(result).toMatchObject({ ok: true, upgraded: false, originalVersion: 4 });
		if (!result.ok) throw new Error('Expected current collation checkpoint to round-trip.');
		expect(result.payload.payload.document.flow).toMatchObject({
			phase: 'review',
			furthestPhase: 'review',
		});
	});

	it('round-trips a current Review collation', async () => {
		const bytes = await serializeCanonicalDocument(COLLATION_FORMAT, COLLATION_FIXTURE);
		const result = await readCanonicalDocument<CollationPayload>(COLLATION_FORMAT, bytes);

		expect(result).toMatchObject({
			ok: true,
			upgraded: false,
			originalVersion: COLLATION_CURRENT_VERSION,
		});
		if (!result.ok) throw new Error('Expected current Review collation to round-trip.');
		expect(result.payload.document.flow).toMatchObject({
			phase: 'review',
			furthestPhase: 'review',
		});
	});

	it.each([
		[TRANSCRIPTION_CHECKPOINT_FORMAT, TRANSCRIPTION_CHECKPOINT_FIXTURE],
		[COLLATION_CHECKPOINT_FORMAT, COLLATION_CHECKPOINT_FIXTURE],
	])('rejects %s documents with a null nested payload', async (format, fixture) => {
		const registry = createCanonicalFormatRegistry();
		const document = await sealDocument(
			format,
			format === COLLATION_CHECKPOINT_FORMAT ? COLLATION_CHECKPOINT_CURRENT_VERSION : 1,
			{ ...fixture, payload: null } as JsonObject
		);

		await expect(registry.readDocument(format, document)).resolves.toMatchObject({
			ok: false,
			quarantine: { code: 'invalid_shape' },
		});
	});

	it('rejects transcription checkpoints with malformed nested snapshots', async () => {
		const registry = createCanonicalFormatRegistry();
		const document = await sealDocument(TRANSCRIPTION_CHECKPOINT_FORMAT, 1, {
			...TRANSCRIPTION_CHECKPOINT_FIXTURE,
			payload: {
				project_transcription_id: TRANSCRIPTION_CHECKPOINT_FIXTURE.entity_id,
				id: TRANSCRIPTION_CHECKPOINT_FIXTURE.payload_transcription_id,
				format: TRANSCRIPTION_CHECKPOINT_FIXTURE.content_format,
			},
		} as JsonObject);

		await expect(
			registry.readDocument(TRANSCRIPTION_CHECKPOINT_FORMAT, document)
		).resolves.toMatchObject({ ok: false, quarantine: { code: 'invalid_shape' } });
	});

	it.each([
		[PROJECT_TRANSCRIPTION_FORMAT, PROJECT_TRANSCRIPTION_FIXTURE],
		[COLLATION_FORMAT, COLLATION_FIXTURE],
		[TRANSCRIPTION_CHECKPOINT_FORMAT, TRANSCRIPTION_CHECKPOINT_FIXTURE],
		[COLLATION_CHECKPOINT_FORMAT, COLLATION_CHECKPOINT_FIXTURE],
	] as const)(
		'rejects resealed %s documents with invalid nested hashes',
		async (format, fixture) => {
			const version =
				format === COLLATION_FORMAT
					? COLLATION_CURRENT_VERSION
					: format === COLLATION_CHECKPOINT_FORMAT
						? COLLATION_CHECKPOINT_CURRENT_VERSION
						: 1;
			const document = await sealDocument(format, version, {
				...fixture,
				...(format.includes('checkpoint')
					? { payload_content_hash: 'sha256:wrong' }
					: {
							current_revision: {
								...('current_revision' in fixture
									? (fixture.current_revision as Record<string, unknown>)
									: {}),
								content_hash: 'sha256:wrong',
							},
						}),
			} as JsonObject);

			await expect(readCanonicalDocument(format, document)).resolves.toMatchObject({
				ok: false,
				quarantine: { code: 'hash_mismatch' },
			});
		}
	);

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

describe('derived TEI serializers', () => {
	it('serializes project transcription documents as well-formed TEI', () => {
		const xml = transcriptionDocumentToTei(PROJECT_TRANSCRIPTION_FIXTURE);
		const doc = parseXml(xml);

		expect(doc.getElementsByTagName('TEI')).toHaveLength(1);
		expect(doc.getElementsByTagName('title')[0]?.textContent).toBe('Witness A');
	});

	it('resolves a locally present user edition for a legacy record through the store serializer', async () => {
		const backend = new MemoryStoreBackend();
		const edition = await registerUserReferenceEdition(
			{
				xml: '<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader/><text><body><div type="book" n="book"><ab n="1"/></div></body></text></TEI>',
				fileName: 'legacy.xml',
			},
			{
				backend,
				parse: async () => ({
					source: { units: [{ position: 0, label: { verse: '1' }, content: [] }] },
					metadata: { title: 'Legacy edition', attribution: 'Legacy user attribution' },
				}),
			}
		);
		const fixture = transcriptionWithEditions([edition.id]);
		const doc = parseXml(await transcriptionDocumentToTeiFromStore(fixture, { backend }));

		expect(referenceEditionEntries(doc).map(node => node.textContent)).toEqual([
			'Legacy user attribution',
		]);
	});

	it('prefers a legacy record snapshot when its user edition is absent from the store', async () => {
		const fixture = transcriptionWithEditions(['edition-two'], {
			'edition-two': 'Persisted edition attribution',
		});
		const doc = parseXml(
			await transcriptionDocumentToTeiFromStore(fixture, {
				backend: new MemoryStoreBackend(),
			})
		);

		expect(referenceEditionEntries(doc).map(node => node.textContent)).toEqual([
			'Persisted edition attribution',
		]);
	});

	it('keeps user-edition attribution when the edition is absent on this device', () => {
		const fixture = transcriptionWithEditions(['user-missing-device'], {
			'user-missing-device': 'Missing-device edition attribution',
		});

		const doc = parseXml(transcriptionDocumentToTei(fixture, []));

		expect(referenceEditionEntries(doc).map(node => node.textContent)).toEqual([
			'Missing-device edition attribution',
		]);
	});

	it('refuses to silently omit an edition whose attribution cannot be resolved', () => {
		const fixture = transcriptionWithEditions(['user-missing-attribution']);

		expect(() => transcriptionDocumentToTei(fixture, [])).toThrow(
			'Attribution for required reference edition user-missing-attribution is unavailable.'
		);
	});

	it('names every used reference edition in the source description', () => {
		const fixture = transcriptionWithEditions(['edition-one', 'edition-two']);
		const doc = parseXml(transcriptionDocumentToTei(fixture, referenceEditionCatalog));

		expect(referenceEditionEntries(doc).map(node => node.textContent)).toEqual([
			'Edition One attribution',
			'Edition Two attribution',
		]);
	});

	it('leaves export unchanged when no reference editions were used', () => {
		const withoutSet = transcriptionDocumentToTei(PROJECT_TRANSCRIPTION_FIXTURE);
		const withEmptySet = transcriptionDocumentToTei(transcriptionWithEditions([]));

		expect(withEmptySet).toBe(withoutSet);
	});

	it('keeps attribution after seeded text has been edited away', () => {
		const fixture = transcriptionWithEditions(['edition-one']);
		fixture.content_json = {
			type: 'transcriptionDocument',
			pages: [],
			referenceEditionsUsed: ['edition-one'],
		};
		const doc = parseXml(transcriptionDocumentToTei(fixture, referenceEditionCatalog));

		expect(referenceEditionEntries(doc).map(node => node.textContent)).toEqual([
			'Edition One attribution',
		]);
	});
});

function parseXml(xml: string): XmlDocument {
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
	return doc;
}

const referenceEditionCatalog: ReferenceEditionCatalogEntry[] = [
	{
		id: 'edition-one',
		title: 'Edition One',
		attribution: 'Edition One attribution',
		source: 'bundled',
	},
	{
		id: 'edition-two',
		title: 'Edition Two',
		attribution: 'Edition Two attribution',
		source: 'user',
	},
];

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
