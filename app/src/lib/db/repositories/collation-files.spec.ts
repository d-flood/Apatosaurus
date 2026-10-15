import {
	createCollationWithFiles,
	createLocalDbTestHarness,
	type LocalDbTestHarness,
} from '$lib/testing/local-db-harness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_CURRENT_VERSION,
	COLLATION_FORMAT,
	PROJECT_MANIFEST_FORMAT,
	readCanonicalDocument,
	type CollationCheckpointPayload,
	type CollationPayload,
	type ProjectManifestPayload,
	WORKING_COLLATION_CURRENT_VERSION,
	WORKING_COLLATION_FORMAT,
} from '$lib/storage/formats';
import { createQuarantineReport } from '$lib/storage/quarantine-report.spec-support';
import {
	collationCheckpointFile,
	collationPrimaryFile,
	collationTeiFile,
	collationWorkingFile,
	joinStorePath,
	normalizeStorePath,
	projectManifestFile,
	storePathBasename,
	storePathDirname,
} from '$lib/storage/layout';
import {
	readTextFile,
	StoreMoveUnavailableError,
	type StoreBackend,
	type StoreBackendDirectoryEntry,
	writeTextFileAtomic,
} from '$lib/storage/opfs-store';
import { sealDocument, serializeSealedDocument } from '$lib/storage/envelope';
import { createProject as createProjectRepository } from './projects';
import { projectWriteLockName } from './project-locks';
import { createCollation, saveCollationProjection } from './collations';
import { createCommittedCollationCheckpoint } from './revisions';
import {
	createCollationWithFilesResult,
	createCommittedCollationCheckpointWithFiles,
	getCollationVersionStatusWithWorkingFile,
	loadCollationWithWorkingFile,
	saveWorkingCollationArtifact,
	saveWorkingCollationMetadata,
} from './collation-files';

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

	it('stores Current in the canonical primary and leaves collation_artifacts empty', async () => {
		await createFixtureCollation();
		await harness.db
			.insertInto('collation_tokens')
			.values({
				id: 'stale-token',
				collation_id: 'col-1',
				witness_id: 'stale',
				token_index: 0,
				token_text: 'stale',
			})
			.execute();

		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(collationDocument('alignment')),
				now: '2026-07-04T12:00:00.000Z',
			},
			{ backend, nonce: () => 'working-write' }
		);

		const raw = await readTextFile(collationPrimaryFile('project-slug', 'col-1'), { backend });
		const parsed = await readCanonicalDocument<CollationPayload>(COLLATION_FORMAT, raw);

		expect(parsed).toMatchObject({
			ok: true,
			payload: {
				id: 'col-1',
				project_id: 'project-1',
				title: 'Romans 1:1',
				status: 'alignment',
				updated_at: '2026-07-04T12:00:00.000Z',
				based_on_checkpoint: null,
				draft: { saved_at: '2026-07-04T12:00:00.000Z', author_name: null },
				document: { type: 'collationDocument', flow: { phase: 'alignment' } },
			},
		});
		if (!parsed.ok) throw new Error('primary file did not parse');
		await expect(
			readTextFile(collationWorkingFile('project-slug', 'col-1'), { backend })
		).rejects.toThrow('was not found');
		expect(parsed.payload).not.toHaveProperty('artifacts');
		expect(parsed.payload).not.toHaveProperty('witnesses');
		expect(parsed.payload).not.toHaveProperty('tokens');
		expect(parsed.payload).not.toHaveProperty('variation_units');
		await expect(
			harness.db.selectFrom('collation_artifacts').selectAll().execute()
		).resolves.toEqual([]);
		await expect(
			harness.db.selectFrom('collation_tokens').selectAll().execute()
		).resolves.toEqual([]);
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
		const raw = await readTextFile(collationPrimaryFile('project-slug', 'col-1'), { backend });
		const parsed = await readCanonicalDocument<CollationPayload>(COLLATION_FORMAT, raw);

		expect(parsed).toMatchObject({
			ok: true,
			payload: { verse_identifier: 'Romans 1:1 (critical text)' },
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
		expect(loaded?.artifact?.payload).toContain('"phase":"readings"');
		expect(loaded?.row.status).toBe('readings');
		expect(loaded?.row.updatedAt).toBe('2026-07-04T12:00:00.000Z');
	});

	it('loads the committed primary file when no working file exists and the index cache is stale', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Romans',
			createdAt: '2026-07-04T00:00:00.000Z',
			updatedAt: '2026-07-04T00:00:00.000Z',
		});
		await createCollationWithFiles(
			harness.db,
			{
				id: 'col-1',
				projectId: 'project-1',
				title: 'Romans 1:3',
				verseIdentifier: 'Rom 1:3',
				segment: { id: 'segment-1', name: 'Romans 1:3', members: ['Rom 1:3'] },
				now: '2026-07-04T00:00:00.000Z',
			},
			{ backend, nonce: () => 'create-write' }
		);
		await harness.db
			.updateTable('collations')
			.set({ title: 'Stale index title', status: 'alignment' })
			.where('id', '=', 'col-1')
			.execute();

		const loaded = await loadCollationWithWorkingFile(harness.db, 'col-1', { backend });

		expect(loaded?.row.title).toBe('Romans 1:3');
		expect(loaded?.row.status).toBe('setup');
		expect(loaded?.artifact?.payload).toContain('"phase":"setup"');
		expect(loaded?.artifact?.payload).toContain('"projectName":"Romans"');
	});

	it('records every canonical validation failure without mutating the collation primary', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Romans',
			createdAt: '2026-07-04T00:00:00.000Z',
			updatedAt: '2026-07-04T00:00:00.000Z',
		});
		await createCollationWithFiles(
			harness.db,
			{
				id: 'col-1',
				projectId: 'project-1',
				title: 'Romans 1:3',
				verseIdentifier: 'Rom 1:3',
				segment: { id: 'segment-1', name: 'Romans 1:3', members: ['Rom 1:3'] },
				now: '2026-07-04T00:00:00.000Z',
			},
			{ backend }
		);
		const path = collationPrimaryFile('project-slug', 'col-1');
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
					await sealDocument(COLLATION_FORMAT, COLLATION_CURRENT_VERSION, {})
				),
			},
			{ code: 'hash_mismatch', raw: JSON.stringify({ ...validDocument, title: 'tampered' }) },
		] as const;

		for (const failure of failures) {
			await writeTextFileAtomic(path, failure.raw, { backend });
			const quarantineSink = createQuarantineReport();

			await loadCollationWithWorkingFile(harness.db, 'col-1', { backend, quarantineSink });

			expect(quarantineSink.list()).toEqual([
				expect.objectContaining({ path, code: failure.code, message: expect.any(String) }),
			]);
			expect(await readTextFile(path, { backend })).toBe(failure.raw);
		}
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
				file_path: 'collations/col-1.json',
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

	it('creates a collation through the initial committed file path', async () => {
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

		const historyRaw = await readTextFile(
			collationCheckpointFile('project-slug', 'col-created', head.current_revision_id),
			{ backend }
		);
		const primaryRaw = await readTextFile(collationPrimaryFile('project-slug', 'col-created'), {
			backend,
		});
		const manifestRaw = await readTextFile(projectManifestFile('project-slug'), { backend });
		const tei = await readTextFile(collationTeiFile('project-slug', 'col-created'), {
			backend,
		});
		const history = await readCanonicalDocument<CollationCheckpointPayload>(
			COLLATION_CHECKPOINT_FORMAT,
			historyRaw
		);
		const primary = await readCanonicalDocument<CollationPayload>(COLLATION_FORMAT, primaryRaw);
		const manifest = await readCanonicalDocument<ProjectManifestPayload>(
			PROJECT_MANIFEST_FORMAT,
			manifestRaw
		);

		expect(id).toBe('col-created');
		expect(head.current_revision_id).toBeTruthy();
		expect(history).toMatchObject({
			ok: true,
			payload: {
				checkpoint_id: head.current_revision_id,
				entity_id: 'col-created',
				payload_content_hash: head.current_content_hash,
			},
		});
		if (history.ok) {
			expect(history.payload.payload).toMatchObject({
				document: { type: 'collationDocument', flow: { phase: 'setup' } },
			});
			expect(history.payload.payload).not.toHaveProperty('artifacts');
			expect(history.payload.payload).not.toHaveProperty('variation_units');
		}
		expect(primary).toMatchObject({
			ok: true,
			payload: {
				id: 'col-created',
				project_id: 'project-1',
				based_on_checkpoint: {
					id: head.current_revision_id,
					content_hash: head.current_content_hash,
				},
				document: {
					type: 'collationDocument',
					flow: { phase: 'setup' },
					meta: { projectName: 'Romans' },
				},
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
					},
				],
			},
		});
		expect(tei).toContain('Romans 1:3');
		expect(tei).not.toContain('Rom 1:3');
		await expect(
			harness.db.selectFrom('collation_artifacts').selectAll().execute()
		).resolves.toEqual([]);
	});

	it.each([
		['history', 'history/collations/col-created/'],
		['primary', 'collations/col-created.json.tmp-'],
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

	it('returns a TEI warning while collation creation succeeds', async () => {
		await createProject(harness.db, {
			id: 'project-1',
			storageSlug: 'project-slug',
			name: 'Romans',
		});
		backend.failWritePathIncludes = '.tei.xml.tmp-';

		const result = await createCollationWithFilesResult(
			harness.db,
			{
				id: 'col-created',
				projectId: 'project-1',
				title: 'Romans 1:3',
				verseIdentifier: 'Rom 1:3',
				segment: { id: 'segment-1', name: 'Romans 1:3', members: ['Rom 1:3'] },
			},
			{ backend }
		);

		expect(result.value).toBe('col-created');
		expect(result.warnings).toEqual([
			expect.objectContaining({ code: 'tei_write_failed', entityType: 'collation' }),
		]);
		await expect(
			harness.db
				.selectFrom('collations')
				.select('id')
				.where('id', '=', 'col-created')
				.executeTakeFirst()
		).resolves.toEqual({ id: 'col-created' });
	});

	it('writes committed collation files before updating the index', async () => {
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

		const checkpoint = await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{
				collationId: 'col-1',
				checkpointId: 'col-cp-1',
				commitMessage: 'Initial collation commit',
				authorName: 'Editor',
				createdAt: '2026-07-04T13:00:00.000Z',
			},
			{ backend, nonce: () => 'commit-write' }
		);

		const historyRaw = await readTextFile(
			collationCheckpointFile('project-slug', 'col-1', 'col-cp-1'),
			{ backend }
		);
		const history = await readCanonicalDocument<CollationCheckpointPayload>(
			COLLATION_CHECKPOINT_FORMAT,
			historyRaw
		);
		const primaryRaw = await readTextFile(collationPrimaryFile('project-slug', 'col-1'), {
			backend,
		});
		const primary = await readCanonicalDocument<CollationPayload>(COLLATION_FORMAT, primaryRaw);
		const manifestRaw = await readTextFile(projectManifestFile('project-slug'), { backend });
		const manifest = await readCanonicalDocument<ProjectManifestPayload>(
			PROJECT_MANIFEST_FORMAT,
			manifestRaw
		);
		const tei = await readTextFile(collationTeiFile('project-slug', 'col-1'), { backend });
		const head = await harness.db
			.selectFrom('collations')
			.select(['current_revision_id', 'current_content_hash'])
			.where('id', '=', 'col-1')
			.executeTakeFirstOrThrow();

		expect(history).toMatchObject({
			ok: true,
			payload: {
				checkpoint_id: 'col-cp-1',
				entity_id: 'col-1',
				payload_content_hash: checkpoint.contentHash,
				commit_message: 'Initial collation commit',
			},
		});
		expect(primary).toMatchObject({
			ok: true,
			payload: {
				id: 'col-1',
				project_id: 'project-1',
				status: 'readings',
				based_on_checkpoint: { id: 'col-cp-1', content_hash: checkpoint.contentHash },
				document: { type: 'collationDocument', flow: { phase: 'readings' } },
			},
		});
		if (primary.ok) {
			expect(primary.payload).not.toHaveProperty('artifacts');
			expect(primary.payload).not.toHaveProperty('witnesses');
			expect(primary.payload).not.toHaveProperty('variation_units');
		}
		expect(manifest).toMatchObject({
			ok: true,
			payload: {
				id: 'project-1',
				collations: [
					{
						collation_id: 'col-1',
						current_revision: { id: 'col-cp-1', content_hash: checkpoint.contentHash },
						primary_path: 'collations/col-1.json',
					},
				],
			},
		});
		expect(tei).toContain('<TEI');
		expect(head).toEqual({
			current_revision_id: 'col-cp-1',
			current_content_hash: checkpoint.contentHash,
		});
		await expect(
			harness.db.selectFrom('collation_artifacts').selectAll().execute()
		).resolves.toEqual([]);

		const status = await getCollationVersionStatusWithWorkingFile(
			harness.db,
			'col-1',
			{},
			{ backend }
		);
		expect(status.commitState).toBe('clean');
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
		expect(tei).toContain('<app xml:id="unit-variant" from="4"');
		expect(tei).toContain('two');
		expect(tei).toContain('<graph type="directed">');
	});

	it('commits an incomplete collation with a warning and no derived TEI', async () => {
		await createFixtureCollation();
		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(incompleteCollationDocument()),
				now: '2026-07-04T12:00:00.000Z',
			},
			{ backend }
		);

		const checkpoint = await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{
				collationId: 'col-1',
				checkpointId: 'col-cp-incomplete',
				createdAt: '2026-07-04T13:00:00.000Z',
			},
			{ backend }
		);

		expect(checkpoint.warnings).toEqual([
			expect.objectContaining({
				code: 'tei_write_failed',
				entityType: 'collation',
				message: expect.stringContaining('Cannot export apparatus'),
			}),
		]);
		await expect(
			readTextFile(collationTeiFile('project-slug', 'col-1'), { backend })
		).rejects.toThrow('not found');
	});

	it('allows manifest to advance while the collation index remains old if index insertion fails', async () => {
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
		await harness.db
			.insertInto('collation_checkpoints')
			.values({
				id: 'col-cp-index-fail',
				collation_id: 'col-1',
				parent_checkpoint_id: null,
				content_hash: 'preexisting-content-hash',
				is_committed: 1,
				label: '',
				commit_message: null,
				author_name: 'Seed',
				created_at: '2026-07-04T01:00:00.000Z',
			})
			.execute();

		await expect(
			createCommittedCollationCheckpointWithFiles(
				harness.db,
				{
					collationId: 'col-1',
					checkpointId: 'col-cp-index-fail',
					createdAt: '2026-07-04T13:00:00.000Z',
				},
				{ backend, nonce: () => 'index-fail' }
			)
		).rejects.toThrow();

		await expect(
			readTextFile(collationCheckpointFile('project-slug', 'col-1', 'col-cp-index-fail'), {
				backend,
			})
		).resolves.toContain('col-cp-index-fail');
		await expect(
			readTextFile(collationPrimaryFile('project-slug', 'col-1'), { backend })
		).resolves.toContain('col-cp-index-fail');
		await expect(
			readTextFile(projectManifestFile('project-slug'), { backend })
		).resolves.toContain('col-cp-index-fail');
		await expect(
			harness.db
				.selectFrom('collations')
				.select(['current_revision_id', 'current_content_hash'])
				.where('id', '=', 'col-1')
				.executeTakeFirstOrThrow()
		).resolves.toEqual({ current_revision_id: '', current_content_hash: '' });
		await expect(
			harness.db
				.selectFrom('collation_checkpoints')
				.select(['content_hash'])
				.where('id', '=', 'col-cp-index-fail')
				.executeTakeFirstOrThrow()
		).resolves.toEqual({ content_hash: 'preexisting-content-hash' });
	});

	it('returns a warning without failing the collation commit when derived TEI writing fails', async () => {
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
		backend.failWritePathIncludes = '.tei.xml.tmp-';
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		try {
			const checkpoint = await createCommittedCollationCheckpointWithFiles(
				harness.db,
				{
					collationId: 'col-1',
					checkpointId: 'col-cp-tei-fail',
					createdAt: '2026-07-04T13:00:00.000Z',
				},
				{ backend, nonce: () => 'tei-fail' }
			);

			expect(checkpoint.id).toBe('col-cp-tei-fail');
			expect(checkpoint.warnings).toEqual([
				expect.objectContaining({ code: 'tei_write_failed', entityType: 'collation' }),
			]);
			await expect(
				readTextFile(collationTeiFile('project-slug', 'col-1'), { backend })
			).rejects.toThrow('not found');
			await expect(
				readTextFile(projectManifestFile('project-slug'), { backend })
			).resolves.toContain('col-cp-tei-fail');
			await expect(
				harness.db
					.selectFrom('collations')
					.select(['current_revision_id', 'current_content_hash'])
					.where('id', '=', 'col-1')
					.executeTakeFirstOrThrow()
			).resolves.toEqual({
				current_revision_id: 'col-cp-tei-fail',
				current_content_hash: checkpoint.contentHash,
			});
		} finally {
			warn.mockRestore();
		}
	});

	it.each([
		['migrates', null],
		[
			'keeps the working file when the new primary cannot be written',
			'collations/col-1.json.tmp-',
		],
	])('%s a legacy primary and working pair on load', async (_case, failWritePathIncludes) => {
		await createFixtureCollation();
		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(collationDocument('readings')),
				now: '2026-07-04T12:00:00.000Z',
			},
			{ backend }
		);
		await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{ collationId: 'col-1', checkpointId: 'col-cp-1' },
			{ backend }
		);
		const committed = await readCanonicalDocument<CollationPayload>(
			COLLATION_FORMAT,
			await readTextFile(collationPrimaryFile('project-slug', 'col-1'), { backend })
		);
		if (!committed.ok || !committed.payload.based_on_checkpoint)
			throw new Error('Expected a committed primary.');
		const { based_on_checkpoint: basedOn, draft: _draft, ...content } = committed.payload;
		const legacyPrimary = serializeSealedDocument(
			await sealDocument(COLLATION_FORMAT, 6, {
				...content,
				current_revision: {
					...basedOn,
					created_at: '2026-07-04T13:00:00.000Z',
					author_name: 'Editor',
				},
			})
		);
		await writeTextFileAtomic(collationPrimaryFile('project-slug', 'col-1'), legacyPrimary, {
			backend,
		});
		await writeTextFileAtomic(
			collationWorkingFile('project-slug', 'col-1'),
			serializeSealedDocument(
				await sealDocument(WORKING_COLLATION_FORMAT, WORKING_COLLATION_CURRENT_VERSION, {
					...content,
					notes: 'Uncommitted notes',
					updated_at: '2026-07-04T14:00:00.000Z',
					draft: {
						base_revision_id: basedOn.id,
						base_content_hash: basedOn.content_hash,
						saved_at: '2026-07-04T14:00:00.000Z',
						author_name: null,
					},
				})
			),
			{ backend }
		);
		backend.failWritePathIncludes = failWritePathIncludes;

		const loading = loadCollationWithWorkingFile(harness.db, 'col-1', { backend });

		if (failWritePathIncludes) {
			await expect(loading).rejects.toThrow('simulated write failure');
			await expect(
				readTextFile(collationPrimaryFile('project-slug', 'col-1'), { backend })
			).resolves.toBe(legacyPrimary);
			await expect(
				readTextFile(collationWorkingFile('project-slug', 'col-1'), { backend })
			).resolves.toContain('Uncommitted notes');
			return;
		}
		expect((await loading)?.row.notes).toBe('Uncommitted notes');
		await expect(
			readTextFile(collationWorkingFile('project-slug', 'col-1'), { backend })
		).rejects.toThrow('not found');
		const migratedRaw = await readTextFile(collationPrimaryFile('project-slug', 'col-1'), {
			backend,
		});
		expect(JSON.parse(migratedRaw)).toMatchObject({
			schema_version: COLLATION_CURRENT_VERSION,
		});
		await expect(readCanonicalDocument(COLLATION_FORMAT, migratedRaw)).resolves.toMatchObject({
			ok: true,
			payload: {
				notes: 'Uncommitted notes',
				based_on_checkpoint: basedOn,
				draft: { saved_at: '2026-07-04T14:00:00.000Z' },
			},
		});
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

function collationDocument(phase: string) {
	return {
		type: 'collationDocument',
		version: 1,
		meta: { collationId: 'col-1', projectId: 'project-1', projectName: 'Project' },
		flow: {
			phase,
			furthestPhase: phase,
			alignmentDisplayMode: 'regularized',
			alignmentLayout: 'grid',
		},
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
