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
	getCurrentVerseSources,
	getTranscription,
	listVerseIndexRowsForTranscription,
} from './transcriptions';
import {
	createCommittedTranscriptionCheckpointWithFiles,
	loadTranscriptionContentWithFiles,
	loadTranscriptionWithWorkingFile,
	reimportTranscriptionContent,
	replaceTranscriptionCurrent,
	restoreTranscriptionVersion,
	saveWorkingTranscriptionContent,
	saveWorkingTranscriptionMetadata,
	updateTranscriptionVersionNote,
	writeWorkingTranscriptionSnapshot,
} from './transcription-files';
import { verseMilestones } from './verse-milestones.spec-support';
import { ensureManifestSourceWithFiles } from './iiif-files';
import {
	getProjectTranscriptionCheckpointStatus,
	listTranscriptionVersions,
	loadCommittedTranscriptionCheckpointPayload,
	loadTranscriptionContentHash,
	loadTranscriptionSourceState,
} from './revisions';
import type { StoredTranscriptionDocument } from '$lib/transcription/content';
import {
	PROJECT_MANIFEST_FORMAT,
	parseTranscriptionTei,
	parseTranscriptionTeiVersion,
	readCanonicalDocument,
	type ProjectManifestPayload,
	type ProjectTranscriptionPayload,
} from '$lib/storage/formats';
import { teiContentHash } from '$lib/storage/tei-content';
import {
	joinStorePath,
	normalizeStorePath,
	projectManifestFile,
	storePathBasename,
	storePathDirname,
	transcriptionCheckpointTeiFile,
	transcriptionTeiFile,
} from '$lib/storage/layout';
import {
	readTextFile,
	StoreMoveUnavailableError,
	type StoreBackend,
	type StoreBackendDirectoryEntry,
} from '$lib/storage/opfs-store';
import { registerUserReferenceEdition } from '$lib/reference-editions/user-reference-editions';

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

		expect(await readPrimaryPayload()).toMatchObject({
			title: 'Edited title',
			siglum: '02',
			description: 'Edited description',
			tags: ['edited'],
			transcriber: 'New editor',
			repository: 'New library',
			settlement: 'New city',
			language: 'lat',
			updated_at: '2026-07-04T12:00:00.000Z',
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

		const primary = await readPrimaryPayload();
		const row = await getTranscription(harness.db, 'tx-1');

		expect(primary).toMatchObject({
			project_transcription_id: 'pt-1',
			id: 'tx-1',
			content_format: 'normalized_ast_v3',
			updated_at: '2026-07-04T12:00:00.000Z',
			based_on_checkpoint: null,
			draft: { saved_at: '2026-07-04T12:00:00.000Z', author_name: null },
		});
		expect(JSON.stringify(primary.content_json)).toContain('"verse":"2"');
		expect(row?.content_json).toContain('"verse":"2"');
		expect(row?.updated_at).toBe('2026-07-04T12:00:00.000Z');
	});

	it('gathers verse sources from index slices once per id', async () => {
		await createFixtureTranscription();
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-1', document: documentWithVerses(['Romans 1:1', 'Romans 1:2']) },
			{ backend }
		);

		const sources = await getCurrentVerseSources(harness.db, 'Romans 1:2', [
			'tx-1',
			'tx-1',
			'missing',
		]);

		expect(sources).toHaveLength(1);
		expect(sources[0]).toMatchObject({ transcriptionId: 'tx-1', siglum: '01' });
		expect(sources[0].document.type).toBe('transcriptionDocument');
		expect(JSON.stringify(sources[0].document.pages)).toContain('"verse":"2"');
	});

	it('hashes current verse sources as the source-currency check does', async () => {
		await createFixtureTranscription();
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-1' },
			{ backend, nonce: () => 'primary-write' }
		);
		await ensureManifestSourceWithFiles(
			harness.db,
			{ transcriptionId: 'tx-1', manifestUrl: 'https://example.test/manifest', label: 'MS' },
			{ backend }
		);
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-1', document: documentWithVerses(['Romans 1:2']) },
			{ backend }
		);

		const [loaded] = await getCurrentVerseSources(harness.db, 'Romans 1:2', ['tx-1']);

		expect(loaded.contentHash).toMatch(/^sha256:/);
		expect(loaded.contentHash).toBe(
			(await loadTranscriptionSourceState(harness.db, 'pt-1')).currentContentHash
		);
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
			transcriptionCheckpointTeiFile('project-slug', 'pt-created', head.current_revision_id),
			{ backend }
		);
		const primaryRaw = await readTextFile(transcriptionTeiFile('project-slug', 'pt-created'), {
			backend,
		});
		const manifestRaw = await readTextFile(projectManifestFile('project-slug'), { backend });
		const manifest = await readCanonicalDocument<ProjectManifestPayload>(
			PROJECT_MANIFEST_FORMAT,
			manifestRaw
		);

		expect(id).toBe('tx-created');
		expect(head.current_revision_id).toBeTruthy();
		expect(parseTranscriptionTeiVersion(historyRaw)).toMatchObject({
			projectTranscriptionId: 'pt-created',
			version: { id: head.current_revision_id },
		});
		expect(await teiContentHash(historyRaw)).toBe(head.current_content_hash);
		expect(parseTranscriptionTei(primaryRaw)).toMatchObject({
			project_transcription_id: 'pt-created',
			id: 'tx-created',
			based_on_checkpoint: {
				id: head.current_revision_id,
				content_hash: head.current_content_hash,
			},
		});
		expect(JSON.parse(manifestRaw).schema_version).toBe(7);
		expect(manifest).toMatchObject({
			ok: true,
			payload: {
				transcriptions: [
					{
						project_transcription_id: 'pt-created',
						primary_path: 'transcriptions/pt-created.tei.xml',
						current_revision: {
							id: head.current_revision_id,
							content_hash: head.current_content_hash,
						},
					},
				],
			},
		});
		expect([...backend.files.keys()].filter(path => /pt-created.*\.json$/.test(path))).toEqual(
			[]
		);
	});

	it.each([
		['history', 'history/transcriptions/pt-created/'],
		['primary', 'transcriptions/pt-created.tei.xml.tmp-'],
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

	it('cites a used reference edition by id without consulting the device catalog', async () => {
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

		const tei = await readTextFile(transcriptionTeiFile('project-slug', 'pt-created'), {
			backend,
		});
		expect(tei).toContain(`<bibl type="referenceEdition" xml:id="${edition.id}"/>`);
		expect(tei).not.toContain('Legacy local attribution');
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
		const primaryPath = transcriptionTeiFile('project-slug', 'pt-1');
		const beforeHash = await teiContentHash(await readTextFile(primaryPath, { backend }));
		const before = await readPrimaryPayload();
		const historyBefore = historyFiles();

		const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-2' },
			{ backend }
		);

		const after = await readPrimaryPayload();
		expect(await teiContentHash(await readTextFile(primaryPath, { backend }))).toBe(beforeHash);
		expect(before.based_on_checkpoint?.id).toBe('tx-cp-1');
		expect(after.based_on_checkpoint).toEqual({
			id: 'tx-cp-2',
			content_hash: checkpoint.contentHash,
		});
		const added = historyFiles().filter(path => !historyBefore.includes(path));
		expect(added).toHaveLength(1);
		expect(added[0]).toMatch(/history\/transcriptions\/pt-1\/tx-cp-2\.tei\.xml$/);
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

	it('re-imports content as a version after versioning unsaved edits', async () => {
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

		await reimportTranscriptionContent(
			harness.db,
			'tx-1',
			JSON.stringify(documentWithVerses(['Romans 1:3'])),
			{ backend }
		);

		expect(JSON.stringify((await readPrimaryPayload()).content_json)).toContain('"verse":"3"');
		expect(
			(await listVerseIndexRowsForTranscription(harness.db, 'tx-1')).map(
				row => row.verse_identifier
			)
		).toEqual(['Romans 1:3']);
		expect(
			(await listTranscriptionVersions(harness.db, 'tx-1')).map(version => [
				version.label,
				version.note,
			])
		).toEqual([
			['Version 3', 'TEI re-import'],
			['Version 2', 'Before TEI re-import'],
			['Version 1', null],
		]);
	});

	it('keeps page ids and adds no version when re-imported content is unchanged', async () => {
		await createFixtureTranscription();
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'pt-1', checkpointId: 'tx-cp-1' },
			{ backend }
		);

		await reimportTranscriptionContent(
			harness.db,
			'tx-1',
			JSON.stringify(documentWithVerses(['Romans 1:1'])),
			{ backend }
		);

		expect(await listTranscriptionVersions(harness.db, 'tx-1')).toHaveLength(1);
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

describe('TEI-canonical transcriptions', () => {
	it('saves, commits and restores a new transcription through TEI files only', async () => {
		const firstVersionId = await createTeiFixtureTranscription();
		await saveWorkingTranscriptionContent(
			harness.db,
			{
				id: 'tx-tei',
				document: documentWithVerses(['Romans 1:1', 'Romans 1:2']),
				updatedAt: '2026-07-05T00:00:00.000Z',
			},
			{ backend }
		);
		await saveWorkingTranscriptionMetadata(
			harness.db,
			{
				id: 'tx-tei',
				title: 'Edited TEI witness',
				siglum: 'T',
				description: 'Edited',
				tags: ['tei'],
				transcriber: 'Editor',
				repository: '',
				settlement: '',
				language: 'grc',
				updatedAt: '2026-07-05T01:00:00.000Z',
			},
			{ backend }
		);
		expect(await commitState('pt-tei')).toBe('dirty');
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId: 'pt-tei',
				checkpointId: 'tei-cp-2',
				commitMessage: 'Second',
				authorName: 'Editor',
				createdAt: '2026-07-05T02:00:00.000Z',
			},
			{ backend }
		);

		const primaryRaw = await readTextFile(transcriptionTeiFile('project-slug', 'pt-tei'), {
			backend,
		});
		expect(parseTranscriptionTei(primaryRaw)).toMatchObject({
			title: 'Edited TEI witness',
			tags: ['tei'],
			based_on_checkpoint: { id: 'tei-cp-2' },
		});
		expect(
			parseTranscriptionTeiVersion(
				await readTextFile(
					transcriptionCheckpointTeiFile('project-slug', 'pt-tei', 'tei-cp-2'),
					{
						backend,
					}
				)
			).version
		).toEqual({
			id: 'tei-cp-2',
			label: 'Version 2',
			note: 'Second',
			author_name: 'Editor',
			created_at: '2026-07-05T02:00:00.000Z',
			parent_id: firstVersionId,
		});
		expect(teiFixtureFiles().filter(path => path.endsWith('.json'))).toEqual([]);
		expect(teiFixtureFiles().filter(path => path.endsWith('.tei.xml'))).toEqual(
			[
				`history/transcriptions/pt-tei/${firstVersionId}.tei.xml`,
				'history/transcriptions/pt-tei/tei-cp-2.tei.xml',
				'transcriptions/pt-tei.tei.xml',
			].sort()
		);
		const fingerprints = await harness.db
			.selectFrom('document_file_fingerprints')
			.selectAll()
			.orderBy('path')
			.execute();
		expect(fingerprints.map(row => [row.path, row.entity_type, row.entity_id]).sort()).toEqual(
			[
				[
					`history/transcriptions/pt-tei/${firstVersionId}.tei.xml`,
					'version',
					firstVersionId,
				],
				['history/transcriptions/pt-tei/tei-cp-2.tei.xml', 'version', 'tei-cp-2'],
				['transcriptions/pt-tei.tei.xml', 'transcription', 'pt-tei'],
			].sort()
		);
		const primary = fingerprints.find(row => row.entity_type === 'transcription')!;
		expect(primary).toMatchObject({
			size: new TextEncoder().encode(primaryRaw).byteLength,
			content_hash: await teiContentHash(primaryRaw),
		});
		expect(await loadTranscriptionContentHash(harness.db, 'pt-tei')).toBe(primary.content_hash);
		expect(await commitState('pt-tei')).toBe('clean');
		const manifestRaw = await readTextFile(projectManifestFile('project-slug'), { backend });
		expect(JSON.parse(manifestRaw)).toMatchObject({
			schema_version: 7,
			transcriptions: [
				{
					primary_path: 'transcriptions/pt-tei.tei.xml',
					current_revision: { id: 'tei-cp-2', content_hash: primary.content_hash },
				},
			],
		});

		await restoreTranscriptionVersion(harness.db, 'tx-tei', firstVersionId, { backend });
		const restored = await loadTranscriptionWithWorkingFile(harness.db, 'tx-tei', { backend });
		expect(restored).toMatchObject({
			title: 'TEI witness',
			current_revision_id: firstVersionId,
		});
		expect(restored?.content_json).not.toContain('"verse":"2"');
		expect(await commitState('pt-tei')).toBe('clean');
	});

	it('stays clean when a save changes only the save time', async () => {
		await createTeiFixtureTranscription();
		const before = await primaryFingerprint();
		const content = await loadTranscriptionContentWithFiles(harness.db, 'tx-tei', { backend });

		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-tei', contentJson: content ?? '', updatedAt: '2026-07-09T00:00:00.000Z' },
			{ backend }
		);

		const after = await primaryFingerprint();
		expect(after.file_hash).not.toBe(before.file_hash);
		expect(after.content_hash).toBe(before.content_hash);
		expect(await commitState('pt-tei')).toBe('clean');
	});

	it('rewrites only the Version note, keeping its content hash and integrity', async () => {
		const versionId = await createTeiFixtureTranscription();
		const path = transcriptionCheckpointTeiFile('project-slug', 'pt-tei', versionId);
		const before = await readTextFile(path, { backend });
		const fingerprintBefore = await versionFingerprint(versionId);

		await updateTranscriptionVersionNote(harness.db, 'tx-tei', versionId, 'Revised note', {
			backend,
		});

		const after = await readTextFile(path, { backend });
		const fingerprintAfter = await versionFingerprint(versionId);
		expect(after).not.toBe(before);
		expect(after).toContain('<note>Revised note</note>');
		expect(after.replace(/<revisionDesc>[\s\S]*<\/revisionDesc>/, '')).toBe(
			before.replace(/<revisionDesc>[\s\S]*<\/revisionDesc>/, '')
		);
		expect(fingerprintAfter.file_hash).not.toBe(fingerprintBefore.file_hash);
		expect(fingerprintAfter.content_hash).toBe(fingerprintBefore.content_hash);
		expect(await teiContentHash(after)).toBe(fingerprintBefore.content_hash);
		await expect(
			loadCommittedTranscriptionCheckpointPayload(harness.db, 'tx-tei', versionId, {
				backend,
			})
		).resolves.toMatchObject({
			commitMessage: 'Revised note',
			contentHash: fingerprintBefore.content_hash,
		});
		expect(await listTranscriptionVersions(harness.db, 'tx-tei')).toMatchObject([
			{ id: versionId, note: 'Revised note' },
		]);
		expect(await commitState('pt-tei')).toBe('clean');
	});

	it('keeps outside formatting when rewriting a Version note', async () => {
		const versionId = await createTeiFixtureTranscription();
		const key = [...backend.files.keys()].find(path => path.endsWith(`${versionId}.tei.xml`))!;
		const edited = backend.files
			.get(key)!
			.replace('<text', '<!-- proofread -->\n<text')
			.replace('<body>', '<body>\n\n');
		backend.files.set(key, edited);

		await updateTranscriptionVersionNote(harness.db, 'tx-tei', versionId, 'Revised note', {
			backend,
		});

		const after = backend.files.get(key)!;
		expect(after).toContain('<!-- proofread -->\n<text');
		expect(after).toContain('<body>\n\n');
		expect(after).toContain('<note>Revised note</note>');
		expect(await teiContentHash(after)).toBe(await teiContentHash(edited));
		expect((await versionFingerprint(versionId)).content_hash).toBe(
			await teiContentHash(edited)
		);
	});
});

async function createTeiFixtureTranscription({ createProject: withProject = true } = {}) {
	if (withProject)
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
			id: 'tx-tei',
			projectId: 'project-1',
			projectTranscriptionId: 'pt-tei',
			title: 'TEI witness',
			siglum: 'T',
			document: documentWithVerses(['Romans 1:1']),
			createdAt: '2026-07-04T00:00:00.000Z',
			updatedAt: '2026-07-04T00:00:00.000Z',
			transcriber: 'Editor',
			repository: '',
			settlement: '',
			language: 'grc',
		},
		{ backend }
	);
	return (
		await harness.db
			.selectFrom('transcriptions')
			.select('current_revision_id')
			.where('id', '=', 'tx-tei')
			.executeTakeFirstOrThrow()
	).current_revision_id;
}

async function commitState(projectTranscriptionId: string) {
	return (await getProjectTranscriptionCheckpointStatus(harness.db, projectTranscriptionId))
		.commitState;
}

function teiFixtureFiles(): string[] {
	const prefix = 'apatosaurus/v1/projects/project-slug/';
	return [...backend.files.keys()]
		.filter(path => path.includes('pt-tei'))
		.map(path => path.slice(prefix.length))
		.sort();
}

async function primaryFingerprint() {
	return harness.db
		.selectFrom('document_file_fingerprints')
		.selectAll()
		.where('path', '=', 'transcriptions/pt-tei.tei.xml')
		.executeTakeFirstOrThrow();
}

async function versionFingerprint(versionId: string) {
	return harness.db
		.selectFrom('document_file_fingerprints')
		.selectAll()
		.where('entity_type', '=', 'version')
		.where('entity_id', '=', versionId)
		.executeTakeFirstOrThrow();
}

async function readPrimaryPayload(): Promise<ProjectTranscriptionPayload> {
	return parseTranscriptionTei(
		await readTextFile(transcriptionTeiFile('project-slug', 'pt-1'), { backend })
	);
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
	await writeWorkingTranscriptionSnapshot(harness.db, 'tx-1', '2026-07-04T00:00:00.000Z', {
		backend,
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
								items: verseMilestones(verses),
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

	async readFileBytes(path: string): Promise<Uint8Array> {
		return new TextEncoder().encode(await this.readTextFile(path));
	}

	async writeFileBytes(path: string, bytes: Uint8Array): Promise<void> {
		await this.writeTextFile(path, new TextDecoder().decode(bytes));
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
