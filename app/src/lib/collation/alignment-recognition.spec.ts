import { describe, expect, it } from 'vitest';
import { alignmentCellFromTokens } from './alignment-cell';
import { recognizeColumns } from './alignment-recognition';
import type { AlignmentColumn } from './alignment-snapshot';

function column(id: string, tokens: Record<string, string[]>): AlignmentColumn {
	return {
		id,
		index: 0,
		merged: false,
		cells: new Map(
			Object.entries(tokens).map(([witnessId, sourceTokenIds]) => [
				witnessId,
				alignmentCellFromTokens([{ t: 'text', n: 'text', sourceTokenIds }]),
			])
		),
	};
}

describe('recognizeColumns', () => {
	it('matches identical nonempty sets over common witnesses regardless of order', () => {
		expect(
			recognizeColumns(
				[column('old', { A: ['a2', 'a1'], B: ['b1'], removed: ['r1'] })],
				[column('new', { B: ['b1'], A: ['a1', 'a2', 'a1'], added: ['n1'] })],
				['A', 'B']
			)
		).toEqual(new Map([['new', 'old']]));
	});

	it('refuses changed token sets even when most tokens match', () => {
		expect(
			recognizeColumns(
				[column('old', { A: ['a1', 'a2'], B: ['b1'] })],
				[column('new', { A: ['a1'], B: ['b1'] })],
				['A', 'B']
			)
		).toEqual(new Map());
	});

	it('uses each previous column at most once', () => {
		const result = recognizeColumns(
			[column('old-1', { A: ['a1'] }), column('old-2', { A: ['a1'] })],
			['new-1', 'new-2', 'new-3'].map(id => column(id, { A: ['a1'] })),
			['A']
		);
		expect(result).toEqual(
			new Map([
				['new-1', 'old-1'],
				['new-2', 'old-2'],
			])
		);
	});

	it('never matches empty token sets, including witnesses outside the intersection', () => {
		expect(
			recognizeColumns(
				[column('old', { A: [], B: ['b1'] })],
				[column('new', { A: [], C: ['c1'] })],
				['A']
			)
		).toEqual(new Map());
	});
});
