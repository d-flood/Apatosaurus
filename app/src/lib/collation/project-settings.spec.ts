import { describe, expect, it } from 'vitest';
import { createProjectCollationSettings, parseProjectCollationSettings } from './project-settings';

describe('project collation settings', () => {
	it('normalizes tag labels and rejects duplicate labels, ids and malformed entries', () => {
		expect(
			parseProjectCollationSettings({
				readingTags: [
					{ id: 'ns', label: ' Nomen sacrum ' },
					{ id: 'duplicate', label: 'NOMEN SACRUM' },
					{ id: 'ns', label: 'Other' },
					{ id: 'blank', label: ' ' },
					{ id: ' ', label: 'Blank id' },
					null,
					{ id: 42, label: 'Bad id' },
					{ id: 'bad', label: 42 },
				],
			}).readingTags
		).toEqual([{ id: 'ns', label: 'Nomen sacrum' }]);
	});

	it('round-trips excluded hands alongside witness treatments', () => {
		const settings = createProjectCollationSettings([], {
			ignoreWordBreaks: false,
			lowercase: false,
			ignoreTokenWhitespace: true,
			ignorePunctuation: false,
			suppliedTextMode: 'clear',
			segmentation: true,
			transcriptionWitnessTreatments: new Map([['tx-1', 'full']]),
			transcriptionWitnessExcludedHands: new Map([['tx-1', ['corrector1', 'corrector2']]]),
			readingTypes: [],
			readingTags: [{ id: 'ns', label: ' Nomen sacrum ' }],
		});

		expect(parseProjectCollationSettings(JSON.stringify(settings))).toMatchObject({
			transcriptionWitnessTreatments: { 'tx-1': 'full' },
			readingTags: [{ id: 'ns', label: 'Nomen sacrum' }],
			transcriptionWitnessExcludedHands: { 'tx-1': ['corrector1', 'corrector2'] },
		});
	});

	it('round-trips a project-supplied reading type', () => {
		const settings = createProjectCollationSettings([], {
			ignoreWordBreaks: false,
			lowercase: false,
			ignoreTokenWhitespace: true,
			ignorePunctuation: false,
			suppliedTextMode: 'clear',
			segmentation: true,
			transcriptionWitnessTreatments: new Map(),
			transcriptionWitnessExcludedHands: new Map(),
			readingTypes: [
				{
					id: 'itacism',
					label: 'Itacism',
					description: 'Vowel confusion characteristic of the scribe.',
					selectable: true,
					suffix: 'i',
				},
			],
		});

		expect(parseProjectCollationSettings(JSON.stringify(settings)).readingTypes).toEqual([
			{
				id: 'itacism',
				label: 'Itacism',
				description: 'Vowel confusion characteristic of the scribe.',
				selectable: true,
				suffix: 'i',
			},
		]);
	});
});
