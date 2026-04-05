import { describe, expect, it } from 'vitest';
import { collateToAlignmentSnapshot } from './collation-adapter';

describe('collateToAlignmentSnapshot', () => {
	it('preserves caller witness order', () => {
		const result = collateToAlignmentSnapshot({
			witnesses: [
				{ id: 'B', content: 'alpha beta' },
				{ id: 'A', content: 'alpha beta' },
			],
		});

		expect(result.snapshot.witnessOrder).toEqual(['B', 'A']);
		expect(result.snapshot.columns).toHaveLength(1);
		expect(result.snapshot.columns[0]?.cells.map(([witnessId]) => witnessId)).toEqual(['B', 'A']);
	});

	it('uses segmented collation by default', () => {
		const result = collateToAlignmentSnapshot({
			witnesses: [
				{ id: 'A', content: 'a b' },
				{ id: 'B', content: 'a b' },
			],
		});

		expect(result.snapshot.columns).toHaveLength(1);
		expect(result.snapshot.columns[0]?.cells).toEqual([
			[
				'A',
				{
					text: 'a b',
					regularizedText: 'a b',
					alignmentValue: 'a b',
					sourceTokenIds: [],
					kind: 'text',
					gap: null,
					isOmission: false,
					isLacuna: false,
					isRegularized: false,
					ruleIds: [],
					regularizationTypes: [],
				},
			],
			[
				'B',
				{
					text: 'a b',
					regularizedText: 'a b',
					alignmentValue: 'a b',
					sourceTokenIds: [],
					kind: 'text',
					gap: null,
					isOmission: false,
					isLacuna: false,
					isRegularized: false,
					ruleIds: [],
					regularizationTypes: [],
				},
			],
		]);
	});

	it('accepts pretokenized witness input', () => {
		const result = collateToAlignmentSnapshot({
			witnesses: [
				{
					id: 'A',
					content: 'unused',
					tokens: [
						{ t: 'και εγενετο', n: 'και εγενετο', sourceTokenIds: ['A::source::0'] },
						{ t: 'λογος', n: 'λογος', sourceTokenIds: ['A::source::1'] },
					],
				},
				{
					id: 'B',
					content: 'unused',
					tokens: [
						{ t: 'και', n: 'και', sourceTokenIds: ['B::source::0'] },
						{ t: 'λογος', n: 'λογος', sourceTokenIds: ['B::source::1'] },
					],
				},
			],
			options: { segmentation: false },
		});

		expect(result.snapshot.witnessOrder).toEqual(['A', 'B']);
		expect(result.snapshot.columns[0]?.cells[0]).toEqual([
			'A',
				{
					text: 'και εγενετο',
					regularizedText: 'και εγενετο',
					alignmentValue: 'και εγενετο',
					sourceTokenIds: ['A::source::0'],
					kind: 'text',
					gap: null,
				isOmission: false,
				isLacuna: false,
				isRegularized: false,
				ruleIds: [],
				regularizationTypes: [],
			},
		]);
	});

	it('defaults to segmented alignment for pretokenized witness input', () => {
		const result = collateToAlignmentSnapshot({
			witnesses: [
				{
					id: 'A',
					content: 'unused',
					tokens: [
						{ t: 'και', n: 'και', sourceTokenIds: ['A::source::0'] },
						{ t: 'λογος', n: 'λογος', sourceTokenIds: ['A::source::1'] },
						{ t: 'ον', n: 'ον', sourceTokenIds: ['A::source::2'] },
						{ t: 'the', n: 'the', sourceTokenIds: ['A::source::3'] },
						{ t: 'mat', n: 'mat', sourceTokenIds: ['A::source::4'] },
					],
				},
				{
					id: 'B',
					content: 'unused',
					tokens: [
						{ t: 'και', n: 'και', sourceTokenIds: ['B::source::0'] },
						{ t: 'ρημα', n: 'ρημα', sourceTokenIds: ['B::source::1'] },
						{ t: 'ον', n: 'ον', sourceTokenIds: ['B::source::2'] },
						{ t: 'the', n: 'the', sourceTokenIds: ['B::source::3'] },
						{ t: 'mat', n: 'mat', sourceTokenIds: ['B::source::4'] },
					],
				},
			],
		});

		expect(result.snapshot.columns).toHaveLength(3);
		expect(result.snapshot.columns[0]?.cells[0]?.[1].text).toBe('και');
		expect(result.snapshot.columns[1]?.cells[0]?.[1].text).toBe('λογος');
		expect(result.snapshot.columns[1]?.cells[1]?.[1].text).toBe('ρημα');
		expect(result.snapshot.columns[2]?.cells[0]?.[1].text).toBe('ον the mat');
		expect(result.snapshot.columns[2]?.cells[1]?.[1].text).toBe('ον the mat');
	});

	it('supports non-segmented alignment for pretokenized witness input when requested', () => {
		const result = collateToAlignmentSnapshot({
			witnesses: [
				{
					id: 'A',
					content: 'unused',
					tokens: [
						{ t: 'και', n: 'και', sourceTokenIds: ['A::source::0'] },
						{ t: 'λογος', n: 'λογος', sourceTokenIds: ['A::source::1'] },
					],
				},
				{
					id: 'B',
					content: 'unused',
					tokens: [
						{ t: 'και', n: 'και', sourceTokenIds: ['B::source::0'] },
						{ t: 'ρημα', n: 'ρημα', sourceTokenIds: ['B::source::1'] },
					],
				},
			],
			options: { segmentation: false },
		});

		expect(result.snapshot.columns).toHaveLength(2);
		expect(result.snapshot.columns[0]?.cells[0]?.[1].text).toBe('και');
		expect(result.snapshot.columns[1]?.cells[0]?.[1].text).toBe('λογος');
		expect(result.snapshot.columns[1]?.cells[1]?.[1].text).toBe('ρημα');
	});

	it('keeps original text while collating on normalized text', () => {
		const result = collateToAlignmentSnapshot({
			witnesses: [
				{
					id: 'A',
					content: 'unused',
					tokens: [{
						t: 'θεος',
						n: 'θεος',
						originalSegments: [
							{ text: 'θε', hasUnclear: false, isPunctuation: false, isSupplied: false },
							{ text: 'ος', hasUnclear: true, isPunctuation: false, isSupplied: false },
						],
					}],
				},
				{
					id: 'B',
					content: 'unused',
					tokens: [{ t: 'θς', n: 'θεος', ruleIds: ['rule-1'], regularizationTypes: ['ns'] }],
				},
			],
			options: { segmentation: false },
		});

		expect(result.snapshot.columns).toHaveLength(1);
		expect(result.snapshot.columns[0]?.cells).toEqual([
			[
				'A',
				{
					text: 'θεος',
					regularizedText: 'θεος',
					alignmentValue: 'θεος',
					sourceTokenIds: [],
					kind: 'text',
					gap: null,
					originalSegments: [
						{ text: 'θε', hasUnclear: false, isPunctuation: false, isSupplied: false },
						{ text: 'ος', hasUnclear: true, isPunctuation: false, isSupplied: false },
					],
					isOmission: false,
					isLacuna: false,
					isRegularized: false,
					ruleIds: [],
					regularizationTypes: [],
				},
			],
			[
				'B',
				{
					text: 'θς',
					regularizedText: 'θεος',
					alignmentValue: 'θεος',
					sourceTokenIds: [],
					kind: 'text',
					gap: null,
					isOmission: false,
					isLacuna: false,
					isRegularized: true,
					ruleIds: ['rule-1'],
					regularizationTypes: ['ns'],
				},
			],
		]);
	});

	it('joins standalone punctuation without adding a leading space before it', () => {
		const result = collateToAlignmentSnapshot({
			witnesses: [
				{
					id: 'A',
					content: 'unused',
					tokens: [
						{
							t: 'λογος',
							n: 'λογος',
							sourceTokenIds: ['A::source::0'],
						},
						{
							t: ',',
							n: ',',
							isPunctuation: true,
							originalSegments: [
								{ text: ',', hasUnclear: false, isPunctuation: true, isSupplied: false },
							],
							sourceTokenIds: ['A::source::1'],
						},
						{
							t: 'θεος',
							n: 'θεος',
							sourceTokenIds: ['A::source::2'],
						},
					],
				},
				{
					id: 'B',
					content: 'unused',
					tokens: [
						{ t: 'λογος', n: 'λογος' },
						{ t: ',', n: ',', isPunctuation: true },
						{ t: 'θεος', n: 'θεος' },
					],
				},
			],
		});

		expect(result.snapshot.columns).toHaveLength(1);
		expect(result.snapshot.columns[0]?.cells[0]?.[1].text).toBe('λογος, θεος');

		expect(result.snapshot.columns[0]?.cells[0]?.[1].alignmentValue).toBe('λογος, θεος');
	});

	it('marks gap tokens as lacunose cells instead of omissions', () => {
		const result = collateToAlignmentSnapshot({
			witnesses: [
				{
					id: 'A',
					content: 'unused',
					tokens: [
						{
							t: '⊘',
							n: '__gap:reason=lacuna;unit=chars;extent=3__',
							kind: 'gap',
							displayRegularized: null,
							gap: {
								source: 'gap',
								reason: 'lacuna',
								unit: 'chars',
								extent: '3',
							},
						},
					],
				},
				{
					id: 'B',
					content: 'unused',
					tokens: [{ t: 'λογος', n: 'λογος' }],
				},
			],
			options: { segmentation: false },
		});

		expect(result.snapshot.columns[0]?.cells[0]).toEqual([
			'A',
				{
					text: '⊘',
					regularizedText: null,
					alignmentValue: '__gap:reason=lacuna;unit=chars;extent=3__',
					sourceTokenIds: [],
					kind: 'gap',
					gap: {
					source: 'gap',
					reason: 'lacuna',
					unit: 'chars',
					extent: '3',
				},
				isOmission: false,
				isLacuna: true,
				isRegularized: false,
				ruleIds: [],
				regularizationTypes: [],
			},
		]);
	});
});
