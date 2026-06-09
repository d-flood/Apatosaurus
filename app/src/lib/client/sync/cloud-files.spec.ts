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
import {
	createCommittedCollationCheckpoint,
	createCommittedTranscriptionCheckpoint,
} from '$lib/client/db/repositories/revisions';
import {
	createTranscription,
	updateTranscriptionContent,
} from '$lib/client/db/repositories/transcriptions';
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

beforeEach(() => {
	harness = createLocalDbTestHarness();
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
		const parsedProject = parseProjectCloudFile(serializeCloudFile(projectFile));
		const tombstoneFile = await serializeTombstoneCloudFile(harness.db, 'tombstone-1');
		const parsedTombstone = parseTombstoneCloudFile(serializeCloudFile(tombstoneFile));

		expect(parsedProject).toEqual({ ok: true, value: projectFile });
		expect(parsedTombstone).toEqual({ ok: true, value: tombstoneFile });
		if (!parsedProject.ok || !parsedTombstone.ok)
			throw new Error('Expected valid cloud files.');
		expect(projectCloudFileToRepositoryInput(parsedProject.value)).toMatchObject({
			id: 'project-1',
			name: 'Gospel of John Collation',
			collationSettings: { normalization: true, regularize: false },
		});
		expect(tombstoneCloudFileToRow(parsedTombstone.value)).toMatchObject({
			id: 'tombstone-1',
			cloud_path: 'transcriptions/pt-1.json',
		});
		expect(parseProjectCloudFile({ ...projectFile, schema_version: 2 })).toMatchObject({
			ok: false,
			quarantine: { code: 'invalid_schema_version' },
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
		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId,
			checkpointId: 'tx-cp-1',
			commitMessage: 'Initial transcription commit',
			authorName: 'Editor',
			createdAt: '2026-06-08T12:05:00.000Z',
		});

		const primary = await serializeProjectTranscriptionCloudFile(
			harness.db,
			projectTranscriptionId
		);
		const history = await serializeProjectTranscriptionHistoryCloudFile(
			harness.db,
			projectTranscriptionId,
			'tx-cp-1'
		);
		const parsedPrimary = await parseProjectTranscriptionCloudFile(serializeCloudFile(primary));
		const parsedHistory = await parseHistoryCloudFile(serializeCloudFile(history));

		expect(parsedPrimary).toEqual({ ok: true, value: primary });
		expect(parsedHistory).toEqual({ ok: true, value: history });
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
		expect(
			await parseProjectTranscriptionCloudFile({ ...primary, title: 'Tampered title' })
		).toMatchObject({ ok: false, quarantine: { code: 'hash_mismatch' } });

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
		await createCollation(harness.db, {
			id: 'col-1',
			projectId: 'project-1',
			title: 'John 18:1 Collation',
			verseIdentifier: 'B04K18V1',
			now: '2026-06-08T12:00:00.000Z',
		});
		await insertCollationChildRows();
		await saveCollationArtifact(harness.db, {
			collationId: 'col-1',
			artifactId: 'artifact-1',
			artifactType: 'collation_document_v1',
			payload: '{"b":2,"a":1}',
			now: '2026-06-08T12:03:00.000Z',
		});
		await createCommittedCollationCheckpoint(harness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-1',
			commitMessage: 'Initial collation commit',
			authorName: 'Editor',
			createdAt: '2026-06-08T12:10:00.000Z',
		});

		const primary = await serializeCollationCloudFile(harness.db, 'col-1');
		const history = await serializeCollationHistoryCloudFile(harness.db, 'col-1', 'col-cp-1');
		const parsedPrimary = await parseCollationCloudFile(serializeCloudFile(primary));
		const parsedHistory = await parseHistoryCloudFile(serializeCloudFile(history));

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

async function insertCollationChildRows(): Promise<void> {
	await harness.db
		.insertInto('collation_witnesses')
		.values([
			{
				id: 'witness-b',
				collation_id: 'col-1',
				witness_id: 'B',
				content: 'in pricipio',
				position: 1,
				project_transcription_id: null,
				transcription_id: null,
				source_revision_id: 'source-rev-b',
				source_content_hash: 'sha256:source-b',
			},
			{
				id: 'witness-a',
				collation_id: 'col-1',
				witness_id: 'A',
				content: 'in principio',
				position: 0,
				project_transcription_id: null,
				transcription_id: null,
				source_revision_id: 'source-rev-a',
				source_content_hash: 'sha256:source-a',
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
