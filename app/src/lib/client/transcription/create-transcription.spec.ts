import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	ensureDjazzkitRuntime,
	createTranscriptionRow,
	createManyTranscriptionRows,
	rebuildVerseIndexForTranscriptions,
	suppressNotifications,
	resumeNotifications,
} = vi.hoisted(() => ({
	ensureDjazzkitRuntime: vi.fn(),
	createTranscriptionRow: vi.fn(),
	createManyTranscriptionRows: vi.fn(),
	rebuildVerseIndexForTranscriptions: vi.fn(),
	suppressNotifications: vi.fn(),
	resumeNotifications: vi.fn(),
}));

vi.mock('$lib/client/djazzkit-runtime', () => ({
	ensureDjazzkitRuntime,
}));

vi.mock('$generated/models/Transcription', () => ({
	Transcription: {
		objects: {
			create: createTranscriptionRow,
			createMany: createManyTranscriptionRows,
		},
	},
}));

vi.mock('$lib/client/transcription/verse-index', () => ({
	rebuildVerseIndexForTranscriptions,
}));

vi.mock('@djazzkit/core', () => ({
	suppressNotifications,
	resumeNotifications,
}));

import {
	createTranscriptionRecord,
	createTranscriptionRecords,
} from './create-transcription';

const baseInput = {
	title: 'Romans Witness',
	siglum: 'P46',
	transcriber: 'Editor',
	repository: 'Library',
	settlement: 'City',
	language: 'grc',
};

describe('create-transcription indexing hooks', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ensureDjazzkitRuntime.mockResolvedValue(undefined);
		createTranscriptionRow.mockResolvedValue(undefined);
		createManyTranscriptionRows.mockResolvedValue(undefined);
		rebuildVerseIndexForTranscriptions.mockResolvedValue({
			processed: 0,
			succeeded: 0,
			failed: 0,
			failures: [],
		});
		resumeNotifications.mockResolvedValue(undefined);
	});

	it('indexes a transcription after single-record creation', async () => {
		const transcriptionId = await createTranscriptionRecord(baseInput);

		expect(createTranscriptionRow).toHaveBeenCalledTimes(1);
		expect(rebuildVerseIndexForTranscriptions).toHaveBeenCalledWith([transcriptionId]);
	});

	it('indexes each created chunk during bulk creation', async () => {
		const onChunkComplete = vi.fn();

		const ids = await createTranscriptionRecords(
			[
				baseInput,
				{ ...baseInput, siglum: 'P47', title: 'Romans Witness 2' },
				{ ...baseInput, siglum: 'P48', title: 'Romans Witness 3' },
			],
			onChunkComplete,
			2,
		);

		expect(ids).toHaveLength(3);
		expect(createManyTranscriptionRows).toHaveBeenCalledTimes(2);
		expect(rebuildVerseIndexForTranscriptions).toHaveBeenCalledTimes(2);
		expect(rebuildVerseIndexForTranscriptions.mock.calls[0][0]).toHaveLength(2);
		expect(rebuildVerseIndexForTranscriptions.mock.calls[1][0]).toHaveLength(1);
		expect(onChunkComplete).toHaveBeenNthCalledWith(1, 2, 3);
		expect(onChunkComplete).toHaveBeenNthCalledWith(2, 3, 3);
		expect(suppressNotifications).toHaveBeenCalledTimes(1);
		expect(resumeNotifications).toHaveBeenCalledTimes(1);
	});
});
