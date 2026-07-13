import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { MemoryStoreBackend } from '$lib/client/store/memory-store-backend.spec-support';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '$lib/client/db/test-harness';
import { createCollation, updateCollationMetadata } from '$lib/client/db/repositories/collations';
import { createProject as createProjectRepository } from '$lib/client/db/repositories/projects';
import { createCommittedCollationCheckpoint } from '$lib/client/db/repositories/revisions';
import { createCommittedTranscriptionCheckpointWithFiles } from '$lib/client/db/repositories/transcription-files';
import {
	createTranscription,
	updateTranscriptionContent,
} from '$lib/client/db/repositories/transcriptions';
import {
	applyCollationTombstone,
	classifyCommittedHeadSync,
	createCollationConflictCopy,
	createCollationTombstone,
	createProjectTranscriptionConflictCopy,
	createProjectTranscriptionTombstone,
	preserveProjectTranscriptionDraftCheckpoint,
	type TombstoneData,
} from './conflicts';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
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

describe('local sync conflicts and tombstones', () => {
	it('classifies committed local and remote head divergence without merging', () => {
		const lastSyncedHead = { revisionId: 'rev-1', contentHash: 'sha256:one' };

		expect(
			classifyCommittedHeadSync({
				localHead: lastSyncedHead,
				remoteHead: lastSyncedHead,
				lastSyncedHead,
			})
		).toBe('in_sync');
		expect(
			classifyCommittedHeadSync({
				localHead: { revisionId: 'rev-2', contentHash: 'sha256:two' },
				remoteHead: lastSyncedHead,
				lastSyncedHead,
			})
		).toBe('local_only_change');
		expect(
			classifyCommittedHeadSync({
				localHead: lastSyncedHead,
				remoteHead: { revisionId: 'rev-3', contentHash: 'sha256:three' },
				lastSyncedHead,
			})
		).toBe('remote_only_change');
		expect(
			classifyCommittedHeadSync({
				localHead: { revisionId: 'rev-2', contentHash: 'sha256:two' },
				remoteHead: { revisionId: 'rev-3', contentHash: 'sha256:three' },
				lastSyncedHead,
			})
		).toBe('local_remote_conflict');
	});

	it('creates tombstones when project transcriptions and collations are deleted locally', async () => {
		const projectTranscriptionId = await createCommittedProjectTranscription();
		await createCollation(harness.db, {
			id: 'col-1',
			projectId: 'project-1',
			title: 'Romans 1:1',
			verseIdentifier: 'Romans 1:1',
		});
		const collationCheckpoint = await createCommittedCollationCheckpoint(harness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-1',
			createdAt: '2026-06-09T10:00:00.000Z',
		});

		const transcriptionTombstone = await createProjectTranscriptionTombstone(harness.db, {
			id: 'tombstone-tx-1',
			entityId: projectTranscriptionId,
			deletedBy: 'editor@example.com',
			deletedAt: '2026-06-09T11:00:00.000Z',
		});
		const collationTombstone = await createCollationTombstone(harness.db, {
			id: 'tombstone-col-1',
			entityId: 'col-1',
			deletedBy: 'editor@example.com',
			deletedAt: '2026-06-09T11:01:00.000Z',
		});

		await expect(
			harness.db
				.selectFrom('project_transcriptions')
				.selectAll()
				.where('id', '=', projectTranscriptionId)
				.executeTakeFirst()
		).resolves.toBeUndefined();
		await expect(
			harness.db
				.selectFrom('collations')
				.selectAll()
				.where('id', '=', 'col-1')
				.executeTakeFirst()
		).resolves.toBeUndefined();
		expect(transcriptionTombstone).toMatchObject({
			entity_type: 'project-transcription',
			entity_id: projectTranscriptionId,
			cloud_path: `transcriptions/${projectTranscriptionId}.json`,
		});
		expect(collationTombstone).toMatchObject({
			entity_type: 'collation',
			entity_id: 'col-1',
			deletion_revision_id: collationCheckpoint.id,
			cloud_path: 'collations/col-1.json',
		});
	});

	it('keeps newer committed edits when an older tombstone arrives', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		await createCollation(harness.db, {
			id: 'col-1',
			projectId: 'project-1',
			title: 'Romans 1:1',
			verseIdentifier: 'Romans 1:1',
		});
		const first = await createCommittedCollationCheckpoint(harness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-1',
			createdAt: '2026-06-09T10:00:00.000Z',
		});
		await updateCollationMetadata(harness.db, {
			id: 'col-1',
			notes: 'Newer committed edit',
			updatedAt: '2026-06-09T10:30:00.000Z',
		});
		const second = await createCommittedCollationCheckpoint(harness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-2',
			createdAt: '2026-06-09T11:00:00.000Z',
		});
		const tombstone: TombstoneData = {
			id: 'tombstone-col-1',
			project_id: 'project-1',
			entity_type: 'collation',
			entity_id: 'col-1',
			cloud_path: 'collations/col-1.json',
			deletion_revision_id: first.id,
			deleted_by: 'remote@example.com',
			deleted_at: '2026-06-09T11:30:00.000Z',
		};

		const result = await applyCollationTombstone(harness.db, tombstone);

		expect(result).toMatchObject({
			outcome: 'delete_edit_conflict',
			entityRevisionId: second.id,
		});
		await expect(
			harness.db
				.selectFrom('collations')
				.selectAll()
				.where('id', '=', 'col-1')
				.executeTakeFirst()
		).resolves.toMatchObject({ current_revision_id: second.id, notes: 'Newer committed edit' });
	});

	it('applies tombstones idempotently when the tombstone deletion point wins', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		await createCollation(harness.db, {
			id: 'col-1',
			projectId: 'project-1',
			title: 'Romans 1:1',
			verseIdentifier: 'Romans 1:1',
		});
		const checkpoint = await createCommittedCollationCheckpoint(harness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-1',
		});
		const tombstone: TombstoneData = {
			id: 'tombstone-col-1',
			project_id: 'project-1',
			entity_type: 'collation',
			entity_id: 'col-1',
			cloud_path: 'collations/col-1.json',
			deletion_revision_id: checkpoint.id,
			deleted_by: 'remote@example.com',
			deleted_at: '2026-06-09T11:00:00.000Z',
		};

		await expect(applyCollationTombstone(harness.db, tombstone)).resolves.toMatchObject({
			outcome: 'tombstone_wins',
		});
		await expect(applyCollationTombstone(harness.db, tombstone)).resolves.toMatchObject({
			outcome: 'entity_missing',
		});
	});

	it('preserves dirty project transcription working state as an uncommitted draft checkpoint', async () => {
		const projectTranscriptionId = await createCommittedProjectTranscription();
		const snapshotId = await getSnapshotId(projectTranscriptionId);
		await updateTranscriptionContent(harness.db, {
			id: snapshotId,
			document: documentWithVerses(['Romans 1:2']),
			updatedAt: '2026-06-09T11:00:00.000Z',
		});

		const draft = await preserveProjectTranscriptionDraftCheckpoint(harness.db, {
			projectTranscriptionId,
			checkpointId: 'draft-cp-1',
			createdAt: '2026-06-09T11:05:00.000Z',
		});

		expect(draft).toMatchObject({ checkpointId: 'draft-cp-1', parentCheckpointId: 'tx-cp-1' });
		await expect(
			harness.db
				.selectFrom('transcription_checkpoints')
				.selectAll()
				.where('id', '=', 'draft-cp-1')
				.executeTakeFirst()
		).resolves.toMatchObject({ is_committed: 0, parent_checkpoint_id: 'tx-cp-1' });
		await expect(
			harness.db
				.selectFrom('transcriptions')
				.select(['current_revision_id'])
				.where('id', '=', snapshotId)
				.executeTakeFirst()
		).resolves.toEqual({ current_revision_id: 'tx-cp-1' });
	});

	it('creates project-scoped conflict copies without mutating primary records', async () => {
		const projectTranscriptionId = await createCommittedProjectTranscription();
		await createCollation(harness.db, {
			id: 'col-1',
			projectId: 'project-1',
			title: 'Romans 1:1',
			verseIdentifier: 'Romans 1:1',
		});
		await createCommittedCollationCheckpoint(harness.db, {
			collationId: 'col-1',
			checkpointId: 'col-cp-1',
		});

		const transcriptionCopy = await createProjectTranscriptionConflictCopy(harness.db, {
			projectTranscriptionId,
			conflictProjectTranscriptionId: 'pt-conflict-1',
			conflictTranscriptionId: 'tx-conflict-1',
			checkpointId: 'tx-conflict-cp-1',
			actorName: 'User B',
			now: '2026-06-09T12:00:00.000Z',
		});
		const collationCopy = await createCollationConflictCopy(harness.db, {
			collationId: 'col-1',
			conflictCollationId: 'col-conflict-1',
			checkpointId: 'col-conflict-cp-1',
			actorName: 'User B',
			now: '2026-06-09T12:05:00.000Z',
		});

		expect(transcriptionCopy).toMatchObject({
			projectTranscriptionId: 'pt-conflict-1',
			transcriptionId: 'tx-conflict-1',
			currentRevisionId: 'tx-conflict-cp-1',
			siglum: '01 (Conflicted Copy from User B)',
		});
		expect(collationCopy).toMatchObject({
			collationId: 'col-conflict-1',
			currentRevisionId: 'col-conflict-cp-1',
			title: 'Romans 1:1 (Conflicted Copy from User B)',
		});
		await expect(
			harness.db
				.selectFrom('transcriptions')
				.select(['current_revision_id'])
				.where('id', '=', await getSnapshotId(projectTranscriptionId))
				.executeTakeFirst()
		).resolves.toEqual({ current_revision_id: 'tx-cp-1' });
		await expect(
			harness.db
				.selectFrom('collations')
				.select(['current_revision_id'])
				.where('id', '=', 'col-1')
				.executeTakeFirst()
		).resolves.toEqual({ current_revision_id: 'col-cp-1' });
	});
});

async function createCommittedProjectTranscription(): Promise<string> {
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
	await createCommittedTranscriptionCheckpointWithFiles(
		harness.db,
		{
			projectTranscriptionId: 'pt-1',
			checkpointId: 'tx-cp-1',
			createdAt: '2026-06-09T10:00:00.000Z',
		},
		{ backend }
	);
	return 'pt-1';
}

async function getSnapshotId(projectTranscriptionId: string): Promise<string> {
	const row = await harness.db
		.selectFrom('project_transcriptions')
		.select('transcription_id')
		.where('id', '=', projectTranscriptionId)
		.executeTakeFirstOrThrow();
	return row.transcription_id;
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
