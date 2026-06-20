import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	getTranscription,
	listVerseIndexRowsForTranscription,
	listVerseIndexRows,
	getVerseIndexRowsForVerse,
	rebuildVerseIndexForTranscriptions,
	updateTranscriptionContent,
} = vi.hoisted(() => ({
	getTranscription: vi.fn(),
	listVerseIndexRowsForTranscription: vi.fn(),
	listVerseIndexRows: vi.fn(),
	getVerseIndexRowsForVerse: vi.fn(),
	rebuildVerseIndexForTranscriptions: vi.fn(),
	updateTranscriptionContent: vi.fn(),
}));

vi.mock('$lib/client/db/client', () => ({
	getTranscription,
	listVerseIndexRowsForTranscription,
	listVerseIndexRows,
	getVerseIndexRowsForVerse,
	rebuildVerseIndexForTranscriptions,
	updateTranscriptionContent,
}));

import {
	getVerseIndexRows,
	getVerseIndexRowsForTranscription,
	getVerseIndexRowsForVerse as getPublicVerseIndexRowsForVerse,
	rebuildVerseIndexForTranscriptions as rebuildPublicVerseIndexForTranscriptions,
	syncVerseIndexFromDocument,
} from './verse-index';

const verseRow = {
	id: 'idx-1',
	transcription_id: 'tx-1',
	verse_identifier: 'Romans 1:1',
	book: 'Romans',
	chapter: '1',
	verse: '1',
	last_indexed_at: '2026-01-01T00:00:00.000Z',
};

describe('verse-index local DB bridge', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listVerseIndexRowsForTranscription.mockResolvedValue([verseRow]);
		listVerseIndexRows.mockResolvedValue([verseRow]);
		getVerseIndexRowsForVerse.mockResolvedValue([verseRow]);
		getTranscription.mockResolvedValue({ id: 'tx-1', siglum: '01', title: 'Codex 01' });
		rebuildVerseIndexForTranscriptions.mockResolvedValue({
			processed: 1,
			succeeded: 1,
			failed: 0,
			failures: [],
		});
		updateTranscriptionContent.mockResolvedValue(undefined);
	});

	it('returns local DB verse index rows without compatibility aliases', async () => {
		await expect(getVerseIndexRows()).resolves.toEqual([
			expect.objectContaining({
				id: 'idx-1',
				transcription_id: 'tx-1',
			}),
		]);

		await getPublicVerseIndexRowsForVerse('Romans 1:1', ['tx-1']);
		expect(getVerseIndexRowsForVerse).toHaveBeenCalledWith('Romans 1:1', ['tx-1']);

		await getVerseIndexRowsForTranscription('tx-1');
		expect(listVerseIndexRowsForTranscription).toHaveBeenCalledWith('tx-1');
	});

	it('rebuilds through one worker operation and reports label progress', async () => {
		const progressUpdates: Array<{ completed: number; total: number; currentLabel: string }> =
			[];

		const result = await rebuildPublicVerseIndexForTranscriptions(['tx-1'], {
			onProgress: progress => {
				progressUpdates.push({
					completed: progress.completed,
					total: progress.total,
					currentLabel: progress.currentLabel,
				});
			},
		});

		expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0, failures: [] });
		expect(rebuildVerseIndexForTranscriptions).toHaveBeenCalledWith(['tx-1']);
		expect(progressUpdates).toEqual([
			{ completed: 0, total: 1, currentLabel: '01' },
			{ completed: 1, total: 1, currentLabel: '01' },
		]);
	});

	it('updates content and index together when syncing from an editor document', async () => {
		const document = { type: 'transcriptionDocument' as const, pages: [] };

		await syncVerseIndexFromDocument('tx-1', document);

		expect(updateTranscriptionContent).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'tx-1',
				document,
				contentJson: JSON.stringify(document),
			})
		);
	});
});
