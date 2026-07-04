import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { upsertCloudConnection } from './cloud-connections';
import { createCollation } from './collations';
import { createTranscription, updateTranscriptionContent } from './transcriptions';
import { ensureManifestSource, upsertCanvasAnnotation, upsertPageCanvasLink } from './iiif';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import {
	createProject,
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
	promoteProjectTranscriptionToLibrary,
	addProjectTranscriptionFromProject,
	PromoteUncommittedProjectTranscriptionError,
	AddFromProjectUncommittedSourceError,
	AddFromProjectSameProjectError,
	refreshProjectTranscription,
	RefreshDirtyProjectTranscriptionError,
	syncProjectTranscriptionIds,
	updateProjectMetadata,
} from './projects';
import {
	createCommittedTranscriptionCheckpoint,
	getTranscriptionCommittedHead,
	listCommittedTranscriptionCheckpoints,
} from './revisions';

let harness: LocalDbTestHarness;

beforeEach(() => {
	harness = createLocalDbTestHarness();
});

afterEach(async () => {
	await harness.destroy();
});

describe('projects repository', () => {
	it('creates, lists, loads, and updates project metadata/settings', async () => {
		const projectId = await createProject(harness.db, {
			id: 'project-1',
			name: '  Romans Collation  ',
			description: ' first pass ',
			collationSettings: { lowercase: true },
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-01T00:00:00.000Z',
		});

		await updateProjectMetadata(harness.db, {
			projectId,
			name: 'Romans Final',
			description: ' revised ',
			collationSettings: { segmentation: false },
			updatedAt: '2024-02-01T00:00:00.000Z',
		});

		const projects = await listProjects(harness.db);
		const project = await getProject(harness.db, projectId);

		expect(projects).toEqual([
			{
				id: 'project-1',
				name: 'Romans Final',
				description: 'revised',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-02-01T00:00:00.000Z',
			},
		]);
		expect(project).toMatchObject({
			id: 'project-1',
			name: 'Romans Final',
			collationSettings: { segmentation: false },
		});
	});

	it('lists transcription options without content and loads content on demand', async () => {
		await createTranscription(harness.db, baseTranscription('tx-2', '02'));
		await createTranscription(harness.db, baseTranscription('tx-1', '01'));

		const options = await listProjectTranscriptionOptions(harness.db);
		const content = await loadTranscriptionContent(harness.db, 'tx-1');

		expect(options.map(option => option.id)).toEqual(['tx-1', 'tx-2']);
		expect(options[0]).not.toHaveProperty('content_json');
		expect(content).toContain('transcriptionDocument');
	});

	it('syncs project transcription ids with hard deletes and conflict-safe inserts', async () => {
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createTranscription(harness.db, {
			...baseTranscription('tx-2', '02'),
			document: documentWithVerses(['Romans 1:2']),
		});
		await createProject(harness.db, { id: 'project-1', name: 'Project' });

		const firstSnapshotIds = await syncProjectTranscriptionIds(harness.db, 'project-1', [
			'tx-1',
			'tx-2',
			'tx-1',
		]);
		const syncedSnapshotIds = await syncProjectTranscriptionIds(harness.db, 'project-1', [
			firstSnapshotIds[1],
		]);

		const ids = await getProjectTranscriptionIds(harness.db, 'project-1');
		const rows = await harness.db.selectFrom('project_transcriptions').selectAll().execute();
		const removedSnapshot = await harness.db
			.selectFrom('transcriptions')
			.selectAll()
			.where('id', '=', firstSnapshotIds[0])
			.executeTakeFirst();

		expect(firstSnapshotIds).toHaveLength(2);
		expect(firstSnapshotIds).not.toContain('tx-1');
		expect(firstSnapshotIds).not.toContain('tx-2');
		expect(syncedSnapshotIds).toEqual([firstSnapshotIds[1]]);
		expect(ids).toEqual([firstSnapshotIds[1]]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			project_id: 'project-1',
			transcription_id: firstSnapshotIds[1],
			canonical_transcription_id: 'tx-2',
		});
		expect(removedSnapshot).toBeUndefined();
	});

	it('clones transcription provenance, verse indexes, and IIIF rows into project snapshots', async () => {
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await harness.db
			.updateTable('transcriptions')
			.set({ current_revision_id: 'rev-1', current_content_hash: 'sha256:source' })
			.where('id', '=', 'tx-1')
			.execute();
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

		expect(snapshot).toMatchObject({
			scope_type: 'project_snapshot',
			project_id: 'project-1',
			origin_type: 'canonical',
			origin_project_id: null,
			origin_transcription_id: 'tx-1',
			origin_revision_id: 'rev-1',
			origin_content_hash: 'sha256:source',
			current_revision_id: '',
			current_content_hash: '',
		});
		expect(projectRows[0]).toMatchObject({
			project_id: 'project-1',
			transcription_id: snapshotId,
			canonical_transcription_id: 'tx-1',
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
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
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
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		const [snapshotId] = await syncProjectTranscriptionIds(harness.db, 'project-1', ['tx-1']);
		const projectTranscriptionId = await getProjectTranscriptionLinkId(snapshotId);

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
			sourceState: { kind: 'source-has-no-committed-version', sourceTranscriptionId: 'tx-1' },
		});
		expect(statusByOwnedTranscriptionId).toMatchObject({
			projectId: 'project-1',
			projectTranscriptionId,
			projectOwnedTranscriptionId: snapshotId,
		});
		expect(initialStatus.workingContentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
		await expect(
			getProjectTranscriptionStatusForOwnedTranscription(harness.db, 'tx-1')
		).resolves.toBeNull();

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
		await harness.db
			.updateTable('transcriptions')
			.set({ current_revision_id: 'source-rev-1', current_content_hash: 'sha256:source-1' })
			.where('id', '=', 'tx-1')
			.execute();
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		const [snapshotId] = await syncProjectTranscriptionIds(harness.db, 'project-1', ['tx-1']);
		const projectTranscriptionId = await getProjectTranscriptionLinkId(snapshotId);

		const upToDateStatus = await getProjectTranscriptionStatus(
			harness.db,
			projectTranscriptionId
		);

		expect(upToDateStatus.canonicalSource).toMatchObject({
			transcriptionId: 'tx-1',
			scopeType: 'global',
			projectId: null,
			currentCheckpoint: { revisionId: 'source-rev-1', contentHash: 'sha256:source-1' },
			dirtyToCheckpoint: null,
		});
		expect(upToDateStatus.immediateSource).toMatchObject({
			sourceType: 'canonical',
			sourceTranscriptionId: 'tx-1',
			sourceRevisionId: 'source-rev-1',
			sourceContentHash: 'sha256:source-1',
		});
		expect(upToDateStatus.sourceState).toEqual({
			kind: 'up-to-date',
			sourceTranscriptionId: 'tx-1',
			sourceRevisionId: 'source-rev-1',
			sourceContentHash: 'sha256:source-1',
		});

		await harness.db
			.updateTable('transcriptions')
			.set({ current_revision_id: 'source-rev-2', current_content_hash: 'sha256:source-2' })
			.where('id', '=', 'tx-1')
			.execute();
		expect(
			(await getProjectTranscriptionStatus(harness.db, projectTranscriptionId)).sourceState
		).toEqual({
			kind: 'newer-source-available',
			sourceTranscriptionId: 'tx-1',
			sourceRevisionId: 'source-rev-2',
			sourceContentHash: 'sha256:source-2',
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
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, { id: 'project-a', name: 'Project A' });
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const [snapshotAId] = await syncProjectTranscriptionIds(harness.db, 'project-a', ['tx-1']);
		const [snapshotBId] = await syncProjectTranscriptionIds(harness.db, 'project-b', ['tx-1']);
		const projectTranscriptionAId = await getProjectTranscriptionLinkId(snapshotAId);
		const projectTranscriptionBId = await getProjectTranscriptionLinkId(snapshotBId);

		await updateTranscriptionContent(harness.db, {
			id: snapshotAId,
			document: documentWithVerses(['Romans 1:2']),
			updatedAt: '2026-06-20T10:00:00.000Z',
		});
		const sourceCheckpoint = await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscriptionAId,
			checkpointId: 'src-cp-1',
			createdAt: '2026-06-20T11:00:00.000Z',
		});

		const committedCheckpoints = await listCommittedTranscriptionCheckpoints(
			harness.db,
			snapshotAId
		);

		const refreshed = await refreshProjectTranscription(harness.db, {
			projectTranscriptionId: projectTranscriptionBId,
			sourceTranscriptionId: snapshotAId,
			sourceCheckpointId: 'src-cp-1',
			allowReplaceDirty: true,
			updatedAt: '2026-06-20T12:00:00.000Z',
		});

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

		expect(committedCheckpoints.map(row => row.id)).toEqual(['src-cp-1']);
		expect(refreshed.projectTranscriptionId).toBe(projectTranscriptionBId);
		expect(refreshed.projectOwnedTranscriptionId).toBe(snapshotBId);
		expect(refreshed.commitState).toBe('never-committed');
		expect(refreshed.currentCheckpoint).toBeNull();
		expect(refreshedVerseRows.map(row => row.verse_identifier)).toEqual(['Romans 1:2']);
		expect(refreshedRow).toMatchObject({
			id: snapshotBId,
			scope_type: 'project_snapshot',
			project_id: 'project-b',
			origin_type: 'project_snapshot',
			origin_project_id: 'project-a',
			origin_transcription_id: snapshotAId,
			origin_revision_id: 'src-cp-1',
			origin_content_hash: sourceCheckpoint.contentHash,
			current_revision_id: '',
			current_content_hash: '',
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
	});

	it('does not alter other project transcriptions or collation witnesses during refresh', async () => {
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, { id: 'project-a', name: 'Project A' });
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const [snapshotAId] = await syncProjectTranscriptionIds(harness.db, 'project-a', ['tx-1']);
		const [snapshotBId] = await syncProjectTranscriptionIds(harness.db, 'project-b', ['tx-1']);
		const projectTranscriptionAId = await getProjectTranscriptionLinkId(snapshotAId);
		const projectTranscriptionBId = await getProjectTranscriptionLinkId(snapshotBId);

		await updateTranscriptionContent(harness.db, {
			id: snapshotAId,
			document: documentWithVerses(['Romans 1:2']),
		});
		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscriptionAId,
			checkpointId: 'src-cp-1',
		});

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

		await refreshProjectTranscription(harness.db, {
			projectTranscriptionId: projectTranscriptionBId,
			sourceTranscriptionId: snapshotAId,
			sourceCheckpointId: 'src-cp-1',
			allowReplaceDirty: true,
		});

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
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, { id: 'project-a', name: 'Project A' });
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const [snapshotAId] = await syncProjectTranscriptionIds(harness.db, 'project-a', ['tx-1']);
		const [snapshotBId] = await syncProjectTranscriptionIds(harness.db, 'project-b', ['tx-1']);
		const projectTranscriptionAId = await getProjectTranscriptionLinkId(snapshotAId);
		const projectTranscriptionBId = await getProjectTranscriptionLinkId(snapshotBId);

		await updateTranscriptionContent(harness.db, {
			id: snapshotAId,
			document: documentWithVerses(['Romans 1:2']),
		});
		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscriptionAId,
			checkpointId: 'src-cp-1',
		});
		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscriptionBId,
			checkpointId: 'target-cp-1',
		});
		await updateTranscriptionContent(harness.db, {
			id: snapshotBId,
			document: documentWithVerses(['Romans 1:9']),
		});

		await expect(
			refreshProjectTranscription(harness.db, {
				projectTranscriptionId: projectTranscriptionBId,
				sourceTranscriptionId: snapshotAId,
				sourceCheckpointId: 'src-cp-1',
			})
		).rejects.toBeInstanceOf(RefreshDirtyProjectTranscriptionError);

		const refreshedWithConfirmation = await refreshProjectTranscription(harness.db, {
			projectTranscriptionId: projectTranscriptionBId,
			sourceTranscriptionId: snapshotAId,
			sourceCheckpointId: 'src-cp-1',
			allowReplaceDirty: true,
		});

		expect(refreshedWithConfirmation.commitState).toBe('dirty');
		expect(refreshedWithConfirmation.currentCheckpoint?.revisionId).toBe('target-cp-1');
	});

	it('blocks refresh when the source checkpoint is missing or not the current committed head', async () => {
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, { id: 'project-a', name: 'Project A' });
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const [snapshotAId] = await syncProjectTranscriptionIds(harness.db, 'project-a', ['tx-1']);
		const [snapshotBId] = await syncProjectTranscriptionIds(harness.db, 'project-b', ['tx-1']);
		const projectTranscriptionAId = await getProjectTranscriptionLinkId(snapshotAId);
		const projectTranscriptionBId = await getProjectTranscriptionLinkId(snapshotBId);

		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscriptionAId,
			checkpointId: 'src-cp-1',
			createdAt: '2026-06-20T10:00:00.000Z',
		});
		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscriptionBId,
			checkpointId: 'target-cp-1',
			createdAt: '2026-06-20T10:05:00.000Z',
		});
		await updateTranscriptionContent(harness.db, {
			id: snapshotAId,
			document: documentWithVerses(['Romans 1:3']),
		});
		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscriptionAId,
			checkpointId: 'src-cp-2',
			createdAt: '2026-06-20T11:00:00.000Z',
		});

		await expect(
			refreshProjectTranscription(harness.db, {
				projectTranscriptionId: projectTranscriptionBId,
				sourceTranscriptionId: snapshotAId,
				sourceCheckpointId: 'missing-cp',
			})
		).rejects.toThrow(/was not found/);

		await expect(
			refreshProjectTranscription(harness.db, {
				projectTranscriptionId: projectTranscriptionBId,
				sourceTranscriptionId: snapshotAId,
				sourceCheckpointId: 'src-cp-1',
			})
		).rejects.toThrow(/not the current committed head/);

		const refreshed = await refreshProjectTranscription(harness.db, {
			projectTranscriptionId: projectTranscriptionBId,
			sourceTranscriptionId: snapshotAId,
			sourceCheckpointId: 'src-cp-2',
		});

		const refreshedVerseRows = await harness.db
			.selectFrom('transcription_verse_index')
			.select('verse_identifier')
			.where('transcription_id', '=', snapshotBId)
			.execute();

		expect(refreshedVerseRows.map(row => row.verse_identifier)).toEqual(['Romans 1:3']);
		expect(refreshed.immediateSource?.sourceRevisionId).toBe('src-cp-2');
		expect(refreshed.currentCheckpoint?.revisionId).toBe('target-cp-1');
		expect(refreshed.commitState).toBe('dirty');
	});

	it('promotes a committed project transcription to a new library transcription with a committed checkpoint', async () => {
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, { id: 'project-a', name: 'Project A' });
		const [snapshotAId] = await syncProjectTranscriptionIds(harness.db, 'project-a', ['tx-1']);
		const projectTranscriptionAId = await getProjectTranscriptionLinkId(snapshotAId);

		await updateTranscriptionContent(harness.db, {
			id: snapshotAId,
			document: documentWithVerses(['Romans 1:2']),
			updatedAt: '2026-06-20T10:00:00.000Z',
		});
		const sourceCheckpoint = await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscriptionAId,
			checkpointId: 'src-cp-1',
			createdAt: '2026-06-20T11:00:00.000Z',
		});

		const libraryId = await promoteProjectTranscriptionToLibrary(harness.db, {
			projectTranscriptionId: projectTranscriptionAId,
			title: 'Promoted Witness',
			siglum: 'P01',
			description: 'Promoted from Project A',
			createdAt: '2026-06-20T12:00:00.000Z',
		});

		const libraryRow = await harness.db
			.selectFrom('transcriptions')
			.selectAll()
			.where('id', '=', libraryId)
			.executeTakeFirstOrThrow();
		const libraryVerseRows = await harness.db
			.selectFrom('transcription_verse_index')
			.select('verse_identifier')
			.where('transcription_id', '=', libraryId)
			.execute();
		const libraryHead = await getTranscriptionCommittedHead(harness.db, libraryId);
		const libraryCheckpoints = await listCommittedTranscriptionCheckpoints(
			harness.db,
			libraryId
		);
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
		const projectLinks = await harness.db
			.selectFrom('project_transcriptions')
			.selectAll()
			.where('transcription_id', '=', libraryId)
			.execute();

		expect(libraryRow).toMatchObject({
			id: libraryId,
			scope_type: 'global',
			project_id: null,
			origin_type: 'project_snapshot',
			origin_project_id: 'project-a',
			origin_transcription_id: snapshotAId,
			origin_revision_id: 'src-cp-1',
			origin_content_hash: sourceCheckpoint.contentHash,
			title: 'Promoted Witness',
			siglum: 'P01',
			description: 'Promoted from Project A',
		});
		expect(JSON.parse(libraryRow.content_json)).toEqual(JSON.parse(sourceRow.content_json));
		expect(libraryVerseRows.map(row => row.verse_identifier)).toEqual(['Romans 1:2']);
		expect(libraryHead).toEqual({
			revisionId: libraryCheckpoints[0]!.id,
			contentHash: sourceCheckpoint.contentHash,
		});
		expect(libraryCheckpoints).toHaveLength(1);
		expect(libraryCheckpoints[0]).toMatchObject({
			transcriptionId: libraryId,
			contentHash: sourceCheckpoint.contentHash,
			isCommitted: true,
		});
		expect(sourceRow.current_revision_id).toBe('src-cp-1');
		expect(sourceRow.current_content_hash).toBe(sourceCheckpoint.contentHash);
		expect(sourceVerseRows.map(row => row.verse_identifier)).toEqual(['Romans 1:2']);
		expect(projectLinks).toHaveLength(0);
	});

	it('blocks promote when the project transcription has no committed version', async () => {
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, { id: 'project-a', name: 'Project A' });
		const [snapshotAId] = await syncProjectTranscriptionIds(harness.db, 'project-a', ['tx-1']);
		const projectTranscriptionAId = await getProjectTranscriptionLinkId(snapshotAId);

		await expect(
			promoteProjectTranscriptionToLibrary(harness.db, {
				projectTranscriptionId: projectTranscriptionAId,
			})
		).rejects.toBeInstanceOf(PromoteUncommittedProjectTranscriptionError);

		const globalRows = await harness.db
			.selectFrom('transcriptions')
			.selectAll()
			.where('scope_type', '=', 'global')
			.execute();
		expect(globalRows.map(row => row.id)).toEqual(['tx-1']);
	});

	it('adds a committed transcription from another project into the current project with origin metadata', async () => {
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, { id: 'project-a', name: 'Project A' });
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const [snapshotAId] = await syncProjectTranscriptionIds(harness.db, 'project-a', ['tx-1']);
		const projectTranscriptionAId = await getProjectTranscriptionLinkId(snapshotAId);

		await updateTranscriptionContent(harness.db, {
			id: snapshotAId,
			document: documentWithVerses(['Romans 1:2']),
			updatedAt: '2026-06-20T10:00:00.000Z',
		});
		const sourceCheckpoint = await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscriptionAId,
			checkpointId: 'src-cp-1',
			createdAt: '2026-06-20T11:00:00.000Z',
		});

		const result = await addProjectTranscriptionFromProject(harness.db, {
			targetProjectId: 'project-b',
			sourceProjectTranscriptionId: projectTranscriptionAId,
			createdAt: '2026-06-20T12:00:00.000Z',
		});

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
			scope_type: 'project_snapshot',
			project_id: 'project-b',
			origin_type: 'project_snapshot',
			origin_project_id: 'project-a',
			origin_transcription_id: snapshotAId,
			origin_revision_id: 'src-cp-1',
			origin_content_hash: sourceCheckpoint.contentHash,
			current_revision_id: '',
			current_content_hash: '',
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
	});

	it('does not mutate the source project during add-from-project', async () => {
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, { id: 'project-a', name: 'Project A' });
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const [snapshotAId] = await syncProjectTranscriptionIds(harness.db, 'project-a', ['tx-1']);
		const projectTranscriptionAId = await getProjectTranscriptionLinkId(snapshotAId);
		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscriptionAId,
			checkpointId: 'src-cp-1',
		});

		await addProjectTranscriptionFromProject(harness.db, {
			targetProjectId: 'project-b',
			sourceProjectTranscriptionId: projectTranscriptionAId,
		});

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
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, { id: 'project-a', name: 'Project A' });
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const [snapshotAId] = await syncProjectTranscriptionIds(harness.db, 'project-a', ['tx-1']);
		const projectTranscriptionAId = await getProjectTranscriptionLinkId(snapshotAId);

		await expect(
			addProjectTranscriptionFromProject(harness.db, {
				targetProjectId: 'project-b',
				sourceProjectTranscriptionId: projectTranscriptionAId,
			})
		).rejects.toBeInstanceOf(AddFromProjectUncommittedSourceError);

		expect(await getProjectTranscriptionIds(harness.db, 'project-b')).toEqual([]);
	});

	it('blocks add-from-project when the source is in the same project', async () => {
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, { id: 'project-a', name: 'Project A' });

		const [snapshotAId] = await syncProjectTranscriptionIds(harness.db, 'project-a', ['tx-1']);
		const projectTranscriptionAId = await getProjectTranscriptionLinkId(snapshotAId);
		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscriptionAId,
			checkpointId: 'src-cp-1',
		});

		await expect(
			addProjectTranscriptionFromProject(harness.db, {
				targetProjectId: 'project-a',
				sourceProjectTranscriptionId: projectTranscriptionAId,
			})
		).rejects.toBeInstanceOf(AddFromProjectSameProjectError);
	});

	it('forks a project into a new independent project with project data', async () => {
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, {
			id: 'project-a',
			name: 'Project A',
			description: 'Source project',
		});
		const [snapshotAId] = await syncProjectTranscriptionIds(harness.db, 'project-a', ['tx-1']);
		const projectTranscriptionAId = await getProjectTranscriptionLinkId(snapshotAId);
		const sourceCheckpoint = await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscriptionAId,
			checkpointId: 'src-cp-1',
		});
		await createCollation(harness.db, {
			id: 'col-a',
			projectId: 'project-a',
			title: 'Romans 1:1',
			verseIdentifier: 'Romans 1:1',
		});
		await harness.db
			.insertInto('collation_witnesses')
			.values({
				id: 'wit-a',
				collation_id: 'col-a',
				witness_id: 'A',
				content: 'in principio',
				position: 0,
				project_transcription_id: projectTranscriptionAId,
				transcription_id: snapshotAId,
				source_revision_id: 'src-cp-1',
				source_content_hash: sourceCheckpoint.contentHash,
			})
			.execute();
		await harness.db
			.insertInto('collation_checkpoints')
			.values({
				id: 'col-cp-1',
				collation_id: 'col-a',
				parent_checkpoint_id: null,
				payload: JSON.stringify({ id: 'col-a' }),
				content_hash: 'sha256:collation',
				is_committed: 1,
				commit_message: null,
				author_name: '',
				created_at: '2026-06-20T10:00:00.000Z',
			})
			.execute();
		await harness.db
			.updateTable('collations')
			.set({ current_revision_id: 'col-cp-1', current_content_hash: 'sha256:collation' })
			.where('id', '=', 'col-a')
			.execute();

		const fork = await forkProject(harness.db, {
			sourceProjectId: 'project-a',
			createdAt: '2026-06-20T12:00:00.000Z',
		});

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
			origin_project_id: 'project-a',
			origin_transcription_id: snapshotAId,
			current_content_hash: sourceCheckpoint.contentHash,
		});
		expect(forkedTranscription.current_revision_id).not.toBe('src-cp-1');
		expect(forkedLink).toMatchObject({
			project_id: fork.projectId,
			transcription_id: fork.projectOwnedTranscriptionIds[0],
		});
		expect(forkedTranscriptionCheckpoints).toHaveLength(1);
		expect(forkedTranscriptionCheckpoints[0]).toMatchObject({
			content_hash: sourceCheckpoint.contentHash,
			is_committed: 1,
		});
		expect(forkedCollation).toMatchObject({
			project_id: fork.projectId,
			current_content_hash: 'sha256:collation',
		});
		expect(forkedCollation.current_revision_id).not.toBe('col-cp-1');
		expect(forkedWitness).toMatchObject({
			project_transcription_id: fork.projectTranscriptionIds[0],
			transcription_id: fork.projectOwnedTranscriptionIds[0],
			source_content_hash: sourceCheckpoint.contentHash,
		});
		expect(forkedWitness.source_revision_id).not.toBe('src-cp-1');
		expect(forkedWitness.source_revision_id).toBe(forkedTranscription.current_revision_id);
		expect(sourceFolderLinks).toHaveLength(0);
	});

	it('lists project transcription source candidates from other projects with committed status', async () => {
		await createTranscription(harness.db, {
			...baseTranscription('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, { id: 'project-a', name: 'Project A' });
		await createProject(harness.db, { id: 'project-b', name: 'Project B' });

		const [snapshotAId] = await syncProjectTranscriptionIds(harness.db, 'project-a', ['tx-1']);
		const projectTranscriptionAId = await getProjectTranscriptionLinkId(snapshotAId);
		await createCommittedTranscriptionCheckpoint(harness.db, {
			projectTranscriptionId: projectTranscriptionAId,
			checkpointId: 'src-cp-1',
		});

		const [snapshotBId] = await syncProjectTranscriptionIds(harness.db, 'project-b', ['tx-1']);
		const projectTranscriptionBId = await getProjectTranscriptionLinkId(snapshotBId);

		const candidatesForB = await listProjectTranscriptionSourceCandidates(
			harness.db,
			'project-b'
		);
		const candidatesForA = await listProjectTranscriptionSourceCandidates(
			harness.db,
			'project-a'
		);

		expect(candidatesForB).toHaveLength(1);
		expect(candidatesForB[0]).toMatchObject({
			projectTranscriptionId: projectTranscriptionAId,
			projectOwnedTranscriptionId: snapshotAId,
			projectId: 'project-a',
			projectName: 'Project A',
			siglum: '01',
			currentCheckpoint: { revisionId: 'src-cp-1' },
			dirtyToCheckpoint: false,
		});
		expect(candidatesForA).toHaveLength(1);
		expect(candidatesForA[0]).toMatchObject({
			projectTranscriptionId: projectTranscriptionBId,
			projectId: 'project-b',
			projectName: 'Project B',
			currentCheckpoint: null,
			dirtyToCheckpoint: true,
		});
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
