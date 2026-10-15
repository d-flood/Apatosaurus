import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';

import { createCbgmEngine, type CbgmEngine } from '../src/index';
import {
	computeCache,
	expectedTable,
	readFixture,
	readJsonFixture,
	runs,
	shuffled,
	unfiltered,
} from './support';

type NativeFlow = { flow: string; attestations: [string, string][]; variants: string };

const relatives = [
	{ name: 'all', readings: [] },
	{ name: 'one', readings: ['b'] },
	{ name: 'two', readings: ['a', 'd'] },
];

const substemmata = ['025', '5', 'A', '03'].flatMap(witness => [
	{ witness, maxCost: undefined, name: `substemmata-${witness}.txt` },
	{ witness, maxCost: 5, name: `substemmata-${witness}-b5.txt` },
]);

const flows = [
	{ name: 'plain', opts: { strengths: false } },
	{ name: 'strengths', opts: { strengths: true } },
	{ name: 'k3', opts: { strengths: false, connectivityLimit: 3 } },
];

const stemmata = [
	{ name: 'plain', opts: { lengths: false, strengths: false } },
	{ name: 'lengths', opts: { lengths: true, strengths: false } },
	{ name: 'strengths', opts: { lengths: false, strengths: true } },
	{ name: 'lengths-strengths', opts: { lengths: true, strengths: true } },
];

function nativeSubstemmata(output: string, witness: string) {
	if (output.startsWith('{')) return JSON.parse(output);
	if (output.includes(`${witness} has no potential ancestors`))
		return { kind: 'no-potential-ancestors' };
	if (output.includes(`${witness} cannot be explained by any of its potential ancestors`)) {
		return { kind: 'no-data' };
	}
	if (output.startsWith('No substemma exists with a cost below')) {
		return expect.objectContaining({ primary_wit: witness, rows: [] });
	}
	throw new Error(`Unexpected native output: ${output}`);
}

describe.each(runs)(
	'query parity with native open-cbgm v2.1: $fixture',
	({ fixture, settings }) => {
		let engine: CbgmEngine;
		let cache: Uint8Array;

		beforeAll(async () => {
			engine = await createCbgmEngine();
			cache = computeCache(engine, settings);
			engine.open(cache, unfiltered);
		}, 120_000);

		it('lists the native witnesses and variation units', () => {
			const tables = JSON.parse(
				gunzipSync(readFixture(fixture, 'tables.json.gz')).toString('utf8')
			);
			expect(engine.witnesses()).toEqual(
				tables.WITNESSES.map(([, witness]: string[]) => witness)
			);
			expect(engine.units()).toEqual(
				tables.VARIATION_UNITS.map(([, id, label]: string[]) => ({
					id,
					label,
					readings: tables.READINGS.filter(([, unit]: string[]) => unit === id).map(
						([, , reading]: string[]) => reading
					),
				}))
			);
		});

		it('lists only the witnesses the open filter keeps', async () => {
			const filtered = await createCbgmEngine();
			filtered.open(cache, { excludedWitnesses: ['A', '5'], minExtantProportion: null });
			expect(filtered.witnesses()).toEqual(
				engine.witnesses().filter(w => w !== 'A' && w !== '5')
			);
		});

		it.each(relatives)('finds relatives with $name readings', ({ name, readings }) => {
			expect(engine.findRelatives('5', 'B25K1V4U22-26', readings)).toEqual(
				expectedTable(fixture, `relatives-${name}.json`)
			);
		});

		it.each(substemmata)(
			'optimizes substemmata for $witness with maximum cost $maxCost',
			({ witness, maxCost, name }) => {
				const output = readFixture(fixture, name).toString('utf8').trim();
				expect(engine.optimizeSubstemmata(witness, maxCost)).toEqual(
					nativeSubstemmata(output, witness)
				);
			}
		);

		it.each(flows)(
			'draws $name textual flow, attestation and variant DOT',
			({ name, opts }) => {
				const units: Record<string, NativeFlow> = readJsonFixture(
					fixture,
					`textual-flow-${name}.json`
				);
				for (const [unit, native] of Object.entries(units)) {
					expect(engine.textualFlow(unit, 'flow', opts)).toBe(native.flow);
					expect(engine.textualFlow(unit, 'attestations', opts)).toBe(
						native.attestations.map(([, dot]) => dot).join('')
					);
					expect(engine.textualFlow(unit, 'variants', opts)).toBe(native.variants);
				}
			},
			30_000
		);

		describe('global stemma', () => {
			let substemmaByWitness: Map<string, string[]>;

			beforeAll(async () => {
				const [first, second] = await Promise.all([createCbgmEngine(), createCbgmEngine()]);
				first.open(cache, unfiltered);
				second.open(cache, unfiltered);
				substemmaByWitness = new Map(
					shuffled(engine.witnesses()).map((witness, index) => [
						witness,
						(index % 2 ? first : second).optimizeSubstemma(witness) ?? [],
					])
				);
			}, 120_000);

			it.each(stemmata)('assembles the $name global stemma DOT', ({ name, opts }) => {
				expect(engine.globalStemma(substemmaByWitness, opts)).toBe(
					readFixture(fixture, `global-stemma-${name}.dot`).toString('utf8')
				);
			});
		});
	}
);
