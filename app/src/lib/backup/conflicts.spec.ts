import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ClassifiedReading } from '$lib/collation/collation-types';
import type { CollationDocument } from '$lib/collation/collation-document';
import {
	coerceTranscriptionDocument,
	type StoredTranscriptionDocument,
} from '$lib/transcription/content';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '$lib/testing/local-db-harness';
import { createCollation } from '$lib/db/repositories/collations';
import {
	loadCollationVersionDocument,
	saveWorkingCollationArtifact,
} from '$lib/db/repositories/collation-files';
import { createProject as createProjectRepository } from '$lib/db/repositories/projects';
import { createCommittedCollationCheckpoint } from '$lib/db/repositories/revisions';
import {
	createCommittedTranscriptionCheckpointWithFiles,
	loadTranscriptionContentWithFiles,
	saveWorkingTranscriptionContent,
} from '$lib/db/repositories/transcription-files';
import { createTranscription } from '$lib/db/repositories/transcriptions';
import { compareCollations, compareTranscriptions } from '$lib/shell/version-compare';
import { COLLATION_FIXTURE } from '$lib/storage/formats/payload-fixtures';
import {
	createCollationConflictCopy,
	createProjectTranscriptionConflictCopy,
	listConflictCopies,
	loadConflictCopyContents,
	reconcileConflictCopy,
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
	it('refuses to load or reconcile a conflict copy without canonical content', async () => {
		const projectTranscriptionId = await createCommittedProjectTranscription();
		const copy = await createProjectTranscriptionConflictCopy(harness.db, {
			projectTranscriptionId,
			conflictTranscriptionId: 'tx-conflict',
			conflictProjectTranscriptionId: 'pt-conflict',
		});
		await expect(
			loadConflictCopyContents(harness.db, copy.transcriptionId, { backend })
		).rejects.toThrow('Canonical transcription file for tx-conflict was not found.');
		await expect(
			reconcileConflictCopy(harness.db, copy.transcriptionId, {}, { backend })
		).rejects.toThrow('Canonical transcription file for tx-conflict was not found.');
		await expect(
			harness.db
				.selectFrom('transcriptions')
				.select('content_json')
				.where('id', '=', copy.transcriptionId)
				.executeTakeFirst()
		).resolves.toMatchObject({
			content_json: expect.stringContaining('transcriptionDocument'),
		});
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

describe('reconciling conflict copies', () => {
	it('keeps the chosen side per verse and leaves untouched verses as they were', async () => {
		await createCommittedProjectTranscription();
		const mine = transcription([
			['1', 'mine one'],
			['2', 'mine two'],
			['3', 'shared three'],
		]);
		const theirs = transcription([
			['1', 'their one'],
			['2', 'their two'],
			['3', 'shared three'],
		]);
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-1', document: mine },
			{ backend }
		);
		await createProjectTranscriptionConflictCopy(harness.db, {
			projectTranscriptionId: 'pt-1',
			conflictProjectTranscriptionId: 'pt-conflict-1',
			conflictTranscriptionId: 'tx-conflict-1',
			actorName: 'User B',
			now: '2026-06-09T12:00:00.000Z',
		});
		await saveWorkingTranscriptionContent(
			harness.db,
			{ id: 'tx-conflict-1', document: theirs },
			{ backend }
		);
		await expect(listConflictCopies(harness.db, 'project-1')).resolves.toMatchObject([
			{
				kind: 'transcription',
				copyId: 'tx-conflict-1',
				originId: 'tx-1',
				title: 'Witness 01',
				author: 'User B',
			},
		]);
		const [verse1, verse2] = compareTranscriptions(mine, theirs).filter(part => part.differs);

		await reconcileConflictCopy(
			harness.db,
			'tx-conflict-1',
			{ [verse1.key]: 'right', [verse2.key]: 'left' },
			{ backend }
		);

		const current = await loadTranscriptionContentWithFiles(harness.db, 'tx-1', { backend });
		expect(coerceTranscriptionDocument(current)).toEqual(
			coerceTranscriptionDocument(
				transcription([
					['1', 'their one'],
					['2', 'mine two'],
					['3', 'shared three'],
				])
			)
		);
		await expect(listConflictCopies(harness.db, 'project-1')).resolves.toEqual([]);
		await expect(
			harness.db.selectFrom('transcriptions').select('id').execute()
		).resolves.toEqual([{ id: 'tx-1' }]);
	});

	it('keeps the chosen side per variation unit and for settings', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		await createCollation(harness.db, {
			id: 'col-1',
			projectId: 'project-1',
			title: 'John 1:1',
			verseIdentifier: 'John 1:1',
		});
		const mine = collation({ lemma: 'a', connectivity: 5, lowercase: true });
		const theirs = collation({ lemma: 'b', connectivity: 7, lowercase: false });
		await saveCollation('col-1', mine);
		await createCollationConflictCopy(harness.db, {
			collationId: 'col-1',
			conflictCollationId: 'col-conflict-1',
			actorName: 'User B',
		});
		await saveCollation('col-conflict-1', theirs);
		await expect(listConflictCopies(harness.db, 'project-1')).resolves.toMatchObject([
			{ kind: 'collation', copyId: 'col-conflict-1', originId: 'col-1', title: 'John 1:1' },
		]);

		await reconcileConflictCopy(
			harness.db,
			'col-conflict-1',
			{ 'unit:c1': 'right', 'unit:c2': 'left', settings: 'right' },
			{ backend }
		);

		const current = await loadCollationVersionDocument(harness.db, 'col-1', null, {
			backend,
		});
		const fromTheirs = new Set(['unit:c1', 'settings']);
		const parts = compareCollations(mine, theirs);
		expect(parts.filter(part => part.differs).map(part => part.key)).toEqual([
			'unit:c1',
			'unit:c2',
			'settings',
		]);
		for (const part of compareCollations(current, mine))
			expect(part.differs, part.key).toBe(fromTheirs.has(part.key));
		for (const part of compareCollations(current, theirs))
			expect(part.differs, part.key).toBe(part.key === 'unit:c2');
		expect(current.alignment).toEqual(mine.alignment);
		await expect(listConflictCopies(harness.db, 'project-1')).resolves.toEqual([]);
		await expect(harness.db.selectFrom('collations').select('id').execute()).resolves.toEqual([
			{ id: 'col-1' },
		]);
	});
});

async function saveCollation(collationId: string, document: CollationDocument): Promise<void> {
	await saveWorkingCollationArtifact(
		harness.db,
		{
			collationId,
			artifactType: 'collation_document_v1',
			payload: JSON.stringify({ ...document, meta: { ...document.meta, collationId } }),
		},
		{ backend }
	);
}

function reading(id: string, text: string): ClassifiedReading {
	return {
		id,
		order: 0,
		label: id,
		text,
		normalizedText: text,
		witnessIds: [id === 'a' ? 'w1' : 'w2'],
		witnessGroups: [],
		isOmission: false,
		isLacuna: false,
		readingType: null,
		certainty: null,
		parentReadingId: null,
		isSubreading: false,
		autoGenerated: true,
		derivedFromRuleIds: [],
	};
}

function cell(text: string) {
	return {
		text,
		regularizedText: text,
		alignmentValue: text,
		sourceTokenIds: [],
		kind: 'text' as const,
		gap: null,
		isOmission: false,
		isLacuna: false,
		isRegularized: false,
		ruleIds: [],
		regularizationTypes: [],
	};
}

function collation(choice: {
	lemma: 'a' | 'b';
	connectivity: number;
	lowercase: boolean;
}): CollationDocument {
	const columns: Array<[string, string, string]> = [
		['c1', 'logos', 'logou'],
		['c2', 'en', 'hn'],
		['c3', 'theos', 'theos'],
	];
	const document = structuredClone(COLLATION_FIXTURE.document) as CollationDocument;
	return {
		...document,
		settings: { ...document.settings, lowercase: choice.lowercase },
		alignment: {
			type: 'alignment',
			witnessOrder: ['w1', 'w2'],
			columns: columns.map(([id, first, second], index) => ({
				id,
				index,
				cells: [
					['w1', cell(first)],
					['w2', cell(second)],
				],
				merged: false,
			})),
		},
		apparatus: {
			type: 'apparatus',
			units: columns.slice(0, 2).map(([id, first, second]) => ({
				type: 'variationUnit' as const,
				id: `unit:${id}`,
				unitId: `unit:${id}`,
				columnId: id,
				readings: [reading('a', first), reading('b', second)],
				decisions: { lemmaReadingId: id === 'c1' ? choice.lemma : 'a' },
			})),
		},
		stemma: {
			type: 'stemma',
			units: columns.slice(0, 2).map(([id]) => ({
				type: 'stemmaUnit' as const,
				id: `stemma:${id}`,
				unitId: `unit:${id}`,
				columnId: id,
				arcs: [],
				connectivity: id === 'c2' ? choice.connectivity : 10,
			})),
		},
	};
}

function transcription(verses: Array<[string, string]>): StoredTranscriptionDocument {
	return {
		type: 'transcriptionDocument',
		pages: [
			{
				type: 'page',
				id: 'page-1',
				pageId: 'page-1',
				columns: [
					{
						type: 'column',
						number: 1,
						lines: verses.map(([verse, text], index) => ({
							type: 'line' as const,
							number: index + 1,
							items: [
								{
									type: 'milestone' as const,
									kind: 'verse' as const,
									attrs: { book: 'John', chapter: '1', verse },
								},
								{ type: 'text' as const, text },
							],
						})),
					},
				],
			},
		],
	};
}

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
