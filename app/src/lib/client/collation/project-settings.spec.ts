import { describe, expect, it } from 'vitest';
import { createProjectCollationSettings, parseProjectCollationSettings } from './project-settings';

describe('project collation settings', () => {
	it('round-trips excluded hands alongside witness treatments', () => {
		const settings = createProjectCollationSettings([], {
			ignoreWordBreaks: false,
			lowercase: false,
			ignoreTokenWhitespace: true,
			ignorePunctuation: false,
			suppliedTextMode: 'clear',
			segmentation: true,
			transcriptionWitnessTreatments: new Map([['tx-1', 'full']]),
			transcriptionWitnessExcludedHands: new Map([
				['tx-1', ['corrector1', 'corrector2']],
			]),
		});

		expect(parseProjectCollationSettings(JSON.stringify(settings))).toMatchObject({
			transcriptionWitnessTreatments: { 'tx-1': 'full' },
			transcriptionWitnessExcludedHands: { 'tx-1': ['corrector1', 'corrector2'] },
		});
	});
});
