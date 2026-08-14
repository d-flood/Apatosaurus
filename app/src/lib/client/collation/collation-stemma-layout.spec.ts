import { beforeEach, describe, expect, it } from 'vitest';
import { collateToAlignmentSnapshot } from './collation-adapter';
import { collationState, type WitnessConfig } from './collation-state.svelte';
import { layoutLocalStemma } from './collation-stemma-layout';
import { projectLocalStemma, type StemmaTreeNode } from './collation-stemma';
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

function makeWitness(witnessId: string, text: string, isBaseText = false): WitnessConfig {
	return {
		witnessId,
		siglum: witnessId,
		transcriptionId: `${witnessId}-tx`,
		sourceVersion: 'v1',
		content: text,
		tokens: textTokens(text),
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

const CHAIN_TEXTS = ['λογος', 'θεος', 'πνευμα', 'κυριος', 'σωτηρ'];

function chainReadings(): ClassifiedReading[] {
	return readingsFor(
		CHAIN_TEXTS.map((text, index) =>
			makeWitness(String.fromCharCode(65 + index), text, index === 0)
		)
	);
}

/** A stemma of `depth + 1` generations, each reading derived from the one before it. */
function generations(readings: ClassifiedReading[], depth: number): StemmaTreeNode[] {
	const arcs: ReadingArc[] = [];
	for (let index = 1; index <= depth; index += 1) {
		arcs.push(arc(readings[index - 1].id, readings[index].id));
	}
	return projectLocalStemma(readings, arcs, readings[0].id).nodes;
}

function overlaps(
	a: { x: number; y: number; width: number; height: number },
	b: { x: number; y: number; width: number; height: number }
): boolean {
	return (
		a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
	);
}

describe('layoutLocalStemma', () => {
	beforeEach(() => {
		collationState.reset();
	});

	it('places four generations without overlapping any node', () => {
		const nodes = generations(chainReadings(), 4);
		const layout = layoutLocalStemma(nodes);

		expect(layout.nodes).toHaveLength(5);
		expect(new Set(layout.nodes.map(node => node.y)).size).toBe(5);
		for (const [index, node] of layout.nodes.entries()) {
			for (const other of layout.nodes.slice(index + 1)) {
				expect(overlaps(node, other)).toBe(false);
			}
		}
	});

	it('fits its bounds to the stemma rather than to a fixed canvas', () => {
		const readings = chainReadings();
		const deep = layoutLocalStemma(generations(readings, 4));
		const flat = layoutLocalStemma(projectLocalStemma(readings, [], readings[0].id).nodes);

		expect(deep.bounds.height).toBeGreaterThan(flat.bounds.height);
		expect(flat.bounds.width).toBeGreaterThan(deep.bounds.width);
		for (const layout of [deep, flat]) {
			for (const node of layout.nodes) {
				expect(node.x).toBeGreaterThanOrEqual(0);
				expect(node.y).toBeGreaterThanOrEqual(0);
				expect(node.x + node.width).toBeLessThanOrEqual(layout.bounds.width);
				expect(node.y + node.height).toBeLessThanOrEqual(layout.bounds.height);
			}
		}
	});

	it('returns the same geometry for equal input', () => {
		const nodes = generations(chainReadings(), 3);

		expect(layoutLocalStemma(nodes)).toEqual(layoutLocalStemma(nodes));
	});

	it('positions undecided and unclear readings too, just without arcs', () => {
		const readings = chainReadings();
		const nodes = projectLocalStemma(readings, [arc(readings[0].id, readings[1].id)], null, {
			[readings[2].id]: { kind: 'unclear' },
		}).nodes;
		const layout = layoutLocalStemma(nodes);

		expect(layout.nodes.map(node => node.id).sort()).toEqual(
			nodes.map(node => node.readingId).sort()
		);
		expect(layout.arcs).toHaveLength(1);
	});

	it('draws one path per arc, from the prior reading to the posterior one', () => {
		const readings = chainReadings();
		const nodes = generations(readings, 2);
		const layout = layoutLocalStemma(nodes);

		expect(layout.arcs.map(entry => [entry.from, entry.to])).toEqual([
			[readings[0].id, readings[1].id],
			[readings[1].id, readings[2].id],
		]);
		const prior = layout.nodes.find(node => node.id === readings[0].id)!;
		const posterior = layout.nodes.find(node => node.id === readings[1].id)!;
		expect(layout.arcs[0].path).toContain(
			`M ${prior.x + prior.width / 2} ${prior.y + prior.height}`
		);
		expect(
			layout.arcs[0].path.endsWith(`${posterior.x + posterior.width / 2} ${posterior.y}`)
		).toBe(true);
	});

	it('still places readings an arc cycle left without a root', () => {
		const readings = chainReadings();
		const nodes = projectLocalStemma(
			readings,
			[arc(readings[1].id, readings[2].id), arc(readings[2].id, readings[1].id)],
			readings[0].id
		).nodes;
		const layout = layoutLocalStemma(nodes);

		expect(layout.nodes).toHaveLength(nodes.length);
	});

	it('returns empty bounds for a unit with no readings', () => {
		expect(layoutLocalStemma([])).toEqual({
			nodes: [],
			arcs: [],
			bounds: { width: 0, height: 0 },
		});
	});
});
