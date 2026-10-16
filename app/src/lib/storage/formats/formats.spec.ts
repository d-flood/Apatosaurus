import { DOMParser } from '@xmldom/xmldom';
import type { Document as XmlDocument } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';

import type { ReferenceEditionCatalogEntry } from '$lib/reference-editions/catalog';
import { hashCanonicalPayload } from '../canonical-json';
import { MemoryStoreBackend } from '../memory-store-backend.spec-support';
import { registerUserReferenceEdition } from '$lib/reference-editions/user-reference-editions';

import { sealDocument, serializeSealedDocument, type JsonObject } from '../envelope';
import {
	CBGM_ANALYSIS_FORMAT,
	COLLATION_CHECKPOINT_CURRENT_VERSION,
	COLLATION_CHECKPOINT_FORMAT,
	type CollationCheckpointPayload,
	COLLATION_CURRENT_VERSION,
	COLLATION_FORMAT,
	PROJECT_MANIFEST_CURRENT_VERSION,
	PROJECT_MANIFEST_FORMAT,
	PROJECT_TRANSCRIPTION_CURRENT_VERSION,
	PROJECT_TRANSCRIPTION_FORMAT,
	TOMBSTONE_FORMAT,
	TRANSCRIPTION_CHECKPOINT_CURRENT_VERSION,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	WORKING_COLLATION_CURRENT_VERSION,
	WORKING_COLLATION_FORMAT,
	WORKING_TRANSCRIPTION_FORMAT,
	canonicalFormatRegistrations,
	createCanonicalFormatRegistry,
	mergeWorkingCollation,
	mergeWorkingTranscription,
	readCanonicalDocument,
	serializeCanonicalDocument,
	transcriptionDocumentToTei,
	transcriptionDocumentToTeiFromStore,
	type ProjectTranscriptionPayload,
	type WorkingCollationPayload,
	type WorkingTranscriptionPayload,
} from './index';
import { collationPayloadToContent, type CollationPayload } from './collation';
import collationV1Input from './fixtures/collation-v1.input.json';
import workingCollationV1Input from './fixtures/working-collation-v1.input.json';
import checkpointCollationV1Input from './fixtures/checkpoint-collation-v1.input.json';
import projectManifestV1Input from './fixtures/project-manifest-v1.input.json';
import projectManifestV2Expected from './fixtures/project-manifest-v2.expected.json';
import projectTranscriptionV1Input from './fixtures/project-transcription-v1.input.json';
import workingTranscriptionV1Input from './fixtures/working-transcription-v1.input.json';
import projectTranscriptionV2Expected from './fixtures/project-transcription-v2.expected.json';
import collationV6Input from './fixtures/collation-v6.input.json';
import workingCollationV4Input from './fixtures/working-collation-v4.input.json';
import collationV7Expected from './fixtures/collation-v7.expected.json';
import collationV8Input from './fixtures/collation-v8.input.json';
import collationV9Expected from './fixtures/collation-v9.expected.json';
import collationV9Input from './fixtures/collation-v9.input.json';
import collationV10Expected from './fixtures/collation-v10.expected.json';
import collationV10Input from './fixtures/collation-v10.input.json';
import collationV11Expected from './fixtures/collation-v11.expected.json';
import collationV11Input from './fixtures/collation-v11.input.json';
import collationV12Expected from './fixtures/collation-v12.expected.json';
import projectManifestV2Input from './fixtures/project-manifest-v2.input.json';
import projectManifestV3Expected from './fixtures/project-manifest-v3.expected.json';
import collationV12Input from './fixtures/collation-v12.input.json';
import collationV13Expected from './fixtures/collation-v13.expected.json';
import projectManifestV3Input from './fixtures/project-manifest-v3.input.json';
import projectManifestV4Expected from './fixtures/project-manifest-v4.expected.json';
import {
	COLLATION_CHECKPOINT_FIXTURE,
	COLLATION_CHECKPOINT_OLD_SHAPE_FIXTURE,
	COLLATION_FIXTURE,
	PROJECT_MANIFEST_FIXTURE,
	PROJECT_TRANSCRIPTION_FIXTURE,
	PROJECT_TRANSCRIPTION_OLD_SHAPE_FIXTURE,
	TOMBSTONE_FIXTURE,
	TRANSCRIPTION_CHECKPOINT_FIXTURE,
	TRANSCRIPTION_CHECKPOINT_OLD_SHAPE_FIXTURE,
	WORKING_COLLATION_FIXTURE,
	WORKING_TRANSCRIPTION_FIXTURE,
} from '$lib/storage/formats/payload-fixtures';

const FORMAT_FIXTURES = [
	{
		format: PROJECT_MANIFEST_FORMAT,
		version: PROJECT_MANIFEST_CURRENT_VERSION,
		payload: PROJECT_MANIFEST_FIXTURE,
	},
	{
		format: PROJECT_TRANSCRIPTION_FORMAT,
		version: PROJECT_TRANSCRIPTION_CURRENT_VERSION,
		payload: PROJECT_TRANSCRIPTION_FIXTURE,
	},
	{ format: COLLATION_FORMAT, version: COLLATION_CURRENT_VERSION, payload: COLLATION_FIXTURE },
	{
		format: TRANSCRIPTION_CHECKPOINT_FORMAT,
		version: TRANSCRIPTION_CHECKPOINT_CURRENT_VERSION,
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

	it('upgrades manual-witness fixtures and preserves decisions in working and checkpoint formats', async () => {
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
		expect(
			await readCanonicalDocument(
				COLLATION_FORMAT,
				await sealDocument(COLLATION_FORMAT, 12, collationV12Input as JsonObject)
			)
		).toMatchObject({
			ok: true,
			upgraded: true,
			originalVersion: 12,
			payload: collationV13Expected,
		});
		const working = { ...WORKING_COLLATION_FIXTURE, document: collationV13Expected.document };
		expect(
			await readCanonicalDocument(
				WORKING_COLLATION_FORMAT,
				await sealDocument(
					WORKING_COLLATION_FORMAT,
					WORKING_COLLATION_CURRENT_VERSION,
					working as JsonObject
				)
			)
		).toMatchObject({ ok: true, payload: working });
		const payload = {
			...COLLATION_CHECKPOINT_FIXTURE.payload,
			document: collationV13Expected.document,
		};
		const checkpoint = {
			...COLLATION_CHECKPOINT_FIXTURE,
			payload,
			payload_content_hash: await hashCanonicalPayload(payload),
		};
		expect(
			await readCanonicalDocument(
				COLLATION_CHECKPOINT_FORMAT,
				await sealDocument(
					COLLATION_CHECKPOINT_FORMAT,
					COLLATION_CHECKPOINT_CURRENT_VERSION,
					checkpoint as JsonObject
				)
			)
		).toMatchObject({ ok: true, payload: checkpoint });
	});

	it.each<JsonObject>([
		{ manualTestimony: [] },
		{ manualTestimony: { father: { kind: 'wrong' } } },
		{ manualTestimony: { father: { kind: 'reading', readingId: '' } } },
		{ authoredReadings: {} },
		{
			authoredReadings: [
				{
					id: 'bad',
					text: null,
					isOmission: true,
					order: '1',
					parentReadingId: null,
					readingType: null,
				},
			],
		},
		{
			authoredReadings: [
				{
					id: 'bad',
					text: null,
					isOmission: true,
					order: 1,
					parentReadingId: 'parent',
					readingType: null,
				},
			],
		},
	])('quarantines malformed manual decisions %j', async decisions => {
		const payload = structuredClone(collationV13Expected) as JsonObject;
		const document = payload.document as JsonObject;
		const apparatus = document.apparatus as JsonObject;
		(apparatus.units as JsonObject[])[0].decisions = decisions;
		expect(
			await readCanonicalDocument(
				COLLATION_FORMAT,
				await sealDocument(COLLATION_FORMAT, COLLATION_CURRENT_VERSION, payload)
			)
		).toMatchObject({ ok: false, quarantine: { code: 'invalid_shape' } });
	});

	it('upgrades v11 declarations unchanged and preserves them in working and checkpoint formats', async () => {
		expect(
			await readCanonicalDocument(
				COLLATION_FORMAT,
				await sealDocument(COLLATION_FORMAT, 11, collationV11Input as JsonObject)
			)
		).toMatchObject({
			ok: true,
			upgraded: true,
			originalVersion: 11,
			payload: collationV12Expected,
		});
		for (const [format, payload] of [
			[
				WORKING_COLLATION_FORMAT,
				{ ...WORKING_COLLATION_FIXTURE, document: collationV12Expected.document },
			],
			[
				COLLATION_CHECKPOINT_FORMAT,
				{
					...COLLATION_CHECKPOINT_FIXTURE,
					payload: {
						...COLLATION_CHECKPOINT_FIXTURE.payload,
						document: collationV12Expected.document,
					},
				},
			],
		] as const) {
			const checked =
				'payload' in payload
					? {
							...payload,
							payload_content_hash: await hashCanonicalPayload(payload.payload),
						}
					: payload;
			expect(
				await readCanonicalDocument(
					format,
					await serializeCanonicalDocument(format, checked as JsonObject)
				)
			).toMatchObject({ ok: true, payload: checked });
		}
	});

	it.each([
		null,
		{},
		['column-0'],
		[{ firstColumnId: '', lastColumnId: 'column-1' }],
		[{ firstColumnId: 'column-1' }],
		[{ firstColumnId: 'column-1', lastColumnId: 1 }],
		[{ firstColumnId: 'declared-last', lastColumnId: 'declared-first' }],
	])('quarantines malformed declarations %j', async declaredUnits => {
		const payload = structuredClone(collationV12Expected) as JsonObject;
		((payload.document as JsonObject).alignment as JsonObject).declaredUnits =
			declaredUnits as JsonObject;
		expect(
			await readCanonicalDocument(
				COLLATION_FORMAT,
				await sealDocument(COLLATION_FORMAT, COLLATION_CURRENT_VERSION, payload)
			)
		).toMatchObject({ ok: false });
	});

	it('upgrades v10 collation tags unchanged and preserves them in working and checkpoint formats', async () => {
		const result = await readCanonicalDocument(
			COLLATION_FORMAT,
			await sealDocument(COLLATION_FORMAT, 10, collationV10Input as JsonObject)
		);
		expect(result).toMatchObject({
			ok: true,
			upgraded: true,
			originalVersion: 10,
			payload: collationV11Expected,
		});
		for (const [format, payload] of [
			[
				WORKING_COLLATION_FORMAT,
				{ ...WORKING_COLLATION_FIXTURE, document: collationV11Expected.document },
			],
			[
				COLLATION_CHECKPOINT_FORMAT,
				{
					...COLLATION_CHECKPOINT_FIXTURE,
					payload: {
						...COLLATION_CHECKPOINT_FIXTURE.payload,
						document: collationV11Expected.document,
					},
				},
			],
		] as const) {
			const checkedPayload =
				'payload' in payload
					? {
							...payload,
							payload_content_hash: await hashCanonicalPayload(payload.payload),
						}
					: payload;
			expect(
				await readCanonicalDocument(
					format,
					await serializeCanonicalDocument(format, checkedPayload as JsonObject)
				)
			).toMatchObject({ ok: true, payload: checkedPayload });
		}
	});

	it.each([
		null,
		[],
		'ns',
		{ a: 'ns' },
		{ a: [1] },
		{ a: ['ns', 'ns'] },
		{ a: [' '] },
		{ '': ['ns'] },
	])('quarantines malformed reading tags %j', async readingTags => {
		const payload = structuredClone(collationV11Expected) as JsonObject;
		const document = payload.document as JsonObject;
		const apparatus = document.apparatus as JsonObject;
		const units = apparatus.units as JsonObject[];
		units[0].decisions = { readingTags } as JsonObject;
		expect(
			await readCanonicalDocument(
				COLLATION_FORMAT,
				await sealDocument(COLLATION_FORMAT, COLLATION_CURRENT_VERSION, payload)
			)
		).toMatchObject({ ok: false, quarantine: { code: 'invalid_shape' } });
	});

	it('migrates a v1 project transcription and its working file into a v2 primary holding the working content', async () => {
		const primary = await readCanonicalDocument<ProjectTranscriptionPayload>(
			PROJECT_TRANSCRIPTION_FORMAT,
			serializeSealedDocument(
				await sealDocument(
					PROJECT_TRANSCRIPTION_FORMAT,
					1,
					projectTranscriptionV1Input as JsonObject
				)
			)
		);
		const working = await readCanonicalDocument<WorkingTranscriptionPayload>(
			WORKING_TRANSCRIPTION_FORMAT,
			serializeSealedDocument(
				await sealDocument(
					WORKING_TRANSCRIPTION_FORMAT,
					1,
					workingTranscriptionV1Input as JsonObject
				)
			)
		);

		expect(primary).toMatchObject({ ok: true, upgraded: true, originalVersion: 1 });
		if (!primary.ok || !working.ok)
			throw new Error('Expected v1 transcription fixtures to read.');
		expect(primary.payload.content_json).toEqual(projectTranscriptionV1Input.content_json);
		expect(primary.payload.based_on_checkpoint).toEqual({
			id: projectTranscriptionV1Input.current_revision.id,
			content_hash: projectTranscriptionV1Input.current_revision.content_hash,
		});
		const merged = mergeWorkingTranscription(primary.payload, working.payload);
		expect(merged).toEqual(projectTranscriptionV2Expected);
		const reread = await readCanonicalDocument(
			PROJECT_TRANSCRIPTION_FORMAT,
			await serializeCanonicalDocument(PROJECT_TRANSCRIPTION_FORMAT, merged)
		);
		expect(reread).toMatchObject({ ok: true, upgraded: false, payload: merged });
	});

	it('migrates a v6 collation and its working file into a v7 primary holding the working content', async () => {
		const primary = await readCanonicalDocument<CollationPayload>(
			COLLATION_FORMAT,
			serializeSealedDocument(
				await sealDocument(COLLATION_FORMAT, 6, collationV6Input as JsonObject)
			)
		);
		const working = await readCanonicalDocument<WorkingCollationPayload>(
			WORKING_COLLATION_FORMAT,
			serializeSealedDocument(
				await sealDocument(
					WORKING_COLLATION_FORMAT,
					4,
					workingCollationV4Input as JsonObject
				)
			)
		);

		expect(primary).toMatchObject({ ok: true, upgraded: true, originalVersion: 6 });
		if (!primary.ok || !working.ok) throw new Error('Expected collation fixtures to read.');
		expect(primary.payload.notes).toBe(collationV6Input.notes);
		expect(primary.payload.based_on_checkpoint).toEqual({
			id: collationV6Input.current_revision.id,
			content_hash: collationV6Input.current_revision.content_hash,
		});
		const merged = mergeWorkingCollation(primary.payload, working.payload);
		expect(merged).toEqual(collationV7Expected);
		const reread = await readCanonicalDocument(
			COLLATION_FORMAT,
			await serializeCanonicalDocument(COLLATION_FORMAT, merged)
		);
		expect(reread).toMatchObject({ ok: true, upgraded: false, payload: merged });
	});

	it('migrates pinned-checkpoint witnesses in a v7 collation to witness sources', async () => {
		const witness = {
			type: 'witness',
			siglum: 'A',
			content: 'in principio',
			treatment: 'full',
			isBaseText: true,
			isExcluded: false,
			overridesDefault: false,
			sourceTokens: [],
		};
		const v7 = {
			...collationV7Expected,
			document: {
				...collationV7Expected.document,
				setup: {
					...collationV7Expected.document.setup,
					witnesses: [
						{
							...witness,
							id: 'pinned',
							transcriptionId: 'tx-1',
							sourceVersion: 'tx-cp-1',
							sourceContentHash: 'sha256:tx-cp-1',
						},
						{ ...witness, id: 'unpinned', transcriptionId: 'tx-2', sourceVersion: '' },
					],
				},
			},
		};

		const result = await readCanonicalDocument<CollationPayload>(
			COLLATION_FORMAT,
			serializeSealedDocument(await sealDocument(COLLATION_FORMAT, 7, v7 as JsonObject))
		);

		expect(result).toMatchObject({ ok: true, upgraded: true, originalVersion: 7 });
		if (!result.ok) throw new Error('Expected the v7 collation to read.');
		const [pinned, unpinned] = result.payload.document.setup.witnesses;
		expect(pinned).toMatchObject({
			id: 'pinned',
			source: { kind: 'version', transcriptionId: 'tx-1', versionId: 'tx-cp-1' },
		});
		expect(pinned).not.toHaveProperty('sourceVersion');
		expect(pinned).not.toHaveProperty('sourceContentHash');
		expect(unpinned).toMatchObject({
			id: 'unpinned',
			source: {
				kind: 'current',
				transcriptionId: 'tx-2',
				capturedAt: collationV7Expected.updated_at,
				contentHash: '',
			},
		});
	});

	it('upgrades a v8 collation to v9 without changing its payload', async () => {
		const result = await readCanonicalDocument<CollationPayload>(
			COLLATION_FORMAT,
			serializeSealedDocument(
				await sealDocument(COLLATION_FORMAT, 8, collationV8Input as JsonObject)
			)
		);

		expect(result).toMatchObject({ ok: true, upgraded: true, originalVersion: 8 });
		if (!result.ok) throw new Error('Expected the v8 collation to read.');
		expect(result.payload).toEqual(collationV9Expected);
	});

	it('upgrades v9 placement decisions unchanged and quarantines malformed decisions', async () => {
		const result = await readCanonicalDocument<CollationPayload>(
			COLLATION_FORMAT,
			await sealDocument(COLLATION_FORMAT, 9, collationV9Input as JsonObject)
		);
		expect(result).toMatchObject({
			ok: true,
			upgraded: true,
			originalVersion: 9,
			payload: collationV10Expected,
		});
		for (const decisions of [
			{ unconfirmedWitnessIds: 'A' },
			{ unconfirmedWitnessIds: [1] },
			{ unresolvedAttestations: {} },
			{ unresolvedAttestations: [{ witnessId: 1, candidateReadingIds: ['a', 'b'] }] },
			{ unresolvedAttestations: [{ witnessId: 'A', candidateReadingIds: ['a'] }] },
			{ unresolvedAttestations: [{ witnessId: 'A', candidateReadingIds: ['a', 'a'] }] },
			{ unresolvedAttestations: [{ witnessId: 'A', candidateReadingIds: ['a', 1] }] },
		]) {
			const payload = structuredClone(collationV10Expected) as JsonObject;
			const document = payload.document as JsonObject;
			const apparatus = document.apparatus as JsonObject;
			const units = apparatus.units as JsonObject[];
			units[0].decisions = decisions as unknown as JsonObject;
			await expect(
				readCanonicalDocument(
					COLLATION_FORMAT,
					await sealDocument(COLLATION_FORMAT, COLLATION_CURRENT_VERSION, payload)
				)
			).resolves.toMatchObject({ ok: false, quarantine: { code: 'invalid_shape' } });
		}
	});

	it('preserves placement decisions in current working and checkpoint formats', async () => {
		const document = collationV10Expected.document;
		const working = { ...WORKING_COLLATION_FIXTURE, document } as JsonObject;
		const workingRead = await readCanonicalDocument(
			WORKING_COLLATION_FORMAT,
			await serializeCanonicalDocument(WORKING_COLLATION_FORMAT, working)
		);
		expect(workingRead).toMatchObject({ ok: true, upgraded: false, payload: { document } });
		const payload = { ...COLLATION_CHECKPOINT_FIXTURE.payload, document } as JsonObject;
		const checkpoint = {
			...COLLATION_CHECKPOINT_FIXTURE,
			payload,
			payload_content_hash: await hashCanonicalPayload(payload),
		};
		const checkpointRead = await readCanonicalDocument(
			COLLATION_CHECKPOINT_FORMAT,
			await serializeCanonicalDocument(COLLATION_CHECKPOINT_FORMAT, checkpoint)
		);
		expect(checkpointRead).toMatchObject({
			ok: true,
			upgraded: false,
			payload: { payload: { document } },
		});
	});

	it('retains ambiguous attestations in a v9 collation and quarantines malformed ones', async () => {
		const withAttestations = (ambiguousAttestations: unknown) =>
			({
				...collationV9Expected,
				document: {
					...collationV9Expected.document,
					apparatus: {
						...collationV9Expected.document.apparatus,
						units: collationV9Expected.document.apparatus.units.map(unit => ({
							...unit,
							decisions: { ...unit.decisions, ambiguousAttestations },
						})),
					},
				},
			}) as unknown as JsonObject;
		const valid = withAttestations([
			{ id: 'zw-1', witnessIds: ['A'], targetReadingIds: ['reading-a', 'reading-b'] },
		]);

		const read = await readCanonicalDocument<CollationPayload>(
			COLLATION_FORMAT,
			await serializeCanonicalDocument(COLLATION_FORMAT, valid)
		);
		expect(read).toMatchObject({ ok: true, upgraded: false, payload: valid });

		for (const malformed of [
			{},
			[{ id: 'zw-1', witnessIds: ['A'], targetReadingIds: ['reading-a'] }],
			[{ id: 'zw-1', witnessIds: ['A'], targetReadingIds: ['reading-a', 'reading-a'] }],
			[{ id: 'zw-1', witnessIds: [], targetReadingIds: ['reading-a', 'reading-b'] }],
			[{ witnessIds: ['A'], targetReadingIds: ['reading-a', 'reading-b'] }],
		]) {
			await expect(
				readCanonicalDocument(
					COLLATION_FORMAT,
					await sealDocument(
						COLLATION_FORMAT,
						COLLATION_CURRENT_VERSION,
						withAttestations(malformed)
					)
				)
			).resolves.toMatchObject({ ok: false, quarantine: { code: 'invalid_shape' } });
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
					current_revision: transcription.based_on_checkpoint,
				},
			],
			collations: [
				{
					...PROJECT_MANIFEST_FIXTURE.collations[0],
					current_revision: COLLATION_FIXTURE.based_on_checkpoint,
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
			current_revision: collationV6Input.current_revision,
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
		const sealed = await sealDocument(COLLATION_FORMAT, 3, {
			...payload,
			current_revision: {
				id: 'col-cp-1',
				content_hash: await hashCanonicalPayload(collationPayloadToContent(payload)),
				created_at: payload.created_at,
				author_name: 'Editor',
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

	it('upgrades unlabelled checkpoints with a blank label and their creation time', async () => {
		const {
			label: _txLabel,
			metadata_updated_at: _txUpdatedAt,
			...transcription
		} = TRANSCRIPTION_CHECKPOINT_FIXTURE;
		const {
			label: _colLabel,
			metadata_updated_at: _colUpdatedAt,
			...collation
		} = COLLATION_CHECKPOINT_FIXTURE;

		for (const [format, version, payload] of [
			[TRANSCRIPTION_CHECKPOINT_FORMAT, 1, transcription],
			[COLLATION_CHECKPOINT_FORMAT, 4, collation],
		] as const) {
			const result = await readCanonicalDocument(
				format,
				await sealDocument(format, version, payload as JsonObject)
			);
			expect(result).toMatchObject({
				ok: true,
				upgraded: true,
				payload: { label: '', metadata_updated_at: payload.created_at },
			});
		}
	});

	it('refuses v3 collation checkpoints because they cannot preserve absolute connectivity, and accepts v5', async () => {
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

		expect(result).toMatchObject({
			ok: true,
			upgraded: false,
			originalVersion: COLLATION_CHECKPOINT_CURRENT_VERSION,
		});
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
		[PROJECT_TRANSCRIPTION_FORMAT, projectTranscriptionV1Input],
		[COLLATION_FORMAT, collationV6Input],
		[TRANSCRIPTION_CHECKPOINT_FORMAT, TRANSCRIPTION_CHECKPOINT_FIXTURE],
		[COLLATION_CHECKPOINT_FORMAT, COLLATION_CHECKPOINT_FIXTURE],
	] as const)(
		'rejects resealed %s documents with invalid nested hashes',
		async (format, fixture) => {
			const version =
				format === COLLATION_FORMAT
					? 6
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
