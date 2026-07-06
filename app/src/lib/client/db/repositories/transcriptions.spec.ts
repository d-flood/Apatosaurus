import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProject, syncProjectTranscriptionIds } from './projects';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import {
	createTranscription,
	createTranscriptions,
	deleteTranscription,
	getTranscription,
	getTranscriptionSummary,
	getTranscriptionVersionsByIds,
	getTranscriptionsByIds,
	getVerseIndexRowsForVerse,
	listVerseIndexRowsForTranscription,
	listVerseIndexRowsForTranscriptions,
	listTranscriptionSummaries,
	rebuildVerseIndexForTranscriptions,
	updateTranscriptionContent,
} from './transcriptions';
import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';

let harness: LocalDbTestHarness;

beforeEach(() => {
	harness = createLocalDbTestHarness();
});

afterEach(async () => {
	await harness.destroy();
});

describe('transcriptions repository', () => {
	it('creates transcriptions, lists summaries without blobs, and loads full records by id', async () => {
		const firstId = await createTranscription(harness.db, {
			id: 'tx-1',
			title: 'Romans Witness',
			siglum: 'P46',
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-01T00:00:00.000Z',
			document: documentWithVerses(['Romans 1:1']),
			isPublic: true,
			tags: ['paul'],
			transcriber: 'Editor',
			repository: 'Library',
			settlement: 'City',
			language: 'grc',
		});
		await createTranscription(harness.db, {
			id: 'tx-2',
			title: 'Later Witness',
			siglum: '03',
			createdAt: '2024-01-02T00:00:00.000Z',
			updatedAt: '2024-01-02T00:00:00.000Z',
			document: documentWithVerses(['Romans 1:2']),
			transcriber: 'Editor',
			repository: 'Library',
			settlement: 'City',
			language: 'grc',
		});

		const summaries = await listTranscriptionSummaries(harness.db);
		const full = await getTranscription(harness.db, firstId);

		expect(firstId).toBe('tx-1');
		expect(summaries).toEqual([
			{
				id: 'tx-2',
				title: 'Later Witness',
				siglum: '03',
				created_at: '2024-01-02T00:00:00.000Z',
				updated_at: '2024-01-02T00:00:00.000Z',
			},
			{
				id: 'tx-1',
				title: 'Romans Witness',
				siglum: 'P46',
				created_at: '2024-01-01T00:00:00.000Z',
				updated_at: '2024-01-01T00:00:00.000Z',
			},
		]);
		expect(summaries[0]).not.toHaveProperty('content_json');
		expect(full).toMatchObject({
			id: 'tx-1',
			title: 'Romans Witness',
			siglum: 'P46',
			is_public: true,
			tags: ['paul'],
		});
		expect(full?.content_json).toContain('Romans');
	});

	it('creates many transcriptions and indexes unique verse identifiers in the same operation', async () => {
		const ids = await createTranscriptions(harness.db, [
			{
				id: 'tx-1',
				title: 'Witness 1',
				siglum: '01',
				document: documentWithVerses(['Romans 1:1', 'Romans 1:1', 'Romans 1:2']),
				transcriber: 'Editor',
				repository: 'Library',
				settlement: 'City',
				language: 'grc',
			},
			{
				id: 'tx-2',
				title: 'Witness 2',
				siglum: '02',
				document: documentWithVerses(['Romans 1:1']),
				transcriber: 'Editor',
				repository: 'Library',
				settlement: 'City',
				language: 'grc',
			},
		]);

		const rows = await getVerseIndexRowsForVerse(harness.db, 'Romans 1:1');

		expect(ids).toEqual(['tx-1', 'tx-2']);
		expect(rows).toHaveLength(2);
		expect(rows.map(row => row.transcription_id)).toEqual(['tx-1', 'tx-2']);
	});

	it('lists verse index rows for one transcription', async () => {
		await createTranscriptions(harness.db, [
			{
				...baseInput('tx-1', '01'),
				document: documentWithVerses(['Romans 1:1', 'Romans 1:2']),
			},
			{
				...baseInput('tx-2', '02'),
				document: documentWithVerses(['Romans 1:1']),
			},
		]);

		const rows = await listVerseIndexRowsForTranscription(harness.db, 'tx-1');

		expect(rows.map(row => row.transcription_id)).toEqual(['tx-1', 'tx-1']);
		expect(rows.map(row => row.verse_identifier)).toEqual(['Romans 1:1', 'Romans 1:2']);
	});

	it('lists verse index rows for many transcriptions in one query', async () => {
		await createTranscriptions(harness.db, [
			{
				...baseInput('tx-1', '01'),
				document: documentWithVerses(['Romans 1:1', 'Romans 1:2']),
			},
			{
				...baseInput('tx-2', '02'),
				document: documentWithVerses(['Romans 1:3']),
			},
			{
				...baseInput('tx-3', '03'),
				document: documentWithVerses(['Romans 1:4']),
			},
		]);

		const rows = await listVerseIndexRowsForTranscriptions(harness.db, [
			'tx-2',
			'tx-1',
			'tx-1',
			'',
		]);

		expect(rows.map(row => [row.transcription_id, row.verse_identifier])).toEqual([
			['tx-1', 'Romans 1:1'],
			['tx-1', 'Romans 1:2'],
			['tx-2', 'Romans 1:3'],
		]);
	});

	it('loads full transcriptions in caller id order', async () => {
		await createTranscriptions(harness.db, [
			baseInput('tx-1', '01'),
			baseInput('tx-2', '02'),
			baseInput('tx-3', '03'),
		]);

		const rows = await getTranscriptionsByIds(harness.db, ['tx-3', 'tx-1', 'tx-missing']);

		expect(rows.map(row => row.id)).toEqual(['tx-3', 'tx-1']);
	});

	it('loads metadata-only transcription summaries and versions', async () => {
		await createTranscriptions(harness.db, [
			baseInput('tx-1', '01'),
			baseInput('tx-2', '02'),
			baseInput('tx-3', '03'),
		]);

		const summary = await getTranscriptionSummary(harness.db, 'tx-1');
		const versions = await getTranscriptionVersionsByIds(harness.db, [
			'tx-3',
			'tx-1',
			'tx-missing',
		]);

		expect(summary).toMatchObject({ id: 'tx-1', siglum: '01' });
		expect(summary).not.toHaveProperty('content_json');
		expect(versions.map(row => row.id)).toEqual(['tx-3', 'tx-1']);
		expect(versions[0]).toEqual({ id: 'tx-3', updated_at: expect.any(String) });
		expect(versions[0]).not.toHaveProperty('content_json');
	});

	it('lists project-owned transcriptions and project copies', async () => {
		await createTranscription(harness.db, {
			...baseInput('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		const [snapshotId] = await syncProjectTranscriptionIds(harness.db, 'project-1', ['tx-1']);

		const summaries = await listTranscriptionSummaries(harness.db);
		const snapshotSummary = await getTranscriptionSummary(harness.db, snapshotId);
		const loadedByIds = await getTranscriptionsByIds(harness.db, [snapshotId, 'tx-1']);
		const versions = await getTranscriptionVersionsByIds(harness.db, [snapshotId]);
		const snapshot = await getTranscription(harness.db, snapshotId);

		expect(summaries.map(row => row.id)).toEqual([snapshotId, 'tx-1']);
		expect(snapshotSummary).toMatchObject({ id: snapshotId, siglum: '01' });
		expect(loadedByIds.map(row => row.id)).toEqual([snapshotId, 'tx-1']);
		expect(versions.map(row => row.id)).toEqual([snapshotId]);
		expect(snapshot).toMatchObject({
			id: snapshotId,
			project_id: 'project-1',
		});
	});

	it('replaces verse indexes when content is updated', async () => {
		await createTranscription(harness.db, {
			...baseInput('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});

		await updateTranscriptionContent(harness.db, {
			id: 'tx-1',
			document: documentWithVerses(['Romans 1:2']),
			updatedAt: '2024-02-01T00:00:00.000Z',
		});

		const oldRows = await getVerseIndexRowsForVerse(harness.db, 'Romans 1:1');
		const newRows = await getVerseIndexRowsForVerse(harness.db, 'Romans 1:2');
		const updated = await getTranscription(harness.db, 'tx-1');

		expect(oldRows).toEqual([]);
		expect(newRows).toHaveLength(1);
		expect(updated?.updated_at).toBe('2024-02-01T00:00:00.000Z');
	});

	it('rebuilds verse indexes and reports missing or invalid transcriptions', async () => {
		await createTranscription(harness.db, {
			...baseInput('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});
		await harness.db
			.updateTable('transcriptions')
			.set({ content_json: '{not-json' })
			.where('id', '=', 'tx-1')
			.execute();

		const result = await rebuildVerseIndexForTranscriptions(harness.db, ['tx-1', 'tx-missing']);

		expect(result).toEqual({
			processed: 2,
			succeeded: 0,
			failed: 2,
			failures: [
				{
					transcriptionId: 'tx-1',
					label: '01',
					message: 'Transcription content is missing or invalid',
				},
				{
					transcriptionId: 'tx-missing',
					label: 'tx-missing',
					message: 'Transcription was not found',
				},
			],
		});
	});

	it('hard deletes transcriptions and cascades verse index rows', async () => {
		await createTranscription(harness.db, {
			...baseInput('tx-1', '01'),
			document: documentWithVerses(['Romans 1:1']),
		});

		await deleteTranscription(harness.db, 'tx-1');

		const full = await getTranscription(harness.db, 'tx-1');
		const verseRows = await getVerseIndexRowsForVerse(harness.db, 'Romans 1:1');
		expect(full).toBeNull();
		expect(verseRows).toEqual([]);
	});
});

function baseInput(id: string, siglum: string) {
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
