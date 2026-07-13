import { DOMParser } from '@xmldom/xmldom';
import type { Document as XmlDocument } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';

import type { CollationDocument as SemanticCollationDocument } from '$lib/client/collation/collation-document';
import { hashCanonicalPayload } from '../canonical-json';

import { sealDocument, serializeSealedDocument, type JsonObject } from '../envelope';
import {
	COLLATION_CHECKPOINT_FIXTURE,
	COLLATION_CHECKPOINT_CURRENT_VERSION,
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_CHECKPOINT_OLD_SHAPE_FIXTURE,
	COLLATION_FIXTURE,
	COLLATION_CURRENT_VERSION,
	COLLATION_FORMAT,
	PROJECT_MANIFEST_FIXTURE,
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
	collationDocumentToTei,
	createCanonicalFormatRegistry,
	readCanonicalDocument,
	serializeCanonicalDocument,
	transcriptionDocumentToTei,
} from './index';
import { buildLegacyCollationHashPayload } from './collation';
import collationV1Input from './fixtures/collation-v1.input.json';
import collationV2Expected from './fixtures/collation-v2.expected.json';
import workingCollationV1Input from './fixtures/working-collation-v1.input.json';
import workingCollationV2Expected from './fixtures/working-collation-v2.expected.json';
import checkpointCollationV1Input from './fixtures/checkpoint-collation-v1.input.json';
import checkpointCollationV2Expected from './fixtures/checkpoint-collation-v2.expected.json';

const FORMAT_FIXTURES = [
	{ format: PROJECT_MANIFEST_FORMAT, version: 1, payload: PROJECT_MANIFEST_FIXTURE },
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

	it('upgrades v1 collation primary, working, and checkpoint files', async () => {
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
		const {
			readings: _readings,
			reading_witnesses: _readingWitnesses,
			...legacyHashContent
		} = content;
		const legacyHashPayload = {
			...legacyHashContent,
			artifacts: [
				{ artifact_type: 'collation_document_v1', payload: COLLATION_FIXTURE.document },
			],
		};
		const revisionHash = await hashCanonicalPayload(legacyHashPayload);
		expect(buildLegacyCollationHashPayload(content)).toEqual(legacyHashPayload);
		const primary = await sealDocument(COLLATION_FORMAT, 1, {
			...content,
			current_revision: { ...COLLATION_FIXTURE.current_revision, content_hash: revisionHash },
			created_at: COLLATION_FIXTURE.created_at,
			updated_at: COLLATION_FIXTURE.updated_at,
		} as JsonObject);
		const working = await sealDocument(WORKING_COLLATION_FORMAT, 1, {
			...content,
			created_at: COLLATION_FIXTURE.created_at,
			updated_at: COLLATION_FIXTURE.updated_at,
			draft: WORKING_COLLATION_FIXTURE.draft,
		} as JsonObject);
		const checkpoint = await sealDocument(COLLATION_CHECKPOINT_FORMAT, 1, {
			...COLLATION_CHECKPOINT_FIXTURE,
			payload_content_hash: revisionHash,
			payload: legacyHashPayload,
		} as JsonObject);

		for (const [format, document] of [
			[COLLATION_FORMAT, primary],
			[WORKING_COLLATION_FORMAT, working],
			[COLLATION_CHECKPOINT_FORMAT, checkpoint],
		] as const) {
			const result = await registry.readDocument(format, document);
			if (!result.ok) {
				throw new Error(
					`Expected ${format} v1 fixture to upgrade: ${JSON.stringify(result.quarantine)}`
				);
			}
			expect(result).toMatchObject({ ok: true, upgraded: true, originalVersion: 1 });
			const payload = result.payload as Record<string, unknown>;
			const upgradedContent =
				format === COLLATION_CHECKPOINT_FORMAT
					? (payload.payload as Record<string, unknown>)
					: payload;
			expect(upgradedContent.document).toEqual(COLLATION_FIXTURE.document);
			expect(upgradedContent).not.toHaveProperty('artifacts');
		}
	});

	it.each([
		[COLLATION_FORMAT, collationV1Input, collationV2Expected],
		[WORKING_COLLATION_FORMAT, workingCollationV1Input, workingCollationV2Expected],
		[COLLATION_CHECKPOINT_FORMAT, checkpointCollationV1Input, checkpointCollationV2Expected],
	] as const)('upgrades checked-in %s v1 fixtures through the public read API', async (format, input, expected) => {
		const result = await readCanonicalDocument(format, input);

		expect(result).toMatchObject({ ok: true, upgraded: true, originalVersion: 1 });
		if (!result.ok) throw new Error(`Expected ${format} fixture to upgrade.`);
		expect(result.payload).toEqual(expected);
	});

	it.each([
		[TRANSCRIPTION_CHECKPOINT_FORMAT, TRANSCRIPTION_CHECKPOINT_FIXTURE],
		[COLLATION_CHECKPOINT_FORMAT, COLLATION_CHECKPOINT_FIXTURE],
	])('rejects %s documents with a null nested payload', async (format, fixture) => {
		const registry = createCanonicalFormatRegistry();
		const document = await sealDocument(format, 1, { ...fixture, payload: null } as JsonObject);

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
	] as const)('rejects resealed %s documents with invalid nested hashes', async (format, fixture) => {
		const document = await sealDocument(format, format.includes('collation') ? 2 : 1, {
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
	});

	it('rejects a resealed manifest whose head path is not canonical', async () => {
		const payload = {
			...PROJECT_MANIFEST_FIXTURE,
			transcriptions: [
				{ ...PROJECT_MANIFEST_FIXTURE.transcriptions[0], primary_path: 'transcriptions/wrong.json' },
			],
		};
		payload.manifest_content_hash = await hashCanonicalPayload({
			project_id: payload.id,
			transcriptions: payload.transcriptions,
			collations: payload.collations,
			tombstones: payload.tombstones,
		});
		const document = await sealDocument(PROJECT_MANIFEST_FORMAT, 1, payload);

		await expect(readCanonicalDocument(PROJECT_MANIFEST_FORMAT, document)).resolves.toMatchObject({
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

	it('serializes collation documents as a TEI parallel-segmentation apparatus', () => {
		const xml = collationDocumentToTei(collationDocumentFixture());
		const doc = parseXml(xml);

		expect(
			doc.getElementsByTagName('listWit')[0]?.getElementsByTagName('witness')
		).toHaveLength(2);
		expect(doc.getElementsByTagName('app')).toHaveLength(1);
		expect(doc.getElementsByTagName('lem')[0]?.textContent).toBe('in');
		expect(doc.getElementsByTagName('rdg')[0]?.getAttribute('wit')).toBe('#wit-B');
	});

	it('emits valid xml:id values for numeric and punctuation-heavy identifiers', () => {
		const fixture = collationDocumentFixture();
		fixture.setup.selectedVerse = { ...fixture.setup.selectedVerse!, identifier: '123:1?!' };
		fixture.setup.witnesses[0].id = '123?!';
		const doc = parseXml(collationDocumentToTei(fixture));
		const ids = Array.from(doc.getElementsByTagName('*'))
			.map(node => node.getAttribute('xml:id'))
			.filter((id): id is string => id !== '');

		expect(ids.length).toBeGreaterThan(0);
		expect(ids.every(id => /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id))).toBe(true);
	});
});

function parseXml(xml: string): XmlDocument {
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
	return doc;
}

function collationDocumentFixture(): SemanticCollationDocument {
	return {
		type: 'collationDocument',
		version: 1,
		meta: { collationId: 'col-1', projectId: 'project-1', projectName: 'Project One' },
		flow: {
			phase: 'readings',
			furthestPhase: 'readings',
			alignmentDisplayMode: 'regularized',
			alignmentLayout: 'grid',
		},
		setup: {
			selectedVerse: {
				identifier: 'John 1:1',
				book: 'John',
				chapter: '1',
				verse: '1',
				count: 2,
			},
			selectedBook: 'John',
			selectedChapter: '1',
			selectedVerseNum: '1',
			witnesses: [witnessNode('A', 'A', 'in'), witnessNode('B', 'B', 'en')],
		},
		settings: {
			regularizationRules: [],
			ignoreWordBreaks: false,
			lowercase: false,
			ignoreTokenWhitespace: true,
			ignorePunctuation: false,
			suppliedTextMode: 'clear',
			segmentation: true,
		},
		alignment: null,
		apparatus: {
			type: 'apparatus',
			units: [
				{
					type: 'variationUnit',
					id: 'unit-1',
					unitIndex: 0,
					columnId: null,
					readings: [
						reading('r-a', 0, 'a', 'in', ['A']),
						reading('r-b', 1, 'b', 'en', ['B']),
					],
				},
			],
		},
		stemma: null,
	};
}

function witnessNode(id: string, siglum: string, content: string) {
	return {
		type: 'witness' as const,
		id,
		siglum,
		transcriptionId: `${id}-tx`,
		content,
		treatment: 'inherit' as const,
		isBaseText: id === 'A',
		isExcluded: false,
		overridesDefault: false,
		sourceTokens: [],
	};
}

function reading(id: string, order: number, label: string, text: string, witnessIds: string[]) {
	return {
		id,
		order,
		label,
		text,
		normalizedText: text,
		witnessIds,
		witnessGroups: [],
		classification: 'unclassified' as const,
		isOmission: false,
		isLacuna: false,
		readingType: null,
		parentReadingId: null,
		isSubreading: false,
		autoGenerated: false,
		derivedFromRuleIds: [],
	};
}
