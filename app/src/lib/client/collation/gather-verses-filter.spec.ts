import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/transcription/verse-index', () => ({
	getVerseIndexRows: vi.fn(),
	getVerseIndexRowsForTranscription: vi.fn(),
}));

import {
	getVerseIndexRows,
	getVerseIndexRowsForTranscription,
} from '$lib/client/transcription/verse-index';
import { gatherVerses } from './gather-verses';

describe('gatherVerses project filtering', () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it('limits aggregated verses to the selected transcription ids', async () => {
		vi.mocked(getVerseIndexRowsForTranscription).mockResolvedValue([
			{
				transcription_id: 'tx-1',
				book: 'Romans',
				chapter: '1',
				verse: '1',
			},
			{
				transcription_id: 'tx-1',
				book: 'Romans',
				chapter: '1',
				verse: '1',
			},
		] as Awaited<ReturnType<typeof getVerseIndexRows>>);

		const verses = await gatherVerses(['tx-1']);

		expect(getVerseIndexRows).not.toHaveBeenCalled();
		expect(getVerseIndexRowsForTranscription).toHaveBeenCalledWith('tx-1');
		expect(verses).toEqual([
			{
				identifier: 'Romans 1:1',
				book: 'Romans',
				chapter: '1',
				verse: '1',
				count: 2,
			},
		]);
	});
});
