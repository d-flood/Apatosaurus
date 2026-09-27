import { makeMainReadingIdOf } from './collation-reading-proposal';
import type { ClassifiedReading, ReadingArc } from './collation-types';

/** `undecided` is no answer; `unclear` judges the origin undeterminable. */
export type SourceDecision =
	{ kind: 'undecided' } | { kind: 'unclear' } | { kind: 'derived'; from: string };

/** Projected state needing resolution, never an automatic rewrite. */
export type StemmaViolation =
	| {
			/** Multiple priors are never drawn as a guess. */
			kind: 'multiple-sources';
			readingId: string;
			priorReadingIds: string[];
	  }
	| {
			/** Lemma must not derive in a rooted stemma. */
			kind: 'lemma-is-posterior';
			readingId: string;
			priorReadingIds: string[];
	  };

export interface StemmaTreeNode {
	readingId: string;
	label: string;
	text: string | null;
	isOmission: boolean;
	/** Main witnesses plus folded subreadings'. */
	witnessIds: string[];
	/** Folded subreadings; never nodes of their own. */
	subreadingIds: string[];
	sourceDecision: SourceDecision;
	isLemma: boolean;
	/** Lemma roots its stemma; derived per projection, never stored. */
	isRoot: boolean;
	/** No single source projected. */
	violation: StemmaViolation | null;
}

/** Orphaned arc; reported, never dropped. */
export interface OrphanedArc {
	arc: ReadingArc;
	missingReadingIds: string[];
}

export interface LocalStemma {
	nodes: StemmaTreeNode[];
	violations: StemmaViolation[];
	/** Uncarriable `derived` decisions. */
	orphanedArcs: OrphanedArc[];
}

/** One node per main reading; `derived` lives in arcs, `unclear` in the overlay. */
export function projectLocalStemma(
	readings: ClassifiedReading[],
	arcs: ReadingArc[],
	lemmaReadingId: string | null,
	sourceDecisions: Record<string, SourceDecision> = {}
): LocalStemma {
	const mainReadingIdOf = makeMainReadingIdOf(readings);

	const mains = readings.filter(reading => reading.parentReadingId === null && !reading.isLacuna);
	const mainIds = new Set(mains.map(reading => reading.id));

	const foldedInto = new Map<string, ClassifiedReading[]>();
	for (const reading of readings) {
		if (reading.parentReadingId === null) continue;
		const mainId = mainReadingIdOf(reading.id);
		if (!mainId || !mainIds.has(mainId)) continue;
		foldedInto.set(mainId, [...(foldedInto.get(mainId) ?? []), reading]);
	}

	const resolve = (readingId: string): string | null => {
		const mainId = mainReadingIdOf(readingId);
		return mainId && mainIds.has(mainId) ? mainId : null;
	};

	const priorsOf = new Map<string, string[]>();
	const orphanedArcs: OrphanedArc[] = [];
	for (const arc of arcs) {
		const prior = resolve(arc.priorReadingId);
		const posterior = resolve(arc.posteriorReadingId);
		if (!prior || !posterior) {
			orphanedArcs.push({
				arc,
				missingReadingIds: [
					...(prior ? [] : [arc.priorReadingId]),
					...(posterior ? [] : [arc.posteriorReadingId]),
				],
			});
			continue;
		}
		if (prior === posterior) continue;
		const existing = priorsOf.get(posterior) ?? [];
		if (existing.includes(prior)) continue;
		priorsOf.set(posterior, [...existing, prior]);
	}

	const violations: StemmaViolation[] = [];
	const nodes = mains.map(reading => {
		const folded = foldedInto.get(reading.id) ?? [];
		const priors = priorsOf.get(reading.id) ?? [];
		let violation: StemmaViolation | null = null;
		let sourceDecision: SourceDecision = { kind: 'undecided' };
		if (priors.length > 1) {
			violation = {
				kind: 'multiple-sources',
				readingId: reading.id,
				priorReadingIds: priors,
			};
			violations.push(violation);
		} else if (priors.length === 1) {
			sourceDecision = { kind: 'derived', from: priors[0] };
		} else if (sourceDecisions[reading.id]?.kind === 'unclear') {
			sourceDecision = { kind: 'unclear' };
		}
		const witnessIds = [...reading.witnessIds];
		for (const subreading of folded) {
			for (const witnessId of subreading.witnessIds) {
				if (!witnessIds.includes(witnessId)) witnessIds.push(witnessId);
			}
		}
		return {
			readingId: reading.id,
			label: reading.label,
			text: reading.text,
			isOmission: reading.isOmission,
			witnessIds,
			subreadingIds: folded.map(subreading => subreading.id),
			sourceDecision,
			isLemma: reading.id === lemmaReadingId,
			isRoot: reading.id === lemmaReadingId && priors.length === 0,
			violation,
		};
	});

	const lemmaMainReadingId = lemmaReadingId ? resolve(lemmaReadingId) : null;
	if (lemmaMainReadingId) {
		const priorReadingIds = priorsOf.get(lemmaMainReadingId) ?? [];
		if (priorReadingIds.length > 0) {
			violations.push({
				kind: 'lemma-is-posterior',
				readingId: lemmaMainReadingId,
				priorReadingIds,
			});
		}
	}

	return { nodes, violations, orphanedArcs };
}

/** Prior reading per node, for cycle checks and layout. */
export function sourceReadingIdOf(node: StemmaTreeNode): string | null {
	return node.sourceDecision.kind === 'derived' ? node.sourceDecision.from : null;
}

/** Whether this derivation would close a cycle. */
export function wouldCreateCycle(
	nodes: StemmaTreeNode[],
	readingId: string,
	priorReadingId: string
): boolean {
	const sourceOf = new Map(nodes.map(node => [node.readingId, sourceReadingIdOf(node)] as const));
	let current: string | null = priorReadingId;
	const seen = new Set<string>();
	while (current !== null && !seen.has(current)) {
		if (current === readingId) return true;
		seen.add(current);
		current = sourceOf.get(current) ?? null;
	}
	return false;
}
