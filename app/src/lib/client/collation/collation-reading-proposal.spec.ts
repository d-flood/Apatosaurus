import { describe, expect, it } from 'vitest';
import type { AlignmentCell, AlignmentColumn } from './alignment-snapshot';
import { buildReadingProposal } from './collation-reading-proposal';

function makeCell(text: string | null, options: Partial<AlignmentCell> = {}): AlignmentCell {
	return {
		text,
		regularizedText: text,
		alignmentValue: text,
		sourceTokenIds: [],
		kind: text === null ? 'omission' : 'text',
		gap: null,
		isOmission: text === null,
		isLacuna: false,
		isRegularized: false,
		ruleIds: [],
		regularizationTypes: [],
		...options,
	};
}

function makeColumn(cells: Array<[string, AlignmentCell]>): AlignmentColumn {
	return {
		id: 'col-1',
		index: 0,
		cells: new Map(cells),
		merged: false,
	};
}

describe('reading proposal', () => {
	it('builds and labels a multi-witness proposal with normalized-text subreadings and base text first', () => {
		const columns = [
			makeColumn([
				['A', makeCell('zeta')],
				['B', makeCell('word')],
				['C', makeCell('w0rd', { regularizedText: 'word', alignmentValue: 'word' })],
				['D', makeCell('word')],
			]),
		];

		const readings = buildReadingProposal({
			columns,
			spanColumnIds: ['col-1'],
			sourceWitnessIds: ['A', 'B', 'C', 'D'],
			baseWitnessId: 'A',
		});

		expect(
			readings.map(reading => ({
				label: reading.label,
				text: reading.text,
				normalizedText: reading.normalizedText,
				witnessIds: reading.witnessIds,
				parentReadingId: reading.parentReadingId,
				isSubreading: reading.isSubreading,
			}))
		).toEqual([
			{
				label: 'a',
				text: 'zeta',
				normalizedText: 'zeta',
				witnessIds: ['A'],
				parentReadingId: null,
				isSubreading: false,
			},
			{
				label: 'b',
				text: 'word',
				normalizedText: 'word',
				witnessIds: ['B', 'D'],
				parentReadingId: null,
				isSubreading: false,
			},
			{
				label: 'b1',
				text: 'w0rd',
				normalizedText: 'word',
				witnessIds: ['C'],
				parentReadingId: 'col-1::word::original',
				isSubreading: true,
			},
		]);
	});

	it('keeps omission and lacuna readings separate and primary', () => {
		const columns = [
			makeColumn([
				['A', makeCell('text')],
				['B', makeCell(null)],
				[
					'C',
					makeCell('', {
						regularizedText: null,
						alignmentValue: null,
						kind: 'gap',
						isOmission: false,
						isLacuna: true,
					}),
				],
			]),
		];

		const readings = buildReadingProposal({
			columns,
			spanColumnIds: ['col-1'],
			sourceWitnessIds: ['A', 'B', 'C'],
			baseWitnessId: 'A',
		});

		expect(
			readings.map(reading => ({
				label: reading.label,
				text: reading.text,
				witnessIds: reading.witnessIds,
				isOmission: reading.isOmission,
				isLacuna: reading.isLacuna,
				parentReadingId: reading.parentReadingId,
			}))
		).toEqual([
			{
				label: 'a',
				text: 'text',
				witnessIds: ['A'],
				isOmission: false,
				isLacuna: false,
				parentReadingId: null,
			},
			{
				label: 'b',
				text: null,
				witnessIds: ['C'],
				isOmission: false,
				isLacuna: true,
				parentReadingId: null,
			},
			{
				label: 'c',
				text: null,
				witnessIds: ['B'],
				isOmission: true,
				isLacuna: false,
				parentReadingId: null,
			},
		]);
	});
});
