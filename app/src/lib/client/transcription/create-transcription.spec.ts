import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createTranscription, createTranscriptions } = vi.hoisted(() => ({
	createTranscription: vi.fn(),
	createTranscriptions: vi.fn(),
}));

vi.mock('$lib/client/db/client', () => ({
	createTranscription,
	createTranscriptions,
}));

import { createTranscriptionRecord, createTranscriptionRecords } from './create-transcription';

const baseInput = {
	title: 'Romans Witness',
	siglum: 'P46',
	transcriber: 'Editor',
	repository: 'Library',
	settlement: 'City',
	language: 'grc',
};

describe('create-transcription storage calls', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createTranscription.mockResolvedValue('tx-single');
		createTranscriptions
			.mockResolvedValueOnce(['tx-1', 'tx-2'])
			.mockResolvedValueOnce(['tx-3']);
	});

	it('creates a single transcription through the local DB client', async () => {
		const transcriptionId = await createTranscriptionRecord(baseInput);

		expect(transcriptionId).toBe('tx-single');
		expect(createTranscription).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Romans Witness',
				siglum: 'P46',
				format: 'normalized_ast_v3',
				isPublic: false,
				tags: [],
			})
		);
	});

	it('creates bulk transcriptions in chunks and reports progress', async () => {
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

		expect(ids).toEqual(['tx-1', 'tx-2', 'tx-3']);
		expect(createTranscriptions).toHaveBeenCalledTimes(2);
		expect(createTranscriptions.mock.calls[0][0]).toHaveLength(2);
		expect(createTranscriptions.mock.calls[1][0]).toHaveLength(1);
		expect(onChunkComplete).toHaveBeenNthCalledWith(1, 2, 3);
		expect(onChunkComplete).toHaveBeenNthCalledWith(2, 3, 3);
	});
});
