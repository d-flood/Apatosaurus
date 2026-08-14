import { beforeEach, describe, expect, it } from 'vitest';
import { deserializeAlignmentColumns, type AlignmentColumn } from './alignment-snapshot';
import { collateToAlignmentSnapshot } from './collation-adapter';
import {
	buildSegmentSequence,
	renderApparatusUnit,
	type ApparatusRenderOptions,
} from './collation-apparatus';
import { buildCollationProjection } from './collation-projection';
import { collationState, type WitnessConfig } from './collation-state.svelte';
import { buildVariationUnitSpans } from './collation-variation-units';
import type { WitnessSourceToken } from './collation-types';

function textTokens(content: string): WitnessSourceToken[] {
	return content
		.split(/\s+/)
		.filter(Boolean)
		.map(token => ({
			kind: 'text' as const,
			original: token,
			segments: [{ text: token, hasUnclear: false, isPunctuation: false, isSupplied: false }],
			gap: null,
		}));
}

function gapToken(): WitnessSourceToken {
	return {
		kind: 'gap',
		original: '⊘',
		segments: [],
		gap: { source: 'gap', reason: 'lacuna', unit: 'char', extent: '5' },
	};
}

function makeWitness(
	witnessId: string,
	tokens: WitnessSourceToken[],
	isBaseText = false
): WitnessConfig {
	return {
		witnessId,
		siglum: witnessId,
		transcriptionId: `${witnessId}-tx`,
		sourceVersion: 'v1',
		content: tokens.map(token => token.original).join(' '),
		tokens,
		treatment: 'inherit',
		isBaseText,
		isExcluded: false,
		overridesDefault: false,
	};
}

/** The alignment the real collation pipeline produces, never a hand-built one. */
function collate(witnesses: WitnessConfig[]): AlignmentColumn[] {
	collationState.reset();
	collationState.setWitnesses(witnesses);
	collationState.refreshCollationInput();
	const result = collateToAlignmentSnapshot({
		witnesses: collationState.buildCollationWitnessInputs(),
		options: { segmentation: false },
	});
	collationState.setAlignmentSnapshot(result.snapshot);
	return deserializeAlignmentColumns(result.snapshot.columns);
}

function sequenceFor(columns: AlignmentColumn[], baseWitnessId: string | null) {
	return buildSegmentSequence({
		columns,
		spans: buildVariationUnitSpans(columns),
		baseWitnessId,
	});
}

function coveredColumnIds(segments: ReturnType<typeof buildSegmentSequence>): string[] {
	return segments.flatMap(segment =>
		segment.kind === 'agreed' ? segment.columnIds : segment.span.columnIds
	);
}

describe('buildSegmentSequence', () => {
	beforeEach(() => {
		collationState.reset();
	});

	it('alternates agreed stretches and variation units, covering every column exactly once', () => {
		const columns = collate([
			makeWitness('A', textTokens('εν αρχη ην ο λογος'), true),
			makeWitness('B', textTokens('εν αρχη ην ο θεος')),
			makeWitness('C', textTokens('εν αρχη δε ην ο λογος')),
		]);

		const segments = sequenceFor(columns, 'A');

		expect(segments.length).toBeGreaterThan(2);
		for (const [index, segment] of segments.entries()) {
			expect(segment.kind).not.toBe(segments[index - 1]?.kind);
		}
		expect(coveredColumnIds(segments)).toEqual(columns.map(column => column.id));
	});

	it('keeps an agreed stretch whole when a witness is non-attesting across it', () => {
		const columns = collate([
			makeWitness('A', textTokens('εν χριστω ιησου τω κυριω'), true),
			makeWitness('B', textTokens('εν χριστω ιησου τω θεω')),
			makeWitness('C', [
				...textTokens('εν'),
				gapToken(),
				gapToken(),
				...textTokens('τω κυριω'),
			]),
		]);

		const segments = sequenceFor(columns, 'A');

		expect(segments.map(segment => segment.kind)).toEqual(['agreed', 'unit']);
		expect(segments[0]).toMatchObject({ kind: 'agreed', text: 'εν χριστω ιησου τω' });
		expect(coveredColumnIds(segments)).toEqual(columns.map(column => column.id));
	});

	it('takes agreed text from an attesting witness where the base witness is damaged', () => {
		const columns = collate([
			makeWitness(
				'A',
				[...textTokens('εν'), gapToken(), ...textTokens('ιησου τω κυριω')],
				true
			),
			makeWitness('B', textTokens('εν χριστω ιησου τω κυριω')),
			makeWitness('C', textTokens('εν χριστω ιησου τω θεω')),
		]);

		const segments = sequenceFor(columns, 'A');

		expect(segments[0]).toMatchObject({ kind: 'agreed', text: 'εν χριστω ιησου τω' });
	});
});

describe('renderApparatusUnit', () => {
	beforeEach(() => {
		collationState.reset();
	});

	it('renders the unit range, the lemma text, and every reading with its sigla', () => {
		collate([
			makeWitness('A', textTokens('ο λογος'), true),
			makeWitness('B', textTokens('ο λογος')),
			makeWitness('C', textTokens('ο θεος')),
			makeWitness('D', [...textTokens('ο'), gapToken()]),
		]);
		const segments = collationState.getSegmentSequence();
		const unit = segments.find(segment => segment.kind === 'unit')!;
		const view = collationState.peekUnitView(unit.span.startIndex);

		const notation = renderApparatusUnit(view, {
			label: unit.label,
			nonAttestation: collationState.getNonAttestationForUnit(unit.span.startIndex),
		});

		expect(notation).toBe(`${unit.label} ⸂ λογος ] a: A B | b: C | zz: D`);
	});

	it('cites a subreading under its main reading and shows a recorded reading type', () => {
		collate([
			makeWitness('A', textTokens('ο λογος'), true),
			makeWitness('B', textTokens('ο θεος')),
			makeWitness('C', textTokens('ο κυριος')),
		]);
		const unit = collationState.getSegmentSequence().find(segment => segment.kind === 'unit')!;
		const unitIndex = unit.span.startIndex;
		const readings = collationState.peekReadingsForUnit(unitIndex);
		const main = readings.find(reading => reading.text === 'λογος')!;
		const other = readings.find(reading => reading.text === 'θεος')!;
		collationState.setReadingParent(unitIndex, other.id, main.id);
		collationState.setReadingType(unitIndex, other.id, 'orthographic');

		const notation = renderApparatusUnit(collationState.peekUnitView(unitIndex), {
			label: unit.label,
			siglumOf: witnessId => `0${witnessId}`,
			nonAttestation: collationState.getNonAttestationForUnit(unitIndex),
			readingTypeLabelOf: readingType => readingType.toUpperCase(),
		});

		expect(notation).toBe(`${unit.label} ⸂ λογος ] a: 0A | a1 (ORTHOGRAPHIC): 0B | b: 0C`);
	});

	/**
	 * Attaching a main reading that already carries subreadings chains them. An apparatus that
	 * omits a reading omits its witnesses, and one a witness is missing from cannot be used to
	 * reconstruct that witness.
	 */
	it('cites the witnesses of a subreading attached to another subreading', () => {
		collate([
			makeWitness('A', textTokens('ο λογος'), true),
			makeWitness('B', textTokens('ο θεος')),
			makeWitness('C', textTokens('ο κυριος')),
		]);
		const unit = collationState.getSegmentSequence().find(segment => segment.kind === 'unit')!;
		const unitIndex = unit.span.startIndex;
		const readings = collationState.peekReadingsForUnit(unitIndex);
		const main = readings.find(reading => reading.text === 'λογος')!;
		const middle = readings.find(reading => reading.text === 'θεος')!;
		const deepest = readings.find(reading => reading.text === 'κυριος')!;
		collationState.setReadingParent(unitIndex, middle.id, main.id);
		collationState.setReadingParent(unitIndex, deepest.id, middle.id);

		const notation = renderApparatusUnit(collationState.peekUnitView(unitIndex), {
			label: unit.label,
			nonAttestation: collationState.getNonAttestationForUnit(unitIndex),
		});

		expect(notation).toContain(': C');
		expect(notation).toBe(`${unit.label} ⸂ λογος ] a: A | a1: B | a2: C`);
	});

	/**
	 * Checked by `pnpm check` rather than at run time: were `nonAttestation` optional again, the
	 * suppression below would be unused and the type check would fail.
	 */
	it('cannot be rendered without a non-attestation report', () => {
		// @ts-expect-error an apparatus that silently omits its reserved non-attestation entry
		// claims testimony the manuscripts do not give, so the report is not optional.
		const options: ApparatusRenderOptions = { label: '2' };

		expect(options.nonAttestation).toBeUndefined();
	});
});

describe('the shared variation-unit definition', () => {
	beforeEach(() => {
		collationState.reset();
	});

	/**
	 * A witness that does not testify is not evidence. On its own it can never open a variation
	 * unit, or every column a damaged witness covers becomes one and the agreed text fragments
	 * around it.
	 */
	it('opens no variation unit where only a non-attesting witness differs', () => {
		collate([
			makeWitness('A', textTokens('εν αρχη ην ο λογος'), true),
			makeWitness('B', textTokens('εν αρχη ην ο λογος')),
			makeWitness('C', [
				...textTokens('εν αρχη'),
				gapToken(),
				...textTokens('ο λογος'),
			]),
		]);

		expect(collationState.getVariationUnitSpans()).toEqual([]);
		expect(collationState.getSegmentSequence()).toEqual([
			expect.objectContaining({ kind: 'agreed', text: 'εν αρχη ην ο λογος' }),
		]);
	});

	/**
	 * The invariant this module exists for. Each surface below is asserted against the units the
	 * witnesses themselves imply — one unit, at the last column — rather than against another
	 * surface's derivation, so a surface that starts deriving its own segmentation fails here.
	 */
	it('is what every surface reads', () => {
		const witnesses = [
			makeWitness('A', textTokens('εν αρχη ην ο λογος'), true),
			makeWitness('B', textTokens('εν αρχη ην ο θεος')),
			makeWitness('C', [...textTokens('εν αρχη'), gapToken(), ...textTokens('ο λογος')]),
		];
		const columns = collate(witnesses);
		const expectedUnitColumnIds = [columns[4].id];

		// The basetext strip and the live apparatus preview.
		expect(
			collationState
				.getSegmentSequence()
				.flatMap(segment => (segment.kind === 'unit' ? segment.span.columnIds : []))
		).toEqual(expectedUnitColumnIds);
		// The stemma phase, and keyboard unit navigation.
		expect(collationState.getVariationUnitSpans().flatMap(span => span.columnIds)).toEqual(
			expectedUnitColumnIds
		);
		// The persisted projection, which ticket 11's export is built over.
		expect(
			buildCollationProjection({
				witnesses,
				alignmentColumns: columns,
				getReadingsForUnit: unitIndex => collationState.getReadingsForUnit(unitIndex),
				getBaseTextForVariationUnit: unitIndex =>
					collationState.getBaseTextForVariationUnit(unitIndex),
				getBaseWitnessId: () => collationState.getBaseWitnessId(),
			}).variationUnits.map(unit => columns[unit.startIndex].id)
		).toEqual(expectedUnitColumnIds);

		// The worklists that walk every unit, and the orphan report that decides which units are
		// live: a decision recorded at the unit is not orphaned, and is reported as divergence.
		const readings = collationState.getReadingsForUnit(4);
		collationState.setLemmaReading(4, readings.find(reading => reading.text === 'θεος')!.id);
		expect(collationState.getLemmaDivergence().map(entry => entry.unitId)).toEqual(
			expectedUnitColumnIds.map(columnId => `unit:${columnId}`)
		);
		expect(collationState.getOrphanedUnitDecisions()).toEqual([]);

		// Keyboard navigation moves between the same units.
		collationState.setPhase('readings');
		collationState.selectedUnitIndex = 0;
		collationState.moveFocus('right');
		expect(columns[collationState.selectedUnitIndex].id).toBe(expectedUnitColumnIds[0]);
	});

	/** Ticket 05's worklist links to units; a unit it reports must be one the pane can open. */
	it('reports only units the readings pane can select as needing a lemma decision', () => {
		const columns = collate([
			makeWitness('A', [...textTokens('εν αρχη'), gapToken(), ...textTokens('ο'), gapToken()], true),
			makeWitness('B', textTokens('εν αρχη ην ο λογος')),
			makeWitness('C', textTokens('εν αρχη ην ο θεος')),
		]);
		const selectableUnitIndexes = collationState
			.getSegmentSequence()
			.flatMap(segment => (segment.kind === 'unit' ? [segment.span.startIndex] : []));

		const needingLemma = collationState.getUnitsNeedingLemmaDecision();

		expect(needingLemma.map(unit => unit.unitId)).toEqual([`unit:${columns[4].id}`]);
		expect(needingLemma.map(unit => unit.unitIndex)).toEqual(selectableUnitIndexes);
	});

	/**
	 * SPEC lines 29 and 180: a decision naming a unit that no longer exists is surfaced, never
	 * silently dropped. Collations saved before non-attestation stopped opening units carry
	 * decisions at columns that are no longer variation units; they orphan rather than vanish.
	 */
	it('reports a saved decision at a column that is no longer a unit as orphaned', () => {
		const columns = collate([
			makeWitness('A', textTokens('εν αρχη ην ο λογος'), true),
			makeWitness('B', textTokens('εν αρχη ην ο λογος')),
			makeWitness('C', [...textTokens('εν αρχη'), gapToken(), ...textTokens('ο λογος')]),
		]);
		// Stands for a decision restored from a saved collation, keyed by the column it covered.
		collationState.unitDecisions.set(`unit:${columns[2].id}`, { lemmaReadingId: 'reading-1' });

		expect(collationState.getOrphanedUnitDecisions()).toEqual([
			{ unitId: `unit:${columns[2].id}`, decisions: { lemmaReadingId: 'reading-1' } },
		]);
	});
});
