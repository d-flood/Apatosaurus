import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { COLLATION_FIXTURE } from '$lib/client/store';
import { MemoryStoreBackend } from '$lib/client/store/memory-store-backend.spec-support';
import { ensureManifestSource, upsertCanvasAnnotation, upsertPageCanvasLink } from './iiif';
import { createCollation, saveCollationArtifact, updateCollationMetadata } from './collations';
import { createProject as createProjectRepository, syncProjectTranscriptionIds } from './projects';
import { createTranscription, updateTranscriptionContent } from './transcriptions';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import {
	buildCollationHashPayload,
	canonicalJson,
	createCommittedCollationCheckpoint,
	createCommittedTranscriptionCheckpoint,
	getCollationCheckpointStatus,
	getProjectTranscriptionCheckpointStatus,
	hashCanonicalPayload,
	isCollationDirty,
	isTranscriptionDirty,
	listCommittedTranscriptionCheckpoints,
	type SerializedCollation,
} from './revisions';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;

beforeEach(async () => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
	await createProject(harness.db, {
		id: 'default-project',
		storageSlug: 'default-project',
		name: 'Default',
	});
});

afterEach(async () => {
	await harness.destroy();
});

function createProject(
	db: Parameters<typeof createProjectRepository>[0],
	input: Parameters<typeof createProjectRepository>[1]
) {
	return createProjectRepository(db, input, { backend });
}

describe('revision hashing and checkpoints', () => {
	it('canonicalizes JSON before hashing semantic payloads', async () => {
		const left = { z: 'e\u0301\r\nline', a: [{ b: true, a: 1 }] };
		const right = JSON.parse('{"a":[{"a":1,"b":true}],"z":"\\u00e9\\nline"}');

		const leftHash = await hashCanonicalPayload(left);
		const rightHash = await hashCanonicalPayload(right);

		expect(canonicalJson(left)).toBe('{"a":[{"a":1,"b":true}],"z":"\u00e9\\nline"}');
		expect(leftHash).toBe(rightHash);
		expect(leftHash).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(() => canonicalJson({ bad: undefined })).toThrow('Cannot canonicalize undefined');
		expect(() => canonicalJson(Number.NaN)).toThrow('Cannot canonicalize non-finite number');
	});

	it('builds collation hashes independent of incidental child ids and input order', async () => {
		const first = buildCollationHashPayload(baseSerializedCollation());
		const second = buildCollationHashPayload({
			...baseSerializedCollation(),
			witnesses: [
				{ ...baseSerializedCollation().witnesses[1], id: 'new-witness-b' },
				{ ...baseSerializedCollation().witnesses[0], id: 'new-witness-a' },
			],
			tokens: [
				{ ...baseSerializedCollation().tokens[1], id: 'new-token-b' },
				{ ...baseSerializedCollation().tokens[0], id: 'new-token-a' },
			],
			variation_units: [{ ...baseSerializedCollation().variation_units[0], id: 'new-unit' }],
			readings: baseSerializedCollation().readings.map(reading => ({
				...reading,
				id: reading.id === 'reading-a' ? 'new-reading-a' : 'new-reading-b',
				variation_unit_id: 'new-unit',
			})),
			reading_witnesses: [
				{ reading_id: 'new-reading-b', witness_id: 'B' },
				{ reading_id: 'new-reading-a', witness_id: 'A' },
			],
			artifacts: [{ ...baseSerializedCollation().artifacts[0], id: 'new-artifact' }],
		});

		expect(await hashCanonicalPayload(first)).toBe(await hashCanonicalPayload(second));
	});

	it('creates committed transcription checkpoints and tracks dirty working snapshots', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		await createTranscription(harness.db, {
			id: 'tx-1',
			projectId: 'project-1',
			projectTranscriptionId: 'pt-1',
			title: 'Witness 01',
			siglum: '01',
			document: documentWithVerses(['Romans 1:1']),
			tags: ['romans'],
			transcriber: 'Editor',
			repository: 'Library',
			settlement: 'City',
			language: 'grc',
		});
		const snapshotId = 'tx-1';
		const projectTranscriptionId = 'pt-1';
		const manifest = await ensureManifestSource(harness.db, {
			transcriptionId: snapshotId,
			manifestUrl: 'https://example.org/manifest.json',
			label: 'Manifest',
			metadata: { b: 'second', a: 'first' },
		});
		await upsertPageCanvasLink(harness.db, pageCanvasLinkInput(snapshotId, manifest.id));
		await upsertCanvasAnnotation(harness.db, {
			transcriptionId: snapshotId,
			manifestSourceId: manifest.id,
			pageId: 'page-1',
			canvasId: 'canvas-1',
			anchor: { pageId: 'page-1' },
			annotation: {
				'@context': 'http://www.w3.org/ns/anno.jsonld',
				id: 'anno-1',
				type: 'Annotation',
				body: [{ type: 'TextualBody', value: 'note', purpose: 'commenting' }],
				target: { source: 'canvas-1' },
			},
		});

		const initialStatus = await getProjectTranscriptionCheckpointStatus(
			harness.db,
			projectTranscriptionId
		);
		expect(initialStatus).toMatchObject({
			projectTranscriptionId,
			projectOwnedTranscriptionId: snapshotId,
			currentCheckpoint: null,
			dirtyToCheckpoint: true,
			commitState: 'never-committed',
		});
		expect(initialStatus.workingContentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(await isTranscriptionDirty(harness.db, projectTranscriptionId)).toBe(true);

		const first = await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId,
			checkpointId: 'tx-cp-1',
			commitMessage: 'Initial transcription commit',
			authorName: 'Editor',
			createdAt: '2026-06-09T10:00:00.000Z',
		});
		const row = await harness.db
			.selectFrom('transcription_checkpoints')
			.selectAll()
			.where('id', '=', 'tx-cp-1')
			.executeTakeFirstOrThrow();
		const head = await harness.db
			.selectFrom('transcriptions')
			.select(['current_revision_id', 'current_content_hash'])
			.where('id', '=', snapshotId)
			.executeTakeFirstOrThrow();

		expect(first).toMatchObject({
			id: 'tx-cp-1',
			projectTranscriptionId,
			transcriptionId: snapshotId,
			parentCheckpointId: null,
			isCommitted: true,
			commitMessage: 'Initial transcription commit',
			authorName: 'Editor',
		});
		expect(row).toMatchObject({
			id: 'tx-cp-1',
			transcription_id: snapshotId,
			parent_checkpoint_id: null,
			content_hash: first.contentHash,
			is_committed: 1,
		});
		expect(head).toEqual({
			current_revision_id: 'tx-cp-1',
			current_content_hash: first.contentHash,
		});
		expect(first.payload).toMatchObject({
			project_transcription_id: projectTranscriptionId,
			id: snapshotId,
			iiif_manifest_sources: [{ metadata_json: { a: 'first', b: 'second' } }],
		});
		expect(first.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(
			await getProjectTranscriptionCheckpointStatus(harness.db, projectTranscriptionId)
		).toMatchObject({
			currentCheckpoint: { revisionId: 'tx-cp-1', contentHash: first.contentHash },
			workingContentHash: first.contentHash,
			dirtyToCheckpoint: false,
			commitState: 'clean',
		});
		expect(await isTranscriptionDirty(harness.db, projectTranscriptionId)).toBe(false);

		await updateTranscriptionContent(harness.db, {
			id: snapshotId,
			document: documentWithVerses(['Romans 1:2']),
			updatedAt: '2026-06-09T11:00:00.000Z',
		});

		const dirtyStatus = await getProjectTranscriptionCheckpointStatus(
			harness.db,
			projectTranscriptionId
		);
		expect(dirtyStatus).toMatchObject({
			currentCheckpoint: { revisionId: 'tx-cp-1', contentHash: first.contentHash },
			dirtyToCheckpoint: true,
			commitState: 'dirty',
		});
		expect(dirtyStatus.workingContentHash).not.toBe(first.contentHash);
		expect(await isTranscriptionDirty(harness.db, projectTranscriptionId)).toBe(true);

		const second = await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId,
			checkpointId: 'tx-cp-2',
			createdAt: '2026-06-09T12:00:00.000Z',
		});

		expect(second.parentCheckpointId).toBe('tx-cp-1');
		expect(second.contentHash).not.toBe(first.contentHash);
		expect(await isTranscriptionDirty(harness.db, projectTranscriptionId)).toBe(false);
	});

	it('lists committed transcription checkpoints newest-first and omits uncommitted rows', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		await createTranscription(harness.db, {
			id: 'tx-1',
			projectId: 'project-1',
			projectTranscriptionId: 'pt-1',
			title: 'Witness 01',
			siglum: '01',
			document: documentWithVerses(['Romans 1:1']),
			transcriber: 'Editor',
			repository: 'Library',
			settlement: 'City',
			language: 'grc',
		});
		const snapshotId = 'tx-1';
		const projectTranscriptionId = 'pt-1';

		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId,
			checkpointId: 'tx-cp-a',
			createdAt: '2026-06-20T10:00:00.000Z',
		});
		await updateTranscriptionContent(harness.db, {
			id: snapshotId,
			document: documentWithVerses(['Romans 1:2']),
			updatedAt: '2026-06-20T11:00:00.000Z',
		});
		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId,
			checkpointId: 'tx-cp-b',
			createdAt: '2026-06-20T12:00:00.000Z',
		});

		const summaries = await listCommittedTranscriptionCheckpoints(harness.db, snapshotId);

		expect(summaries.map(row => row.id)).toEqual(['tx-cp-b', 'tx-cp-a']);
		expect(summaries[0]).toMatchObject({
			transcriptionId: snapshotId,
			isCommitted: true,
			parentCheckpointId: 'tx-cp-a',
		});
	});

	it('creates committed collation checkpoints and tracks dirty working collations', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		await createCollation(harness.db, {
			id: 'col-1',
			projectId: 'project-1',
			title: 'Romans 1:1',
			verseIdentifier: 'Romans 1:1',
			now: '2026-06-09T09:00:00.000Z',
		});
		await insertCollationProjectionRows();
		await saveCollationArtifact(harness.db, {
			collationId: 'col-1',
			artifactId: 'artifact-1',
			artifactType: 'collation_document_v1',
			payload: JSON.stringify(COLLATION_FIXTURE.document),
			now: '2026-06-09T09:30:00.000Z',
		});

		expect(await getCollationCheckpointStatus(harness.db, 'col-1')).toMatchObject({
			collationId: 'col-1',
			currentCheckpoint: null,
			dirtyToCheckpoint: true,
			commitState: 'never-committed',
		});
		expect(await isCollationDirty(harness.db, 'col-1')).toBe(true);

		const first = await createCommittedCollationCheckpoint(harness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-1',
			commitMessage: 'Initial collation commit',
			authorName: 'Editor',
			createdAt: '2026-06-09T10:00:00.000Z',
		});
		const row = await harness.db
			.selectFrom('collation_checkpoints')
			.selectAll()
			.where('id', '=', 'col-cp-1')
			.executeTakeFirstOrThrow();
		const head = await harness.db
			.selectFrom('collations')
			.select(['current_revision_id', 'current_content_hash'])
			.where('id', '=', 'col-1')
			.executeTakeFirstOrThrow();

		expect(first).toMatchObject({
			id: 'col-cp-1',
			collationId: 'col-1',
			parentCheckpointId: null,
			isCommitted: true,
			commitMessage: 'Initial collation commit',
			authorName: 'Editor',
		});
		expect(row).toMatchObject({
			id: 'col-cp-1',
			collation_id: 'col-1',
			parent_checkpoint_id: null,
			content_hash: first.contentHash,
			is_committed: 1,
		});
		expect(head).toEqual({
			current_revision_id: 'col-cp-1',
			current_content_hash: first.contentHash,
		});
		expect(first.payload).toMatchObject({
			id: 'col-1',
			document: {
				type: 'collationDocument',
				version: 1,
				meta: { collationId: 'col-1', projectId: 'project-1' },
			},
		});
		expect(first.payload).not.toHaveProperty('variation_units');
		expect(first.payload).not.toHaveProperty('artifacts');
		expect(await getCollationCheckpointStatus(harness.db, 'col-1')).toMatchObject({
			currentCheckpoint: { revisionId: 'col-cp-1', contentHash: first.contentHash },
			workingContentHash: first.contentHash,
			dirtyToCheckpoint: false,
			commitState: 'clean',
		});
		expect(await isCollationDirty(harness.db, 'col-1')).toBe(false);

		await updateCollationMetadata(harness.db, {
			id: 'col-1',
			notes: 'Needs review',
			updatedAt: '2026-06-09T11:00:00.000Z',
		});

		const dirtyStatus = await getCollationCheckpointStatus(harness.db, 'col-1');
		expect(dirtyStatus).toMatchObject({
			currentCheckpoint: { revisionId: 'col-cp-1', contentHash: first.contentHash },
			dirtyToCheckpoint: true,
			commitState: 'dirty',
		});
		expect(dirtyStatus.workingContentHash).not.toBe(first.contentHash);
		expect(await isCollationDirty(harness.db, 'col-1')).toBe(true);

		const second = await createCommittedCollationCheckpoint(harness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-2',
			createdAt: '2026-06-09T12:00:00.000Z',
		});

		expect(second.parentCheckpointId).toBe('col-cp-1');
		expect(second.contentHash).not.toBe(first.contentHash);
		expect(await isCollationDirty(harness.db, 'col-1')).toBe(false);
	});
});

function baseSerializedCollation(): SerializedCollation {
	return {
		id: 'col-1',
		project_id: 'project-1',
		title: 'Romans 1:1',
		verse_identifier: 'Romans 1:1',
		status: 'draft',
		group_path: '',
		notes: '',
		sort_key: 0,
		witnesses: [
			{
				id: 'witness-a',
				witness_id: 'A',
				content: 'in principio',
				position: 0,
				project_transcription_id: 'pt-a',
				transcription_id: 'tx-a',
				source_revision_id: 'source-rev-a',
				source_content_hash: 'sha256:source-a',
			},
			{
				id: 'witness-b',
				witness_id: 'B',
				content: 'in pricipio',
				position: 1,
				project_transcription_id: 'pt-b',
				transcription_id: 'tx-b',
				source_revision_id: 'source-rev-b',
				source_content_hash: 'sha256:source-b',
			},
		],
		tokens: [
			{ id: 'token-a', witness_id: 'A', token_index: 0, token_text: 'in' },
			{ id: 'token-b', witness_id: 'B', token_index: 0, token_text: 'in' },
		],
		variation_units: [
			{ id: 'unit-1', start_index: 0, end_index: 1, unit_type: 'variation', base_text: 'in' },
		],
		readings: [
			{
				id: 'reading-a',
				variation_unit_id: 'unit-1',
				reading_order: 0,
				reading_text: 'in',
				is_lacuna: false,
				is_omission: false,
			},
			{
				id: 'reading-b',
				variation_unit_id: 'unit-1',
				reading_order: 1,
				reading_text: 'om.',
				is_lacuna: false,
				is_omission: true,
			},
		],
		reading_witnesses: [
			{ reading_id: 'reading-a', witness_id: 'A' },
			{ reading_id: 'reading-b', witness_id: 'B' },
		],
		artifacts: [
			{ id: 'artifact-1', artifact_type: 'collation_document_v1', payload: { b: 2, a: 1 } },
		],
	};
}

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

async function insertCollationProjectionRows(): Promise<void> {
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
