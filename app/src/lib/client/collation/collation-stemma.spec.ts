import { beforeEach, describe, expect, it } from 'vitest';
import { collateToAlignmentSnapshot } from './collation-adapter';
import { collationState, type WitnessConfig } from './collation-state.svelte';
import { projectLocalStemma, wouldCreateCycle } from './collation-stemma';
import type { ClassifiedReading, ReadingArc, WitnessSourceToken } from './collation-types';

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

/** The readings the real collation pipeline produces, never a hand-built set. */
function readingsFor(witnesses: WitnessConfig[]): ClassifiedReading[] {
	collationState.reset();
	collationState.setWitnesses(witnesses);
	collationState.refreshCollationInput();
	const result = collateToAlignmentSnapshot({
		witnesses: collationState.buildCollationWitnessInputs(),
		options: { segmentation: false },
	});
	collationState.setAlignmentSnapshot(result.snapshot);
	return collationState.getReadingsForUnit(0);
}

function arc(priorReadingId: string, posteriorReadingId: string): ReadingArc {
	return { id: `${priorReadingId}->${posteriorReadingId}`, priorReadingId, posteriorReadingId };
}

function labelled(readings: ClassifiedReading[], label: string): ClassifiedReading {
	const reading = readings.find(entry => entry.label === label);
	if (!reading) throw new Error(`no reading labelled ${label}`);
	return reading;
}

describe('projectLocalStemma', () => {
	beforeEach(() => {
		collationState.reset();
	});

	it('emits one node per main reading and folds subreadings into it', () => {
		const readings = readingsFor([
			makeWitness('A', textTokens('λογος'), true),
			makeWitness('B', textTokens('θεος')),
			makeWitness('C', textTokens('πνευμα')),
		]);
		const main = labelled(readings, 'b');
		const folded = labelled(readings, 'c');
		expect(collationState.setReadingParent(0, folded.id, main.id)).toEqual({ ok: true });

		const decided = collationState.getReadingsForUnit(0);
		const { nodes } = projectLocalStemma(decided, [], labelled(decided, 'a').id);

		expect(nodes.map(node => node.label)).toEqual(['a', 'b']);
		expect(nodes.map(node => node.readingId)).not.toContain(folded.id);
		const foldedInto = nodes.find(node => node.readingId === main.id)!;
		expect(foldedInto.subreadingIds).toEqual([folded.id]);
		expect(foldedInto.witnessIds).toEqual(['B', 'C']);
	});

	it('attaches an arc recorded against a subreading to its main reading node', () => {
		const readings = readingsFor([
			makeWitness('A', textTokens('λογος'), true),
			makeWitness('B', textTokens('θεος')),
			makeWitness('C', textTokens('πνευμα')),
		]);
		const main = labelled(readings, 'b');
		const folded = labelled(readings, 'c');
		collationState.setReadingParent(0, folded.id, main.id);

		const decided = collationState.getReadingsForUnit(0);
		const lemma = labelled(decided, 'a');
		const { nodes } = projectLocalStemma(decided, [arc(lemma.id, folded.id)], lemma.id);

		expect(nodes.find(node => node.readingId === main.id)?.sourceDecision).toEqual({
			kind: 'derived',
			from: lemma.id,
		});
	});

	it('never gives a non-attesting witness a node', () => {
		const readings = readingsFor([
			makeWitness('A', textTokens('λογος'), true),
			makeWitness('B', textTokens('θεος')),
			makeWitness('C', [gapToken()]),
		]);
		const { nodes } = projectLocalStemma(readings, [], labelled(readings, 'a').id);

		expect(nodes).toHaveLength(2);
		expect(nodes.flatMap(node => node.witnessIds)).not.toContain('C');
	});

	it('never gives a reading recorded as a lacuna a node', () => {
		const readings = readingsFor([
			makeWitness('A', textTokens('λογος'), true),
			makeWitness('B', textTokens('θεος')),
		]);
		// The shape a document written before non-attestation left the reading model still holds.
		const legacy = readings.map(reading =>
			reading.label === 'b' ? { ...reading, isLacuna: true } : reading
		);
		const { nodes } = projectLocalStemma(legacy, [], labelled(readings, 'a').id);

		expect(nodes.map(node => node.label)).toEqual(['a']);
	});

	it('roots a newly-built stemma on the lemma and leaves every other reading undecided', () => {
		const readings = readingsFor([
			makeWitness('A', textTokens('λογος'), true),
			makeWitness('B', textTokens('θεος')),
			makeWitness('C', textTokens('θεος')),
			makeWitness('D', textTokens('θεος')),
		]);
		const { nodes } = projectLocalStemma(readings, [], labelled(readings, 'a').id);

		// The majority reading has three witnesses to the lemma's one and still is not the root.
		expect(nodes.filter(node => node.isLemma).map(node => node.witnessIds)).toEqual([['A']]);
		expect(nodes.filter(node => !node.isLemma).map(node => node.sourceDecision)).toEqual([
			{ kind: 'undecided' },
		]);
	});

	it('distinguishes an unclear source from an undecided one', () => {
		const readings = readingsFor([
			makeWitness('A', textTokens('λογος'), true),
			makeWitness('B', textTokens('θεος')),
			makeWitness('C', textTokens('πνευμα')),
		]);
		const unclear = labelled(readings, 'b');
		const { nodes } = projectLocalStemma(readings, [], labelled(readings, 'a').id, {
			[unclear.id]: { kind: 'unclear' },
		});

		expect(nodes.find(node => node.readingId === unclear.id)?.sourceDecision).toEqual({
			kind: 'unclear',
		});
		expect(nodes.find(node => node.label === 'c')?.sourceDecision).toEqual({
			kind: 'undecided',
		});
	});

	it('reports a reading with two recorded sources instead of projecting one of them', () => {
		const readings = readingsFor([
			makeWitness('A', textTokens('λογος'), true),
			makeWitness('B', textTokens('θεος')),
			makeWitness('C', textTokens('πνευμα')),
		]);
		const a = labelled(readings, 'a');
		const b = labelled(readings, 'b');
		const c = labelled(readings, 'c');
		const { nodes, violations } = projectLocalStemma(
			readings,
			[arc(a.id, c.id), arc(b.id, c.id)],
			a.id
		);

		expect(violations).toEqual([
			{ kind: 'multiple-sources', readingId: c.id, priorReadingIds: [a.id, b.id] },
		]);
		const conflicted = nodes.find(node => node.readingId === c.id)!;
		expect(conflicted.sourceDecision).toEqual({ kind: 'undecided' });
		expect(conflicted.violation?.priorReadingIds).toEqual([a.id, b.id]);
	});

	it('reports an arc into the lemma without suppressing the recorded derivation', () => {
		const readings = readingsFor([
			makeWitness('A', textTokens('λογος'), true),
			makeWitness('B', textTokens('θεος')),
		]);
		const lemma = labelled(readings, 'a');
		const other = labelled(readings, 'b');

		const { nodes, violations } = projectLocalStemma(
			readings,
			[arc(other.id, lemma.id)],
			lemma.id
		);

		expect(violations).toEqual([
			{
				kind: 'lemma-is-posterior',
				readingId: lemma.id,
				priorReadingIds: [other.id],
			},
		]);
		expect(nodes.find(node => node.readingId === lemma.id)?.sourceDecision).toEqual({
			kind: 'derived',
			from: other.id,
		});
	});

	it('reports an arc that names a reading the unit no longer has', () => {
		const readings = readingsFor([
			makeWitness('A', textTokens('λογος'), true),
			makeWitness('B', textTokens('θεος')),
		]);
		const b = labelled(readings, 'b');
		const orphaned = arc('gone', b.id);
		const { nodes, violations, orphanedArcs } = projectLocalStemma(
			readings,
			[orphaned],
			labelled(readings, 'a').id
		);

		expect(violations).toEqual([]);
		expect(orphanedArcs).toEqual([{ arc: orphaned, missingReadingIds: ['gone'] }]);
		expect(nodes.find(node => node.readingId === b.id)?.sourceDecision).toEqual({
			kind: 'undecided',
		});
	});

	it('reports both endpoints of an arc naming two readings the unit no longer has', () => {
		const readings = readingsFor([
			makeWitness('A', textTokens('λογος'), true),
			makeWitness('B', textTokens('θεος')),
		]);
		const orphaned = arc('gone-prior', 'gone-posterior');
		const { orphanedArcs } = projectLocalStemma(
			readings,
			[orphaned],
			labelled(readings, 'a').id
		);

		expect(orphanedArcs).toEqual([
			{ arc: orphaned, missingReadingIds: ['gone-prior', 'gone-posterior'] },
		]);
	});

	it('does not report an arc between a subreading and the main reading it folds into', () => {
		const readings = readingsFor([
			makeWitness('A', textTokens('λογος'), true),
			makeWitness('B', textTokens('θεος')),
			makeWitness('C', textTokens('πνευμα')),
		]);
		const main = labelled(readings, 'b');
		const folded = labelled(readings, 'c');
		collationState.setReadingParent(0, folded.id, main.id);

		const decided = collationState.getReadingsForUnit(0);
		const { orphanedArcs } = projectLocalStemma(
			decided,
			[arc(main.id, folded.id)],
			labelled(decided, 'a').id
		);

		expect(orphanedArcs).toEqual([]);
	});
});

describe('wouldCreateCycle', () => {
	beforeEach(() => {
		collationState.reset();
	});

	it('sees the cycle a source decision would close', () => {
		const readings = readingsFor([
			makeWitness('A', textTokens('λογος'), true),
			makeWitness('B', textTokens('θεος')),
			makeWitness('C', textTokens('πνευμα')),
		]);
		const a = labelled(readings, 'a');
		const b = labelled(readings, 'b');
		const c = labelled(readings, 'c');
		const { nodes } = projectLocalStemma(readings, [arc(a.id, b.id), arc(b.id, c.id)], a.id);

		expect(wouldCreateCycle(nodes, a.id, c.id)).toBe(true);
		expect(wouldCreateCycle(nodes, c.id, a.id)).toBe(false);
	});
});
