import { beforeAll, describe, expect, it } from 'vitest';

import {
	createCbgmEngine,
	type CbgmEngine,
	type CompareWitnessesTable,
	type UndecidedReading,
} from '../src/index';
import { computeCache, defaults, expectedTable, unfiltered } from './support';

const unit = 'B25K1V4U22-26';

describe('undecided readings split from unclear', () => {
	let engine: CbgmEngine;
	let everyReading: UndecidedReading[];

	beforeAll(async () => {
		engine = await createCbgmEngine();
		engine.open(computeCache(engine, defaults), unfiltered);
		everyReading = engine
			.units()
			.flatMap(({ id, readings }) => readings.map(reading => ({ unit: id, reading })));
	}, 120_000);

	it('counts every unclear unit as undecided when every reading is undecided', () => {
		const compare = expectedTable('default', 'compare-all.json');
		expect(engine.compareWitnesses('5', [], everyReading)).toEqual({
			...compare,
			rows: compare.rows.map((row: { uncl: number }) => ({
				...row,
				uncl: 0,
				undecided: row.uncl,
			})),
		});
		const relatives = expectedTable('default', 'relatives-all.json');
		expect(engine.findRelatives('5', unit, [], everyReading)).toEqual({
			...relatives,
			rows: relatives.rows.map((row: { uncl: number }) => ({
				...row,
				uncl: 0,
				undecided: row.uncl,
			})),
		});
	});

	it('counts a unit where only the secondary witness reads an undecided reading', () => {
		const native = expectedTable('default', 'compare-all.json');
		const table = engine.compareWitnesses('5', [], [{ unit, reading: 'd2' }]);
		expect(table).toEqual({
			...native,
			rows: native.rows.map((row: { id: string; uncl: number }) =>
				row.id === '2344' ? { ...row, uncl: row.uncl - 1, undecided: 1 } : row
			),
		});
	});

	it('splits unclear into unclear and undecided that add up to native unclear', () => {
		const undecided = [{ unit, reading: 'a' }];
		const queries: [CompareWitnessesTable, CompareWitnessesTable][] = [
			[
				engine.compareWitnesses('5', [], undecided),
				expectedTable('default', 'compare-all.json'),
			],
			[
				engine.findRelatives('5', unit, [], undecided),
				expectedTable('default', 'relatives-all.json'),
			],
		];
		for (const [table, native] of queries) {
			expect(table.rows.map(row => [row.id, row.uncl + row.undecided])).toEqual(
				native.rows.map((row: { id: string; uncl: number }) => [row.id, row.uncl])
			);
			expect(table.rows.some(row => row.undecided > 0)).toBe(true);
			expect(table.rows.some(row => row.uncl > 0)).toBe(true);
		}
	});
});
