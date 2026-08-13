import { describe, expect, it } from 'vitest';
import {
	deserializeAlignmentColumns,
	type AlignmentCell,
	type AlignmentColumn,
} from './alignment-snapshot';
import { collateToAlignmentSnapshot } from './collation-adapter';
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

/**
 * A lacunose cell as the collation pipeline really emits one, built by running the adapter over a
 * gap token. Gap and untranscribed milestones carry the `⊘` placeholder as their text, and a
 * supplied-only token collated as a gap carries the editor's restored letters — so a fixture
 * asserting an empty cell would test a shape production never produces.
 */
function makeLacunaCell(
	options: {
		kind?: 'gap' | 'untranscribed';
		source?: 'gap' | 'untranscribed' | 'supplied';
		text?: string;
	} = {}
): AlignmentCell {
	const kind = options.kind ?? 'gap';
	const source = options.source ?? 'gap';
	const gap = { source, reason: '', unit: '', extent: '' };
	const { snapshot } = collateToAlignmentSnapshot({
		witnesses: [
			{
				id: 'lacunose',
				content: 'unused',
				tokens: [
					{
						t: options.text ?? '⊘',
						n: `__${source}__:none:none:none`,
						kind,
						displayRegularized: null,
						gap,
					},
				],
			},
			{ id: 'other', content: 'unused', tokens: [{ t: 'other', n: 'other' }] },
		],
		options: { segmentation: false },
	});
	const cell = deserializeAlignmentColumns(snapshot.columns)
		.map(column => column.cells.get('lacunose'))
		.find(candidate => candidate?.kind === kind);
	if (!cell) throw new Error(`the adapter produced no ${kind} cell`);
	return cell;
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
	it('takes its lacuna fixture from the adapter, gap placeholder text and all', () => {
		expect(makeLacunaCell()).toMatchObject({
			text: '⊘',
			kind: 'gap',
			isLacuna: true,
			isOmission: false,
		});
	});

	it('builds and labels a multi-witness proposal with normalized-text subreadings and base text first', () => {
		const columns = [
			makeColumn([
				['A', makeCell('zeta')],
				['B', makeCell('word')],
				['C', makeCell('w0rd', { regularizedText: 'word', alignmentValue: 'word' })],
				['D', makeCell('word')],
			]),
		];

		const { readings } = buildReadingProposal({
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

	it('keeps an omission as a lettered reading and reports damage as non-attestation instead', () => {
		const columns = [
			makeColumn([
				['A', makeCell('text')],
				['B', makeCell(null)],
				['C', makeLacunaCell()],
			]),
		];

		const { readings, nonAttestation } = buildReadingProposal({
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
				witnessIds: ['B'],
				isOmission: true,
				isLacuna: false,
				parentReadingId: null,
			},
		]);
		expect(nonAttestation).toEqual({ witnessIds: ['C'], untranscribedWitnessIds: [] });
	});

	it('letters readings identically whether a witness is lacunose or simply absent', () => {
		const attested: Array<[string, AlignmentCell]> = [
			['A', makeCell('alpha')],
			['B', makeCell('beta')],
			['C', makeCell('beta')],
		];

		const withoutLacuna = buildReadingProposal({
			columns: [makeColumn(attested)],
			spanColumnIds: ['col-1'],
			sourceWitnessIds: ['A', 'B', 'C'],
			baseWitnessId: 'A',
		});
		const withLacuna = buildReadingProposal({
			columns: [makeColumn([...attested, ['D', makeLacunaCell()]])],
			spanColumnIds: ['col-1'],
			sourceWitnessIds: ['A', 'B', 'C', 'D'],
			baseWitnessId: 'A',
		});

		const shape = (proposal: { readings: typeof withLacuna.readings }) =>
			proposal.readings.map(reading => [reading.label, reading.text, reading.witnessIds]);

		expect(shape(withLacuna)).toEqual(shape(withoutLacuna));
		expect(withLacuna.readings.some(reading => reading.isLacuna)).toBe(false);
		expect(withLacuna.nonAttestation.witnessIds).toEqual(['D']);
	});

	it('does not inflate witness counts, so a lacunose majority cannot reorder readings', () => {
		const { readings, nonAttestation } = buildReadingProposal({
			columns: [
				makeColumn([
					['A', makeCell('alpha')],
					['B', makeCell('beta')],
					['C', makeCell('beta')],
					['D', makeLacunaCell()],
					['E', makeLacunaCell()],
					['F', makeLacunaCell()],
				]),
			],
			spanColumnIds: ['col-1'],
			sourceWitnessIds: ['A', 'B', 'C', 'D', 'E', 'F'],
			baseWitnessId: null,
		});

		expect(readings.map(reading => [reading.label, reading.text])).toEqual([
			['a', 'beta'],
			['b', 'alpha'],
		]);
		expect(nonAttestation.witnessIds).toEqual(['D', 'E', 'F']);
	});

	it('holds untranscribed witnesses apart from damaged ones', () => {
		const { readings, nonAttestation } = buildReadingProposal({
			columns: [
				makeColumn([
					['A', makeCell('alpha')],
					['B', makeLacunaCell()],
					['C', makeLacunaCell({ kind: 'untranscribed', source: 'untranscribed' })],
					// Supplied text collated as a gap keeps the editor's restored letters as its
					// text, so only the cell's kind can tell that the witness does not testify.
					['D', makeLacunaCell({ source: 'supplied', text: 'λογος' })],
				]),
			],
			spanColumnIds: ['col-1'],
			sourceWitnessIds: ['A', 'B', 'C', 'D'],
			baseWitnessId: 'A',
		});

		expect(readings.map(reading => reading.witnessIds)).toEqual([['A']]);
		expect(nonAttestation).toEqual({
			witnessIds: ['B', 'D'],
			untranscribedWitnessIds: ['C'],
		});
	});
});
