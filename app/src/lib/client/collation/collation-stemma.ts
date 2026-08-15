import { makeMainReadingIdOf } from './collation-reading-proposal';
import type { ClassifiedReading, ReadingArc } from './collation-types';

/**
 * Where a reading came from. `undecided` is the absence of an answer and is never reported as a
 * judgement; `unclear` is the considered judgement that the origin cannot be determined.
 */
export type SourceDecision =
	{ kind: 'undecided' } | { kind: 'unclear' } | { kind: 'derived'; from: string };

/** A projected local stemma state the scholar needs to resolve, never an automatic rewrite. */
export type StemmaViolation =
	| {
			/** A reading with more than one recorded prior reading is never drawn as a guess. */
			kind: 'multiple-sources';
			readingId: string;
			priorReadingIds: string[];
	  }
	| {
			/** The established lemma must not derive from another reading in a rooted stemma. */
			kind: 'lemma-is-posterior';
			readingId: string;
			priorReadingIds: string[];
	  };

export interface StemmaTreeNode {
	readingId: string;
	label: string;
	text: string | null;
	isOmission: boolean;
	/** The main reading's witnesses, followed by those of every subreading folded into it. */
	witnessIds: string[];
	/** The subreadings this node stands for. They are never nodes of their own. */
	subreadingIds: string[];
	sourceDecision: SourceDecision;
	isLemma: boolean;
	/** Set where the recorded arcs do not present a single source, so no source is projected. */
	violation: StemmaViolation | null;
}

/** A recorded arc naming a reading the unit no longer has. Reported, never silently dropped. */
export interface OrphanedArc {
	arc: ReadingArc;
	missingReadingIds: string[];
}

export interface LocalStemma {
	nodes: StemmaTreeNode[];
	violations: StemmaViolation[];
	/** `derived` decisions the current readings can no longer carry. */
	orphanedArcs: OrphanedArc[];
}

/**
 * The local stemma a unit's readings and arcs imply: one node per main reading, subreadings
 * folded into the main reading at the head of their chain, and at most one source per node.
 *
 * Arcs are the storage of a `derived` decision, so multiple sources stay expressible; `unclear`
 * has no arc to live in and is supplied from the decisions overlay.
 */
export function projectLocalStemma(
	readings: ClassifiedReading[],
	arcs: ReadingArc[],
	lemmaReadingId: string | null,
	sourceDecisions: Record<string, SourceDecision> = {}
): LocalStemma {
	const mainReadingIdOf = makeMainReadingIdOf(readings);

	// Non-attestation is not a reading and holds no place in a local stemma.
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
		// An arc between a subreading and its own main reading folds away rather than orphaning.
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

/** The prior reading each node derives from, keyed by node, for cycle checks and layout. */
export function sourceReadingIdOf(node: StemmaTreeNode): string | null {
	return node.sourceDecision.kind === 'derived' ? node.sourceDecision.from : null;
}

/** Whether deriving `readingId` from `priorReadingId` would close a cycle in the current tree. */
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
