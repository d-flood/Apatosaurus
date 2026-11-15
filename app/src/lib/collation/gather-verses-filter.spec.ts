import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/transcription/verse-index', () => ({
	getVerseIndexRows: vi.fn(),
	getVerseCountsForTranscriptions: vi.fn(),
}));

import { getVerseCountsForTranscriptions, getVerseIndexRows } from '$lib/transcription/verse-index';
import { gatherVerses } from './gather-verses';

describe('gatherVerses project filtering', () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it('sorts verse counts for the selected transcription ids', async () => {
		vi.mocked(getVerseCountsForTranscriptions).mockResolvedValue([
			{ identifier: 'Romans 1:2', book: 'Romans', chapter: '1', verse: '2', count: 1 },
			{ identifier: 'Romans 1:1', book: 'Romans', chapter: '1', verse: '1', count: 2 },
		]);

		const verses = await gatherVerses(['tx-1']);

		expect(getVerseIndexRows).not.toHaveBeenCalled();
		expect(getVerseCountsForTranscriptions).toHaveBeenCalledWith(['tx-1']);
		expect(verses.map(verse => [verse.identifier, verse.count])).toEqual([
			['Romans 1:1', 2],
			['Romans 1:2', 1],
		]);
	});

	it('returns no verses for an empty project scope', async () => {
		vi.mocked(getVerseIndexRows).mockResolvedValue([
			{
				transcription_id: 'tx-global',
				book: 'Romans',
				chapter: '1',
				verse: '1',
			},
		] as Awaited<ReturnType<typeof getVerseIndexRows>>);

		const verses = await gatherVerses([]);

		expect(verses).toEqual([]);
	});
});
