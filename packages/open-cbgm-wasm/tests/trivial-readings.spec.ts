import { beforeAll, describe, expect, it } from 'vitest';

import {
	createCbgmEngine,
	type CbgmEngine,
	type CoherenceSettings,
	type ReadingRelation,
} from '../src/index';
import { computeCache, defaults, expectedTable, inputTei, unfiltered } from './support';

const trivial: CoherenceSettings = {
	...defaults,
	trivialReadingTypes: ['defective', 'orthographic'],
};

function edge({ unit, prior, posterior }: ReadingRelation) {
	return { unit, prior, posterior };
}

function agreementsById(rows: { id: string; eq: number }[]): Record<string, number> {
	return Object.fromEntries(rows.map(row => [row.id, row.eq]));
}

describe('trivial reading types', () => {
	let engine: CbgmEngine;

	beforeAll(async () => {
		engine = await createCbgmEngine();
		engine.open(computeCache(engine, trivial), unfiltered);
	}, 120_000);

	it('weighs relations into readings of those types as 0 and keeps every other relation', () => {
		const plain = engine.prepare(inputTei, defaults).relations;
		const weighed = engine.prepare(inputTei, trivial).relations;

		expect(weighed.map(edge)).toEqual(plain.map(edge));
		const changed = weighed.filter(
			(relation, index) => relation.weight !== plain[index].weight
		);
		expect(changed.length).toBeGreaterThan(0);
		expect(changed.every(relation => relation.weight === 0)).toBe(true);
	});

	it('counts readings of those types as agreeing with their source', () => {
		const plain = agreementsById(expectedTable('default', 'compare-all.json').rows);
		const weighed = agreementsById(engine.compareWitnesses('5', []).rows);
		const ids = Object.keys(plain);

		expect(Object.keys(weighed).sort()).toEqual([...ids].sort());
		expect(ids.every(id => weighed[id] >= plain[id])).toBe(true);
		expect(ids.some(id => weighed[id] > plain[id])).toBe(true);
	});

	it('reads the relations of an opened cache as prepared', () => {
		expect(engine.relations()).toEqual(engine.prepare(inputTei, trivial).relations);
	});
});
