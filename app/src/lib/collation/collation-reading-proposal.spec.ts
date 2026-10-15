import { describe, expect, it } from 'vitest';
import {
	deserializeAlignmentColumns,
	type AlignmentCell,
	type AlignmentColumn,
} from './alignment-snapshot';
import { collateToAlignmentSnapshot } from './collation-adapter';
import { applyDecisions } from './collation-decisions';
import { buildReadingProposal, relabelReadings } from './collation-reading-proposal';
import type { ClassifiedReading } from './collation-types';
import { BUNDLED_READING_TYPES, resolveReadingTypeVocabulary } from './reading-types';

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
				label: 'b?',
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

function makeReading(
	id: string,
	order: number,
	options: { parent?: string; type?: string | null } = {}
): ClassifiedReading {
	return {
		id,
		order,
		label: '',
		text: id,
		normalizedText: id,
		witnessIds: [id],
		witnessGroups: [],
		isOmission: false,
		isLacuna: false,
		readingType: options.type ?? null,
		certainty: null,
		parentReadingId: options.parent ?? null,
		isSubreading: options.parent !== undefined,
		autoGenerated: false,
		derivedFromRuleIds: [],
	};
}

function labelsOf(
	readings: ClassifiedReading[],
	vocabulary = BUNDLED_READING_TYPES
): Record<string, string> {
	return Object.fromEntries(
		relabelReadings(readings, null, null, vocabulary).map(reading => [
			reading.id,
			reading.label,
		])
	);
}

describe('subreading labels', () => {
	it("labels a subreading by its main reading's letter and its type's suffix", () => {
		expect(
			labelsOf([
				makeReading('main', 0),
				makeReading('spelling', 0, { parent: 'main', type: 'orthographic' }),
			])
		).toEqual({ main: 'a', spelling: 'ao' });
	});

	it('numbers subreadings of one main reading that share a type, in reading order', () => {
		expect(
			labelsOf([
				makeReading('main', 0),
				makeReading('other', 1),
				makeReading('second', 2, { parent: 'main', type: 'nonsense' }),
				makeReading('spelling', 1, { parent: 'main', type: 'orthographic' }),
				makeReading('first', 0, { parent: 'main', type: 'nonsense' }),
				makeReading('elsewhere', 0, { parent: 'other', type: 'nonsense' }),
			])
		).toEqual({
			main: 'a',
			other: 'b',
			first: 'af1',
			spelling: 'ao',
			second: 'af2',
			elsewhere: 'bf',
		});
	});

	it('labels an untyped subreading with ?, numbered like a type', () => {
		expect(
			labelsOf([makeReading('main', 0), makeReading('untyped', 0, { parent: 'main' })])
		).toEqual({ main: 'a', untyped: 'a?' });
		expect(
			labelsOf([
				makeReading('main', 0),
				makeReading('first', 0, { parent: 'main' }),
				makeReading('second', 1, { parent: 'main', type: 'unknown-type' }),
			])
		).toEqual({ main: 'a', first: 'a?1', second: 'a?2' });
	});

	it('types a subreading recorded as having no type from the proposal, and only then leaves it untyped', () => {
		const view = applyDecisions(
			[
				makeReading('main', 0),
				makeReading('damaged', 0, { parent: 'main', type: 'deficient' }),
				makeReading('plain', 1, { parent: 'main' }),
			],
			{ readingType: { damaged: null, plain: null } }
		);

		expect(
			Object.fromEntries(view.readings.map(reading => [reading.id, reading.label]))
		).toEqual({ main: 'a', damaged: 'ad', plain: 'a?' });
	});

	it("labels a project type's subreadings by the project's suffix", () => {
		const readings = [
			makeReading('main', 0),
			makeReading('itacism', 0, { parent: 'main', type: 'itacism' }),
		];
		const vocabulary = resolveReadingTypeVocabulary([
			{ id: 'itacism', label: 'Itacism', description: '', selectable: true, suffix: 'i' },
		]);

		expect(labelsOf(readings, vocabulary)).toEqual({ main: 'a', itacism: 'ai' });
		expect(labelsOf(readings)).toEqual({ main: 'a', itacism: 'a?' });
	});

	it('labels nested subreadings flat from their main reading', () => {
		expect(
			labelsOf([
				makeReading('main', 0),
				makeReading('child', 0, { parent: 'main', type: 'orthographic' }),
				makeReading('grandchild', 1, { parent: 'child', type: 'orthographic' }),
				makeReading('damaged', 2, { parent: 'child', type: 'deficient' }),
			])
		).toEqual({ main: 'a', child: 'ao1', grandchild: 'ao2', damaged: 'ad' });
	});
});
