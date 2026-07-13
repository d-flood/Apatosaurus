import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_FORMAT,
	PROJECT_MANIFEST_FORMAT,
	createQuarantineReport,
	collationCheckpointFile,
	collationPrimaryFile,
	collationTeiFile,
	collationWorkingFile,
	joinStorePath,
	normalizeStorePath,
	projectManifestFile,
	readCanonicalDocument,
	readTextFile,
	sealDocument,
	serializeSealedDocument,
	StoreMoveUnavailableError,
	storePathBasename,
	storePathDirname,
	type CollationCheckpointPayload,
	type CollationPayload,
	type ProjectManifestPayload,
	WORKING_COLLATION_FORMAT,
	type StoreBackend,
	type StoreBackendDirectoryEntry,
	type WorkingCollationPayload,
	writeTextFileAtomic,
} from '$lib/client/store';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import { createProject as createProjectRepository } from './projects';
import { projectWriteLockName } from './project-locks';
import { createCollation, loadCollation } from './collations';
import { createCommittedCollationCheckpoint } from './revisions';
import {
	createCollationWithFiles,
	createCommittedCollationCheckpointWithFiles,
	getCollationVersionStatusWithWorkingFile,
	loadCollationWithWorkingFile,
	saveWorkingCollationArtifact,
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
	it('writes the working collation file before updating artifact storage', async () => {
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
		await expect(loadCollation(harness.db, 'col-1')).resolves.toMatchObject({
			artifact: null,
			row: { updatedAt: '2026-07-04T00:00:00.000Z' },
		});
	});

	it('stores a canonical working file and leaves collation_artifacts empty', async () => {
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

		const raw = await readTextFile(collationWorkingFile('project-slug', 'col-1'), { backend });
		const parsed = await readCanonicalDocument<WorkingCollationPayload>(
			WORKING_COLLATION_FORMAT,
			raw
		);

		expect(parsed).toMatchObject({
			ok: true,
			payload: {
				id: 'col-1',
				project_id: 'project-1',
				title: 'Romans 1:1',
				status: 'alignment',
				updated_at: '2026-07-04T12:00:00.000Z',
				draft: {
					base_revision_id: null,
					base_content_hash: null,
					saved_at: '2026-07-04T12:00:00.000Z',
				},
				document: { type: 'collationDocument', flow: { phase: 'alignment' } },
			},
		});
		if (!parsed.ok) throw new Error('working file did not parse');
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
				raw: serializeSealedDocument(await sealDocument(COLLATION_FORMAT, 1, {})),
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
				current_revision: {
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
		expect(tei).toContain('Rom 1:3');
		await expect(
			harness.db.selectFrom('collation_artifacts').selectAll().execute()
		).resolves.toEqual([]);
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
				current_revision: {
					id: 'col-cp-1',
					content_hash: checkpoint.contentHash,
					created_at: '2026-07-04T13:00:00.000Z',
					author_name: 'Editor',
				},
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

	it('does not write primary, manifest, or index when collation history writing fails', async () => {
		await createFixtureCollation();
		await saveFixtureWorkingCollation();
		const initialManifest = await readTextFile(projectManifestFile('project-slug'), {
			backend,
		});
		backend.failWritePathIncludes = 'history/collations/col-1/col-cp-history-fail.json.tmp-';

		await expect(
			createCommittedCollationCheckpointWithFiles(
				harness.db,
				{
					collationId: 'col-1',
					checkpointId: 'col-cp-history-fail',
					createdAt: '2026-07-04T13:00:00.000Z',
				},
				{ backend, nonce: () => 'history-fail' }
			)
		).rejects.toThrow('simulated write failure');

		await expect(
			readTextFile(collationCheckpointFile('project-slug', 'col-1', 'col-cp-history-fail'), {
				backend,
			})
		).rejects.toThrow('not found');
		await expect(
			readTextFile(collationPrimaryFile('project-slug', 'col-1'), { backend })
		).rejects.toThrow('not found');
		await expect(readTextFile(projectManifestFile('project-slug'), { backend })).resolves.toBe(
			initialManifest
		);
		await expect(
			harness.db
				.selectFrom('collation_checkpoints')
				.selectAll()
				.where('id', '=', 'col-cp-history-fail')
				.execute()
		).resolves.toEqual([]);
		await expect(
			harness.db
				.selectFrom('collations')
				.select(['current_revision_id', 'current_content_hash'])
				.where('id', '=', 'col-1')
				.executeTakeFirstOrThrow()
		).resolves.toEqual({ current_revision_id: '', current_content_hash: '' });
	});

	it('leaves only history when collation primary writing fails', async () => {
		await createFixtureCollation();
		await saveFixtureWorkingCollation();
		const initialManifest = await readTextFile(projectManifestFile('project-slug'), {
			backend,
		});
		backend.failWritePathIncludes = 'collations/col-1.json.tmp-';

		await expect(
			createCommittedCollationCheckpointWithFiles(
				harness.db,
				{
					collationId: 'col-1',
					checkpointId: 'col-cp-primary-fail',
					createdAt: '2026-07-04T13:00:00.000Z',
				},
				{ backend, nonce: () => 'primary-fail' }
			)
		).rejects.toThrow('simulated write failure');

		await expect(
			readTextFile(collationCheckpointFile('project-slug', 'col-1', 'col-cp-primary-fail'), {
				backend,
			})
		).resolves.toContain('col-cp-primary-fail');
		await expect(
			readTextFile(collationPrimaryFile('project-slug', 'col-1'), { backend })
		).rejects.toThrow('not found');
		await expect(readTextFile(projectManifestFile('project-slug'), { backend })).resolves.toBe(
			initialManifest
		);
		await expect(
			harness.db
				.selectFrom('collation_checkpoints')
				.selectAll()
				.where('id', '=', 'col-cp-primary-fail')
				.execute()
		).resolves.toEqual([]);
		await expect(
			harness.db
				.selectFrom('collations')
				.select(['current_revision_id', 'current_content_hash'])
				.where('id', '=', 'col-1')
				.executeTakeFirstOrThrow()
		).resolves.toEqual({ current_revision_id: '', current_content_hash: '' });
	});

	it('does not update the collation index when manifest writing fails after entity files', async () => {
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
		const initialManifest = await readTextFile(projectManifestFile('project-slug'), {
			backend,
		});
		backend.failWritePathIncludes = 'project.json.tmp-';

		await expect(
			createCommittedCollationCheckpointWithFiles(
				harness.db,
				{
					collationId: 'col-1',
					checkpointId: 'col-cp-manifest-fail',
					createdAt: '2026-07-04T13:00:00.000Z',
				},
				{ backend, nonce: () => 'manifest-fail' }
			)
		).rejects.toThrow('simulated write failure');

		await expect(
			readTextFile(collationCheckpointFile('project-slug', 'col-1', 'col-cp-manifest-fail'), {
				backend,
			})
		).resolves.toContain('col-cp-manifest-fail');
		await expect(
			readTextFile(collationPrimaryFile('project-slug', 'col-1'), { backend })
		).resolves.toContain('col-cp-manifest-fail');
		await expect(readTextFile(projectManifestFile('project-slug'), { backend })).resolves.toBe(
			initialManifest
		);
		await expect(
			harness.db
				.selectFrom('collation_checkpoints')
				.selectAll()
				.where('id', '=', 'col-cp-manifest-fail')
				.execute()
		).resolves.toEqual([]);
		await expect(
			harness.db
				.selectFrom('collations')
				.select(['current_revision_id', 'current_content_hash'])
				.where('id', '=', 'col-1')
				.executeTakeFirstOrThrow()
		).resolves.toEqual({ current_revision_id: '', current_content_hash: '' });
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

	it('does not fail the collation commit when derived TEI writing fails', async () => {
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

async function saveFixtureWorkingCollation(): Promise<void> {
	await saveWorkingCollationArtifact(
		harness.db,
		{
			collationId: 'col-1',
			artifactType: 'collation_document_v1',
			payload: JSON.stringify(collationDocument('setup')),
			now: '2026-07-04T12:00:00.000Z',
		},
		{ backend, nonce: () => 'fixture-working' }
	);
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
			selectedVerse: null,
			selectedBook: 'Romans',
			selectedChapter: '1',
			selectedVerseNum: '1',
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
