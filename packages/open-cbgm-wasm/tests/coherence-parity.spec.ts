import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';

import { createCbgmEngine, type CbgmEngine } from '../src/index';
import { computeCache, dumpTables, expectedTable, readFixture, runs } from './support';

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
				expectedTable(fixture, 'compare-all.json')
			);
		});

		it('compares a primary witness against a list of witnesses', () => {
			expect(engine.compareWitnesses('5', ['A', '01', '03', '623'])).toEqual(
				expectedTable(fixture, 'compare-list.json')
			);
		});
	}
);
