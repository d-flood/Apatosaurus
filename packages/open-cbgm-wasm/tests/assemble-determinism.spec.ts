import { describe, expect, it } from 'vitest';

import { createCbgmEngine } from '../src/index';
import { computeCache, defaults, inputTei, sha256, shuffled } from './support';

describe('assemble determinism', () => {
	it('assembles identical bytes across instances given shuffled witness assignments', async () => {
		const [serial, first, second] = await Promise.all([
			createCbgmEngine(),
			createCbgmEngine(),
			createCbgmEngine(),
		]);
		const expected = sha256(computeCache(serial, defaults));
		const { witnesses } = first.prepare(inputTei, defaults);
		second.prepare(inputTei, defaults);
		const rows = new Map(
			shuffled(witnesses).map((siglum, index) => [
				siglum,
				(index % 2 ? first : second).computeWitness(siglum),
			])
		);

		expect(sha256(first.assemble(rows))).toBe(expected);
		expect(sha256(second.assemble(rows))).toBe(expected);
	}, 120_000);
});
