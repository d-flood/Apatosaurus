import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '$lib/client/db/test-harness';
import { createCollation, saveCollationArtifact } from '$lib/client/db/repositories/collations';
import {
	ensureManifestSource,
	upsertCanvasAnnotation,
	upsertPageCanvasLink,
} from '$lib/client/db/repositories/iiif';
import { createProject, syncProjectTranscriptionIds } from '$lib/client/db/repositories/projects';
import { createCommittedCollationCheckpointWithFiles } from '$lib/client/db/repositories/collation-files';
import { createCommittedTranscriptionCheckpointWithFiles } from '$lib/client/db/repositories/transcription-files';
import {
	createTranscription,
	updateTranscriptionContent,
} from '$lib/client/db/repositories/transcriptions';
import { MemoryStoreBackend } from '$lib/client/store/memory-store-backend.spec-support';
import type { StoreOperationOptions } from '$lib/client/store';
import {
	collationCloudFileToImportInput,
	historyCloudFileToImportInput,
	parseCollationCloudFile,
	parseHistoryCloudFile,
	parseProjectCloudFile,
	parseProjectTranscriptionCloudFile,
	parseTombstoneCloudFile,
	projectCloudFileToRepositoryInput,
	projectRelativeCloudPaths,
	projectTranscriptionCloudFileToImportInput,
	serializeCloudFile,
	serializeCollationCloudFile,
	serializeCollationHistoryCloudFile,
	serializeProjectCloudFile,
	serializeProjectTranscriptionCloudFile,
	serializeProjectTranscriptionHistoryCloudFile,
	serializeTombstoneCloudFile,
	tombstoneCloudFileToRow,
	validateCollationHeadMatchesCheckpoint,
	validateProjectTranscriptionHeadMatchesCheckpoint,
	type HistoryCloudFile,
} from './cloud-files';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;
let storeOptions: StoreOperationOptions;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
	storeOptions = { backend };
});

afterEach(async () => {
	await harness.destroy();
});

describe('cloud file serialization formats', () => {
	it('round-trips project metadata and tombstones through deterministic JSON', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			name: 'Gospel of John Collation',
			description: 'Collation of John Chapter 18 witnesses',
			charter: 'Project charter text',
			collationSettings: { regularize: false, normalization: true },
			createdAt: '2026-06-08T12:00:00.000Z',
			updatedAt: '2026-06-08T12:30:00.000Z',
		});
		await harness.db
			.insertInto('sync_tombstones')
			.values({
				id: 'tombstone-1',
				project_id: 'project-1',
				entity_type: 'project-transcription',
				entity_id: 'pt-1',
				cloud_path: projectRelativeCloudPaths().transcriptions('pt-1'),
				deletion_revision_id: 'checkpoint-90',
				deleted_by: 'editor@example.com',
				deleted_at: '2026-06-08T12:40:00.000Z',
			})
			.execute();

		const projectFile = await serializeProjectCloudFile(harness.db, 'project-1');
		const parsedProject = await parseProjectCloudFile(await serializeCloudFile(projectFile));
		const tombstoneFile = await serializeTombstoneCloudFile(harness.db, 'tombstone-1');
		const parsedTombstone = await parseTombstoneCloudFile(await serializeCloudFile(tombstoneFile));

		expect(parsedProject).toEqual({ ok: true, value: projectFile });
		expect(parsedTombstone).toEqual({ ok: true, value: tombstoneFile });
		if (!parsedProject.ok || !parsedTombstone.ok)
			throw new Error('Expected valid cloud files.');
		expect(projectCloudFileToRepositoryInput(parsedProject.value)).toMatchObject({
			id: 'project-1',
			name: 'Gospel of John Collation',
			collationSettings: { normalization: true, regularize: false },
		});
		expect(parsedProject.value.manifest_content_hash).toMatch(/^sha256:/);
		expect(parsedProject.value.transcriptions).toEqual([]);
		expect(parsedProject.value.collations).toEqual([]);
		expect(parsedProject.value.tombstones).toEqual([
			expect.objectContaining({
				tombstone_id: 'tombstone-1',
				entity_type: 'project-transcription',
				entity_id: 'pt-1',
				primary_path: 'tombstones/tombstone-1.json',
				content_hash: expect.stringMatching(/^sha256:/),
			}),
		]);
		expect(tombstoneCloudFileToRow(parsedTombstone.value)).toMatchObject({
			id: 'tombstone-1',
			cloud_path: 'transcriptions/pt-1.json',
		});
		expect(await parseProjectCloudFile({ ...projectFile, schema_version: 2 })).toMatchObject({
			ok: false,
			quarantine: { code: 'invalid_shape' },
		});
	});

	it('round-trips project transcription snapshots, IIIF records, and history files', async () => {
		await createTranscription(harness.db, {
			id: 'tx-1',
			title: 'Codex Vaticanus - John 18',
			siglum: '03',
			description: 'Transcription from IIIF images',
			document: documentWithVerses(['John 18:1']),
			tags: ['john', 'vaticanus'],
			transcriber: 'David Flood',
			repository: 'Vatican Library',
			settlement: 'Vatican City',
			language: 'grc',
			createdAt: '2026-06-08T12:00:00.000Z',
			updatedAt: '2026-06-08T12:00:00.000Z',
		});
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		const [snapshotId] = await syncProjectTranscriptionIds(harness.db, 'project-1', ['tx-1']);
		const projectTranscriptionId = await getProjectTranscriptionId(snapshotId);
		const manifest = await ensureManifestSource(harness.db, {
			transcriptionId: snapshotId,
			manifestUrl: 'https://example.org/manifest.json',
			label: 'Vaticanus manifest',
			metadata: { b: 'second', a: 'first' },
		});
		await upsertPageCanvasLink(harness.db, pageCanvasLinkInput(snapshotId, manifest.id));
		await upsertCanvasAnnotation(harness.db, {
			transcriptionId: snapshotId,
			manifestSourceId: manifest.id,
			pageId: 'page-1',
			canvasId: 'canvas-1',
			anchor: { pageId: 'page-1', role: 'page' },
			createdBy: 'editor@example.com',
			annotation: {
				'@context': 'http://www.w3.org/ns/anno.jsonld',
				id: 'anno-1',
				type: 'Annotation',
				body: [{ type: 'TextualBody', value: 'note', purpose: 'commenting' }],
				target: { source: 'canvas-1' },
			},
		});
		await createCommittedTranscriptionCheckpointWithFiles(harness.db, {
			projectTranscriptionId,
			checkpointId: 'tx-cp-1',
			commitMessage: 'Initial transcription commit',
			authorName: 'Editor',
			createdAt: '2026-06-08T12:05:00.000Z',
		}, storeOptions);

		const primary = await serializeProjectTranscriptionCloudFile(
			harness.db,
			projectTranscriptionId
		);
		const history = await serializeProjectTranscriptionHistoryCloudFile(
			harness.db,
			projectTranscriptionId,
			'tx-cp-1',
			storeOptions
		);
		const serializedPrimary = await serializeCloudFile(primary);
		const parsedPrimary = await parseProjectTranscriptionCloudFile(serializedPrimary);
		const parsedHistory = await parseHistoryCloudFile(await serializeCloudFile(history));

		expect(parsedPrimary).toEqual({ ok: true, value: primary });
		expect(parsedHistory).toEqual({ ok: true, value: history });
		expect(primary).not.toHaveProperty('scope_type');
		expect(JSON.parse(serializedPrimary)).not.toHaveProperty('scope_type');
		if (!parsedPrimary.ok || !parsedHistory.ok)
			throw new Error('Expected valid transcription files.');
		expect(
			validateProjectTranscriptionHeadMatchesCheckpoint(
				parsedPrimary.value,
				parsedHistory.value
			)
		).toEqual({
			ok: true,
		});
		expect(
			projectTranscriptionCloudFileToImportInput('project-1', parsedPrimary.value)
		).toMatchObject({
			project_id: 'project-1',
			project_transcription_id: projectTranscriptionId,
			transcription_id: snapshotId,
			iiif_manifest_sources: [{ metadata_json: { a: 'first', b: 'second' } }],
			page_canvas_links: [{ canvas_id: 'canvas-1' }],
			canvas_annotations: [{ annotation_id: 'anno-1' }],
		});
		expect(historyCloudFileToImportInput(parsedHistory.value)).toMatchObject({
			checkpoint_id: 'tx-cp-1',
			project_transcription_id: projectTranscriptionId,
			transcription_id: snapshotId,
			content_hash: primary.current_revision.content_hash,
		});
		const projectFile = await serializeProjectCloudFile(harness.db, 'project-1');
		expect(projectFile.transcriptions).toEqual([
			expect.objectContaining({
				project_transcription_id: projectTranscriptionId,
				transcription_id: snapshotId,
				current_revision: {
					id: 'tx-cp-1',
					content_hash: primary.current_revision.content_hash,
				},
				primary_path: `transcriptions/${projectTranscriptionId}.json`,
			}),
		]);
		const tamperedPrimary = JSON.parse(await serializeCloudFile(primary)) as Record<string, unknown>;
		tamperedPrimary.title = 'Tampered title';
		expect(await parseProjectTranscriptionCloudFile(tamperedPrimary)).toMatchObject({
			ok: false,
			quarantine: { code: 'hash_mismatch' },
		});

		await updateTranscriptionContent(harness.db, {
			id: snapshotId,
			document: documentWithVerses(['John 18:2']),
			updatedAt: '2026-06-08T12:10:00.000Z',
		});
		await expect(
			serializeProjectTranscriptionCloudFile(harness.db, projectTranscriptionId)
		).rejects.toThrow('uncommitted changes');
	});

	it('round-trips collations with child records and history files', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		await createTranscription(harness.db, {
			id: 'tx-a',
			title: 'Witness A',
			siglum: 'A',
			document: documentWithVerses(['John 18:1']),
			transcriber: 'Editor',
			repository: 'Library',
			settlement: 'City',
			language: 'grc',
		});
		await createTranscription(harness.db, {
			id: 'tx-b',
			title: 'Witness B',
			siglum: 'B',
			document: documentWithVerses(['John 18:1']),
			transcriber: 'Editor',
			repository: 'Library',
			settlement: 'City',
			language: 'grc',
		});
		const [snapshotAId, snapshotBId] = await syncProjectTranscriptionIds(
			harness.db,
			'project-1',
			['tx-a', 'tx-b']
		);
		const projectTranscriptionAId = await getProjectTranscriptionId(snapshotAId);
		const projectTranscriptionBId = await getProjectTranscriptionId(snapshotBId);
		const sourceA = await createCommittedTranscriptionCheckpointWithFiles(harness.db, {
			projectTranscriptionId: projectTranscriptionAId,
			checkpointId: 'tx-a-cp-1',
			createdAt: '2026-06-08T12:01:00.000Z',
		}, storeOptions);
		const sourceB = await createCommittedTranscriptionCheckpointWithFiles(harness.db, {
			projectTranscriptionId: projectTranscriptionBId,
			checkpointId: 'tx-b-cp-1',
			createdAt: '2026-06-08T12:02:00.000Z',
		}, storeOptions);
		await createCollation(harness.db, {
			id: 'col-1',
			projectId: 'project-1',
			title: 'John 18:1 Collation',
			verseIdentifier: 'B04K18V1',
			now: '2026-06-08T12:00:00.000Z',
		});
		await insertCollationChildRows({
			a: {
				projectTranscriptionId: projectTranscriptionAId,
				transcriptionId: snapshotAId,
				sourceRevisionId: sourceA.id,
				sourceContentHash: sourceA.contentHash,
			},
			b: {
				projectTranscriptionId: projectTranscriptionBId,
				transcriptionId: snapshotBId,
				sourceRevisionId: sourceB.id,
				sourceContentHash: sourceB.contentHash,
			},
		});
		await saveCollationArtifact(harness.db, {
			collationId: 'col-1',
			artifactId: 'artifact-1',
			artifactType: 'collation_document_v1',
			payload: '{"b":2,"a":1}',
			now: '2026-06-08T12:03:00.000Z',
		});
		await createCommittedCollationCheckpointWithFiles(harness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-1',
			commitMessage: 'Initial collation commit',
			authorName: 'Editor',
			createdAt: '2026-06-08T12:10:00.000Z',
		}, storeOptions);

		const primary = await serializeCollationCloudFile(harness.db, 'col-1');
		const history = await serializeCollationHistoryCloudFile(
			harness.db,
			'col-1',
			'col-cp-1',
			storeOptions
		);
		const parsedPrimary = await parseCollationCloudFile(await serializeCloudFile(primary));
		const parsedHistory = await parseHistoryCloudFile(await serializeCloudFile(history));

		expect(parsedPrimary).toEqual({ ok: true, value: primary });
		expect(parsedHistory).toEqual({ ok: true, value: history });
		if (!parsedPrimary.ok || !parsedHistory.ok)
			throw new Error('Expected valid collation files.');
		expect(
			validateCollationHeadMatchesCheckpoint(parsedPrimary.value, parsedHistory.value)
		).toEqual({
			ok: true,
		});
		expect(collationCloudFileToImportInput(parsedPrimary.value)).toMatchObject({
			id: 'col-1',
			witnesses: [{ witness_id: 'A' }, { witness_id: 'B' }],
			tokens: [{ witness_id: 'A' }, { witness_id: 'B' }],
			variation_units: [{ id: 'unit-1' }],
			readings: [{ id: 'reading-a' }, { id: 'reading-b' }],
			reading_witnesses: [
				{ reading_id: 'reading-a', witness_id: 'A' },
				{ reading_id: 'reading-b', witness_id: 'B' },
			],
			artifacts: [{ artifact_type: 'collation_document_v1', payload: { a: 1, b: 2 } }],
		});
		expect(historyCloudFileToImportInput(parsedHistory.value)).toMatchObject({
			checkpoint_id: 'col-cp-1',
			collation_id: 'col-1',
			content_hash: primary.current_revision.content_hash,
		});
		expect(
			validateCollationHeadMatchesCheckpoint(parsedPrimary.value, {
				...parsedHistory.value,
				checkpoint_id: 'other-checkpoint',
			} as HistoryCloudFile)
		).toMatchObject({ ok: false, quarantine: { code: 'hash_mismatch' } });
	});
});

function documentWithVerses(verses: string[]): StoredTranscriptionDocument {
	return {
		type: 'transcriptionDocument',
		pages: [
			{
				type: 'page',
				id: 'page-1',
				columns: [
					{
						type: 'column',
						number: 1,
						lines: [
							{
								type: 'line',
								number: 1,
								items: verses.map(value => {
									const [book = '', chapterVerse = ''] = value.split(' ');
									const [chapter = '', verse = ''] = chapterVerse.split(':');
									return {
										type: 'milestone' as const,
										kind: 'verse' as const,
										attrs: { book, chapter, verse },
									};
								}),
							},
						],
					},
				],
			},
		],
	};
}

function pageCanvasLinkInput(transcriptionId: string, manifestSourceId: string) {
	return {
		transcriptionId,
		pageId: 'page-1',
		pageNameSnapshot: 'Page 1',
		pageOrder: 1,
		manifestSourceId,
		manifestUrlSnapshot: 'https://example.org/manifest.json',
		canvasId: 'canvas-1',
		canvasOrder: 1,
		canvasLabel: 'Canvas 1',
		imageServiceUrl: null,
		thumbnailUrl: null,
		linkRole: 'primary',
	};
}

async function getProjectTranscriptionId(transcriptionId: string): Promise<string> {
	const row = await harness.db
		.selectFrom('project_transcriptions')
		.select('id')
		.where('transcription_id', '=', transcriptionId)
		.executeTakeFirstOrThrow();
	if (!row.id) throw new Error('Missing project transcription id.');
	return row.id;
}

async function insertCollationChildRows(sources: {
	a: {
		projectTranscriptionId: string;
		transcriptionId: string;
		sourceRevisionId: string;
		sourceContentHash: string;
	};
	b: {
		projectTranscriptionId: string;
		transcriptionId: string;
		sourceRevisionId: string;
		sourceContentHash: string;
	};
}): Promise<void> {
	await harness.db
		.insertInto('collation_witnesses')
		.values([
			{
				id: 'witness-b',
				collation_id: 'col-1',
				witness_id: 'B',
				content: 'in pricipio',
				position: 1,
				project_transcription_id: sources.b.projectTranscriptionId,
				transcription_id: sources.b.transcriptionId,
				source_revision_id: sources.b.sourceRevisionId,
				source_content_hash: sources.b.sourceContentHash,
			},
			{
				id: 'witness-a',
				collation_id: 'col-1',
				witness_id: 'A',
				content: 'in principio',
				position: 0,
				project_transcription_id: sources.a.projectTranscriptionId,
				transcription_id: sources.a.transcriptionId,
				source_revision_id: sources.a.sourceRevisionId,
				source_content_hash: sources.a.sourceContentHash,
			},
		])
		.execute();
	await harness.db
		.insertInto('collation_tokens')
		.values([
			{
				id: 'token-b',
				collation_id: 'col-1',
				witness_id: 'B',
				token_index: 0,
				token_text: 'in',
			},
			{
				id: 'token-a',
				collation_id: 'col-1',
				witness_id: 'A',
				token_index: 0,
				token_text: 'in',
			},
		])
		.execute();
	await harness.db
		.insertInto('collation_variation_units')
		.values({
			id: 'unit-1',
			collation_id: 'col-1',
			start_index: 0,
			end_index: 1,
			unit_type: 'variation',
			base_text: 'in',
		})
		.execute();
	await harness.db
		.insertInto('collation_readings')
		.values([
			{
				id: 'reading-b',
				variation_unit_id: 'unit-1',
				reading_order: 1,
				reading_text: 'om.',
				is_lacuna: 0,
				is_omission: 1,
			},
			{
				id: 'reading-a',
				variation_unit_id: 'unit-1',
				reading_order: 0,
				reading_text: 'in',
				is_lacuna: 0,
				is_omission: 0,
			},
		])
		.execute();
	await harness.db
		.insertInto('collation_reading_witnesses')
		.values([
			{ id: 'rw-b', reading_id: 'reading-b', witness_id: 'B' },
			{ id: 'rw-a', reading_id: 'reading-a', witness_id: 'A' },
		])
		.execute();
}
