import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';

import { createCbgmEngine, type CbgmEngine } from '../src/index';
import { computeCache, defaults, dumpTables, readFixture } from './support';

const runs = [
	{ fixture: 'default', settings: defaults },
	{ fixture: 'classic', settings: { ...defaults, classicRules: true } },
	{
		fixture: 'dropped-ambiguous-merge-splits',
		settings: { ...defaults, droppedReadingTypes: ['ambiguous'], mergeSplitReadings: true },
	},
];

describe.each(runs)(
	'coherence parity with native open-cbgm v2.1: $fixture',
	({ fixture, settings }) => {
		let engine: CbgmEngine;
		let cache: Uint8Array;

		beforeAll(async () => {
			engine = await createCbgmEngine();
			cache = computeCache(engine, settings);
			engine.open(cache, { excludedWitnesses: [], minExtantProportion: null });
		}, 120_000);

		it('assembles the native cache tables row for row', () => {
			const expected = JSON.parse(
				gunzipSync(readFixture(fixture, 'tables.json.gz')).toString('utf8')
			);
			expected.GENEALOGICAL_COMPARISONS = expected.GENEALOGICAL_COMPARISONS.map(
				(row: string[], rowId: number) => [rowId, ...row]
			);
			expect(dumpTables(cache)).toEqual(expected);
		});

		it('compares a primary witness against all witnesses', () => {
			expect(engine.compareWitnesses('5', [])).toEqual(
				JSON.parse(readFixture(fixture, 'compare-all.json').toString('utf8'))
			);
		});

		it('compares a primary witness against a list of witnesses', () => {
			expect(engine.compareWitnesses('5', ['A', '01', '03', '623'])).toEqual(
				JSON.parse(readFixture(fixture, 'compare-list.json').toString('utf8'))
			);
		});
	}
);
