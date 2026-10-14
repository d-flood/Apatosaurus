import {
	createTranscriptionWithFiles,
	createLocalDbTestHarness,
	type LocalDbTestHarness,
} from '$lib/testing/local-db-harness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectWriteLockName } from './project-locks';
import { createProject as createProjectRepository } from './projects';
import {
	createTranscription,
	getTranscription,
	listVerseIndexRowsForTranscription,
} from './transcriptions';
import {
	createTranscriptionWithFilesResult,
	createCommittedTranscriptionCheckpointWithFiles,
	getTranscriptionsWithWorkingFilesByIds,
	loadTranscriptionWithWorkingFile,
	rebuildVerseIndexForTranscriptionsWithFiles,
	replaceTranscriptionCurrent,
	restoreTranscriptionVersion,
	saveWorkingTranscriptionContent,
	saveWorkingTranscriptionMetadata,
	updateTranscriptionVersionNote,
} from './transcription-files';
import { rebuildIndexFromStore } from './index-rebuild';
import { listTranscriptionVersions } from './revisions';
import type { StoredTranscriptionDocument } from '$lib/transcription/content';
import {
	PROJECT_MANIFEST_FORMAT,
	PROJECT_TRANSCRIPTION_CURRENT_VERSION,
	PROJECT_TRANSCRIPTION_FORMAT,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	projectTranscriptionPayloadToSnapshot,
	readCanonicalDocument,
	WORKING_TRANSCRIPTION_FORMAT,
	type ProjectManifestPayload,
	type ProjectTranscriptionPayload,
	type TranscriptionCheckpointPayload,
	type WorkingTranscriptionPayload,
} from '$lib/storage/formats';
import { createQuarantineReport } from '$lib/storage/quarantine-report.spec-support';
import {
	joinStorePath,
	normalizeStorePath,
	projectManifestFile,
	storePathBasename,
	storePathDirname,
	transcriptionCheckpointFile,
	transcriptionPrimaryFile,
	transcriptionTeiFile,
	transcriptionWorkingFile,
} from '$lib/storage/layout';
import {
	readTextFile,
	StoreMoveUnavailableError,
	type StoreBackend,
	type StoreBackendDirectoryEntry,
	writeTextFileAtomic,
} from '$lib/storage/opfs-store';
import { registerUserReferenceEdition } from '$lib/reference-editions/user-reference-editions';
import { sealDocument, serializeSealedDocument, type JsonValue } from '$lib/storage/envelope';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await harness.destroy();
});

function createProject(
	db: Parameters<typeof createProjectRepository>[0],
	input: Parameters<typeof createProjectRepository>[1]
) {
	return createProjectRepository(db, input, { backend });
}

describe('transcription file persistence', () => {
	it('rejects metadata edits without canonical content before changing the index', async () => {
		await createFixtureTranscription();
		await expect(
			saveWorkingTranscriptionMetadata(
				harness.db,
				{
					id: 'tx-1',
					title: 'Changed',
					siglum: '02',
					description: '',
					tags: [],
					transcriber: '',
					repository: '',
					settlement: '',
					language: 'grc',
				},
				{ backend }
			)
		).rejects.toThrow('Canonical transcription file');
		expect((await getTranscription(harness.db, 'tx-1'))?.title).toBe('Witness 1');
		await expect(
			readTextFile(transcriptionPrimaryFile('project-slug', 'pt-1'), { backend })
		).rejects.toThrow();
	});

	it('reports a missing canonical file without changing its index or unrequested IDs', async () => {
		await createFixtureTranscription();
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-1' },
			{ backend }
		);
		for (const id of ['tx-missing', 'tx-untouched']) {
			await createTranscription(harness.db, {
				id,
				projectId: 'project-1',
				title: id,
				siglum: id,
				transcriber: '',
				repository: '',
				settlement: '',
				language: 'grc',
				document: documentWithVerses(['Romans 2:2']),
			});
		}
		const beforeMissing = await listVerseIndexRowsForTranscription(harness.db, 'tx-missing');
		const beforeUntouched = await listVerseIndexRowsForTranscription(
			harness.db,
			'tx-untouched'
		);
		await harness.db
			.deleteFrom('transcription_verse_index')
			.where('transcription_id', '=', 'tx-1')
			.execute();
		const result = await rebuildVerseIndexForTranscriptionsWithFiles(
			harness.db,
			['tx-1', 'tx-missing'],
			{ backend }
		);
		expect(result).toMatchObject({
			processed: 2,
			succeeded: 1,
			failed: 1,
			failures: [
				{
					transcriptionId: 'tx-missing',
					message: 'Canonical transcription file was not found',
				},
			],
		});
		expect(
			(await listVerseIndexRowsForTranscription(harness.db, 'tx-1')).map(
				row => row.verse_identifier
			)
		).toEqual(['Romans 1:1']);
		expect(await listVerseIndexRowsForTranscription(harness.db, 'tx-missing')).toEqual(
			beforeMissing
		);
		expect(await listVerseIndexRowsForTranscription(harness.db, 'tx-untouched')).toEqual(
			beforeUntouched
		);
	});

	it('writes metadata to the primary file before updating the index', async () => {
		await createFixtureTranscription();
		await saveWorkingTranscriptionContent(
			harness.db,
			{
				id: 'tx-1',
				document: documentWithVerses(['Romans 1:1']),
				updatedAt: '2026-07-04T00:00:00.000Z',
			},
			{ backend }
		);
		backend.failWrites = true;

		await expect(
			saveWorkingTranscriptionMetadata(
				harness.db,
				{
					id: 'tx-1',
					title: 'Edited title',
					siglum: '02',
					description: 'Edited description',
					tags: ['edited'],
					transcriber: 'New editor',
					repository: 'New library',
					settlement: 'New city',
					language: 'lat',
					updatedAt: '2026-07-04T12:00:00.000Z',
				},
				{ backend, nonce: () => 'failed-metadata-write' }
			)
		).rejects.toThrow('simulated write failure');

		expect(await getTranscription(harness.db, 'tx-1')).toMatchObject({
			title: 'Witness 1',
			siglum: '01',
			updated_at: '2026-07-04T00:00:00.000Z',
		});
	});

	it('derives edited transcription metadata from the primary file', async () => {
		await createFixtureTranscription();
		await saveWorkingTranscriptionContent(
			harness.db,
			{
				id: 'tx-1',
				document: documentWithVerses(['Romans 1:1']),
				updatedAt: '2026-07-04T00:00:00.000Z',
			},
			{ backend }
		);

		await saveWorkingTranscriptionMetadata(
			harness.db,
			{
				id: 'tx-1',
				title: 'Edited title',
				siglum: '02',
				description: 'Edited description',
				tags: ['edited'],
				transcriber: 'New editor',
				repository: 'New library',
				settlement: 'New city',
				language: 'lat',
				updatedAt: '2026-07-04T12:00:00.000Z',
			},
			{ backend, nonce: () => 'metadata-write' }
		);

		const raw = await readTextFile(transcriptionPrimaryFile('project-slug', 'pt-1'), {
			backend,
		});
		const parsed = await readCanonicalDocument<ProjectTranscriptionPayload>(
			PROJECT_TRANSCRIPTION_FORMAT,
			raw
		);
		expect(parsed).toMatchObject({
			ok: true,
			payload: {
				title: 'Edited title',
				siglum: '02',
				description: 'Edited description',
				tags: ['edited'],
				transcriber: 'New editor',
				repository: 'New library',
				settlement: 'New city',
				language: 'lat',
				updated_at: '2026-07-04T12:00:00.000Z',
			},
		});
		expect(await getTranscription(harness.db, 'tx-1')).toMatchObject({
			title: 'Edited title',
			siglum: '02',
			tags: ['edited'],
			updated_at: '2026-07-04T12:00:00.000Z',
		});
	});

	it('writes the primary transcription file before updating the index cache', async () => {
		await createFixtureTranscription();
		backend.failWrites = true;

		await expect(
			saveWorkingTranscriptionContent(
				harness.db,
				{
					id: 'tx-1',
					document: documentWithVerses(['Romans 1:2']),
					updatedAt: '2026-07-04T12:00:00.000Z',
				},
				{ backend, nonce: () => 'failed-write' }
			)
		).rejects.toThrow('simulated write failure');

		const row = await getTranscription(harness.db, 'tx-1');
		expect(row?.content_json).toContain('"verse":"1"');
		expect(row?.updated_at).toBe('2026-07-04T00:00:00.000Z');
	});

	it('stores Current in the primary file and then updates the index cache', async () => {
		await createFixtureTranscription();

		await saveWorkingTranscriptionContent(
			harness.db,
			{
				id: 'tx-1',
				document: documentWithVerses(['Romans 1:2']),
				updatedAt: '2026-07-04T12:00:00.000Z',
			},
			{ backend, nonce: () => 'working-write' }
		);

		const path = transcriptionPrimaryFile('project-slug', 'pt-1');
		const raw = await readTextFile(path, { backend });
		const parsed = await readCanonicalDocument<ProjectTranscriptionPayload>(
			PROJECT_TRANSCRIPTION_FORMAT,
			raw
		);
		const row = await getTranscription(harness.db, 'tx-1');

		expect(parsed).toMatchObject({
			ok: true,
			payload: {
				project_transcription_id: 'pt-1',
				id: 'tx-1',
				content_format: 'normalized_ast_v3',
				updated_at: '2026-07-04T12:00:00.000Z',
				based_on_checkpoint: null,
				draft: { saved_at: '2026-07-04T12:00:00.000Z', author_name: null },
			},
		});
		if (!parsed.ok) throw new Error('primary file did not parse');
		await expect(
			readTextFile(transcriptionTeiFile('project-slug', 'pt-1'), { backend })
		).resolves.toContain('<TEI');
		expect(JSON.stringify(parsed.payload.content_json)).toContain('"verse":"2"');
		expect(row?.content_json).toContain('"verse":"2"');
		expect(row?.updated_at).toBe('2026-07-04T12:00:00.000Z');
	});

	it('loads Current from the primary file when the index cache is stale', async () => {
		await createFixtureTranscription();
		await saveWorkingTranscriptionContent(
			harness.db,
			{
				id: 'tx-1',
				document: documentWithVerses(['Romans 1:2']),
				updatedAt: '2026-07-04T12:00:00.000Z',
			},
			{ backend, nonce: () => 'working-write' }
		);
		await harness.db
			.updateTable('transcriptions')
			.set({
				content_json: JSON.stringify(documentWithVerses(['Romans 1:1'])),
				updated_at: '2026-07-04T00:00:00.000Z',
			})
			.where('id', '=', 'tx-1')
			.execute();

		const loaded = await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', { backend });

		expect(loaded?.content_json).toContain('"verse":"2"');
		expect(loaded?.updated_at).toBe('2026-07-04T12:00:00.000Z');
	});

	it('does not let an old working file mask a newer committed primary', async () => {
		await createFixtureTranscription();
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
			{ backend }
		);
		const staleWorking = await legacyWorkingFileFromPrimary(null);
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-1' },
			{ backend }
		);
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-1', document: documentWithVerses(['Romans 1:3']) },
			{ backend }
		);
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-2' },
			{ backend }
		);
		await writeTextFileAtomic(transcriptionWorkingFile('project-slug', 'pt-1'), staleWorking, {
			backend,
		});

		const loaded = await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', { backend });

		expect(loaded?.content_json).toContain('"verse":"3"');
	});

	it('loads the committed primary file when no working file exists and the index cache is stale', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Project',
			createdAt: '2026-07-04T00:00:00.000Z',
			updatedAt: '2026-07-04T00:00:00.000Z',
		});
		await createTranscriptionWithFiles(
			harness.db,
			{
				id: 'tx-1',
				projectId: 'project-1',
				projectTranscriptionId: 'pt-1',
				title: 'Witness 1',
				siglum: '01',
				document: documentWithVerses(['Romans 1:2']),
				createdAt: '2026-07-04T00:00:00.000Z',
				updatedAt: '2026-07-04T00:00:00.000Z',
				transcriber: 'Editor',
				repository: 'Library',
				settlement: 'City',
				language: 'grc',
			},
			{ backend, nonce: () => 'create-write' }
		);
		await harness.db
			.updateTable('transcriptions')
			.set({
				title: 'Stale index title',
				content_json: JSON.stringify(documentWithVerses(['Romans 1:1'])),
				updated_at: '2026-07-04T12:00:00.000Z',
			})
			.where('id', '=', 'tx-1')
			.execute();

		const loaded = await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', { backend });

		expect(loaded?.title).toBe('Witness 1');
		expect(loaded?.content_json).toContain('"verse":"2"');
		expect(loaded?.updated_at).toBe('2026-07-04T00:00:00.000Z');
	});

	it('records every canonical validation failure without mutating the transcription primary', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Project',
			createdAt: '2026-07-04T00:00:00.000Z',
			updatedAt: '2026-07-04T00:00:00.000Z',
		});
		await createTranscriptionWithFiles(
			harness.db,
			{
				id: 'tx-1',
				projectId: 'project-1',
				projectTranscriptionId: 'pt-1',
				title: 'Witness 1',
				siglum: '01',
				document: documentWithVerses(['Romans 1:2']),
				createdAt: '2026-07-04T00:00:00.000Z',
				updatedAt: '2026-07-04T00:00:00.000Z',
				transcriber: '',
				repository: '',
				settlement: '',
				language: 'grc',
			},
			{ backend }
		);
		const path = transcriptionPrimaryFile('project-slug', 'pt-1');
		const validRaw = await readTextFile(path, { backend });
		const validDocument = JSON.parse(validRaw) as Record<string, unknown>;
		const failures = [
			{ code: 'invalid_json', raw: '{' },
			{
				code: 'invalid_schema_version',
				raw: JSON.stringify({ ...validDocument, schema_version: 99 }),
			},
			{
				code: 'invalid_shape',
				raw: serializeSealedDocument(
					await sealDocument(PROJECT_TRANSCRIPTION_FORMAT, 1, {})
				),
			},
			{ code: 'hash_mismatch', raw: JSON.stringify({ ...validDocument, title: 'tampered' }) },
		] as const;

		for (const failure of failures) {
			await writeTextFileAtomic(path, failure.raw, { backend });
			const quarantineSink = createQuarantineReport();

			await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', { backend, quarantineSink });

			expect(quarantineSink.list()).toEqual([
				expect.objectContaining({ path, code: failure.code, message: expect.any(String) }),
			]);
			expect(await readTextFile(path, { backend })).toBe(failure.raw);
		}
	});

	it('loads many transcriptions from files once per id when the index cache is stale', async () => {
		await createFixtureTranscription();
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-1' },
			{ backend, nonce: () => 'primary-write' }
		);
		await harness.db
			.updateTable('transcriptions')
			.set({
				title: 'Stale index title',
				content_json: JSON.stringify(documentWithVerses(['Romans 9:9'])),
			})
			.where('id', '=', 'tx-1')
			.execute();

		const loaded = await getTranscriptionsWithWorkingFilesByIds(
			harness.db,
			['tx-1', 'tx-1', 'missing'],
			{ backend }
		);

		expect(loaded).toHaveLength(1);
		expect(loaded[0]).toMatchObject({ id: 'tx-1', title: 'Witness 1' });
		expect(loaded[0].content_json).toContain('"verse":"1"');
	});

	it('rebuilds the verse index from canonical files when the index cache is stale', async () => {
		await createFixtureTranscription();
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-1' },
			{ backend, nonce: () => 'primary-write' }
		);
		await harness.db
			.updateTable('transcriptions')
			.set({ content_json: JSON.stringify(documentWithVerses(['Romans 9:9'])) })
			.where('id', '=', 'tx-1')
			.execute();

		const result = await rebuildVerseIndexForTranscriptionsWithFiles(harness.db, ['tx-1'], {
			backend,
		});
		const rows = await listVerseIndexRowsForTranscription(harness.db, 'tx-1');

		expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
		expect(rows.map(row => row.verse_identifier)).toEqual(['Romans 1:1']);
	});

	it('creates a transcription through the initial committed file path', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Project',
			createdAt: '2026-07-04T00:00:00.000Z',
			updatedAt: '2026-07-04T00:00:00.000Z',
		});

		const id = await createTranscriptionWithFiles(
			harness.db,
			{
				id: 'tx-created',
				projectId: 'project-1',
				projectTranscriptionId: 'pt-created',
				title: 'Created Witness',
				siglum: 'C',
				document: documentWithVerses(['Romans 1:3']),
				createdAt: '2026-07-04T00:00:00.000Z',
				updatedAt: '2026-07-04T00:00:00.000Z',
				transcriber: 'Editor',
				repository: 'Library',
				settlement: 'City',
				language: 'grc',
			},
			{ backend, nonce: () => 'create-write' }
		);
		const head = await harness.db
			.selectFrom('transcriptions')
			.select(['current_revision_id', 'current_content_hash'])
			.where('id', '=', 'tx-created')
			.executeTakeFirstOrThrow();

		const historyRaw = await readTextFile(
			transcriptionCheckpointFile('project-slug', 'pt-created', head.current_revision_id),
			{ backend }
		);
		const primaryRaw = await readTextFile(
			transcriptionPrimaryFile('project-slug', 'pt-created'),
			{
				backend,
			}
		);
		const manifestRaw = await readTextFile(projectManifestFile('project-slug'), { backend });
		const tei = await readTextFile(transcriptionTeiFile('project-slug', 'pt-created'), {
			backend,
		});
		const history = await readCanonicalDocument<TranscriptionCheckpointPayload>(
			TRANSCRIPTION_CHECKPOINT_FORMAT,
			historyRaw
		);
		const primary = await readCanonicalDocument<ProjectTranscriptionPayload>(
			PROJECT_TRANSCRIPTION_FORMAT,
			primaryRaw
		);
		const manifest = await readCanonicalDocument<ProjectManifestPayload>(
			PROJECT_MANIFEST_FORMAT,
			manifestRaw
		);

		expect(id).toBe('tx-created');
		expect(head.current_revision_id).toBeTruthy();
		expect(history).toMatchObject({
			ok: true,
			payload: {
				checkpoint_id: head.current_revision_id,
				entity_id: 'pt-created',
				payload_content_hash: head.current_content_hash,
			},
		});
		expect(primary).toMatchObject({
			ok: true,
			payload: {
				project_transcription_id: 'pt-created',
				id: 'tx-created',
				based_on_checkpoint: {
					id: head.current_revision_id,
					content_hash: head.current_content_hash,
				},
			},
		});
		expect(manifest).toMatchObject({
			ok: true,
			payload: {
				transcriptions: [
					{
						project_transcription_id: 'pt-created',
						current_revision: {
							id: head.current_revision_id,
							content_hash: head.current_content_hash,
						},
					},
				],
			},
		});
		expect(tei).toContain('<TEI');
	});

	it.each([
		['history', 'history/transcriptions/pt-created/'],
		['primary', 'transcriptions/pt-created.json.tmp-'],
		['manifest', 'project.json.tmp-'],
	])('does not publish a transcription when the initial %s write fails', async (_step, path) => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Project',
		});
		backend.failWritePathIncludes = path;

		await expect(
			createTranscriptionWithFiles(
				harness.db,
				{
					id: 'tx-created',
					projectId: 'project-1',
					projectTranscriptionId: 'pt-created',
					title: 'Created Witness',
					siglum: 'C',
					document: documentWithVerses(['Romans 1:3']),
					transcriber: '',
					repository: '',
					settlement: '',
					language: 'grc',
				},
				{ backend, nonce: () => 'create-failure' }
			)
		).rejects.toThrow('simulated write failure');
		await expect(
			harness.db
				.selectFrom('transcriptions')
				.selectAll()
				.where('id', '=', 'tx-created')
				.execute()
		).resolves.toEqual([]);
	});

	it('returns a TEI warning while transcription creation succeeds', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Project',
		});
		backend.failWritePathIncludes = '.tei.xml.tmp-';

		const result = await createTranscriptionWithFilesResult(
			harness.db,
			{
				id: 'tx-created',
				projectId: 'project-1',
				projectTranscriptionId: 'pt-created',
				title: 'Witness',
				siglum: 'C',
				document: documentWithVerses(['Romans 1:3']),
				transcriber: '',
				repository: '',
				settlement: '',
				language: 'grc',
			},
			{ backend }
		);

		expect(result.value).toBe('tx-created');
		expect(result.warnings).toEqual([
			expect.objectContaining({ code: 'tei_write_failed', entityType: 'transcription' }),
		]);
		await expect(getTranscription(harness.db, 'tx-created')).resolves.not.toBeNull();
	});

	it('writes legacy user-edition attribution from the local store into derived TEI', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Project',
		});
		const edition = await registerUserReferenceEdition(
			{
				xml: '<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader/><text><body><div type="book" n="book"><ab n="1"/></div></body></text></TEI>',
				fileName: 'legacy.xml',
			},
			{
				backend,
				parse: async () => ({
					source: { units: [{ position: 0, label: { verse: '1' }, content: [] }] },
					metadata: { title: 'Legacy edition', attribution: 'Legacy local attribution' },
				}),
			}
		);
		const document = documentWithVerses(['Romans 1:3']);
		document.referenceEditionsUsed = [edition.id];

		await createTranscriptionWithFiles(
			harness.db,
			{
				id: 'tx-created',
				projectId: 'project-1',
				projectTranscriptionId: 'pt-created',
				title: 'Witness',
				siglum: 'C',
				document,
				transcriber: '',
				repository: '',
				settlement: '',
				language: 'grc',
			},
			{ backend }
		);

		await expect(
			readTextFile(transcriptionTeiFile('project-slug', 'pt-created'), { backend })
		).resolves.toContain('Legacy local attribution');
	});

	it('writes committed transcription files before updating the index', async () => {
		await createFixtureTranscription();

		const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId: 'pt-1',
				checkpointId: 'tx-cp-1',
				commitMessage: 'Initial commit',
				authorName: 'Editor',
				createdAt: '2026-07-04T13:00:00.000Z',
			},
			{ backend, nonce: () => 'commit-write' }
		);

		const historyRaw = await readTextFile(
			transcriptionCheckpointFile('project-slug', 'pt-1', 'tx-cp-1'),
			{ backend }
		);
		const history = await readCanonicalDocument<TranscriptionCheckpointPayload>(
			TRANSCRIPTION_CHECKPOINT_FORMAT,
			historyRaw
		);
		const primaryRaw = await readTextFile(transcriptionPrimaryFile('project-slug', 'pt-1'), {
			backend,
		});
		const primary = await readCanonicalDocument<ProjectTranscriptionPayload>(
			PROJECT_TRANSCRIPTION_FORMAT,
			primaryRaw
		);
		const manifestRaw = await readTextFile(projectManifestFile('project-slug'), { backend });
		const manifest = await readCanonicalDocument<ProjectManifestPayload>(
			PROJECT_MANIFEST_FORMAT,
			manifestRaw
		);
		const tei = await readTextFile(transcriptionTeiFile('project-slug', 'pt-1'), { backend });
		const head = await harness.db
			.selectFrom('transcriptions')
			.select(['current_revision_id', 'current_content_hash'])
			.where('id', '=', 'tx-1')
			.executeTakeFirstOrThrow();

		expect(history).toMatchObject({
			ok: true,
			payload: {
				checkpoint_id: 'tx-cp-1',
				entity_id: 'pt-1',
				payload_transcription_id: 'tx-1',
				payload_content_hash: checkpoint.contentHash,
				commit_message: 'Initial commit',
			},
		});
		expect(primary).toMatchObject({
			ok: true,
			payload: {
				project_transcription_id: 'pt-1',
				id: 'tx-1',
				based_on_checkpoint: { id: 'tx-cp-1', content_hash: checkpoint.contentHash },
			},
		});
		expect(manifest).toMatchObject({
			ok: true,
			payload: {
				id: 'project-1',
				transcriptions: [
					{
						project_transcription_id: 'pt-1',
						current_revision: { id: 'tx-cp-1', content_hash: checkpoint.contentHash },
						primary_path: 'transcriptions/pt-1.json',
					},
				],
			},
		});
		expect(tei).toContain('<TEI');
		expect(head).toEqual({
			current_revision_id: 'tx-cp-1',
			current_content_hash: checkpoint.contentHash,
		});
	});

	it('allows manifest to advance while the transcription index remains old if index insertion fails', async () => {
		await createFixtureTranscription();
		await harness.db
			.insertInto('transcription_checkpoints')
			.values({
				id: 'tx-cp-index-fail',
				transcription_id: 'tx-1',
				parent_checkpoint_id: null,
				format: 'normalized_ast_v3',
				content_hash: 'preexisting-content-hash',
				is_committed: 1,
				label: '',
				commit_message: null,
				author_name: 'Seed',
				created_at: '2026-07-04T01:00:00.000Z',
			})
			.execute();

		await expect(
			createCommittedTranscriptionCheckpointWithFiles(
				harness.db,
				{
					projectTranscriptionId: 'pt-1',
					checkpointId: 'tx-cp-index-fail',
					createdAt: '2026-07-04T13:00:00.000Z',
				},
				{ backend, nonce: () => 'index-fail' }
			)
		).rejects.toThrow();

		await expect(
			readTextFile(transcriptionCheckpointFile('project-slug', 'pt-1', 'tx-cp-index-fail'), {
				backend,
			})
		).resolves.toContain('tx-cp-index-fail');
		await expect(
			readTextFile(transcriptionPrimaryFile('project-slug', 'pt-1'), { backend })
		).resolves.toContain('tx-cp-index-fail');
		await expect(
			readTextFile(projectManifestFile('project-slug'), { backend })
		).resolves.toContain('tx-cp-index-fail');
		await expect(
			harness.db
				.selectFrom('transcriptions')
				.select(['current_revision_id', 'current_content_hash'])
				.where('id', '=', 'tx-1')
				.executeTakeFirstOrThrow()
		).resolves.toEqual({ current_revision_id: '', current_content_hash: '' });
		await expect(
			harness.db
				.selectFrom('transcription_checkpoints')
				.select(['content_hash'])
				.where('id', '=', 'tx-cp-index-fail')
				.executeTakeFirstOrThrow()
		).resolves.toEqual({ content_hash: 'preexisting-content-hash' });
	});

	it('returns a warning without failing the commit when derived TEI writing fails', async () => {
		await createFixtureTranscription();
		backend.failWritePathIncludes = '.tei.xml.tmp-';
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		try {
			const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
				harness.db,
				{
					projectTranscriptionId: 'pt-1',
					checkpointId: 'tx-cp-tei-fail',
					createdAt: '2026-07-04T13:00:00.000Z',
				},
				{ backend, nonce: () => 'tei-fail' }
			);

			expect(checkpoint.id).toBe('tx-cp-tei-fail');
			expect(checkpoint.warnings).toEqual([
				expect.objectContaining({ code: 'tei_write_failed', entityType: 'transcription' }),
			]);
			await expect(
				readTextFile(transcriptionTeiFile('project-slug', 'pt-1'), { backend })
			).rejects.toThrow('not found');
			await expect(
				readTextFile(projectManifestFile('project-slug'), { backend })
			).resolves.toContain('tx-cp-tei-fail');
			await expect(
				harness.db
					.selectFrom('transcriptions')
					.select(['current_revision_id', 'current_content_hash'])
					.where('id', '=', 'tx-1')
					.executeTakeFirstOrThrow()
			).resolves.toEqual({
				current_revision_id: 'tx-cp-tei-fail',
				current_content_hash: checkpoint.contentHash,
			});
		} finally {
			warn.mockRestore();
		}
	});

	it('returns autosaved Current after reload with no working file on disk', async () => {
		await createFixtureTranscription();
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-1' },
			{ backend }
		);
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
			{ backend }
		);
		await harness.db
			.updateTable('transcriptions')
			.set({ content_json: JSON.stringify(documentWithVerses(['Romans 9:9'])) })
			.where('id', '=', 'tx-1')
			.execute();

		const loaded = await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', { backend });

		expect(loaded?.content_json).toContain('"verse":"2"');
		expect(loaded?.current_revision_id).toBe('tx-cp-1');
		expect([...backend.files.keys()].filter(path => path.endsWith('.working.json'))).toEqual(
			[]
		);
	});

	it('names a version without changing primary content and adds exactly one history file', async () => {
		await createFixtureTranscription();
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-1' },
			{ backend }
		);
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
			{ backend }
		);
		const before = await readPrimaryPayload();
		const historyBefore = historyFiles();

		const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-2' },
			{ backend }
		);

		const after = await readPrimaryPayload();
		expect(projectTranscriptionPayloadToSnapshot(after)).toEqual(
			projectTranscriptionPayloadToSnapshot(before)
		);
		expect(before.based_on_checkpoint?.id).toBe('tx-cp-1');
		expect(after.based_on_checkpoint).toEqual({
			id: 'tx-cp-2',
			content_hash: checkpoint.contentHash,
		});
		const added = historyFiles().filter(path => !historyBefore.includes(path));
		expect(added).toHaveLength(1);
		expect(added[0]).toMatch(/history\/transcriptions\/pt-1\/tx-cp-2\.json$/);
	});

	it('labels versions by count and edits a note without changing the content hash', async () => {
		await createFixtureTranscription();
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-1' },
			{ backend }
		);
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-2', commitMessage: 'First' },
			{ backend }
		);
		const path = transcriptionCheckpointFile('project-slug', 'pt-1', 'tx-cp-2');
		const before = await readCheckpoint(path);

		await updateTranscriptionVersionNote(harness.db, 'tx-1', 'tx-cp-2', 'Edited', { backend });

		const after = await readCheckpoint(path);
		expect(after.commit_message).toBe('Edited');
		expect(after.label).toBe('Version 2');
		expect(after.payload_content_hash).toBe(before.payload_content_hash);
		expect(after.payload).toEqual(before.payload);
		expect(
			(await listTranscriptionVersions(harness.db, 'tx-1')).map(version => [
				version.label,
				version.note,
				version.contentHash,
			])
		).toEqual([
			['Version 2', 'Edited', before.payload_content_hash],
			['Version 1', null, expect.any(String)],
		]);
	});

	it('restores a version into Current and undoes it without touching history', async () => {
		await createFixtureTranscription();
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-1' },
			{ backend }
		);
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
			{ backend }
		);
		const history = new Map(
			historyFiles().map(path => [path, backend.files.get(path)] as const)
		);

		const previous = await restoreTranscriptionVersion(harness.db, 'tx-1', 'tx-cp-1', {
			backend,
		});

		const restored = await readPrimaryPayload();
		expect(JSON.stringify(restored.content_json)).toContain('"verse":"1"');
		expect(restored.based_on_checkpoint?.id).toBe('tx-cp-1');
		expect((await getTranscription(harness.db, 'tx-1'))?.content_json).toContain('"verse":"1"');
		expect(
			(await listVerseIndexRowsForTranscription(harness.db, 'tx-1')).map(
				row => row.verse_identifier
			)
		).toEqual(['Romans 1:1']);

		await replaceTranscriptionCurrent(harness.db, 'tx-1', previous, { backend });

		const undone = await readPrimaryPayload();
		expect(undone).toEqual(previous);
		expect((await getTranscription(harness.db, 'tx-1'))?.content_json).toContain('"verse":"2"');
		expect(
			new Map(historyFiles().map(path => [path, backend.files.get(path)] as const))
		).toEqual(history);
	});

	it('numbers unlabelled legacy versions by date when indexing', async () => {
		await createFixtureTranscription();
		for (const checkpointId of ['tx-cp-a', 'tx-cp-b', 'tx-cp-c']) {
			await createCommittedTranscriptionCheckpointWithFiles(
				harness.db,
				{ projectTranscriptionId: 'pt-1', checkpointId },
				{ backend }
			);
		}
		const createdAt = {
			'tx-cp-a': '2026-07-03T00:00:00.000Z',
			'tx-cp-b': '2026-07-01T00:00:00.000Z',
			'tx-cp-c': '2026-07-02T00:00:00.000Z',
		};
		for (const [checkpointId, date] of Object.entries(createdAt)) {
			const path = transcriptionCheckpointFile('project-slug', 'pt-1', checkpointId);
			const {
				label: _label,
				metadata_updated_at: _updatedAt,
				...legacy
			} = await readCheckpoint(path);
			backend.files.set(
				[...backend.files.keys()].find(key => key.endsWith(path)) ?? path,
				serializeSealedDocument(
					await sealDocument(TRANSCRIPTION_CHECKPOINT_FORMAT, 1, {
						...legacy,
						parent_checkpoint_id: null,
						created_at: date,
					})
				)
			);
		}

		await rebuildIndexFromStore(harness.db, { backend });

		const labels = Object.fromEntries(
			(await listTranscriptionVersions(harness.db, 'tx-1')).map(version => [
				version.id,
				version.label,
			])
		);
		expect(labels).toEqual({
			'tx-cp-b': 'Version 1',
			'tx-cp-c': 'Version 2',
			'tx-cp-a': 'Version 3',
		});
	});

	it('migrates a legacy primary and working file into one Current primary on load', async () => {
		await createFixtureTranscription();
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-1' },
			{ backend }
		);
		const committed = await readPrimaryPayload();
		const { based_on_checkpoint: basedOn, draft: _draft, ...content } = committed;
		if (!basedOn) throw new Error('Expected a committed primary.');
		await writeTextFileAtomic(
			transcriptionPrimaryFile('project-slug', 'pt-1'),
			serializeSealedDocument(
				await sealDocument(PROJECT_TRANSCRIPTION_FORMAT, 1, {
					...content,
					current_revision: {
						...basedOn,
						created_at: '2026-07-04T13:00:00.000Z',
						author_name: 'Editor',
					},
				})
			),
			{ backend }
		);
		await writeTextFileAtomic(
			transcriptionWorkingFile('project-slug', 'pt-1'),
			serializeSealedDocument(
				await sealDocument(WORKING_TRANSCRIPTION_FORMAT, 1, {
					...content,
					title: 'Draft title',
					content_json: documentWithVerses(['Romans 1:5']) as unknown as JsonValue,
					draft: {
						base_revision_id: basedOn.id,
						base_content_hash: basedOn.content_hash,
						saved_at: '2026-07-04T14:00:00.000Z',
						author_name: null,
					},
				} satisfies WorkingTranscriptionPayload)
			),
			{ backend }
		);

		const loaded = await loadTranscriptionWithWorkingFile(harness.db, 'tx-1', { backend });

		expect(loaded).toMatchObject({ title: 'Draft title', current_revision_id: 'tx-cp-1' });
		expect(loaded?.content_json).toContain('"verse":"5"');
		await expect(
			readTextFile(transcriptionWorkingFile('project-slug', 'pt-1'), { backend })
		).rejects.toThrow('not found');
		const migratedRaw = await readTextFile(transcriptionPrimaryFile('project-slug', 'pt-1'), {
			backend,
		});
		expect(JSON.parse(migratedRaw)).toMatchObject({
			schema_version: PROJECT_TRANSCRIPTION_CURRENT_VERSION,
		});
		expect(await readPrimaryPayload()).toMatchObject({
			title: 'Draft title',
			based_on_checkpoint: basedOn,
			draft: { saved_at: '2026-07-04T14:00:00.000Z' },
		});
	});

	it('runs committed transcription file writes under the project write lock', async () => {
		await createFixtureTranscription();
		const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) =>
			callback()
		);
		vi.stubGlobal('navigator', { locks: { request } });

		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId: 'pt-1',
				checkpointId: 'tx-cp-locked',
				createdAt: '2026-07-04T13:00:00.000Z',
			},
			{ backend, nonce: () => 'locked-write' }
		);

		expect(request).toHaveBeenCalledWith(
			projectWriteLockName('project-1'),
			expect.any(Function)
		);
	});
});

async function readPrimaryPayload(): Promise<ProjectTranscriptionPayload> {
	const read = await readCanonicalDocument<ProjectTranscriptionPayload>(
		PROJECT_TRANSCRIPTION_FORMAT,
		await readTextFile(transcriptionPrimaryFile('project-slug', 'pt-1'), { backend })
	);
	if (!read.ok) throw new Error('Expected a readable transcription primary.');
	return read.payload;
}

async function legacyWorkingFileFromPrimary(
	basedOn: ProjectTranscriptionPayload['based_on_checkpoint']
): Promise<string> {
	const { based_on_checkpoint: _basedOn, draft, ...content } = await readPrimaryPayload();
	return serializeSealedDocument(
		await sealDocument(WORKING_TRANSCRIPTION_FORMAT, 1, {
			...content,
			draft: {
				base_revision_id: basedOn?.id ?? null,
				base_content_hash: basedOn?.content_hash ?? null,
				saved_at: draft.saved_at,
				author_name: null,
			},
		} satisfies WorkingTranscriptionPayload)
	);
}

async function readCheckpoint(path: string): Promise<TranscriptionCheckpointPayload> {
	const read = await readCanonicalDocument<TranscriptionCheckpointPayload>(
		TRANSCRIPTION_CHECKPOINT_FORMAT,
		await readTextFile(path, { backend })
	);
	if (!read.ok) throw new Error(`Expected a readable version at ${path}.`);
	return read.payload;
}

function historyFiles(): string[] {
	return [...backend.files.keys()].filter(path => path.includes('/history/')).sort();
}

async function createFixtureTranscription(): Promise<void> {
	await createProject(harness.db, {
		id: 'project-1',
		storageSlug: 'project-slug',
		name: 'Project',
		createdAt: '2026-07-04T00:00:00.000Z',
		updatedAt: '2026-07-04T00:00:00.000Z',
	});
	await createTranscription(harness.db, {
		id: 'tx-1',
		projectId: 'project-1',
		projectTranscriptionId: 'pt-1',
		title: 'Witness 1',
		siglum: '01',
		document: documentWithVerses(['Romans 1:1']),
		createdAt: '2026-07-04T00:00:00.000Z',
		updatedAt: '2026-07-04T00:00:00.000Z',
		transcriber: 'Editor',
		repository: 'Library',
		settlement: 'City',
		language: 'grc',
	});
}

function documentWithVerses(verses: string[]): StoredTranscriptionDocument {
	return {
		type: 'transcriptionDocument' as const,
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
								items: verses.map(identifier => {
									const [book, chapterVerse] = identifier.split(' ');
									const [chapter, verse] = chapterVerse.split(':');
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

class MemoryStoreBackend implements StoreBackend {
	readonly files = new Map<string, string>();
	readonly directories = new Set<string>(['']);
	failWrites = false;
	failWritePathIncludes: string | null = null;

	async readTextFile(path: string): Promise<string> {
		const normalized = normalizeStorePath(path);
		const content = this.files.get(normalized);
		if (content === undefined) throw new Error(`File ${path} was not found.`);
		return content;
	}

	async writeTextFile(path: string, content: string): Promise<void> {
		const normalized = normalizeStorePath(path);
		if (
			this.failWrites ||
			(this.failWritePathIncludes && normalized.includes(this.failWritePathIncludes))
		) {
			throw new Error(`simulated write failure for ${path}`);
		}
		this.addDirectory(storePathDirname(normalized));
		this.files.set(normalized, content);
	}

	async deleteFile(path: string): Promise<void> {
		const normalized = normalizeStorePath(path);
		if (!this.files.delete(normalized)) throw new Error(`File ${path} was not found.`);
	}

	async listDirectory(path: string): Promise<StoreBackendDirectoryEntry[]> {
		const normalized = normalizeStorePath(path);
		if (!this.directories.has(normalized)) throw new Error(`Directory ${path} was not found.`);
		const entries = new Map<string, StoreBackendDirectoryEntry>();
		for (const directory of this.directories) {
			if (!directory || directory === normalized) continue;
			if (storePathDirname(directory) === normalized) {
				entries.set(storePathBasename(directory), {
					name: storePathBasename(directory),
					kind: 'directory',
				});
			}
		}
		for (const file of this.files.keys()) {
			if (storePathDirname(file) === normalized) {
				entries.set(storePathBasename(file), {
					name: storePathBasename(file),
					kind: 'file',
				});
			}
		}
		return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
	}

	async ensureDirectory(path: string): Promise<void> {
		this.addDirectory(path);
	}

	async moveFile(fromPath: string, toPath: string): Promise<void> {
		const normalizedFrom = normalizeStorePath(fromPath);
		const normalizedTo = normalizeStorePath(toPath);
		const content = this.files.get(normalizedFrom);
		if (content === undefined) throw new StoreMoveUnavailableError();
		this.addDirectory(storePathDirname(normalizedTo));
		this.files.delete(normalizedFrom);
		this.files.set(normalizedTo, content);
	}

	private addDirectory(path: string): void {
		const normalized = normalizeStorePath(path);
		let current = '';
		this.directories.add(current);
		for (const segment of normalized ? normalized.split('/') : []) {
			current = joinStorePath(current, segment);
			this.directories.add(current);
		}
	}
}
