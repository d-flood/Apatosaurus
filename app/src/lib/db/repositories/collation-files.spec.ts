import {
	createCollationWithFiles,
	createTranscriptionWithFiles,
	createLocalDbTestHarness,
	type LocalDbTestHarness,
} from '$lib/testing/local-db-harness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	PROJECT_MANIFEST_FORMAT,
	parseCollationPayloadTei,
	parseCollationTeiVersion,
	readCanonicalDocument,
	type CollationPayload,
	type ProjectManifestPayload,
} from '$lib/storage/formats';
import { parseCollationTei } from '$lib/collation/collation-document-tei';
import {
	collationTeiFile,
	joinStorePath,
	normalizeStorePath,
	projectFolder,
	projectManifestFile,
	storePathBasename,
	storePathDirname,
} from '$lib/storage/layout';
import {
	readTextFile,
	StoreMoveUnavailableError,
	type StoreBackend,
	type StoreBackendDirectoryEntry,
} from '$lib/storage/opfs-store';
import { createProject as createProjectRepository } from './projects';
import { projectWriteLockName } from './project-locks';
import { createCollation, saveCollationProjection } from './collations';
import { createCommittedCollationCheckpoint } from './revisions';
import { parseCollationDocument } from '$lib/collation/collation-document';
import { MockCloudStorageProvider } from '$lib/backup/providers/mock-provider';
import { backupProject } from '$lib/backup/sync-manager';
import { exportProjectZip } from '$lib/backup/project-zip-export';
import { importProjectZip } from '$lib/backup/project-zip-import';
import { writeProjectManifestFile } from './project-files';
import { MemoryStoreBackend as ImportStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import {
	createCommittedCollationCheckpointWithFiles,
	getCollationVersionStatusWithWorkingFile,
	loadCollationVersionDocument,
	loadCollationWithWorkingFile,
	restoreCollationVersion,
	saveWorkingCollationArtifact,
	saveWorkingCollationMetadata,
	updateCollationVersionNote,
} from './collation-files';
import { saveWorkingTranscriptionContent } from './transcription-files';
import { loadTranscriptionContentHash } from './revisions';
import { loadCollationSnapshots } from './cbgm-analyses';
import { hashContent } from '$lib/storage/content-hash';
import { teiContentText } from '$lib/storage/tei-content';

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

describe('collation file persistence', () => {
	it('writes the Current collation file before updating artifact storage', async () => {
		await createFixtureCollation();
		backend.failWrites = true;

		await expect(
			saveWorkingCollationArtifact(
				harness.db,
				{
					collationId: 'col-1',
					artifactType: 'collation_document_v1',
					payload: JSON.stringify(collationDocument('alignment')),
					now: '2026-07-04T12:00:00.000Z',
				},
				{ backend, nonce: () => 'failed-write' }
			)
		).rejects.toThrow('simulated write failure');

		await expect(
			harness.db.selectFrom('collation_artifacts').selectAll().execute()
		).resolves.toEqual([]);
		await expect(
			harness.db
				.selectFrom('collations')
				.select('updated_at')
				.where('id', '=', 'col-1')
				.executeTakeFirst()
		).resolves.toEqual({ updated_at: '2026-07-04T00:00:00.000Z' });
	});

	it('synchronizes renamed display metadata in the DB and Current without touching project.json', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Project',
			createdAt: '2026-07-04T00:00:00.000Z',
			updatedAt: '2026-07-04T00:00:00.000Z',
		});
		await createCollationWithFiles(
			harness.db,
			{
				id: 'col-1',
				projectId: 'project-1',
				title: 'Romans 1:1',
				verseIdentifier: 'Romans 1:1',
				segment: { id: 'segment-1', name: 'Romans 1:1', members: ['Romans 1:1'] },
				now: '2026-07-04T00:00:00.000Z',
			},
			{ backend, nonce: () => 'create-renamed-collation' }
		);

		const manifestBefore = await readTextFile(projectManifestFile('project-slug'), { backend });

		await saveWorkingCollationMetadata(
			harness.db,
			{
				id: 'col-1',
				verseIdentifier: 'Romans 1:1 (critical text)',
				updatedAt: '2026-07-04T13:00:00.000Z',
			},
			{ backend, nonce: () => 'renamed-working-write' }
		);

		await expect(
			harness.db
				.selectFrom('collations')
				.select('verse_identifier')
				.where('id', '=', 'col-1')
				.executeTakeFirst()
		).resolves.toEqual({ verse_identifier: 'Romans 1:1 (critical text)' });
		expect(await readPrimaryPayload()).toMatchObject({
			verse_identifier: 'Romans 1:1 (critical text)',
		});
		await expect(readTextFile(projectManifestFile('project-slug'), { backend })).resolves.toBe(
			manifestBefore
		);
	});

	it('loads a working file when the index artifact cache is empty', async () => {
		await createFixtureCollation();
		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(collationDocument('readings')),
				now: '2026-07-04T12:00:00.000Z',
			},
			{ backend, nonce: () => 'working-write' }
		);

		const loaded = await loadCollationWithWorkingFile(harness.db, 'col-1', { backend });

		expect(loaded?.artifact).toMatchObject({
			artifactType: 'collation_document_v1',
		});
		expect(loaded?.artifact?.payload).toContain('"projectName":"Project (readings)"');
		expect(loaded?.row.status).toBe('draft');
		expect(loaded?.row.updatedAt).toBe('2026-07-04T12:00:00.000Z');
	});

	it('uses the working file to compute dirty status', async () => {
		await createFixtureCollation();
		const checkpoint = await createCommittedCollationCheckpoint(harness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-1',
			createdAt: '2026-07-04T01:00:00.000Z',
		});
		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(collationDocument('setup')),
				now: '2026-07-04T12:00:00.000Z',
			},
			{ backend, nonce: () => 'working-write' }
		);

		const status = await getCollationVersionStatusWithWorkingFile(
			harness.db,
			'col-1',
			{},
			{ backend }
		);

		expect(status.currentCheckpoint).toEqual({
			revisionId: 'col-cp-1',
			contentHash: checkpoint.contentHash,
		});
		expect(status.workingContentHash).not.toBe(checkpoint.contentHash);
		expect(status.dirtyToCheckpoint).toBe(true);
		expect(status.commitState).toBe('dirty');
	});

	it('reports metadata, witnesses, and cloud state with the canonical file status', async () => {
		await createFixtureCollation();
		const saveDocument = (phase: string) =>
			saveWorkingCollationArtifact(
				harness.db,
				{
					collationId: 'col-1',
					artifactType: 'collation_document_v1',
					payload: JSON.stringify(collationDocument(phase)),
				},
				{ backend }
			);
		await saveDocument('readings');
		const checkpoint = await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{ collationId: 'col-1', checkpointId: 'col-cp-1' },
			{ backend }
		);
		await saveCollationProjection(harness.db, {
			collationId: 'col-1',
			witnesses: [{ witnessId: 'legacy', transcriptionId: null, content: '', position: 0 }],
			tokens: [],
			variationUnits: [],
		});
		const syncContext = {
			connectionId: 'conn-1',
			projectId: 'project-1',
			cloudFolderId: 'folder-1',
		};
		await harness.db
			.insertInto('sync_file_fingerprints')
			.values({
				target_id: syncContext.connectionId,
				project_id: syncContext.projectId,
				file_path: 'collations/col-1.tei.xml',
				local_content_hash: '',
				local_size: 0,
				local_modified_at: '',
				remote_file_id: 'file-col-1',
				remote_revision: 'rev-1',
				remote_content_hash: '',
				remote_size: 0,
				remote_modified_at: '',
				synced_at: '2026-07-04T13:00:00.000Z',
				entity_type: 'collation',
				entity_id: 'col-1',
				revision_id: checkpoint.id,
				entity_content_hash: checkpoint.contentHash,
			})
			.execute();
		const status = () =>
			getCollationVersionStatusWithWorkingFile(
				harness.db,
				'col-1',
				{ syncContext },
				{ backend }
			);

		await expect(status()).resolves.toMatchObject({
			projectId: 'project-1',
			projectName: 'Project',
			collationId: 'col-1',
			title: 'Romans 1:1',
			verseIdentifier: 'Rom 1:1',
			commitState: 'clean',
			witnesses: [{ witnessId: 'legacy', position: 0, versionState: 'no-source' }],
			cloudBackupState: { status: 'backed-up', lastSyncedRevision: 'col-cp-1' },
		});

		await saveDocument('review');

		await expect(status()).resolves.toMatchObject({
			commitState: 'dirty',
			cloudBackupState: { status: 'uncommitted-local-changes' },
		});
	});

	it('creates a TEI-canonical collation through the initial committed file path', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Romans',
			createdAt: '2026-07-04T00:00:00.000Z',
			updatedAt: '2026-07-04T00:00:00.000Z',
		});

		const id = await createCollationWithFiles(
			harness.db,
			{
				id: 'col-created',
				projectId: 'project-1',
				title: 'Romans 1:3',
				verseIdentifier: 'Rom 1:3',
				segment: { id: 'segment-1', name: 'Romans 1:3', members: ['Rom 1:3'] },
				now: '2026-07-04T00:00:00.000Z',
			},
			{ backend, nonce: () => 'create-write' }
		);
		const head = await harness.db
			.selectFrom('collations')
			.select(['current_revision_id', 'current_content_hash'])
			.where('id', '=', 'col-created')
			.executeTakeFirstOrThrow();

		const version = parseCollationTeiVersion(
			await readTextFile(
				joinStorePath(
					projectFolder('project-slug'),
					`history/collations/col-created/${head.current_revision_id}.tei.xml`
				),
				{ backend }
			)
		);
		const tei = await readTextFile(collationTeiFile('project-slug', 'col-created'), {
			backend,
		});
		const primary = parseCollationPayloadTei(tei);
		const manifest = await readCanonicalDocument<ProjectManifestPayload>(
			PROJECT_MANIFEST_FORMAT,
			await readTextFile(projectManifestFile('project-slug'), { backend })
		);

		expect(id).toBe('col-created');
		expect(head.current_revision_id).toBeTruthy();
		expect(version.version).toMatchObject({ id: head.current_revision_id, parent_id: null });
		expect(version.payload.document).toMatchObject({ type: 'collationDocument' });
		expect(version.payload.document).not.toHaveProperty('flow');
		expect(primary).toMatchObject({
			id: 'col-created',
			project_id: 'project-1',
			title: 'Romans 1:3',
			based_on_checkpoint: {
				id: head.current_revision_id,
				content_hash: head.current_content_hash,
			},
			document: {
				type: 'collationDocument',
				meta: { projectName: 'Romans' },
			},
		});
		expect(manifest).toMatchObject({
			ok: true,
			payload: {
				collations: [
					{
						collation_id: 'col-created',
						current_revision: {
							id: head.current_revision_id,
							content_hash: head.current_content_hash,
						},
						primary_path: 'collations/col-created.tei.xml',
					},
				],
			},
		});
		expect(tei.slice(0, tei.indexOf('<standOff'))).not.toContain('Rom 1:3');
		expect(parseCollationTei(tei).setup.segment.members).toEqual(['Rom 1:3']);
		expect(
			collationStoreFiles(backend, 'col-created').filter(path => path.endsWith('.json'))
		).toEqual([]);
	});

	it.each([
		['history', 'history/collations/col-created/'],
		['primary', 'collations/col-created.tei.xml.tmp-'],
		['manifest', 'project.json.tmp-'],
	])('does not publish a collation when the initial %s write fails', async (_step, path) => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Romans',
		});
		backend.failWritePathIncludes = path;

		await expect(
			createCollationWithFiles(
				harness.db,
				{
					id: 'col-created',
					projectId: 'project-1',
					title: 'Romans 1:3',
					verseIdentifier: 'Rom 1:3',
					segment: { id: 'segment-1', name: 'Romans 1:3', members: ['Rom 1:3'] },
				},
				{ backend, nonce: () => 'create-failure' }
			)
		).rejects.toThrow('simulated write failure');
		await expect(
			harness.db
				.selectFrom('collations')
				.selectAll()
				.where('id', '=', 'col-created')
				.execute()
		).resolves.toEqual([]);
	});

	it('keeps custom subreading suffixes through persistence, sync and archive import', async () => {
		await createFixtureCollation();
		const readingTypes = [
			{
				id: 'itacism',
				label: 'Itacism',
				description: '',
				selectable: true,
				suffix: 'i',
			},
		];
		await harness.db
			.updateTable('projects')
			.set({ collation_settings: JSON.stringify({ readingTypes }) })
			.where('id', '=', 'project-1')
			.execute();
		await writeProjectManifestFile(harness.db, 'project-1', {}, { backend });
		const document = parseCollationDocument(completeCollationDocument())!;
		const unit = document.apparatus!.units[0];
		unit.decisions.subreadingOf = { 'variant::beta': 'variant::alpha' };
		unit.decisions.readingType = { 'variant::beta': 'itacism' };
		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(document),
			},
			{ backend }
		);
		const path = collationTeiFile('project-slug', 'col-1');
		expect(await readTextFile(path, { backend })).toContain('n="ai"');
		await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{
				collationId: 'col-1',
				checkpointId: 'custom-suffix',
			},
			{ backend }
		);
		expect(await readTextFile(path, { backend })).toContain('n="ai"');
		const provider = new MockCloudStorageProvider();
		const cloudFolderId = await provider.createFolder('Project');
		const result = await backupProject(
			harness.db,
			provider,
			{
				connectionId: 'suffix-location',
				projectId: 'project-1',
				cloudFolderId,
				cloudFolderPath: 'Project',
			},
			{ storeOptions: { backend } }
		);
		expect(result.uiState).toBe('synced');
		expect(await readTextFile(path, { backend })).toContain('n="ai"');
		const archive = await exportProjectZip(harness.db, 'project-1', {
			storeOptions: { backend },
		});
		const importedBackend = new ImportStoreBackend();
		const imported = await importProjectZip(harness.db, archive.bytes, {
			collisionMode: 'copy',
			storeOptions: { backend: importedBackend },
		});
		expect(imported.ok, JSON.stringify(imported.quarantinedFiles)).toBe(true);
		expect(
			await readTextFile(collationTeiFile(imported.storageSlug, 'col-1'), {
				backend: importedBackend,
			})
		).toContain('n="ai"');
	});

	it('writes reconstructive derived TEI for a complete collation commit', async () => {
		await createFixtureCollation();
		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(completeCollationDocument()),
				now: '2026-07-04T12:00:00.000Z',
			},
			{ backend }
		);

		const checkpoint = await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{
				collationId: 'col-1',
				checkpointId: 'col-cp-reconstructive',
				createdAt: '2026-07-04T13:00:00.000Z',
			},
			{ backend }
		);
		const tei = await readTextFile(collationTeiFile('project-slug', 'col-1'), { backend });

		expect(checkpoint.warnings).toEqual([]);
		expect(tei).toContain('one');
		expect(tei).toContain('<app n="Romans1:1U1" sameAs="unit%3Avariant">');
		expect(tei).toContain('<arc from="a" to="b" sameAs="variant-alpha-beta"/>');
		expect(tei).toContain('two');
		expect(tei).toContain('<graph type="directed">');
	});

	it('writes both TEI layers for an unfinished collation at every save', async () => {
		await createFixtureCollation();
		const document = incompleteCollationDocument();
		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(document),
				now: '2026-07-04T12:00:00.000Z',
			},
			{ backend }
		);
		const saved = await readTextFile(collationTeiFile('project-slug', 'col-1'), { backend });
		expect(parseCollationTei(saved)).toEqual(document);

		const checkpoint = await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{
				collationId: 'col-1',
				checkpointId: 'col-cp-incomplete',
				createdAt: '2026-07-04T13:00:00.000Z',
			},
			{ backend }
		);
		const tei = await readTextFile(collationTeiFile('project-slug', 'col-1'), { backend });

		expect(checkpoint.warnings).toEqual([]);
		expect(tei).toContain('<standOff type="apatosaurus-collation">');
		expect(tei).toContain('type="untranscribed"');
		expect(tei).toContain('<app n="Romans1:1U1" sameAs="unit%3Atwo">');
		expect(parseCollationTei(tei)).toEqual(document);
		expect(document.apparatus).toBeNull();
	});

	it('runs committed collation file writes under the project write lock', async () => {
		await createFixtureCollation();
		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactId: 'artifact-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(collationDocument('readings')),
				now: '2026-07-04T12:00:00.000Z',
			},
			{ backend, nonce: () => 'working-write' }
		);
		const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) =>
			callback()
		);
		vi.stubGlobal('navigator', { locks: { request } });

		await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{
				collationId: 'col-1',
				checkpointId: 'col-cp-locked',
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

describe('TEI-canonical collation persistence', () => {
	const teiPath = 'collations/col-1.tei.xml';
	const readTei = () => readTextFile(collationTeiFile('project-slug', 'col-1'), { backend });
	const fingerprint = (path: string) =>
		harness.db
			.selectFrom('document_file_fingerprints')
			.selectAll()
			.where('path', '=', path)
			.executeTakeFirst();
	const save = (document: unknown, now: string) =>
		saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(document),
				now,
			},
			{ backend }
		);
	const status = () =>
		getCollationVersionStatusWithWorkingFile(harness.db, 'col-1', {}, { backend });

	it('saves an unfinished collation as one TEI file, no JSON, indexed in the same request', async () => {
		await createFixtureCollation();
		const document = incompleteCollationDocument();
		const writes = vi.spyOn(backend, 'writeTextFile');

		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(document),
				now: '2026-07-04T12:00:00.000Z',
				metadata: { notes: 'Verse note' },
			},
			{ backend }
		);

		expect(collationStoreFiles(backend, 'col-1')).toEqual([
			expect.stringMatching(/collations\/col-1\.tei\.xml$/),
		]);
		expect(writes.mock.calls.filter(([path]) => path.includes(`${teiPath}.tmp-`))).toHaveLength(
			1
		);
		const xml = await readTei();
		const payload = parseCollationPayloadTei(xml);
		expect(payload).toMatchObject({
			id: 'col-1',
			project_id: 'project-1',
			notes: 'Verse note',
			status: 'draft',
			updated_at: '2026-07-04T12:00:00.000Z',
			based_on_checkpoint: null,
		});
		expect(payload.document).toEqual(document);
		await expect(fingerprint(teiPath)).resolves.toMatchObject({
			entity_type: 'collation',
			entity_id: 'col-1',
			content_hash: await hashContent(teiContentText(xml)),
			file_hash: await hashContent(xml),
		});
		await expect(
			harness.db
				.selectFrom('collations')
				.select(['notes', 'status', 'updated_at'])
				.executeTakeFirst()
		).resolves.toEqual({
			notes: 'Verse note',
			status: 'draft',
			updated_at: '2026-07-04T12:00:00.000Z',
		});
		const loaded = await loadCollationWithWorkingFile(harness.db, 'col-1', { backend });
		expect(JSON.parse(loaded?.artifact?.payload ?? '')).toEqual(document);
		expect(loaded?.row.notes).toBe('Verse note');
	});

	it('creates with one Current write, then loads and reports status without file access', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Project',
			createdAt: '2026-07-04T00:00:00.000Z',
			updatedAt: '2026-07-04T00:00:00.000Z',
		});
		const writes = vi.spyOn(backend, 'writeTextFile');

		await createCollationWithFiles(
			harness.db,
			{
				id: 'col-1',
				projectId: 'project-1',
				title: 'Romans 1:1',
				verseIdentifier: 'Rom 1:1',
				segment: { id: 'segment-1', name: 'Romans 1:1', members: ['Rom 1:1'] },
				now: '2026-07-04T00:00:00.000Z',
			},
			{ backend }
		);
		expect(writes.mock.calls.filter(([path]) => path.includes(`${teiPath}.tmp-`))).toHaveLength(
			1
		);
		expect((await status()).commitState).toBe('clean');

		const touched = (
			['readTextFile', 'readFileBytes', 'writeTextFile', 'moveFile'] as const
		).map(method => vi.spyOn(backend, method));
		await loadCollationWithWorkingFile(harness.db, 'col-1', { backend });
		await status();
		for (const spy of touched) expect(spy).not.toHaveBeenCalled();
	});

	it('stays clean across a save that changes only save time', async () => {
		await createFixtureCollation();
		await save(completeCollationDocument(), '2026-07-04T12:00:00.000Z');
		const checkpoint = await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{ collationId: 'col-1', checkpointId: 'col-cp-1' },
			{ backend }
		);
		expect((await status()).commitState).toBe('clean');
		const before = await readTei();

		await save(completeCollationDocument(), '2026-07-05T12:00:00.000Z');

		expect(await readTei()).not.toBe(before);
		expect(teiContentText(await readTei())).toBe(teiContentText(before));
		expect(await status()).toMatchObject({
			commitState: 'clean',
			workingContentHash: checkpoint.contentHash,
		});
		await saveWorkingCollationMetadata(
			harness.db,
			{ id: 'col-1', notes: 'Changed' },
			{ backend }
		);
		expect((await status()).commitState).toBe('dirty');
	});

	it('stores Versions as TEI snapshots whose note edits leave their content alone', async () => {
		await createFixtureCollation();
		await save(completeCollationDocument(), '2026-07-04T12:00:00.000Z');
		const checkpoint = await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{
				collationId: 'col-1',
				checkpointId: 'col-cp-1',
				label: 'First',
				commitMessage: 'Initial',
				authorName: 'Editor',
				createdAt: '2026-07-04T13:00:00.000Z',
			},
			{ backend }
		);
		const versionPath = 'history/collations/col-1/col-cp-1.tei.xml';
		const versionStorePath = joinStorePath(projectFolder('project-slug'), versionPath);
		const before = await readTextFile(versionStorePath, { backend });
		expect(parseCollationTeiVersion(before).version).toEqual({
			id: 'col-cp-1',
			label: 'First',
			note: 'Initial',
			author_name: 'Editor',
			created_at: '2026-07-04T13:00:00.000Z',
			parent_id: null,
		});
		expect(
			collationStoreFiles(backend, 'col-1').filter(path => path.endsWith('.json'))
		).toEqual([]);
		const contentBefore = (await fingerprint(versionPath))?.content_hash;
		expect(contentBefore).toBe(checkpoint.contentHash);

		await updateCollationVersionNote(harness.db, 'col-1', 'col-cp-1', 'Revised', { backend });

		const after = await readTextFile(versionStorePath, { backend });
		const withoutRevisions = (xml: string) =>
			xml.replace(/<revisionDesc>[\s\S]*<\/revisionDesc>/, '');
		expect(after).not.toBe(before);
		expect(withoutRevisions(after)).toBe(withoutRevisions(before));
		expect(parseCollationTeiVersion(after).version?.note).toBe('Revised');
		await expect(fingerprint(versionPath)).resolves.toMatchObject({
			content_hash: contentBefore,
			file_hash: await hashContent(after),
		});
		await expect(
			harness.db
				.selectFrom('collation_checkpoints')
				.select(['label', 'commit_message'])
				.executeTakeFirst()
		).resolves.toEqual({ label: 'First', commit_message: 'Revised' });
		await expect(
			loadCollationVersionDocument(harness.db, 'col-1', 'col-cp-1', { backend })
		).resolves.toEqual(parseCollationDocument(completeCollationDocument()));

		await saveWorkingCollationMetadata(
			harness.db,
			{ id: 'col-1', notes: 'Changed' },
			{ backend }
		);
		expect((await status()).commitState).toBe('dirty');
		await restoreCollationVersion(harness.db, 'col-1', 'col-cp-1', { backend });
		expect((await status()).commitState).toBe('clean');
		expect(parseCollationPayloadTei(await readTei()).notes).toBe('');
	});

	it('stamps witness sources with the TEI content hash and keeps them up to date', async () => {
		await createFixtureCollation();
		const transcription = (id: string) => ({
			id: `tx-${id}`,
			projectId: 'project-1',
			projectTranscriptionId: `pt-${id}`,
			title: id,
			siglum: id,
			document: { type: 'transcriptionDocument' as const, pages: [] },
			transcriber: '',
			repository: '',
			settlement: '',
			language: 'grc',
		});
		await createTranscriptionWithFiles(harness.db, transcription('tei'), { backend });
		const contentHash = await loadTranscriptionContentHash(harness.db, 'pt-tei');
		expect(contentHash).toBe(
			(await fingerprint('transcriptions/pt-tei.tei.xml'))?.content_hash
		);
		const capturedAt = new Date().toISOString();
		const witness = {
			...witnessNode('tei', 'one', true),
			transcriptionId: 'tx-tei',
			source: { kind: 'current', transcriptionId: 'tx-tei', capturedAt, contentHash },
		};
		const document = {
			...collationDocument('alignment'),
			setup: {
				segment: { id: 'segment-1', name: 'Romans 1:1', members: ['Romans 1:1'] },
				witnesses: [witness],
			},
		};
		await save(document, '2026-07-04T12:00:00.000Z');
		const states = async () =>
			(await status()).witnesses.map(entry => [entry.witnessId, entry.versionState]);
		expect(await states()).toEqual([['tei', 'up-to-date']]);

		await saveWorkingTranscriptionContent(
			harness.db,
			{
				id: 'tx-tei',
				document: transcription('tei').document,
				updatedAt: '2026-07-05T00:00:00.000Z',
			},
			{ backend }
		);
		await save(document, '2026-07-05T12:00:00.000Z');

		expect(await states()).toEqual([['tei', 'up-to-date']]);
	});

	it('builds CBGM snapshots from the parsed canonical file', async () => {
		await createFixtureCollation();
		await save(completeCollationDocument(), '2026-07-04T12:00:00.000Z');

		const snapshots = await loadCollationSnapshots(harness.db, 'project-1', undefined, {
			backend,
		});

		const xml = await readTei();
		expect(snapshots.unavailable).toEqual([]);
		expect(snapshots.collations).toEqual([
			expect.objectContaining({
				collationId: 'col-1',
				document: parseCollationTei(xml),
				contentHash: await hashContent(teiContentText(xml)),
			}),
		]);
	});
});

function collationStoreFiles(store: MemoryStoreBackend, collationId: string): string[] {
	return [...store.files.keys()].filter(path =>
		new RegExp(`(^|/)(collations/${collationId}\\.|history/collations/${collationId}/)`).test(
			path
		)
	);
}

async function createFixtureCollation(): Promise<void> {
	await createProject(harness.db, {
		id: 'project-1',
		storageSlug: 'project-slug',
		name: 'Project',
		createdAt: '2026-07-04T00:00:00.000Z',
		updatedAt: '2026-07-04T00:00:00.000Z',
	});
	await createCollation(harness.db, {
		id: 'col-1',
		projectId: 'project-1',
		title: 'Romans 1:1',
		verseIdentifier: 'Rom 1:1',
		now: '2026-07-04T00:00:00.000Z',
	});
}

async function readPrimaryPayload(): Promise<CollationPayload> {
	return parseCollationPayloadTei(
		await readTextFile(collationTeiFile('project-slug', 'col-1'), { backend })
	);
}

function collationDocument(variant: string) {
	return {
		type: 'collationDocument',
		version: 1,
		meta: { collationId: 'col-1', projectId: 'project-1', projectName: `Project (${variant})` },
		setup: {
			segment: { id: 'segment-1', name: 'Romans 1:1', members: ['Romans 1:1'] },
			witnesses: [],
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
		apparatus: null,
		stemma: null,
	};
}

function completeCollationDocument() {
	return {
		...collationDocument('review'),
		setup: {
			segment: { id: 'segment-1', name: 'Romans 1:1', members: ['Romans 1:1'] },
			witnesses: [witnessNode('A', 'one alpha two', true), witnessNode('B', 'one beta two')],
		},
		alignment: {
			type: 'alignment',
			witnessOrder: ['A', 'B'],
			columns: [
				alignmentColumn('one', 0, 'one', 'one'),
				alignmentColumn('variant', 1, 'alpha', 'beta'),
				alignmentColumn('two', 2, 'two', 'two'),
			],
		},
		apparatus: {
			type: 'apparatus',
			units: [
				{
					type: 'variationUnit',
					id: 'unit:variant',
					unitId: 'unit:variant',
					columnId: 'variant',
					readings: [
						reading('variant::alpha', 0, 'alpha', 'A'),
						reading('variant::beta', 1, 'beta', 'B'),
					],
					decisions: {
						sourceDecision: {
							'variant::alpha': { kind: 'unclear' },
							'variant::beta': { kind: 'derived', from: 'variant::alpha' },
						},
					},
				},
			],
		},
		stemma: {
			type: 'stemma',
			units: [
				{
					type: 'stemmaUnit',
					id: 'unit:variant',
					unitId: 'unit:variant',
					columnId: 'variant',
					arcs: [
						{
							id: 'variant-alpha-beta',
							priorReadingId: 'variant::alpha',
							posteriorReadingId: 'variant::beta',
						},
					],
				},
			],
		},
	};
}

function incompleteCollationDocument() {
	return {
		...collationDocument('review'),
		setup: {
			segment: { id: 'segment-1', name: 'Romans 1:1', members: ['Romans 1:1'] },
			witnesses: [witnessNode('A', 'one', true), witnessNode('B', '')],
		},
		alignment: {
			type: 'alignment',
			witnessOrder: ['A', 'B'],
			columns: [
				{
					...alignmentColumn('one', 0, 'one', 'one'),
					cells: [
						['A', textCell('one')],
						[
							'B',
							{
								...textCell('⊘'),
								regularizedText: null,
								alignmentValue: '__untranscribed__:none:none:none',
								kind: 'untranscribed',
								gap: { source: 'untranscribed', reason: '', unit: '', extent: '' },
								isLacuna: true,
							},
						],
					],
				},
				alignmentColumn('two', 1, 'two', 'deux'),
			],
		},
	};
}

function witnessNode(id: string, content: string, isBaseText = false) {
	return {
		type: 'witness',
		id,
		siglum: id,
		transcriptionId: '',
		content,
		treatment: 'inherit',
		isBaseText,
		isExcluded: false,
		overridesDefault: false,
		sourceTokens: [],
	};
}

function alignmentColumn(id: string, index: number, a: string, b: string) {
	return {
		id,
		index,
		merged: false,
		cells: [
			['A', textCell(a)],
			['B', textCell(b)],
		],
	};
}

function textCell(text: string) {
	return {
		text,
		regularizedText: text,
		alignmentValue: text,
		sourceTokenIds: [],
		kind: 'text',
		gap: null,
		isOmission: false,
		isLacuna: false,
		isRegularized: false,
		ruleIds: [],
		regularizationTypes: [],
	};
}

function reading(id: string, order: number, text: string, witnessId: string) {
	return {
		id,
		order,
		label: order === 0 ? 'a' : 'b',
		text,
		normalizedText: text,
		witnessIds: [witnessId],
		witnessGroups: [],
		isOmission: false,
		isLacuna: false,
		readingType: null,
		certainty: null,
		parentReadingId: null,
		isSubreading: false,
		autoGenerated: false,
		derivedFromRuleIds: [],
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
