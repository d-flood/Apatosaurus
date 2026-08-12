import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import { MemoryStoreBackend } from '$lib/client/store/memory-store-backend.spec-support';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '$lib/client/db/test-harness';
import { createCollation } from '$lib/client/db/repositories/collations';
import { createProject as createProjectRepository } from '$lib/client/db/repositories/projects';
import { createCommittedCollationCheckpoint } from '$lib/client/db/repositories/revisions';
import { createCommittedTranscriptionCheckpointWithFiles } from '$lib/client/db/repositories/transcription-files';
import {
	createTranscription,
} from '$lib/client/db/repositories/transcriptions';
import {
	createCollationConflictCopy,
	createProjectTranscriptionConflictCopy,
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
