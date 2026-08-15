import { makeMainReadingIdOf, relabelReadings } from './collation-reading-proposal';
import type { SourceDecision } from './collation-stemma';
import type { ClassifiedReading, ReadingArc } from './collation-types';
import type { Certainty, ReadingTypeId } from './reading-types';

export interface UnitDecisions {
	subreadingOf?: Record<string, string | null>;
	lemmaReadingId?: string | null;
	/** A recorded type outranks the proposal; a recorded null means "no type", not "undecided". */
	readingType?: Record<string, ReadingTypeId | null>;
	certainty?: Record<string, Certainty | null>;
	/**
	 * Only the source decisions no arc can express. A `derived` decision is stored as an arc,
	 * which is the persisted form and the only one able to hold more than one source; `undecided`
	 * is the absence of both. So in practice this holds `unclear`.
	 */
	sourceDecision?: Record<string, SourceDecision>;
}

export type OrphanedDecision =
	| {
			kind: 'subreadingOf';
			readingId: string;
			mainReadingId: string | null;
			missingReadingIds: string[];
	  }
	| {
			kind: 'lemma';
			readingId: string;
			missingReadingIds: string[];
	  }
	| {
			kind: 'readingType';
			readingId: string;
			readingType: ReadingTypeId | null;
			missingReadingIds: string[];
	  }
	| {
			kind: 'certainty';
			readingId: string;
			certainty: Certainty | null;
			missingReadingIds: string[];
	  }
	| {
			kind: 'sourceDecision';
			readingId: string;
			sourceDecision: SourceDecision;
			missingReadingIds: string[];
	  }
	/** A `derived` decision, which lives in an arc rather than in the overlay. */
	| {
			kind: 'sourceArc';
			readingId: string;
			priorReadingId: string;
			missingReadingIds: string[];
	  };

export interface OrphanedUnitDecision {
	unitId: string;
	decisions: UnitDecisions;
	/** Present only where the dead unit also holds arcs, which carry its `derived` decisions. */
	arcs?: ReadingArc[];
}

export interface UnitView {
	readings: ClassifiedReading[];
	orphanedDecisions: OrphanedDecision[];
	/** The reading established as `a`, or null where none can be derived or was designated. */
	lemmaReadingId: string | null;
	/** The main reading the base text attests, or null where it does not testify. */
	baseTextReadingId: string | null;
	needsLemmaDecision: boolean;
}

export function cloneUnitDecisions(decisions: UnitDecisions | undefined): UnitDecisions {
	const clone: UnitDecisions = {};
	if (decisions?.subreadingOf) clone.subreadingOf = { ...decisions.subreadingOf };
	if (decisions?.lemmaReadingId !== undefined) clone.lemmaReadingId = decisions.lemmaReadingId;
	if (decisions?.readingType) clone.readingType = { ...decisions.readingType };
	if (decisions?.certainty) clone.certainty = { ...decisions.certainty };
	if (decisions?.sourceDecision) clone.sourceDecision = { ...decisions.sourceDecision };
	return clone;
}

export function applyDecisions(
	proposal: ClassifiedReading[],
	decisions: UnitDecisions,
	options?: { baseWitnessId?: string | null }
): UnitView {
	const baseWitnessId = options?.baseWitnessId ?? null;
	const readingIds = new Set(proposal.map(reading => reading.id));
	const orphanedDecisions: OrphanedDecision[] = [];
	const applicable = new Map<string, string | null>();

	for (const [readingId, mainReadingId] of Object.entries(decisions.subreadingOf ?? {})) {
		const missingReadingIds = [readingId, mainReadingId].filter(
			(id): id is string => id !== null && !readingIds.has(id)
		);
		if (missingReadingIds.length > 0) {
			orphanedDecisions.push({
				kind: 'subreadingOf',
				readingId,
				mainReadingId,
				missingReadingIds,
			});
			continue;
		}
		applicable.set(readingId, mainReadingId);
	}
	const readingTypes = new Map<string, ReadingTypeId | null>();
	for (const [readingId, readingType] of Object.entries(decisions.readingType ?? {})) {
		if (readingIds.has(readingId)) {
			readingTypes.set(readingId, readingType);
			continue;
		}
		orphanedDecisions.push({
			kind: 'readingType',
			readingId,
			readingType,
			missingReadingIds: [readingId],
		});
	}

	const certainties = new Map<string, Certainty | null>();
	for (const [readingId, certainty] of Object.entries(decisions.certainty ?? {})) {
		if (readingIds.has(readingId)) {
			certainties.set(readingId, certainty);
			continue;
		}
		orphanedDecisions.push({
			kind: 'certainty',
			readingId,
			certainty,
			missingReadingIds: [readingId],
		});
	}

	for (const [readingId, sourceDecision] of Object.entries(decisions.sourceDecision ?? {})) {
		const named =
			sourceDecision.kind === 'derived' ? [readingId, sourceDecision.from] : [readingId];
		const missingReadingIds = named.filter(id => !readingIds.has(id));
		if (missingReadingIds.length === 0) continue;
		orphanedDecisions.push({
			kind: 'sourceDecision',
			readingId,
			sourceDecision,
			missingReadingIds,
		});
	}

	const readings = proposal.map(reading => {
		const decided = {
			...reading,
			readingType: readingTypes.has(reading.id)
				? (readingTypes.get(reading.id) ?? null)
				: reading.readingType,
			certainty: certainties.has(reading.id)
				? (certainties.get(reading.id) ?? null)
				: reading.certainty,
		};
		if (!applicable.has(reading.id)) return decided;
		const parentReadingId = applicable.get(reading.id) ?? null;
		return {
			...decided,
			parentReadingId,
			isSubreading: parentReadingId !== null,
			autoGenerated: false,
		};
	});

	const mainReadingIdOf = makeMainReadingIdOf(readings);

	const baseTextReading = baseWitnessId
		? readings.find(reading => reading.witnessIds.includes(baseWitnessId))
		: undefined;
	// A lacunose base witness testifies to nothing, so it establishes no default lemma.
	const baseTextReadingId =
		baseTextReading && !baseTextReading.isLacuna ? mainReadingIdOf(baseTextReading.id) : null;

	let lemmaReadingId: string | null = null;
	const designatedLemmaId = decisions.lemmaReadingId ?? null;
	if (designatedLemmaId !== null) {
		if (readingIds.has(designatedLemmaId)) {
			// A designated subreading is cited under its main reading, which is what takes `a`.
			lemmaReadingId = mainReadingIdOf(designatedLemmaId);
		} else {
			orphanedDecisions.push({
				kind: 'lemma',
				readingId: designatedLemmaId,
				missingReadingIds: [designatedLemmaId],
			});
		}
	}
	if (lemmaReadingId === null) lemmaReadingId = baseTextReadingId;

	const needsLemmaDecision =
		lemmaReadingId === null && readings.some(reading => reading.parentReadingId === null);

	return {
		// Without a base-text reading the base witness cannot anchor the order, so the
		// remaining readings fall back to witness count — a provisional order, not a lemma.
		readings: relabelReadings(
			readings,
			baseTextReadingId ? baseWitnessId : null,
			lemmaReadingId
		),
		orphanedDecisions,
		lemmaReadingId,
		baseTextReadingId,
		needsLemmaDecision,
	};
}

/**
 * Editorial work recorded against units that no longer exist. Arcs are walked alongside the
 * overlay because a `derived` decision is stored only as an arc, so a report built from the
 * overlay alone would omit exactly the decisions the diagram is made of.
 */
export function findOrphanedUnitDecisions(
	decisions: ReadonlyMap<string, UnitDecisions>,
	liveUnitIds: ReadonlySet<string>,
	readingArcs: ReadonlyMap<string, ReadingArc[]> = new Map()
): OrphanedUnitDecision[] {
	const unitIds = [
		...decisions.keys(),
		...[...readingArcs.keys()].filter(unitId => !decisions.has(unitId)),
	];
	return unitIds
		.filter(unitId => !liveUnitIds.has(unitId))
		.map(unitId => {
			const orphan: OrphanedUnitDecision = {
				unitId,
				decisions: cloneUnitDecisions(decisions.get(unitId)),
			};
			const arcs = readingArcs.get(unitId) ?? [];
			if (arcs.length > 0) orphan.arcs = arcs.map(arc => ({ ...arc }));
			return orphan;
		});
}
