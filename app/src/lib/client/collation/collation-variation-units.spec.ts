import { describe, expect, it } from 'vitest';
import { deserializeAlignmentColumns } from './alignment-snapshot';
import {
	buildCollapsedReadingGroups,
	buildReadingFamilyGroups,
	buildVariationUnitSpans,
	isVariationColumn,
} from './collation-variation-units';

function makeGroupedRows(...witnessIds: string[]) {
	return witnessIds.map((witnessId) => ({ witnessIds: [witnessId] }));
}

describe('collation variation units', () => {
	it('identifies variation columns as individual units', () => {
		const columns = deserializeAlignmentColumns([
			{
				id: 'col-1',
				index: 0,
				merged: false,
				cells: [
					['A', { text: 'και', regularizedText: 'και', alignmentValue: 'και', sourceTokenIds: ['A::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
					['B', { text: 'και', regularizedText: 'και', alignmentValue: 'και', sourceTokenIds: ['B::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
				],
			},
			{
				id: 'col-2',
				index: 1,
				merged: false,
				cells: [
					['A', { text: 'ο', regularizedText: 'ο', alignmentValue: 'ο', sourceTokenIds: ['A::1'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
					['B', { text: 'του', regularizedText: 'του', alignmentValue: 'του', sourceTokenIds: ['B::1'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
				],
			},
			{
				id: 'col-3',
				index: 2,
				merged: false,
				cells: [
					['A', { text: 'λογος', regularizedText: 'λογος', alignmentValue: 'λογος', sourceTokenIds: ['A::2'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
					['B', { text: 'λογου', regularizedText: 'λογου', alignmentValue: 'λογου', sourceTokenIds: ['B::2'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
				],
			},
			{
				id: 'col-4',
				index: 3,
				merged: false,
				cells: [
					['A', { text: 'ην', regularizedText: 'ην', alignmentValue: 'ην', sourceTokenIds: ['A::3'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
					['B', { text: 'ην', regularizedText: 'ην', alignmentValue: 'ην', sourceTokenIds: ['B::3'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
				],
			},
		]);

		expect(isVariationColumn(columns[0]!)).toBe(false);
		expect(isVariationColumn(columns[1]!)).toBe(true);
		expect(isVariationColumn(columns[2]!)).toBe(true);
		expect(isVariationColumn(columns[3]!)).toBe(false);
		expect(buildVariationUnitSpans(columns)).toEqual([
			{ startIndex: 1, endIndex: 1, columnIds: ['col-2'] },
			{ startIndex: 2, endIndex: 2, columnIds: ['col-3'] },
		]);
	});

	it('attaches original-mode regularized readings under their aligned parent', () => {
		const columns = deserializeAlignmentColumns([
			{
				id: 'col-1',
				index: 0,
				merged: false,
				cells: [
					[
						'A',
						{
							text: 'θεος',
							regularizedText: 'θεος',
							alignmentValue: 'θεος',
							sourceTokenIds: ['A::0'],
							kind: 'text',
							gap: null,
							isOmission: false,
							isLacuna: false,
							isRegularized: false,
							ruleIds: [],
							regularizationTypes: [],
							originalSegments: [
								{ text: 'θεος', hasUnclear: false, isPunctuation: false, isSupplied: false },
							],
						},
					],
					[
						'B',
						{
							text: 'θς',
							regularizedText: 'θεος',
							alignmentValue: 'θεος',
							sourceTokenIds: ['B::0'],
							kind: 'text',
							gap: null,
							isOmission: false,
							isLacuna: false,
							isRegularized: true,
							ruleIds: ['rule-1'],
							regularizationTypes: ['ns'],
							originalSegments: [
								{ text: 'θς', hasUnclear: false, isPunctuation: false, isSupplied: false },
							],
						},
					],
					[
						'C',
						{
							text: 'θ(εο)ς',
							regularizedText: 'θεος',
							alignmentValue: 'θεος',
							sourceTokenIds: ['C::0'],
							kind: 'text',
							gap: null,
							isOmission: false,
							isLacuna: false,
							isRegularized: true,
							ruleIds: ['rule-2'],
							regularizationTypes: ['ns'],
							originalSegments: [
								{ text: 'θ(εο)ς', hasUnclear: false, isPunctuation: false, isSupplied: false },
							],
						},
					],
				],
			},
		]);

		const groups = buildCollapsedReadingGroups({
			column: columns[0]!,
			groupedRows: makeGroupedRows('A', 'B', 'C'),
			alignmentDisplayMode: 'original',
			baseWitnessId: 'A',
		});

		expect(groups).toHaveLength(1);
		expect(groups[0]?.parent.label).toBe('a.');
		expect(groups[0]?.parent.witnessIds).toEqual(['A']);
		expect(groups[0]?.children.map((reading) => reading.label)).toEqual(['a1', 'a2']);
		expect(groups[0]?.children.map((reading) => reading.witnessIds)).toEqual([['C'], ['B']]);
	});

	it('attaches all original-form readings to the preferred primary within an equivalence group', () => {
		const columns = deserializeAlignmentColumns([
			{
				id: 'col-1',
				index: 0,
				merged: false,
				cells: [
					[
						'A',
						{
							text: 'θεος',
							regularizedText: 'θεος',
							alignmentValue: 'θεος',
							sourceTokenIds: ['A::0'],
							kind: 'text',
							gap: null,
							isOmission: false,
							isLacuna: false,
							isRegularized: false,
							ruleIds: [],
							regularizationTypes: [],
							originalSegments: [
								{ text: 'θεος', hasUnclear: false, isPunctuation: false, isSupplied: false },
							],
						},
					],
					[
						'B',
						{
							text: 'θεοσ',
							regularizedText: 'θεος',
							alignmentValue: 'θεος',
							sourceTokenIds: ['B::0'],
							kind: 'text',
							gap: null,
							isOmission: false,
							isLacuna: false,
							isRegularized: false,
							ruleIds: [],
							regularizationTypes: [],
							originalSegments: [
								{ text: 'θεοσ', hasUnclear: false, isPunctuation: false, isSupplied: false },
							],
						},
					],
					[
						'C',
						{
							text: 'θς',
							regularizedText: 'θεος',
							alignmentValue: 'θεος',
							sourceTokenIds: ['C::0'],
							kind: 'text',
							gap: null,
							isOmission: false,
							isLacuna: false,
							isRegularized: true,
							ruleIds: ['rule-1'],
							regularizationTypes: ['ns'],
							originalSegments: [
								{ text: 'θς', hasUnclear: false, isPunctuation: false, isSupplied: false },
							],
						},
					],
				],
			},
		]);

		const groups = buildCollapsedReadingGroups({
			column: columns[0]!,
			groupedRows: makeGroupedRows('A', 'B', 'C'),
			alignmentDisplayMode: 'original',
			baseWitnessId: 'A',
		});

		expect(groups).toHaveLength(1);
		expect(groups[0]?.parent.label).toBe('a.');
		expect(groups[0]?.parent.witnessIds).toEqual(['A']);
		expect(groups[0]?.children.map((reading) => reading.label)).toEqual(['a1', 'a2']);
		expect(groups[0]?.children.map((reading) => reading.witnessIds)).toEqual([['B'], ['C']]);
	});

	it('keeps the number of primary original readings aligned with regularized groups', () => {
		const columns = deserializeAlignmentColumns([
			{
				id: 'col-1',
				index: 0,
				merged: false,
				cells: [
					['A', { text: 'alpha', regularizedText: 'omega', alignmentValue: 'omega', sourceTokenIds: ['A::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
					['B', { text: 'beta', regularizedText: 'omega', alignmentValue: 'omega', sourceTokenIds: ['B::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
					['C', { text: 'abbr', regularizedText: 'omega', alignmentValue: 'omega', sourceTokenIds: ['C::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: true, ruleIds: ['rule-1'], regularizationTypes: ['ns'] }],
					['D', { text: 'delta', regularizedText: 'delta', alignmentValue: 'delta', sourceTokenIds: ['D::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
					['E', { text: 'delta-alt', regularizedText: 'delta', alignmentValue: 'delta', sourceTokenIds: ['E::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
				],
			},
		]);

		const regularizedGroups = buildCollapsedReadingGroups({
			column: columns[0]!,
			groupedRows: makeGroupedRows('A', 'B', 'C', 'D', 'E'),
			alignmentDisplayMode: 'regularized',
			baseWitnessId: 'A',
		});

		const originalGroups = buildCollapsedReadingGroups({
			column: columns[0]!,
			groupedRows: makeGroupedRows('A', 'B', 'C', 'D', 'E'),
			alignmentDisplayMode: 'original',
			baseWitnessId: 'A',
		});

		expect(regularizedGroups).toHaveLength(2);
		expect(originalGroups).toHaveLength(2);
		expect(originalGroups[0]?.children.map((reading) => reading.witnessIds)).toEqual([['C'], ['B']]);
		expect(originalGroups[1]?.children.map((reading) => reading.witnessIds)).toEqual([['E']]);
	});

	it('builds reusable reading families with a preferred parent and children', () => {
		const columns = deserializeAlignmentColumns([
			{
				id: 'col-1',
				index: 0,
				merged: false,
				cells: [
					['A', { text: 'θεος', regularizedText: 'θεος', alignmentValue: 'θεος', sourceTokenIds: ['A::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
					['B', { text: 'θς', regularizedText: 'θεος', alignmentValue: 'θεος', sourceTokenIds: ['B::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: true, ruleIds: ['rule-1'], regularizationTypes: ['ns'] }],
					['C', { text: 'θεοσ', regularizedText: 'θεος', alignmentValue: 'θεος', sourceTokenIds: ['C::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
				],
			},
		]);

		const families = buildReadingFamilyGroups({
			entries: ['A', 'B', 'C'].map(witnessId => ({
				witnessId,
				cells: [columns[0]?.cells.get(witnessId)],
			})),
			baseWitnessId: 'A',
			columnId: 'col-1',
		});

		expect(families).toHaveLength(1);
		expect(families[0]?.parent.witnessIds).toEqual(['A']);
		expect(families[0]?.children.map(reading => reading.witnessIds)).toEqual([['C'], ['B']]);
		expect(families[0]?.parent.normalizedText).toBe('θεος');
	});

	it('aggregates witness ids for regularized display groups', () => {
		const columns = deserializeAlignmentColumns([
			{
				id: 'col-1',
				index: 0,
				merged: false,
				cells: [
					['A', { text: 'θεος', regularizedText: 'θεος', alignmentValue: 'θεος', sourceTokenIds: ['A::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
					['B', { text: 'θς', regularizedText: 'θεος', alignmentValue: 'θεος', sourceTokenIds: ['B::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: true, ruleIds: ['rule-1'], regularizationTypes: ['ns'] }],
				],
			},
		]);

		const groups = buildCollapsedReadingGroups({
			column: columns[0]!,
			groupedRows: makeGroupedRows('A', 'B'),
			alignmentDisplayMode: 'regularized',
			baseWitnessId: 'A',
		});

		expect(groups[0]?.parent.witnessIds).toEqual(['A', 'B']);
	});

	it('collapses identical original readings even when their source segments differ', () => {
		const columns = deserializeAlignmentColumns([
			{
				id: 'col-1',
				index: 0,
				merged: false,
				cells: [
					[
						'A',
						{
							text: 'προφητικων',
							regularizedText: 'προφητικων',
							alignmentValue: 'προφητικων',
							sourceTokenIds: ['A::0'],
							kind: 'text',
							gap: null,
							isOmission: false,
							isLacuna: false,
							isRegularized: false,
							ruleIds: [],
							regularizationTypes: [],
							originalSegments: [
								{ text: 'προφητικων', hasUnclear: false, isPunctuation: false, isSupplied: false },
							],
						},
					],
					[
						'B',
						{
							text: 'προφητικων',
							regularizedText: 'προφητικων',
							alignmentValue: 'προφητικων',
							sourceTokenIds: ['B::0'],
							kind: 'text',
							gap: null,
							isOmission: false,
							isLacuna: false,
							isRegularized: false,
							ruleIds: [],
							regularizationTypes: [],
							originalSegments: [
								{ text: 'προ', hasUnclear: false, isPunctuation: false, isSupplied: false },
								{ text: 'φητικων', hasUnclear: false, isPunctuation: false, isSupplied: false },
							],
						},
					],
				],
			},
		]);

		const originalGroups = buildCollapsedReadingGroups({
			column: columns[0]!,
			groupedRows: makeGroupedRows('A', 'B'),
			alignmentDisplayMode: 'original',
			baseWitnessId: 'A',
		});

		expect(originalGroups).toHaveLength(1);
		expect(originalGroups[0]?.parent.witnessIds).toEqual(['A', 'B']);
		expect(originalGroups[0]?.children).toEqual([]);
	});

	it('uses the highest-priority regularized reading as parent when an equivalence group has no unregularized form', () => {
		const columns = deserializeAlignmentColumns([
			{
				id: 'col-1',
				index: 0,
				merged: false,
				cells: [
					['A', { text: 'alpha', regularizedText: 'omega', alignmentValue: 'omega', sourceTokenIds: ['A::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: true, ruleIds: ['rule-1'], regularizationTypes: ['ns'] }],
					['B', { text: 'beta', regularizedText: 'omega', alignmentValue: 'omega', sourceTokenIds: ['B::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: true, ruleIds: ['rule-2'], regularizationTypes: ['ns'] }],
					['C', { text: 'beta', regularizedText: 'omega', alignmentValue: 'omega', sourceTokenIds: ['C::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: true, ruleIds: ['rule-2'], regularizationTypes: ['ns'] }],
					['D', { text: 'gamma', regularizedText: 'omega', alignmentValue: 'omega', sourceTokenIds: ['D::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: true, ruleIds: ['rule-3'], regularizationTypes: ['ns'] }],
				],
			},
		]);

		const groups = buildCollapsedReadingGroups({
			column: columns[0]!,
			groupedRows: makeGroupedRows('A', 'B', 'C', 'D'),
			alignmentDisplayMode: 'original',
			baseWitnessId: null,
		});

		expect(groups).toHaveLength(1);
		expect(groups[0]?.parent.witnessIds).toEqual(['B', 'C']);
		expect(groups[0]?.children.map((reading) => reading.label)).toEqual(['a1', 'a2']);
		expect(groups[0]?.children.map((reading) => reading.witnessIds)).toEqual([['A'], ['D']]);
	});

	it('keeps regularized-mode readings as flat primary labels', () => {
		const columns = deserializeAlignmentColumns([
			{
				id: 'col-1',
				index: 0,
				merged: false,
				cells: [
					['A', { text: 'θεος', regularizedText: 'θεος', alignmentValue: 'θεος', sourceTokenIds: ['A::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
					['B', { text: 'θς', regularizedText: 'θεος', alignmentValue: 'θεος', sourceTokenIds: ['B::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: true, ruleIds: ['rule-1'], regularizationTypes: ['ns'] }],
					['C', { text: 'κυριος', regularizedText: 'κυριος', alignmentValue: 'κυριος', sourceTokenIds: ['C::0'], kind: 'text', gap: null, isOmission: false, isLacuna: false, isRegularized: false, ruleIds: [], regularizationTypes: [] }],
				],
			},
		]);

		const groups = buildCollapsedReadingGroups({
			column: columns[0]!,
			groupedRows: makeGroupedRows('A', 'B', 'C'),
			alignmentDisplayMode: 'regularized',
			baseWitnessId: 'A',
		});

		expect(groups.map((group) => group.parent.label)).toEqual(['a.', 'b.']);
		expect(groups.every((group) => group.children.length === 0)).toBe(true);
	});
});
