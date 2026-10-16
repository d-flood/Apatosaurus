import {
	createCbgmEngine,
	type CbgmEngine,
	type CoherenceSettings,
} from '@apatosaurus/open-cbgm-wasm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AlignmentCell } from '$lib/collation/alignment-snapshot';
import { buildCollationDocument, type CollationDocument } from '$lib/collation/collation-document';
import { collationState, type WitnessConfig } from '$lib/collation/collation-state.svelte';
import { buildCbgmInput } from './cbgm-input';

const UNIT = 'unit:variant';

const defaults: CoherenceSettings = {
	minExtantUnits: null,
	minExtantProportion: null,
	excludedWitnesses: [],
	classicRules: false,
	mergeSplitReadings: false,
	droppedReadingTypes: [],
	includedCorrectors: [],
};

function witness(siglum: string, options: Partial<WitnessConfig> = {}): WitnessConfig {
	return {
		witnessId: siglum,
		siglum,
		transcriptionId: `${siglum}-transcription`,
		content: '',
		tokens: [],
		treatment: 'inherit',
		isBaseText: false,
		isExcluded: false,
		overridesDefault: false,
		...options,
	};
}

function text(value: string, hasUnclear = false): AlignmentCell {
	return {
		text: value,
		regularizedText: value,
		alignmentValue: value,
		sourceTokenIds: [],
		kind: 'text',
		gap: null,
		isOmission: false,
		isLacuna: false,
		isRegularized: false,
		ruleIds: [],
		regularizationTypes: [],
		originalSegments: [{ text: value, hasUnclear, isPunctuation: false, isSupplied: false }],
	};
}

function gap(kind: 'gap' | 'untranscribed'): AlignmentCell {
	return {
		...text('⊘'),
		regularizedText: null,
		alignmentValue: `__${kind}__:none:none:none`,
		kind,
		gap: { source: kind, reason: '', unit: '', extent: '' },
		isLacuna: true,
	};
}

function collate(witnesses: WitnessConfig[], variant: Record<string, AlignmentCell>) {
	collationState.reset();
	collationState.setWitnesses(witnesses);
	const ids = witnesses.map(entry => entry.witnessId);
	const agreed = (id: string, index: number) => ({
		id,
		index,
		merged: false,
		cells: ids.map(witnessId => [witnessId, text(id)] as [string, AlignmentCell]),
	});
	collationState.setAlignmentSnapshot({
		witnessOrder: ids,
		columns: [
			agreed('one', 0),
			{
				id: 'variant',
				index: 1,
				merged: false,
				cells: ids.map(witnessId => [witnessId, variant[witnessId]]),
			},
			agreed('two', 2),
		],
	});
}

function reading(value: string) {
	const found = collationState.peekReadingsForUnit(UNIT).find(entry => entry.text === value);
	if (!found) throw new Error(`No reading ${value}`);
	return found;
}

function saved(collationId: string, segmentName: string): CollationDocument {
	return buildCollationDocument({
		collationId,
		projectId: null,
		projectName: null,
		phase: collationState.phase,
		furthestPhase: collationState.furthestPhase,
		segment: { id: collationId, name: segmentName, members: [segmentName] },
		witnesses: collationState.witnesses,
		rules: collationState.rules,
		ignoreWordBreaks: collationState.ignoreWordBreaks,
		lowercase: collationState.lowercase,
		ignoreTokenWhitespace: collationState.ignoreTokenWhitespace,
		ignorePunctuation: collationState.ignorePunctuation,
		suppliedTextMode: collationState.suppliedTextMode,
		segmentation: collationState.segmentation,
		alignmentColumns: collationState.alignmentColumns,
		witnessOrder: collationState.witnessOrder,
		classifiedReadings: collationState.classifiedReadings,
		unitDecisions: collationState.unitDecisions,
		readingArcs: collationState.readingArcs,
		alignmentDisplayMode: collationState.alignmentDisplayMode,
		alignmentLayout: collationState.alignmentLayout,
	});
}

describe('CBGM input builder, as coherence sees it', () => {
	it('produces identical input with several tags on main and subreadings', async () => {
		collate([witness('A', { isBaseText: true }), witness('B'), witness('C')], {
			A: text('alpha'),
			B: text('alfa'),
			C: text('beta'),
		});
		const main = reading('alpha').id;
		const sub = reading('alfa').id;
		collationState.setReadingParent(UNIT, sub, main, 'orthographic');
		const before = buildCbgmInput([saved('c1', 'John 1:1')], defaults);
		await collationState.addReadingTag(UNIT, main, 'Nomen sacrum');
		await collationState.addReadingTag(UNIT, main, 'Abbreviation');
		await collationState.addReadingTag(UNIT, sub, 'Nomen sacrum');
		expect(buildCbgmInput([saved('c1', 'John 1:1')], defaults)).toEqual(before);
	});

	let engine: CbgmEngine;

	beforeAll(async () => {
		engine = await createCbgmEngine();
	}, 120_000);

	beforeEach(() => {
		collationState.reset();
	});

	function cohere(tei: string | null, settings: CoherenceSettings = defaults) {
		if (tei === null) throw new Error('The CBGM input is blocked.');
		const prepared = engine.prepare(tei, settings);
		engine.open(
			engine.assemble(
				new Map(prepared.witnesses.map(siglum => [siglum, engine.computeWitness(siglum)]))
			),
			{ excludedWitnesses: [], minExtantProportion: null }
		);
		return prepared;
	}

	function attestations(unit: string): Record<string, string> {
		const [primary] = engine.witnesses();
		const table = engine.findRelatives(primary, unit, []);
		return Object.fromEntries([
			[primary, table.primary_rdg],
			...table.rows.map(row => [row.id, row.rdg]),
		]);
	}

	function readingsAt(unit: string): string[] {
		return engine.units().find(entry => entry.id === unit)?.readings ?? [];
	}

	it('counts subreading witnesses with their main reading, even when the subreading type is dropped', () => {
		collate([witness('A', { isBaseText: true }), witness('B'), witness('C')], {
			A: text('alpha'),
			B: text('alfa'),
			C: text('beta'),
		});
		expect(
			collationState.setReadingParent(
				UNIT,
				reading('alfa').id,
				reading('alpha').id,
				'orthographic'
			)
		).toEqual({ ok: true });
		const settings = { ...defaults, droppedReadingTypes: ['orthographic'] };

		const [unit] = cohere(
			buildCbgmInput([saved('c1', 'John 1:1')], settings).tei,
			settings
		).units;

		expect(readingsAt(unit)).toEqual(['a', 'b']);
		expect(attestations(unit)).toEqual({ A: 'a', B: 'a', C: 'b' });
	});

	it('drops only main readings whose recorded type is dropped', () => {
		collate(
			[
				witness('A', { isBaseText: true }),
				witness('B'),
				witness('C'),
				witness('D'),
				witness('E'),
			],
			{
				A: text('alpha'),
				B: text('alphx'),
				C: text('gamma'),
				D: text('delta', true),
				E: text('beta'),
			}
		);
		collationState.setReadingParent(UNIT, reading('alphx').id, reading('alpha').id, 'nonsense');
		collationState.setReadingType(UNIT, reading('gamma').id, 'nonsense');
		expect(reading('delta').readingType).toBe('deficient');
		const [beta, delta, gamma] = ['beta', 'delta', 'gamma'].map(value => reading(value).label);
		const settings = { ...defaults, droppedReadingTypes: ['nonsense', 'deficient'] };

		const [unit] = cohere(
			buildCbgmInput([saved('c1', 'John 1:1')], settings).tei,
			settings
		).units;

		expect(readingsAt(unit)).toEqual(['a', beta, delta]);
		expect(readingsAt(unit)).not.toContain(gamma);
		expect(attestations(unit)).toEqual({ A: 'a', B: 'a', C: '-', D: delta, E: beta });
	});

	it('runs with undecided sources, which create no arc and are listed as undecided', () => {
		collate([witness('A', { isBaseText: true }), witness('B'), witness('C')], {
			A: text('alpha'),
			B: text('beta'),
			C: text('gamma'),
		});
		collationState.setReadingSource(UNIT, reading('beta').id, {
			kind: 'derived',
			from: reading('alpha').id,
		});

		const input = buildCbgmInput([saved('c1', 'John 1:1')], defaults);
		const [unit] = cohere(input.tei).units;

		expect(input.blockingUnits).toEqual([]);
		expect(input.undecidedReadings).toEqual([{ unit, reading: reading('gamma').label }]);
		const [derived] = engine.compareWitnesses('B', ['A']).rows;
		expect(derived.prior + derived.posterior).toBe(1);
		const [undecided] = engine.compareWitnesses('C', ['A'], input.undecidedReadings).rows;
		expect(undecided).toMatchObject({
			prior: 0,
			posterior: 0,
			norel: 0,
			uncl: 0,
			undecided: 1,
		});
	});

	it('treats untranscribed, non-attesting and ambiguous witnesses as not attesting', () => {
		collate(
			[
				witness('A', { isBaseText: true }),
				witness('B'),
				witness('C'),
				witness('D'),
				witness('E'),
			],
			{
				A: text('alpha'),
				B: text('beta'),
				C: gap('gap'),
				D: gap('untranscribed'),
				E: text('beta'),
			}
		);
		const recorded = collationState.recordAmbiguousAttestation(
			UNIT,
			['E'],
			[reading('beta').id, reading('alpha').id]
		);
		expect(recorded.ok).toBe(true);

		const [unit] = cohere(buildCbgmInput([saved('c1', 'John 1:1')], defaults).tei).units;

		expect(readingsAt(unit)).toEqual(['a', 'b']);
		expect(attestations(unit)).toEqual({ A: 'a', B: 'b', C: '-', D: '-', E: '-' });
	});

	it('lets split readings agree only when they are merged', () => {
		collate([witness('A', { isBaseText: true }), witness('B'), witness('C')], {
			A: text('alpha'),
			B: text('beta'),
			C: text('beta'),
		});
		expect(collationState.splitWitnessesIntoNewReading(UNIT, ['C']).ok).toBe(true);
		const merged = { ...defaults, mergeSplitReadings: true };

		const [unit] = cohere(buildCbgmInput([saved('c1', 'John 1:1')], defaults).tei).units;
		expect(attestations(unit)).toEqual({ A: 'a', B: 'b1', C: 'b2' });
		expect(engine.compareWitnesses('B', ['C']).rows[0].eq).toBe(0);

		cohere(buildCbgmInput([saved('c1', 'John 1:1')], merged).tei, merged);
		expect(engine.compareWitnesses('B', ['C']).rows[0].eq).toBe(1);
	});

	it('unifies one siglum across collations and reports its transcriptions as a conflict', () => {
		collate(
			[
				witness('01', { isBaseText: true }),
				witness('P46', { transcriptionId: 'p46-romans' }),
				witness('03'),
				witness('P46c', { transcriptionId: 'p46-romans', kind: 'corrector', handId: 'c' }),
			],
			{ '01': text('alpha'), P46: text('beta'), '03': text('alpha'), P46c: text('alpha') }
		);
		const romans = saved('romans', 'Romans 1:1');
		collate(
			[
				witness('01', { isBaseText: true }),
				witness('P46', { transcriptionId: 'p46-1cor' }),
				witness('03'),
			],
			{ '01': text('gamma'), P46: text('delta'), '03': text('delta') }
		);
		const corinthians = saved('corinthians', '1 Corinthians 1:1');

		const input = buildCbgmInput([romans, corinthians], defaults);
		const { witnesses, units } = cohere(input.tei);

		expect(input.siglumConflicts).toEqual([
			{ siglum: 'P46', transcriptionIds: ['p46-romans', 'p46-1cor'] },
		]);
		expect(input.availableCorrectors).toEqual(['P46c']);
		expect(input.witnesses).toEqual(['01', 'P46', '03']);
		expect(witnesses).toEqual(['01', 'P46', '03']);
		expect(units.map(unit => attestations(unit).P46)).toEqual(['b', 'b']);
		expect(engine.compareWitnesses('P46', ['03']).rows[0]).toMatchObject({ pass: 2, eq: 1 });
		expect(
			buildCbgmInput([romans, corinthians], { ...defaults, includedCorrectors: ['P46c'] })
				.witnesses
		).toEqual(['01', 'P46', '03', 'P46c']);
	});

	it('gives units ids that are unique across collations', () => {
		const collation = (collationId: string, segmentName: string) => {
			collate([witness('A', { isBaseText: true }), witness('B')], {
				A: text('alpha'),
				B: text('beta'),
			});
			return saved(collationId, segmentName);
		};

		const { units } = cohere(
			buildCbgmInput([collation('c1', 'John 1:1'), collation('c2', 'John1:1')], defaults).tei
		);

		expect(new Set(units).size).toBe(2);
		expect(engine.units().map(unit => unit.label)).toEqual(['John 1:1/1', 'John1:1/1']);
	});

	it('blocks on a unit with no lemma reading', () => {
		collate([witness('A', { isBaseText: true }), witness('B'), witness('C')], {
			A: gap('gap'),
			B: text('beta'),
			C: text('gamma'),
		});

		const blocked = buildCbgmInput([saved('c1', 'John 1:1')], defaults);

		expect(blocked.tei).toBeNull();
		expect(blocked.blockingUnits).toEqual([
			{
				collationId: 'c1',
				unitId: 'unit:variant',
				label: 'John 1:1/1',
				kind: 'missing-lemma',
			},
		]);

		collationState.setLemmaReading(UNIT, reading('beta').id);
		const decided = buildCbgmInput([saved('c1', 'John 1:1')], defaults);
		expect(decided.blockingUnits).toEqual([]);
		expect(cohere(decided.tei).units).toHaveLength(1);
	});
});
