import { beforeAll, describe, expect, it } from 'vitest';

import { createCbgmEngine, type CbgmEngine } from '../src/index';
import { computeCache, defaults, dumpTables, queryCache, readFixture } from './support';

const rows = [
	{ witness: '5', ancestors: ['623', '2344'], completedAt: '2026-01-01T00:00:00.000Z' },
	{ witness: 'A', ancestors: [], completedAt: '2026-01-02T00:00:00.000Z' },
];

describe('APATOSAURUS_SUBSTEMMATA', () => {
	let engine: CbgmEngine;
	let cache: Uint8Array;

	beforeAll(async () => {
		engine = await createCbgmEngine();
		cache = computeCache(engine, defaults);
	}, 120_000);

	it('survives a write and read round trip', () => {
		expect(engine.readSubstemmata(engine.writeSubstemmata(cache, rows))).toEqual(
			new Map([
				['5', ['623', '2344']],
				['A', []],
			])
		);
	});

	it('writes exactly the agreed schema beside unchanged upstream tables', () => {
		const written = engine.writeSubstemmata(cache, rows);
		expect(
			queryCache(written, query => ({
				schema: query(
					"SELECT sql FROM sqlite_master WHERE name = 'APATOSAURUS_SUBSTEMMATA'"
				),
				rows: query('SELECT WITNESS, ANCESTORS, COMPLETED_AT FROM APATOSAURUS_SUBSTEMMATA'),
			}))
		).toEqual({
			schema: [
				[
					'CREATE TABLE APATOSAURUS_SUBSTEMMATA (WITNESS TEXT PRIMARY KEY, ANCESTORS TEXT NOT NULL, COMPLETED_AT TEXT NOT NULL)',
				],
			],
			rows: [
				['5', '["623","2344"]', '2026-01-01T00:00:00.000Z'],
				['A', '[]', '2026-01-02T00:00:00.000Z'],
			],
		});
		expect(dumpTables(written)).toEqual(dumpTables(cache));
	});

	it('replaces earlier substemmata when written again', () => {
		const rewritten = engine.writeSubstemmata(engine.writeSubstemmata(cache, rows), [
			{ witness: '025', ancestors: ['L938'], completedAt: '2026-01-03T00:00:00.000Z' },
		]);
		expect(engine.readSubstemmata(rewritten)).toEqual(new Map([['025', ['L938']]]));
	});

	it('reads no substemmata from a cache without the table', () => {
		expect(engine.readSubstemmata(cache)).toEqual(new Map());
	});

	it('leaves the cache readable by native compare_witnesses', () => {
		expect(readFixture('default', 'compare-all-with-substemmata.json')).toEqual(
			readFixture('default', 'compare-all.json')
		);
	});
});
