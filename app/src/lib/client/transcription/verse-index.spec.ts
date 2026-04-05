import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	ensureDjazzkitRuntime,
	getTranscription,
	listExistingVerseIndexRows,
	createManyVerseIndexRows,
	deleteVerseIndexRow,
	getSyncClient,
	suppressNotifications,
	resumeNotifications,
} = vi.hoisted(() => ({
	ensureDjazzkitRuntime: vi.fn(),
	getTranscription: vi.fn(),
	listExistingVerseIndexRows: vi.fn(),
	createManyVerseIndexRows: vi.fn(),
	deleteVerseIndexRow: vi.fn(),
	getSyncClient: vi.fn(),
	suppressNotifications: vi.fn(),
	resumeNotifications: vi.fn(),
}));

vi.mock('$lib/client/djazzkit-runtime', () => ({
	ensureDjazzkitRuntime,
}));

vi.mock('@djazzkit/core', () => ({
	getSyncClient,
	suppressNotifications,
	resumeNotifications,
}));

vi.mock('$generated/models/Transcription', () => ({
	Transcription: {
		objects: {
			filter: vi.fn(() => ({
				filter: vi.fn(() => ({
					first: getTranscription,
				})),
			})),
		},
	},
}));

vi.mock('$generated/index', () => ({
	TranscriptionVerseIndex: {
		objects: {
			filter: vi.fn(() => ({
				all: listExistingVerseIndexRows,
			})),
			createMany: createManyVerseIndexRows,
			delete: deleteVerseIndexRow,
		},
	},
}));

import { rebuildVerseIndexForTranscriptions } from './verse-index';

describe('rebuildVerseIndexForTranscriptions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ensureDjazzkitRuntime.mockResolvedValue(undefined);
		getTranscription.mockReset();
		listExistingVerseIndexRows.mockResolvedValue([]);
		createManyVerseIndexRows.mockResolvedValue(undefined);
		deleteVerseIndexRow.mockResolvedValue(undefined);
		resumeNotifications.mockResolvedValue(undefined);
		getSyncClient.mockReturnValue({
			setUploadsPaused: vi.fn(),
		});
	});

	it('rebuilds unique verse rows in a batch and reports progress', async () => {
		getTranscription.mockResolvedValueOnce({
			_djazzkit_id: 'tx-1',
			siglum: '01',
			title: 'Codex 01',
			content_json: JSON.stringify({
				type: 'transcriptionDocument',
				pages: [
					{
						columns: [
							{
								lines: [
									{
										items: [
											{
												type: 'milestone',
												kind: 'verse',
												attrs: { book: 'Romans', chapter: '1', verse: '1' },
											},
											{
												type: 'milestone',
												kind: 'verse',
												attrs: { book: 'Romans', chapter: '1', verse: '1' },
											},
										],
									},
								],
							},
						],
					},
				],
			}),
		});
		const progressUpdates: Array<{ completed: number; total: number; currentLabel: string }> = [];

		const result = await rebuildVerseIndexForTranscriptions(['tx-1'], {
			onProgress: (progress) => {
				progressUpdates.push({
					completed: progress.completed,
					total: progress.total,
					currentLabel: progress.currentLabel,
				});
			},
		});

		expect(result).toEqual({
			processed: 1,
			succeeded: 1,
			failed: 0,
			failures: [],
		});
		expect(createManyVerseIndexRows).toHaveBeenCalledTimes(1);
		expect(createManyVerseIndexRows).toHaveBeenCalledWith([
			expect.objectContaining({
				transcription_id: 'tx-1',
				verse_identifier: 'Romans 1:1',
				book: 'Romans',
				chapter: '1',
				verse: '1',
			}),
		]);
		expect(deleteVerseIndexRow).not.toHaveBeenCalled();
		expect(progressUpdates).toEqual([
			{ completed: 0, total: 1, currentLabel: '01' },
			{ completed: 1, total: 1, currentLabel: '01' },
		]);
	});

	it('suppresses notifications and pauses uploads for manual rebuilds', async () => {
		const setUploadsPaused = vi.fn();
		getSyncClient.mockReturnValue({ setUploadsPaused });
		getTranscription.mockResolvedValueOnce({
			_djazzkit_id: 'tx-1',
			siglum: '01',
			title: 'Codex 01',
			content_json: JSON.stringify({
				type: 'transcriptionDocument',
				pages: [],
			}),
		});

		await rebuildVerseIndexForTranscriptions(['tx-1'], {
			suppressReactiveNotifications: true,
			pauseUploads: true,
		});

		expect(suppressNotifications).toHaveBeenCalledTimes(1);
		expect(resumeNotifications).toHaveBeenCalledTimes(1);
		expect(setUploadsPaused).toHaveBeenNthCalledWith(1, true);
		expect(setUploadsPaused).toHaveBeenNthCalledWith(2, false);
	});

	it('continues when content is invalid or a transcription is missing', async () => {
		getTranscription
			.mockResolvedValueOnce({
				_djazzkit_id: 'tx-invalid',
				siglum: 'BAD',
				title: 'Broken Import',
				content_json: '{not-json',
			})
			.mockResolvedValueOnce(null);

		const result = await rebuildVerseIndexForTranscriptions(['tx-invalid', 'tx-missing']);

		expect(result.processed).toBe(2);
		expect(result.succeeded).toBe(0);
		expect(result.failed).toBe(2);
		expect(result.failures).toEqual([
			{
				transcriptionId: 'tx-invalid',
				label: 'BAD',
				message: 'Transcription content is missing or invalid',
			},
			{
				transcriptionId: 'tx-missing',
				label: 'tx-missing',
				message: 'Transcription was not found',
			},
		]);
		expect(createManyVerseIndexRows).not.toHaveBeenCalled();
	});
});
