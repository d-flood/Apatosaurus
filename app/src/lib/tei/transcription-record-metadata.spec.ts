import { describe, expect, it } from 'vitest';

import { extractTranscriptionRecordMetadataPatch } from './transcription-record-metadata';

describe('transcription record <-> TEI metadata mapping', () => {
	it('extracts database-backed metadata fields from an imported TEI document', () => {
		const patch = extractTranscriptionRecordMetadataPatch({
			metadata: {
				title: 'A transcription of Romans in 01',
				transcriber: 'members of the INTF',
				repository: 'British Library',
				settlement: 'London',
				idno: 'MS Add. 43725',
				language: 'grc',
			},
			header: {
				titles: [{ text: 'Romans', type: 'short' }],
				msIdentifier: {
					repository: 'British Library',
					settlement: 'London',
					idno: 'MS Add. 43725',
				},
				language: 'grc',
			},
		});

		expect(patch).toEqual({
			title: 'A transcription of Romans in 01',
			transcriber: 'members of the INTF',
			repository: 'British Library',
			settlement: 'London',
			siglum: 'MS Add. 43725',
			language: 'grc',
		});
	});

	it('takes the transcriber only from a "Transcribed by" responsibility', () => {
		const responsibilities = [
			{ resp: 'Created by', name: 'Creator' },
			{ resp: 'Edited by', name: 'Editor' },
		];
		expect(extractTranscriptionRecordMetadataPatch({ header: { responsibilities } })).toEqual(
			{}
		);
		expect(
			extractTranscriptionRecordMetadataPatch({
				header: {
					responsibilities: [
						...responsibilities,
						{ resp: 'Transcribed by', name: 'Transcriber' },
					],
				},
			})
		).toEqual({ transcriber: 'Transcriber' });
	});
});
