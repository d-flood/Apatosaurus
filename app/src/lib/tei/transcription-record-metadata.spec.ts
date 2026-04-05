import { describe, expect, it } from 'vitest';

import {
	buildTEIMetadataFromTranscription,
	extractTranscriptionRecordMetadataPatch,
} from './transcription-record-metadata';

describe('transcription record <-> TEI metadata mapping', () => {
	it('builds export metadata from a transcription record', () => {
		const metadata = buildTEIMetadataFromTranscription({
			title: 'Romans in 01',
			transcriber: 'Editor Name',
			owner: 'owner',
			created_at: '2024-01-02T12:00:00.000Z',
			repository: 'British Library',
			settlement: 'London',
			siglum: 'MS Add. 43725',
			language: 'grc',
		} as any);

		expect(metadata).toEqual({
			title: 'Romans in 01',
			transcriber: 'Editor Name',
			date: '2024-01-02',
			repository: 'British Library',
			settlement: 'London',
			idno: 'MS Add. 43725',
			language: 'grc',
		});
	});

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
});
