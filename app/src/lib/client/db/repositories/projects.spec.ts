import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import {
	PROJECT_MANIFEST_FORMAT,
	COLLATION_FORMAT,
	COLLATION_FIXTURE,
	PROJECT_TRANSCRIPTION_FORMAT,
	StoreMoveUnavailableError,
	TOMBSTONE_FORMAT,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	normalizeStorePath,
	projectManifestFile,
	collationPrimaryFile,
	collationTeiFile,
	readCanonicalDocument,
	readTextFile,
	storePathBasename,
	storePathDirname,
	transcriptionCheckpointFile,
	transcriptionPrimaryFile,
	transcriptionTeiFile,
	tombstoneFile,
	type StoreBackend,
	type StoreBackendDirectoryEntry,
	type ProjectManifestPayload,
	type ProjectTranscriptionPayload,
	type TranscriptionCheckpointPayload,
	type TombstonePayload,
} from '$lib/client/store';
import { upsertCloudConnection } from './cloud-connections';
import { createCollation } from './collations';
import {
	createCollationWithFiles,
	createCommittedCollationCheckpointWithFiles,
	saveWorkingCollationArtifact,
} from './collation-files';
import {
	createTranscription as createTranscriptionRepository,
	updateTranscriptionContent,
} from './transcriptions';
import { ensureManifestSource, upsertCanvasAnnotation, upsertPageCanvasLink } from './iiif';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import {
	createProject as createProjectRepository,
	ensureDefaultProject,
	forkProject,
	getProject,
	getProjectTranscriptionIds,
	getProjectTranscriptionStatus,
	getProjectTranscriptionStatusForOwnedTranscription,
	listProjects,
	listProjectTranscriptionOptions,
	listProjectTranscriptionStatuses,
	listProjectTranscriptionSourceCandidates,
	loadTranscriptionContent,
	addProjectTranscriptionFromProject,
	AddFromProjectUncommittedSourceError,
	AddFromProjectSameProjectError,
	refreshProjectTranscription,
	RefreshDirtyProjectTranscriptionError,
	syncProjectTranscriptionIds as syncProjectTranscriptionIdsRepository,
	updateProjectMetadata,
} from './projects';
import {
	createCommittedCollationCheckpoint,
	createCommittedTranscriptionCheckpoint,
	getTranscriptionCommittedHead,
	listCommittedTranscriptionCheckpoints,
} from './revisions';
import {
	createCommittedTranscriptionCheckpointWithFiles,
	createTranscriptionWithFiles,
	saveWorkingTranscriptionContent,
} from './transcription-files';
import { rebuildIndexFromStore } from './index-rebuild';

let harness: LocalDbTestHarness;
let projectBackend: MemoryStoreBackend;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	projectBackend = new MemoryStoreBackend();
});

afterEach(async () => {
	await harness.destroy();
});

function createProject(
	db: Parameters<typeof createProjectRepository>[0],
	input: Parameters<typeof createProjectRepository>[1],
	storeOptions: Parameters<typeof createProjectRepository>[2] = { backend: projectBackend }
) {
	return createProjectRepository(db, input, storeOptions);
}

async function createTranscription(
	db: Parameters<typeof createTranscriptionRepository>[0],
	input: Parameters<typeof createTranscriptionRepository>[1]
) {
	if (!input.projectId?.trim()) await ensureDefaultProject(db, { backend: projectBackend });
	return createTranscriptionRepository(db, input);
}

function syncProjectTranscriptionIds(
	db: Parameters<typeof syncProjectTranscriptionIdsRepository>[0],
	projectId: Parameters<typeof syncProjectTranscriptionIdsRepository>[1],
	nextIds: Parameters<typeof syncProjectTranscriptionIdsRepository>[2],
	storeOptions: Parameters<typeof syncProjectTranscriptionIdsRepository>[3] = {
		backend: projectBackend,
	}
) {
	return syncProjectTranscriptionIdsRepository(db, projectId, nextIds, storeOptions);
}

async function createCommittedSourceProject(
	storeOptions: Parameters<typeof createProjectRepository>[2] = { backend: projectBackend },
	input: {
		projectId?: string;
		projectName?: string;
		transcriptionId?: string;
		projectTranscriptionId?: string;
		checkpointId?: string;
	} = {}
) {
	const projectId = input.projectId ?? 'project-a';
	const transcriptionId = input.transcriptionId ?? 'tx-1';
	const projectTranscriptionId = input.projectTranscriptionId ?? 'pt-a';
	await createProject(
		harness.db,
		{ id: projectId, storageSlug: projectId, name: input.projectName ?? 'Project A' },
		storeOptions
	);
	await createTranscription(harness.db, {
		...baseTranscription(transcriptionId, '01'),
		projectId,
		projectTranscriptionId,
		document: documentWithVerses(['Romans 1:1']),
	});
	const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
		harness.db,
		{ projectTranscriptionId, checkpointId: input.checkpointId ?? 'src-base' },
		storeOptions
	);
	return { projectId, transcriptionId, projectTranscriptionId, checkpoint };
}

describe('projects repository', () => {
	it('ensures a default project and keeps storage slugs immutable', async () => {
		const storeOptions = { backend: projectBackend };
		const defaultProjectId = await ensureDefaultProject(harness.db, storeOptions);
		const secondDefaultProjectId = await ensureDefaultProject(harness.db, storeOptions);
		const defaultProject = await getProject(harness.db, defaultProjectId);
		const projectId = await createProject(
			harness.db,
			{
				id: 'project-1',
				storageSlug: 'custom-project-slug',
				name: 'Initial Name',
			},
			storeOptions
		);

		await updateProjectMetadata(
			harness.db,
			{ projectId, name: 'Renamed Project' },
			storeOptions
		);

		const renamedProject = await getProject(harness.db, projectId);

		expect(secondDefaultProjectId).toBe(defaultProjectId);
		expect(defaultProject).toMatchObject({
			id: defaultProjectId,
			name: 'Default',
			storageSlug: expect.stringMatching(/^default-[a-z0-9]{8}$/),
		});
		expect(renamedProject).toMatchObject({
			id: 'project-1',
			name: 'Renamed Project',
			storageSlug: 'custom-project-slug',
		});
	});

	it('creates, lists, loads, and updates project metadata/settings', async () => {
		const storeOptions = { backend: projectBackend };
		const projectId = await createProject(
			harness.db,
			{
				id: 'project-1',
				name: '  Romans Collation  ',
				description: ' first pass ',
				collationSettings: { lowercase: true },
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-01T00:00:00.000Z',
			},
			storeOptions
		);

		await updateProjectMetadata(
			harness.db,
			{
				projectId,
				name: 'Romans Final',
				description: ' revised ',
				collationSettings: { segmentation: false },
				updatedAt: '2024-02-01T00:00:00.000Z',
			},
			storeOptions
		);

		const projects = await listProjects(harness.db);
		const project = await getProject(harness.db, projectId);

		expect(projects).toEqual([
			{
				id: 'project-1',
				storageSlug: expect.stringMatching(/^romans-collation-[a-z0-9]{8}$/),
				name: 'Romans Final',
				description: 'revised',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-02-01T00:00:00.000Z',
			},
		]);
		expect(project).toMatchObject({
			id: 'project-1',
			storageSlug: expect.stringMatching(/^romans-collation-[a-z0-9]{8}$/),
			name: 'Romans Final',
			collationSettings: { segmentation: false },
		});
	});

	it('lists transcription options without content and loads content on demand', async () => {
		await createTranscription(harness.db, baseTranscription('tx-2', '02'));
		await createTranscription(harness.db, baseTranscription('tx-1', '01'));
		const defaultProjectLink = await harness.db
			.selectFrom('project_transcriptions')
			.select('project_id')
			.where('transcription_id', '=', 'tx-1')
			.executeTakeFirstOrThrow();

		const options = await listProjectTranscriptionOptions(
			harness.db,
			defaultProjectLink.project_id
		);
		const content = await loadTranscriptionContent(harness.db, 'tx-1');

		expect(options.map(option => option.id)).toEqual(['tx-1', 'tx-2']);
		expect(options[0]).not.toHaveProperty('content_json');
		expect(content).toContain('transcriptionDocument');
	});

	it('canonically copies and tombstones synced project transcriptions across index rebuilds', async () => {
		const backend = projectBackend;
		const storeOptions = { backend };
		await createProject(
			harness.db,
			{ id: 'source-project', storageSlug: 'source-project', name: 'Source' },
			storeOptions
		);
		await createProject(
			harness.db,
			{ id: 'target-project', storageSlug: 'target-project', name: 'Target' },
			storeOptions
		);
		await createTranscriptionWithFiles(
			harness.db,
			{
				...baseTranscription('tx-1', '01'),
				projectId: 'source-project',
				projectTranscriptionId: 'source-pt',
				document: documentWithVerses(['Romans 1:1']),
			},
			storeOptions
		);

		const [copiedId] = await syncProjectTranscriptionIds(
			harness.db,
			'target-project',
			['tx-1', 'tx-1'],
			storeOptions
		);
		const copiedLinkId = await getProjectTranscriptionLinkId(copiedId);
		const copied = await harness.db
			.selectFrom('transcriptions')
			.selectAll()
			.where('id', '=', copiedId)
			.executeTakeFirstOrThrow();
		const primary = await readCanonicalDocument<ProjectTranscriptionPayload>(
			PROJECT_TRANSCRIPTION_FORMAT,
			await readTextFile(
				transcriptionPrimaryFile('target-project', copiedLinkId),
				storeOptions
			)
		);
		const manifest = await readCanonicalDocument<ProjectManifestPayload>(
			PROJECT_MANIFEST_FORMAT,
			await readTextFile(projectManifestFile('target-project'), storeOptions)
		);

		expect(copied).toMatchObject({
			project_id: 'target-project',
			origin_project_id: 'source-project',
			origin_transcription_id: 'tx-1',
			current_revision_id: expect.any(String),
			current_content_hash: expect.stringMatching(/^sha256:/),
		});
		expect(primary).toMatchObject({
			ok: true,
			payload: {
				id: copiedId,
				project_transcription_id: copiedLinkId,
				origin: {
					source_project_id: 'source-project',
					source_transcription_id: 'tx-1',
				},
			},
		});
		expect(manifest).toMatchObject({
			ok: true,
			payload: { transcriptions: [{ project_transcription_id: copiedLinkId }] },
		});
		await expect(
			readTextFile(
				transcriptionCheckpointFile(
					'target-project',
					copiedLinkId,
					copied.current_revision_id
				),
				storeOptions
			)
		).resolves.toContain(copied.current_revision_id);
		await expect(
			readTextFile(transcriptionTeiFile('target-project', copiedLinkId), storeOptions)
		).resolves.toContain('<TEI');
		await rebuildIndexFromStore(harness.db, storeOptions);
		await expect(
			harness.db
				.selectFrom('transcriptions')
				.select([
					'project_id',
					'origin_project_id',
					'origin_transcription_id',
					'current_revision_id',
					'current_content_hash',
				])
				.where('id', '=', copiedId)
				.executeTakeFirst()
		).resolves.toEqual({
			project_id: 'target-project',
			origin_project_id: 'source-project',
			origin_transcription_id: 'tx-1',
			current_revision_id: copied.current_revision_id,
			current_content_hash: copied.current_content_hash,
		});
		expect(await getProjectTranscriptionIds(harness.db, 'target-project')).toEqual([copiedId]);

		await expect(
			syncProjectTranscriptionIds(harness.db, 'target-project', [], storeOptions)
		).resolves.toEqual([]);
		const tombstone = await readCanonicalDocument<TombstonePayload>(
			TOMBSTONE_FORMAT,
			await readTextFile(
				tombstoneFile('target-project', 'project-transcription', copiedLinkId),
				storeOptions
			)
		);
		expect(tombstone).toMatchObject({
			ok: true,
			payload: { project_id: 'target-project', entity_id: copiedLinkId },
		});

		await rebuildIndexFromStore(harness.db, storeOptions);
		expect(await getProjectTranscriptionIds(harness.db, 'source-project')).toEqual(['tx-1']);
		expect(await getProjectTranscriptionIds(harness.db, 'target-project')).toEqual([]);
		await expect(
			harness.db
				.selectFrom('sync_tombstones')
				.select('entity_id')
				.where('entity_id', '=', copiedLinkId)
				.executeTakeFirst()
		).resolves.toEqual({ entity_id: copiedLinkId });
	});

	it('clones transcription provenance, verse indexes, and IIIF rows into project snapshots', async () => {
		await createProject(harness.db, {
			id: 'source-project',
			storageSlug: 'source-project',
			name: 'Source',
		});
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			projectId: 'source-project',
			projectTranscriptionId: 'source-pt',
			document: documentWithVerses(['Romans 1:1']),
		});
		const manifest = await ensureManifestSource(harness.db, {
			transcriptionId: 'tx-1',
			manifestUrl: 'https://example.org/manifest.json',
			label: 'Manifest',
		});
		await upsertPageCanvasLink(harness.db, pageCanvasLinkInput('tx-1', manifest.id));
		await upsertCanvasAnnotation(harness.db, {
			transcriptionId: 'tx-1',
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
		const sourceCheckpoint = await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: 'source-pt', checkpointId: 'rev-1' },
			{ backend: projectBackend }
		);
		await createProject(harness.db, { id: 'project-1', name: 'Project' });

		const [snapshotId] = await syncProjectTranscriptionIds(harness.db, 'project-1', ['tx-1']);

		const snapshot = await harness.db
			.selectFrom('transcriptions')
			.selectAll()
			.where('id', '=', snapshotId)
			.executeTakeFirstOrThrow();
		const projectRows = await harness.db
			.selectFrom('project_transcriptions')
			.selectAll()
			.where('project_id', '=', 'project-1')
			.execute();
		const verseRows = await harness.db
			.selectFrom('transcription_verse_index')
			.selectAll()
			.where('transcription_id', '=', snapshotId)
			.execute();
		const manifestRows = await harness.db
			.selectFrom('iiif_manifest_sources')
			.selectAll()
			.where('transcription_id', '=', snapshotId)
			.execute();
		const pageRows = await harness.db
			.selectFrom('transcription_page_canvas_links')
			.selectAll()
			.where('transcription_id', '=', snapshotId)
			.execute();
		const annotationRows = await harness.db
			.selectFrom('iiif_canvas_annotations')
			.selectAll()
			.where('transcription_id', '=', snapshotId)
			.execute();
		const projectOptions = await listProjectTranscriptionOptions(harness.db, 'project-1');
		const source = await harness.db
			.selectFrom('transcriptions')
			.select('project_id')
			.where('id', '=', 'tx-1')
			.executeTakeFirstOrThrow();

		expect(snapshot).toMatchObject({
			project_id: 'project-1',
			origin_type: 'project_snapshot',
			origin_project_id: source.project_id,
			origin_transcription_id: 'tx-1',
			origin_revision_id: 'rev-1',
			origin_content_hash: sourceCheckpoint.contentHash,
			current_revision_id: expect.any(String),
			current_content_hash: expect.stringMatching(/^sha256:/),
		});
		expect(projectRows[0]).toMatchObject({
			project_id: 'project-1',
			transcription_id: snapshotId,
			canonical_transcription_id: null,
		});
		expect(verseRows.map(row => row.verse_identifier)).toEqual(['Romans 1:1']);
		expect(manifestRows).toHaveLength(1);
		expect(manifestRows[0].id).not.toBe(manifest.id);
		expect(pageRows).toHaveLength(1);
		expect(pageRows[0].manifest_source_id).toBe(manifestRows[0].id);
		expect(annotationRows).toHaveLength(1);
		expect(annotationRows[0].manifest_source_id).toBe(manifestRows[0].id);
		expect(projectOptions.map(option => option.id)).toEqual([snapshotId]);
	});

	it('edits project snapshots without mutating the canonical transcription', async () => {
		await createCommittedSourceProject();
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		const [snapshotId] = await syncProjectTranscriptionIds(harness.db, 'project-1', ['tx-1']);

		await updateTranscriptionContent(harness.db, {
			id: snapshotId,
			document: documentWithVerses(['Romans 1:2']),
			updatedAt: '2024-03-01T00:00:00.000Z',
		});

		const canonicalContent = await loadTranscriptionContent(harness.db, 'tx-1');
		const snapshotContent = await loadTranscriptionContent(harness.db, snapshotId);
		const canonicalVerseRows = await harness.db
			.selectFrom('transcription_verse_index')
			.select('verse_identifier')
			.where('transcription_id', '=', 'tx-1')
			.execute();
		const snapshotVerseRows = await harness.db
			.selectFrom('transcription_verse_index')
			.select('verse_identifier')
			.where('transcription_id', '=', snapshotId)
			.execute();

		expect(snapshotContent).not.toBe(canonicalContent);
		expect(canonicalVerseRows.map(row => row.verse_identifier)).toEqual(['Romans 1:1']);
		expect(snapshotVerseRows.map(row => row.verse_identifier)).toEqual(['Romans 1:2']);
	});

	it('reports project transcription status identities and dirty checkpoint state', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			projectId: 'project-1',
			projectTranscriptionId: 'pt-1',
			document: documentWithVerses(['Romans 1:1']),
		});
		const snapshotId = 'tx-1';
		const projectTranscriptionId = 'pt-1';

		const [initialStatus] = await listProjectTranscriptionStatuses(harness.db, 'project-1');
		const statusByOwnedTranscriptionId =
			await getProjectTranscriptionStatusForOwnedTranscription(harness.db, snapshotId);

		expect(initialStatus).toMatchObject({
			projectId: 'project-1',
			projectTranscriptionId,
			projectOwnedTranscriptionId: snapshotId,
			siglum: '01',
			title: 'Witness 01',
			isProjectOwned: true,
			currentCheckpoint: null,
			dirtyToCheckpoint: true,
			commitState: 'never-committed',
			sourceState: { kind: 'no-source' },
		});
		expect(statusByOwnedTranscriptionId).toMatchObject({
			projectId: 'project-1',
			projectTranscriptionId,
			projectOwnedTranscriptionId: snapshotId,
		});
		expect(initialStatus.workingContentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
		await expect(
			getProjectTranscriptionStatusForOwnedTranscription(harness.db, 'tx-1')
		).resolves.toMatchObject({
			projectOwnedTranscriptionId: 'tx-1',
			isProjectOwned: true,
		});

		const checkpoint = await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId,
			checkpointId: 'tx-cp-1',
		});
		const cleanStatus = await getProjectTranscriptionStatus(harness.db, projectTranscriptionId);

		expect(cleanStatus).toMatchObject({
			currentCheckpoint: { revisionId: 'tx-cp-1', contentHash: checkpoint.contentHash },
			workingContentHash: checkpoint.contentHash,
			dirtyToCheckpoint: false,
			commitState: 'clean',
		});

		const syncContext = await createSyncContext();
		await harness.db
			.insertInto('cloud_sync_metadata')
			.values({
				connection_id: syncContext.connectionId,
				scope_type: 'project',
				scope_id: syncContext.projectId,
				entity_type: 'project-transcription',
				entity_id: projectTranscriptionId,
				cloud_file_id: 'file-pt-1',
				cloud_file_revision: 'rev-1',
				cloud_path: `transcriptions/${projectTranscriptionId}.json`,
				last_synced_revision: checkpoint.id,
				last_synced_hash: checkpoint.contentHash,
				last_synced_at: '2026-06-10T12:10:00.000Z',
			})
			.execute();
		await expect(
			getProjectTranscriptionStatus(harness.db, projectTranscriptionId, { syncContext })
		).resolves.toMatchObject({
			cloudBackupState: {
				status: 'backed-up',
				lastSyncedRevision: 'tx-cp-1',
				lastSyncedHash: checkpoint.contentHash,
				cloudPath: `transcriptions/${projectTranscriptionId}.json`,
			},
		});

		await updateTranscriptionContent(harness.db, {
			id: snapshotId,
			document: documentWithVerses(['Romans 1:2']),
		});
		const dirtyStatus = await getProjectTranscriptionStatus(
			harness.db,
			projectTranscriptionId,
			{
				syncContext,
			}
		);

		expect(dirtyStatus).toMatchObject({
			currentCheckpoint: { revisionId: 'tx-cp-1', contentHash: checkpoint.contentHash },
			dirtyToCheckpoint: true,
			commitState: 'dirty',
			cloudBackupState: { status: 'uncommitted-local-changes' },
		});
		expect(dirtyStatus.workingContentHash).not.toBe(checkpoint.contentHash);
	});

	it('reports project transcription committed source availability', async () => {
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		const sourceProjectTranscriptionId = await getProjectTranscriptionLinkId('tx-1');
		const sourceCheckpoint = await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId: sourceProjectTranscriptionId,
				checkpointId: 'source-rev-1',
			},
			{ backend: projectBackend }
		);
		const sourceProject = await harness.db
			.selectFrom('transcriptions')
			.select('project_id')
			.where('id', '=', 'tx-1')
			.executeTakeFirstOrThrow();
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		const [snapshotId] = await syncProjectTranscriptionIds(harness.db, 'project-1', ['tx-1']);
		const projectTranscriptionId = await getProjectTranscriptionLinkId(snapshotId);

		const upToDateStatus = await getProjectTranscriptionStatus(
			harness.db,
			projectTranscriptionId
		);

		expect(upToDateStatus.canonicalSource).toBeNull();
		expect(upToDateStatus.immediateSource).toMatchObject({
			sourceType: 'project_snapshot',
			sourceProjectId: sourceProject.project_id,
			sourceTranscriptionId: 'tx-1',
			sourceRevisionId: 'source-rev-1',
			sourceContentHash: sourceCheckpoint.contentHash,
		});
		expect(upToDateStatus.sourceState).toEqual({
			kind: 'up-to-date',
			sourceTranscriptionId: 'tx-1',
			sourceRevisionId: 'source-rev-1',
			sourceContentHash: sourceCheckpoint.contentHash,
		});

		await updateTranscriptionContent(harness.db, {
			id: 'tx-1',
			document: documentWithVerses(['Romans 1:2']),
		});
		const newerSourceCheckpoint = await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId: sourceProjectTranscriptionId,
				checkpointId: 'source-rev-2',
			},
			{ backend: projectBackend }
		);
		expect(
			(await getProjectTranscriptionStatus(harness.db, projectTranscriptionId)).sourceState
		).toEqual({
			kind: 'newer-source-available',
			sourceTranscriptionId: 'tx-1',
			sourceRevisionId: 'source-rev-2',
			sourceContentHash: newerSourceCheckpoint.contentHash,
		});

		await harness.db.deleteFrom('transcriptions').where('id', '=', 'tx-1').execute();
		expect(
			(await getProjectTranscriptionStatus(harness.db, projectTranscriptionId)).sourceState
		).toEqual({
			kind: 'source-missing',
			sourceTranscriptionId: 'tx-1',
		});
	});

	it('refreshes a project transcription from a committed source checkpoint while preserving the link id', async () => {
		const storeOptions = { backend: projectBackend };
		await createCommittedSourceProject(storeOptions);
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const snapshotAId = 'tx-1';
		const projectTranscriptionAId = 'pt-a';
		const [snapshotBId] = await syncProjectTranscriptionIds(
			harness.db,
			'project-b',
			['tx-1'],
			storeOptions
		);
		const projectTranscriptionBId = await getProjectTranscriptionLinkId(snapshotBId);

		await updateTranscriptionContent(harness.db, {
			id: snapshotAId,
			document: documentWithVerses(['Romans 1:2']),
			updatedAt: '2026-06-20T10:00:00.000Z',
		});
		const sourceCheckpoint = await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId: projectTranscriptionAId,
				checkpointId: 'src-cp-1',
				createdAt: '2026-06-20T11:00:00.000Z',
			},
			storeOptions
		);

		const committedCheckpoints = await listCommittedTranscriptionCheckpoints(
			harness.db,
			snapshotAId
		);

		const refreshed = await refreshProjectTranscription(
			harness.db,
			{
				projectTranscriptionId: projectTranscriptionBId,
				sourceTranscriptionId: snapshotAId,
				sourceCheckpointId: 'src-cp-1',
				allowReplaceDirty: true,
				updatedAt: '2026-06-20T12:00:00.000Z',
			},
			{ storeOptions }
		);

		const refreshedRow = await harness.db
			.selectFrom('transcriptions')
			.selectAll()
			.where('id', '=', snapshotBId)
			.executeTakeFirstOrThrow();
		const refreshedVerseRows = await harness.db
			.selectFrom('transcription_verse_index')
			.select('verse_identifier')
			.where('transcription_id', '=', snapshotBId)
			.execute();
		const sourceRow = await harness.db
			.selectFrom('transcriptions')
			.select(['content_json'])
			.where('id', '=', snapshotAId)
			.executeTakeFirstOrThrow();
		const sourceVerseRows = await harness.db
			.selectFrom('transcription_verse_index')
			.select('verse_identifier')
			.where('transcription_id', '=', snapshotAId)
			.execute();
		const linkRows = await harness.db
			.selectFrom('project_transcriptions')
			.selectAll()
			.where('id', '=', projectTranscriptionBId)
			.execute();

		expect(committedCheckpoints.map(row => row.id)).toEqual(['src-base', 'src-cp-1']);
		expect(refreshed.projectTranscriptionId).toBe(projectTranscriptionBId);
		expect(refreshed.projectOwnedTranscriptionId).toBe(snapshotBId);
		expect(refreshed.commitState).toBe('clean');
		expect(refreshed.currentCheckpoint?.revisionId).toBeTruthy();
		expect(refreshedVerseRows.map(row => row.verse_identifier)).toEqual(['Romans 1:2']);
		expect(refreshedRow).toMatchObject({
			id: snapshotBId,
			project_id: 'project-b',
			origin_type: 'project_snapshot',
			origin_project_id: 'project-a',
			origin_transcription_id: snapshotAId,
			origin_revision_id: 'src-cp-1',
			origin_content_hash: sourceCheckpoint.contentHash,
			current_revision_id: refreshed.currentCheckpoint?.revisionId,
			current_content_hash: refreshed.currentCheckpoint?.contentHash,
			updated_at: '2026-06-20T12:00:00.000Z',
		});
		expect(refreshedRow.content_json).not.toBe('');
		expect(JSON.parse(refreshedRow.content_json)).toEqual(JSON.parse(sourceRow.content_json));
		expect(linkRows).toHaveLength(1);
		expect(linkRows[0]).toMatchObject({
			id: projectTranscriptionBId,
			project_id: 'project-b',
			transcription_id: snapshotBId,
		});
		expect(sourceVerseRows.map(row => row.verse_identifier)).toEqual(['Romans 1:2']);
		const targetProject = await getProject(harness.db, 'project-b');
		if (!targetProject || !refreshed.currentCheckpoint)
			throw new Error('missing refresh files');
		await expect(
			readTextFile(
				transcriptionCheckpointFile(
					targetProject.storageSlug,
					projectTranscriptionBId,
					refreshed.currentCheckpoint.revisionId
				),
				storeOptions
			)
		).resolves.toContain('Refresh from source');
		await expect(
			readTextFile(
				transcriptionPrimaryFile(targetProject.storageSlug, projectTranscriptionBId),
				storeOptions
			)
		).resolves.toContain(refreshed.currentCheckpoint.revisionId);
		await expect(
			readTextFile(
				transcriptionTeiFile(targetProject.storageSlug, projectTranscriptionBId),
				storeOptions
			)
		).resolves.toContain('<TEI');
		await expect(
			readTextFile(projectManifestFile(targetProject.storageSlug), storeOptions)
		).resolves.toContain(refreshed.currentCheckpoint.revisionId);
	});

	it('does not alter other project transcriptions or collation witnesses during refresh', async () => {
		const storeOptions = { backend: projectBackend };
		await createCommittedSourceProject(storeOptions);
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const snapshotAId = 'tx-1';
		const projectTranscriptionAId = 'pt-a';
		const [snapshotBId] = await syncProjectTranscriptionIds(
			harness.db,
			'project-b',
			['tx-1'],
			storeOptions
		);
		const projectTranscriptionBId = await getProjectTranscriptionLinkId(snapshotBId);

		await updateTranscriptionContent(harness.db, {
			id: snapshotAId,
			document: documentWithVerses(['Romans 1:2']),
		});
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId: projectTranscriptionAId,
				checkpointId: 'src-cp-1',
			},
			storeOptions
		);

		await createCollation(harness.db, {
			id: 'col-b',
			projectId: 'project-b',
			title: 'Romans 1',
			verseIdentifier: 'Romans 1',
			now: '2026-06-20T09:00:00.000Z',
		});
		await harness.db
			.insertInto('collation_witnesses')
			.values({
				id: 'witness-b',
				collation_id: 'col-b',
				witness_id: 'B',
				content: 'in principio',
				position: 0,
				project_transcription_id: projectTranscriptionBId,
				transcription_id: snapshotBId,
				source_revision_id: 'pinned-rev',
				source_content_hash: 'sha256:pinned',
			})
			.execute();

		await refreshProjectTranscription(
			harness.db,
			{
				projectTranscriptionId: projectTranscriptionBId,
				sourceTranscriptionId: snapshotAId,
				sourceCheckpointId: 'src-cp-1',
				allowReplaceDirty: true,
			},
			{ storeOptions }
		);

		const sourceContent = await loadTranscriptionContent(harness.db, snapshotAId);
		const sourceVerseRows = await harness.db
			.selectFrom('transcription_verse_index')
			.select('verse_identifier')
			.where('transcription_id', '=', snapshotAId)
			.execute();
		const witnessRows = await harness.db
			.selectFrom('collation_witnesses')
			.selectAll()
			.where('collation_id', '=', 'col-b')
			.execute();
		const otherProjectStatus = await getProjectTranscriptionStatus(
			harness.db,
			projectTranscriptionAId
		);

		expect(sourceContent).not.toContain('Romans 1:1');
		expect(sourceVerseRows.map(row => row.verse_identifier)).toEqual(['Romans 1:2']);
		expect(otherProjectStatus.projectOwnedTranscriptionId).toBe(snapshotAId);
		expect(otherProjectStatus.commitState).toBe('clean');
		expect(witnessRows).toHaveLength(1);
		expect(witnessRows[0]).toMatchObject({
			project_transcription_id: projectTranscriptionBId,
			transcription_id: snapshotBId,
			source_revision_id: 'pinned-rev',
			source_content_hash: 'sha256:pinned',
		});
	});

	it('blocks refresh when the target project transcription is dirty without confirmation', async () => {
		const storeOptions = { backend: projectBackend };
		await createCommittedSourceProject(storeOptions);
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const snapshotAId = 'tx-1';
		const projectTranscriptionAId = 'pt-a';
		const [snapshotBId] = await syncProjectTranscriptionIds(
			harness.db,
			'project-b',
			['tx-1'],
			storeOptions
		);
		const projectTranscriptionBId = await getProjectTranscriptionLinkId(snapshotBId);

		await updateTranscriptionContent(harness.db, {
			id: snapshotAId,
			document: documentWithVerses(['Romans 1:2']),
		});
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId: projectTranscriptionAId,
				checkpointId: 'src-cp-1',
			},
			storeOptions
		);
		await saveWorkingTranscriptionContent(
			harness.db,
			{
				id: snapshotBId,
				document: documentWithVerses(['Romans 1:9']),
			},
			storeOptions
		);

		await expect(
			refreshProjectTranscription(
				harness.db,
				{
					projectTranscriptionId: projectTranscriptionBId,
					sourceTranscriptionId: snapshotAId,
					sourceCheckpointId: 'src-cp-1',
				},
				{ storeOptions }
			)
		).rejects.toBeInstanceOf(RefreshDirtyProjectTranscriptionError);

		const refreshedWithConfirmation = await refreshProjectTranscription(
			harness.db,
			{
				projectTranscriptionId: projectTranscriptionBId,
				sourceTranscriptionId: snapshotAId,
				sourceCheckpointId: 'src-cp-1',
				allowReplaceDirty: true,
			},
			{ storeOptions }
		);

		expect(refreshedWithConfirmation.commitState).toBe('dirty');
		expect(refreshedWithConfirmation.currentCheckpoint?.revisionId).toBeTruthy();
		expect(refreshedWithConfirmation.sourceState.kind).toBe('up-to-date');
	});

	it('blocks refresh when the source checkpoint is missing or not the current committed head', async () => {
		const storeOptions = { backend: projectBackend };
		await createCommittedSourceProject(storeOptions);
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const snapshotAId = 'tx-1';
		const projectTranscriptionAId = 'pt-a';
		const [snapshotBId] = await syncProjectTranscriptionIds(
			harness.db,
			'project-b',
			['tx-1'],
			storeOptions
		);
		const projectTranscriptionBId = await getProjectTranscriptionLinkId(snapshotBId);

		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId: projectTranscriptionAId,
				checkpointId: 'src-cp-1',
				createdAt: '2026-06-20T10:00:00.000Z',
			},
			storeOptions
		);
		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscriptionBId,
			checkpointId: 'target-cp-1',
			createdAt: '2026-06-20T10:05:00.000Z',
		});
		await updateTranscriptionContent(harness.db, {
			id: snapshotAId,
			document: documentWithVerses(['Romans 1:3']),
		});
		await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId: projectTranscriptionAId,
				checkpointId: 'src-cp-2',
				createdAt: '2026-06-20T11:00:00.000Z',
			},
			storeOptions
		);

		await expect(
			refreshProjectTranscription(
				harness.db,
				{
					projectTranscriptionId: projectTranscriptionBId,
					sourceTranscriptionId: snapshotAId,
					sourceCheckpointId: 'missing-cp',
				},
				{ storeOptions }
			)
		).rejects.toThrow(/was not found/);

		await expect(
			refreshProjectTranscription(
				harness.db,
				{
					projectTranscriptionId: projectTranscriptionBId,
					sourceTranscriptionId: snapshotAId,
					sourceCheckpointId: 'src-cp-1',
				},
				{ storeOptions }
			)
		).rejects.toThrow(/not the current committed head/);

		const refreshed = await refreshProjectTranscription(
			harness.db,
			{
				projectTranscriptionId: projectTranscriptionBId,
				sourceTranscriptionId: snapshotAId,
				sourceCheckpointId: 'src-cp-2',
			},
			{ storeOptions }
		);

		const refreshedVerseRows = await harness.db
			.selectFrom('transcription_verse_index')
			.select('verse_identifier')
			.where('transcription_id', '=', snapshotBId)
			.execute();

		expect(refreshedVerseRows.map(row => row.verse_identifier)).toEqual(['Romans 1:3']);
		expect(refreshed.immediateSource?.sourceRevisionId).toBe('src-cp-2');
		expect(refreshed.currentCheckpoint?.revisionId).not.toBe('target-cp-1');
		expect(refreshed.commitState).toBe('clean');
	});

	it('does not write files or checkpoints when refresh source is already current', async () => {
		const backend = projectBackend;
		const storeOptions = { backend };
		await createCommittedSourceProject(storeOptions, { checkpointId: 'src-cp-1' });
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const snapshotAId = 'tx-1';
		const projectTranscriptionAId = 'pt-a';
		const copied = await addProjectTranscriptionFromProject(
			harness.db,
			{
				targetProjectId: 'project-b',
				sourceProjectTranscriptionId: projectTranscriptionAId,
			},
			{ storeOptions }
		);
		const copiedHead = await getTranscriptionCommittedHead(
			harness.db,
			copied.projectOwnedTranscriptionId
		);
		const fileSnapshot = new Map(backend.files);
		const checkpointRowsBefore = await harness.db
			.selectFrom('transcription_checkpoints')
			.select(['id'])
			.where('transcription_id', '=', copied.projectOwnedTranscriptionId)
			.execute();

		const refreshed = await refreshProjectTranscription(
			harness.db,
			{
				projectTranscriptionId: copied.projectTranscriptionId,
				sourceTranscriptionId: snapshotAId,
				sourceCheckpointId: 'src-cp-1',
			},
			{ storeOptions }
		);

		const checkpointRowsAfter = await harness.db
			.selectFrom('transcription_checkpoints')
			.select(['id'])
			.where('transcription_id', '=', copied.projectOwnedTranscriptionId)
			.execute();
		expect(refreshed.currentCheckpoint?.revisionId).toBe(copiedHead?.revisionId);
		expect(checkpointRowsAfter).toEqual(checkpointRowsBefore);
		expect(backend.files).toEqual(fileSnapshot);
	});

	it('adds a committed transcription from another project into the current project with origin metadata', async () => {
		const storeOptions = { backend: projectBackend };
		await createCommittedSourceProject(storeOptions);
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const snapshotAId = 'tx-1';
		const projectTranscriptionAId = 'pt-a';

		await updateTranscriptionContent(harness.db, {
			id: snapshotAId,
			document: documentWithVerses(['Romans 1:2']),
			updatedAt: '2026-06-20T10:00:00.000Z',
		});
		const sourceCheckpoint = await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{
				projectTranscriptionId: projectTranscriptionAId,
				checkpointId: 'src-cp-1',
				createdAt: '2026-06-20T11:00:00.000Z',
			},
			storeOptions
		);

		const result = await addProjectTranscriptionFromProject(
			harness.db,
			{
				targetProjectId: 'project-b',
				sourceProjectTranscriptionId: projectTranscriptionAId,
				createdAt: '2026-06-20T12:00:00.000Z',
			},
			{ storeOptions }
		);

		const targetRow = await harness.db
			.selectFrom('transcriptions')
			.selectAll()
			.where('id', '=', result.projectOwnedTranscriptionId)
			.executeTakeFirstOrThrow();
		const targetVerseRows = await harness.db
			.selectFrom('transcription_verse_index')
			.select('verse_identifier')
			.where('transcription_id', '=', result.projectOwnedTranscriptionId)
			.execute();
		const linkRows = await harness.db
			.selectFrom('project_transcriptions')
			.selectAll()
			.where('id', '=', result.projectTranscriptionId)
			.execute();
		const sourceRow = await harness.db
			.selectFrom('transcriptions')
			.select(['content_json', 'current_revision_id', 'current_content_hash'])
			.where('id', '=', snapshotAId)
			.executeTakeFirstOrThrow();
		const sourceVerseRows = await harness.db
			.selectFrom('transcription_verse_index')
			.select('verse_identifier')
			.where('transcription_id', '=', snapshotAId)
			.execute();
		const sourceLinkCount = await harness.db
			.selectFrom('project_transcriptions')
			.select('id')
			.where('project_id', '=', 'project-a')
			.execute();

		expect(result.projectOwnedTranscriptionId).not.toBe(snapshotAId);
		expect(result.projectTranscriptionId).not.toBe(projectTranscriptionAId);
		expect(targetRow).toMatchObject({
			project_id: 'project-b',
			origin_type: 'project_snapshot',
			origin_project_id: 'project-a',
			origin_transcription_id: snapshotAId,
			origin_revision_id: 'src-cp-1',
			origin_content_hash: sourceCheckpoint.contentHash,
			current_revision_id: expect.any(String),
			current_content_hash: expect.stringMatching(/^sha256:/),
		});
		expect(JSON.parse(targetRow.content_json)).toEqual(JSON.parse(sourceRow.content_json));
		expect(targetVerseRows.map(row => row.verse_identifier)).toEqual(['Romans 1:2']);
		expect(linkRows).toHaveLength(1);
		expect(linkRows[0]).toMatchObject({
			id: result.projectTranscriptionId,
			project_id: 'project-b',
			transcription_id: result.projectOwnedTranscriptionId,
			canonical_transcription_id: null,
		});
		expect(sourceRow.current_revision_id).toBe('src-cp-1');
		expect(sourceVerseRows.map(row => row.verse_identifier)).toEqual(['Romans 1:2']);
		expect(sourceLinkCount).toHaveLength(1);
		const targetProject = await getProject(harness.db, 'project-b');
		if (!targetProject) throw new Error('target project was not found');
		const historyRaw = await readTextFile(
			transcriptionCheckpointFile(
				targetProject.storageSlug,
				result.projectTranscriptionId,
				targetRow.current_revision_id
			),
			storeOptions
		);
		const primaryRaw = await readTextFile(
			transcriptionPrimaryFile(targetProject.storageSlug, result.projectTranscriptionId),
			storeOptions
		);
		const manifestRaw = await readTextFile(
			projectManifestFile(targetProject.storageSlug),
			storeOptions
		);
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
		expect(history).toMatchObject({
			ok: true,
			payload: {
				checkpoint_id: targetRow.current_revision_id,
				entity_id: result.projectTranscriptionId,
			},
		});
		expect(primary).toMatchObject({
			ok: true,
			payload: {
				project_transcription_id: result.projectTranscriptionId,
				id: result.projectOwnedTranscriptionId,
				origin: {
					source_project_id: 'project-a',
					source_transcription_id: snapshotAId,
					source_revision_id: 'src-cp-1',
					source_content_hash: sourceCheckpoint.contentHash,
				},
			},
		});
		expect(manifest).toMatchObject({
			ok: true,
			payload: {
				transcriptions: [
					{
						project_transcription_id: result.projectTranscriptionId,
						current_revision: {
							id: targetRow.current_revision_id,
							content_hash: targetRow.current_content_hash,
						},
					},
				],
			},
		});
		await expect(
			readTextFile(
				transcriptionTeiFile(targetProject.storageSlug, result.projectTranscriptionId),
				storeOptions
			)
		).resolves.toContain('<TEI');
	});

	it('does not mutate the source project during add-from-project', async () => {
		const storeOptions = { backend: projectBackend };
		await createCommittedSourceProject(storeOptions, { checkpointId: 'src-cp-1' });
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const snapshotAId = 'tx-1';
		const projectTranscriptionAId = 'pt-a';

		await addProjectTranscriptionFromProject(
			harness.db,
			{
				targetProjectId: 'project-b',
				sourceProjectTranscriptionId: projectTranscriptionAId,
			},
			{ storeOptions }
		);

		const sourceStatus = await getProjectTranscriptionStatus(
			harness.db,
			projectTranscriptionAId
		);
		const targetIds = await getProjectTranscriptionIds(harness.db, 'project-b');
		const sourceIds = await getProjectTranscriptionIds(harness.db, 'project-a');

		expect(sourceStatus.commitState).toBe('clean');
		expect(sourceStatus.projectOwnedTranscriptionId).toBe(snapshotAId);
		expect(sourceIds).toEqual([snapshotAId]);
		expect(targetIds).toHaveLength(1);
		expect(targetIds).not.toContain(snapshotAId);
	});

	it('blocks add-from-project when the source is uncommitted', async () => {
		const storeOptions = { backend: projectBackend };
		await createProject(harness.db, { id: 'project-a', name: 'Project A' });
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			projectId: 'project-a',
			projectTranscriptionId: 'pt-a',
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		await expect(
			addProjectTranscriptionFromProject(
				harness.db,
				{
					targetProjectId: 'project-b',
					sourceProjectTranscriptionId: 'pt-a',
				},
				{ storeOptions }
			)
		).rejects.toBeInstanceOf(AddFromProjectUncommittedSourceError);

		expect(await getProjectTranscriptionIds(harness.db, 'project-b')).toEqual([]);
	});

	it('blocks add-from-project when the source is in the same project', async () => {
		const storeOptions = { backend: projectBackend };
		await createProject(harness.db, { id: 'project-a', name: 'Project A' });
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			projectId: 'project-a',
			projectTranscriptionId: 'pt-a',
			document: documentWithVerses(['Romans 1:1']),
		});

		await expect(
			addProjectTranscriptionFromProject(
				harness.db,
				{
					targetProjectId: 'project-a',
					sourceProjectTranscriptionId: 'pt-a',
				},
				{ storeOptions }
			)
		).rejects.toBeInstanceOf(AddFromProjectSameProjectError);
	});

	it('forks a project into a new independent project with project data', async () => {
		const backend = projectBackend;
		const storeOptions = { backend, nonce: () => crypto.randomUUID() };
		await createProject(
			harness.db,
			{
				id: 'project-a',
				storageSlug: 'project-a',
				name: 'Project A',
				description: 'Source project',
			},
			storeOptions
		);
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			projectId: 'project-a',
			projectTranscriptionId: 'pt-a',
			document: documentWithVerses(['Romans 1:1']),
		});
		const snapshotAId = 'tx-1';
		const projectTranscriptionAId = 'pt-a';
		const sourceCheckpoint = await createCommittedTranscriptionCheckpointWithFiles(
			harness.db,
			{ projectTranscriptionId: projectTranscriptionAId, checkpointId: 'src-cp-1' },
			storeOptions
		);
		await createCollationWithFiles(
			harness.db,
			{
				id: 'col-a',
				projectId: 'project-a',
				title: 'Romans 1:1',
				verseIdentifier: 'Romans 1:1',
			},
			storeOptions
		);
		await saveWorkingCollationArtifact(
			harness.db,
			{
				collationId: 'col-a',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify({
					...COLLATION_FIXTURE.document,
					meta: {
						collationId: 'col-a',
						projectId: 'project-a',
						projectName: 'Project A',
					},
					setup: {
						...COLLATION_FIXTURE.document.setup,
						witnesses: [
							{
								type: 'witness',
								id: 'A',
								siglum: 'A',
								transcriptionId: snapshotAId,
								sourceVersion: 'src-cp-1',
								sourceContentHash: sourceCheckpoint.contentHash,
								content: 'in principio',
								treatment: 'full',
								isBaseText: true,
								isExcluded: false,
								overridesDefault: false,
								sourceTokens: [],
							},
						],
					},
				}),
				now: '2026-06-20T10:00:00.000Z',
			},
			storeOptions
		);
		const collationCheckpoint = await createCommittedCollationCheckpointWithFiles(
			harness.db,
			{
				collationId: 'col-a',
				checkpointId: 'col-cp-1',
				createdAt: '2026-06-20T10:00:00.000Z',
			},
			storeOptions
		);

		const fork = await forkProject(
			harness.db,
			{
				sourceProjectId: 'project-a',
				createdAt: '2026-06-20T12:00:00.000Z',
			},
			storeOptions
		);

		const forkedProject = await getProject(harness.db, fork.projectId);
		const forkedTranscription = await harness.db
			.selectFrom('transcriptions')
			.selectAll()
			.where('id', '=', fork.projectOwnedTranscriptionIds[0]!)
			.executeTakeFirstOrThrow();
		const forkedLink = await harness.db
			.selectFrom('project_transcriptions')
			.selectAll()
			.where('id', '=', fork.projectTranscriptionIds[0]!)
			.executeTakeFirstOrThrow();
		const forkedTranscriptionCheckpoints = await harness.db
			.selectFrom('transcription_checkpoints')
			.selectAll()
			.where('transcription_id', '=', fork.projectOwnedTranscriptionIds[0]!)
			.execute();
		const forkedCollation = await harness.db
			.selectFrom('collations')
			.selectAll()
			.where('id', '=', fork.collationIds[0]!)
			.executeTakeFirstOrThrow();
		const forkedWitness = await harness.db
			.selectFrom('collation_witnesses')
			.selectAll()
			.where('collation_id', '=', fork.collationIds[0]!)
			.executeTakeFirstOrThrow();
		const sourceFolderLinks = await harness.db
			.selectFrom('cloud_project_folders')
			.selectAll()
			.where('project_id', '=', fork.projectId)
			.execute();

		expect(forkedProject).toMatchObject({
			name: 'Project A Fork',
			description: 'Source project',
		});
		expect(fork.projectId).not.toBe('project-a');
		expect(fork.projectTranscriptionIds).toHaveLength(1);
		expect(fork.projectOwnedTranscriptionIds).toHaveLength(1);
		expect(fork.collationIds).toHaveLength(1);
		expect(forkedTranscription).toMatchObject({
			project_id: fork.projectId,
			origin_type: '',
			origin_project_id: null,
			origin_transcription_id: null,
			current_content_hash: expect.stringMatching(/^sha256:/),
		});
		expect(forkedTranscription.current_content_hash).not.toBe(sourceCheckpoint.contentHash);
		expect(forkedTranscription.current_revision_id).not.toBe('src-cp-1');
		expect(forkedLink).toMatchObject({
			project_id: fork.projectId,
			transcription_id: fork.projectOwnedTranscriptionIds[0],
		});
		expect(forkedTranscriptionCheckpoints).toHaveLength(1);
		expect(forkedTranscriptionCheckpoints[0]).toMatchObject({
			content_hash: forkedTranscription.current_content_hash,
			is_committed: 1,
		});
		expect(forkedCollation).toMatchObject({
			project_id: fork.projectId,
			current_content_hash: expect.stringMatching(/^sha256:/),
		});
		expect(forkedCollation.current_content_hash).not.toBe(collationCheckpoint.contentHash);
		expect(forkedCollation.current_revision_id).not.toBe('col-cp-1');
		expect(forkedWitness).toMatchObject({
			project_transcription_id: fork.projectTranscriptionIds[0],
			transcription_id: fork.projectOwnedTranscriptionIds[0],
			source_content_hash: forkedTranscription.current_content_hash,
		});
		expect(forkedWitness.source_revision_id).not.toBe('src-cp-1');
		expect(forkedWitness.source_revision_id).toBe(forkedTranscription.current_revision_id);
		expect(sourceFolderLinks).toHaveLength(0);

		const forkManifest = await readCanonicalDocument<ProjectManifestPayload>(
			PROJECT_MANIFEST_FORMAT,
			await readTextFile(projectManifestFile(forkedProject!.storageSlug), storeOptions)
		);
		expect(forkManifest).toMatchObject({
			ok: true,
			payload: {
				id: fork.projectId,
				forked_from: {
					source_project_id: 'project-a',
					source_manifest_content_hash: expect.stringMatching(/^sha256:/),
					source_manifest_schema_version: 2,
				},
			},
		});
		const forkCollation = await readCanonicalDocument(
			COLLATION_FORMAT,
			await readTextFile(
				collationPrimaryFile(forkedProject!.storageSlug, fork.collationIds[0]!),
				storeOptions
			)
		);
		expect(forkCollation).toMatchObject({
			ok: true,
			payload: {
				id: fork.collationIds[0],
				project_id: fork.projectId,
				document: {
					meta: { collationId: fork.collationIds[0], projectId: fork.projectId },
				},
			},
		});
		const forkTranscription = await readCanonicalDocument<ProjectTranscriptionPayload>(
			PROJECT_TRANSCRIPTION_FORMAT,
			await readTextFile(
				transcriptionPrimaryFile(
					forkedProject!.storageSlug,
					fork.projectTranscriptionIds[0]!
				),
				storeOptions
			)
		);
		expect(forkTranscription).toMatchObject({
			ok: true,
			payload: {
				id: fork.projectOwnedTranscriptionIds[0],
				project_transcription_id: fork.projectTranscriptionIds[0],
				origin: {
					source_type: '',
					source_project_id: null,
					source_transcription_id: null,
				},
			},
		});
		await expect(
			readTextFile(
				transcriptionTeiFile(forkedProject!.storageSlug, fork.projectTranscriptionIds[0]!),
				storeOptions
			)
		).resolves.toContain('<TEI');
		await expect(
			readTextFile(
				collationTeiFile(forkedProject!.storageSlug, fork.collationIds[0]!),
				storeOptions
			)
		).resolves.toContain('<TEI');

		await rebuildIndexFromStore(harness.db, storeOptions);
		expect(await getProject(harness.db, fork.projectId)).toMatchObject({
			id: fork.projectId,
			storageSlug: forkedProject!.storageSlug,
			name: 'Project A Fork',
		});
		expect(await getProjectTranscriptionIds(harness.db, fork.projectId)).toEqual(
			fork.projectOwnedTranscriptionIds
		);
	});

	it('lists project transcription source candidates from other projects with committed status', async () => {
		const storeOptions = { backend: projectBackend };
		await createCommittedSourceProject(storeOptions, { checkpointId: 'src-cp-1' });
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const snapshotAId = 'tx-1';
		const projectTranscriptionAId = 'pt-a';

		const [snapshotBId] = await syncProjectTranscriptionIds(
			harness.db,
			'project-b',
			['tx-1'],
			storeOptions
		);
		const projectTranscriptionBId = await getProjectTranscriptionLinkId(snapshotBId);

		const candidatesForB = await listProjectTranscriptionSourceCandidates(
			harness.db,
			'project-b',
			{ storeOptions }
		);
		const candidatesForA = await listProjectTranscriptionSourceCandidates(
			harness.db,
			'project-a',
			{ storeOptions }
		);

		expect(candidatesForB).toHaveLength(1);
		expect(candidatesForB).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					projectTranscriptionId: projectTranscriptionAId,
					projectOwnedTranscriptionId: snapshotAId,
					projectId: 'project-a',
					projectName: 'Project A',
					siglum: '01',
					currentCheckpoint: expect.objectContaining({ revisionId: 'src-cp-1' }),
					dirtyToCheckpoint: false,
				}),
			])
		);
		expect(candidatesForA).toHaveLength(1);
		expect(candidatesForA).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					projectTranscriptionId: projectTranscriptionBId,
					projectId: 'project-b',
					projectName: 'Project B',
					currentCheckpoint: expect.objectContaining({
						revisionId: expect.any(String),
					}),
					dirtyToCheckpoint: false,
				}),
			])
		);
	});
});

async function getProjectTranscriptionLinkId(projectOwnedTranscriptionId: string): Promise<string> {
	const row = await harness.db
		.selectFrom('project_transcriptions')
		.select('id')
		.where('transcription_id', '=', projectOwnedTranscriptionId)
		.executeTakeFirstOrThrow();
	if (!row.id) throw new Error('Project transcription link id was missing.');
	return row.id;
}

async function createSyncContext() {
	await upsertCloudConnection(harness.db, {
		id: 'conn-1',
		providerId: 'mock',
		providerAccountId: 'acct-1',
		accountEmail: 'editor@example.com',
	});
	return {
		connectionId: 'conn-1',
		projectId: 'project-1',
		cloudFolderId: 'folder-1',
		cloudFolderPath: 'Project',
	};
}

function baseTranscription(id: string, siglum: string) {
	return {
		id,
		title: `Witness ${siglum}`,
		siglum,
		transcriber: 'Editor',
		repository: 'Library',
		settlement: 'City',
		language: 'grc',
	};
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
		pageOrder: 0,
		manifestSourceId,
		manifestUrlSnapshot: 'https://example.org/manifest.json',
		canvasId: 'canvas-1',
		canvasOrder: 0,
		canvasLabel: 'Canvas 1',
		imageServiceUrl: null,
		thumbnailUrl: null,
	};
}

class MemoryStoreBackend implements StoreBackend {
	readonly files = new Map<string, string>();
	readonly directories = new Set<string>(['']);

	async readTextFile(path: string): Promise<string> {
		const normalized = normalizeStorePath(path);
		const content = this.files.get(normalized);
		if (content === undefined) throw new Error(`File ${path} was not found.`);
		return content;
	}

	async writeTextFile(path: string, content: string): Promise<void> {
		const normalized = normalizeStorePath(path);
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
		if (this.directories.has(normalized)) return;
		const parent = storePathDirname(normalized);
		if (parent !== normalized) this.addDirectory(parent);
		this.directories.add(normalized);
	}
}
