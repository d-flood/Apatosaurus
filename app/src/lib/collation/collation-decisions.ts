import { citationOrder } from './collation-apparatus';
import { makeMainReadingIdOf, relabelReadings } from './collation-reading-proposal';
import type { SourceDecision } from './collation-stemma';
import type {
	ClassifiedReading,
	ManualWitnessDefinition,
	ManualWitnessOverride,
	ReadingArc,
} from './collation-types';
import type { Certainty, ReadingTypeDefinition, ReadingTypeId } from './reading-types';
import { dropEmptiedReadings, withoutWitnesses } from './reading-edits';

export type ManualTestimony =
	{ kind: 'reading'; readingId: string } | { kind: 'nonAttestation' } | { kind: 'uncited' };

export interface AuthoredReading {
	id: string;
	text: string | null;
	isOmission: boolean;
	order: number;
	parentReadingId: null;
	readingType: null;
}

export interface UnitDecisions {
	manualTestimony?: Record<string, ManualTestimony>;
	authoredReadings?: AuthoredReading[];
	preserveReadings?: true;
	subreadingOf?: Record<string, string | null>;
	lemmaReadingId?: string | null;
	/** Recorded null means "no type", not "undecided". */
	readingType?: Record<string, ReadingTypeId | null>;
	readingTags?: Record<string, string[]>;
	certainty?: Record<string, Certainty | null>;
	connectivity?: number | 'absolute';
	/** Only non-arc source decisions; `derived` lives in arcs. */
	sourceDecision?: Record<string, SourceDecision>;
	ambiguousAttestations?: AmbiguousAttestation[];
	unconfirmedWitnessIds?: string[];
	unresolvedAttestations?: UnresolvedAttestation[];
}

export type UnresolvedAttestation = { witnessId: string; candidateReadingIds: string[] };

export type AmbiguousAttestation = {
	id: string;
	witnessIds: string[];
	targetReadingIds: string[];
};

export interface AmbiguousAttestationView extends AmbiguousAttestation {
	targetLabels: string[];
	label: string;
}

export type AmbiguousAttestationError =
	| 'no-witnesses'
	| 'too-few-targets'
	| 'target-not-found'
	| 'witness-not-attesting'
	| 'witness-already-ambiguous'
	| 'target-emptied';

export type OrphanedDecision =
	| {
			kind: 'manualTestimony';
			manualWitnessId: string;
			readingId: string;
			missingReadingIds: string[];
	  }
	| {
			kind: 'readingTag';
			readingId: string;
			tagIds: string[];
			missingReadingIds: string[];
	  }
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
	| {
			kind: 'sourceArc';
			readingId: string;
			priorReadingId: string;
			missingReadingIds: string[];
	  }
	| {
			kind: 'ambiguousAttestation';
			attestationId: string;
			missingReadingIds: string[];
	  };

export interface OrphanedUnitDecision {
	unitId: string;
	decisions: UnitDecisions;
	/** Arcs of dead units, carrying their `derived` decisions. */
	arcs?: ReadingArc[];
}

export function manualWitnessMembers(
	witnesses: readonly ManualWitnessDefinition[],
	overrides: readonly ManualWitnessOverride[],
	decisions: Iterable<UnitDecisions>
): Array<ManualWitnessDefinition & { treatment: 'full' | 'fragmentary' }> {
	const recorded = new Set(
		[...decisions].flatMap(decision => [
			...Object.keys(decision.manualTestimony ?? {}),
			...(decision.ambiguousAttestations ?? []).flatMap(
				attestation => attestation.witnessIds
			),
		])
	);
	return witnesses.flatMap(witness => {
		const override = overrides.find(entry => entry.manualWitnessId === witness.id);
		if (override?.isExcluded) return [];
		const treatment =
			override && override.treatment !== 'inherit' ? override.treatment : witness.treatment;
		const effective = treatment === 'full' ? 'full' : 'fragmentary';
		return effective === 'full' || recorded.has(witness.id)
			? [{ ...witness, treatment: effective }]
			: [];
	});
}

export interface UnitView {
	uncitedManualWitnessIds: string[];
	nonAttestingManualWitnessIds: string[];
	unrecordedManualWitnessIds: string[];
	readings: ClassifiedReading[];
	ambiguousAttestations: AmbiguousAttestationView[];
	unconfirmedWitnessIds: string[];
	unresolvedAttestations: UnresolvedAttestation[];
	orphanedDecisions: OrphanedDecision[];
	lemmaReadingId: string | null;
	baseTextReadingId: string | null;
	needsLemmaDecision: boolean;
}

export function cloneUnitDecisions(decisions: UnitDecisions | undefined): UnitDecisions {
	const clone: UnitDecisions = {};
	if (decisions?.manualTestimony)
		clone.manualTestimony = Object.fromEntries(
			Object.entries(decisions.manualTestimony).map(([id, testimony]) => [
				id,
				{ ...testimony },
			])
		);
	if (decisions?.authoredReadings)
		clone.authoredReadings = decisions.authoredReadings.map(reading => ({ ...reading }));
	if (decisions?.preserveReadings) clone.preserveReadings = true;
	if (decisions?.subreadingOf) clone.subreadingOf = { ...decisions.subreadingOf };
	if (decisions?.lemmaReadingId !== undefined) clone.lemmaReadingId = decisions.lemmaReadingId;
	if (decisions?.readingType) clone.readingType = { ...decisions.readingType };
	if (decisions?.readingTags)
		clone.readingTags = Object.fromEntries(
			Object.entries(decisions.readingTags).map(([id, tags]) => [id, [...tags]])
		);
	if (decisions?.certainty) clone.certainty = { ...decisions.certainty };
	if (decisions?.connectivity !== undefined) clone.connectivity = decisions.connectivity;
	if (decisions?.sourceDecision) clone.sourceDecision = { ...decisions.sourceDecision };
	if (decisions?.ambiguousAttestations) {
		clone.ambiguousAttestations = decisions.ambiguousAttestations.map(attestation => ({
			id: attestation.id,
			witnessIds: [...attestation.witnessIds],
			targetReadingIds: [...attestation.targetReadingIds],
		}));
	}
	if (decisions?.unconfirmedWitnessIds)
		clone.unconfirmedWitnessIds = [...decisions.unconfirmedWitnessIds];
	if (decisions?.unresolvedAttestations)
		clone.unresolvedAttestations = decisions.unresolvedAttestations.map(attestation => ({
			...attestation,
			candidateReadingIds: [...attestation.candidateReadingIds],
		}));
	return clone;
}

export function applyDecisions(
	proposal: ClassifiedReading[],
	decisions: UnitDecisions,
	options?: {
		baseWitnessId?: string | null;
		vocabulary?: readonly ReadingTypeDefinition[];
		manualWitnesses?: readonly ManualWitnessDefinition[];
	}
): UnitView {
	const baseWitnessId = options?.baseWitnessId ?? null;
	proposal = [
		...proposal,
		...(decisions.authoredReadings ?? [])
			.filter(reading => !proposal.some(stored => stored.id === reading.id))
			.map(reading => ({
				...reading,
				label: '',
				normalizedText: reading.text,
				witnessIds: [],
				witnessGroups: [],
				isLacuna: false,
				certainty: null,
				isSubreading: false,
				autoGenerated: false,
				derivedFromRuleIds: [],
			})),
	];
	const readingIds = new Set(proposal.map(reading => reading.id));
	const orphanedDecisions: OrphanedDecision[] = [];
	const manualByReading = new Map<string, string[]>();
	for (const [manualWitnessId, testimony] of Object.entries(decisions.manualTestimony ?? {})) {
		if (
			options?.manualWitnesses &&
			!options.manualWitnesses.some(witness => witness.id === manualWitnessId)
		)
			continue;
		if (testimony.kind !== 'reading') continue;
		if (!readingIds.has(testimony.readingId)) {
			orphanedDecisions.push({
				kind: 'manualTestimony',
				manualWitnessId,
				readingId: testimony.readingId,
				missingReadingIds: [testimony.readingId],
			});
			continue;
		}
		manualByReading.set(testimony.readingId, [
			...(manualByReading.get(testimony.readingId) ?? []),
			manualWitnessId,
		]);
	}
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
	for (const [readingId, tagIds] of Object.entries(decisions.readingTags ?? {})) {
		if (readingIds.has(readingId) || tagIds.length === 0) continue;
		orphanedDecisions.push({
			kind: 'readingTag',
			readingId,
			tagIds: [...tagIds],
			missingReadingIds: [readingId],
		});
	}
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

	const attestations: AmbiguousAttestation[] = [];
	for (const attestation of decisions.ambiguousAttestations ?? []) {
		const missingReadingIds = attestation.targetReadingIds.filter(id => !readingIds.has(id));
		if (missingReadingIds.length === 0) {
			const witnessIds = attestation.witnessIds.filter(
				id =>
					!options?.manualWitnesses ||
					options.manualWitnesses.some(witness => witness.id === id) ||
					proposal.some(reading => reading.witnessIds.includes(id))
			);
			if (witnessIds.length > 0) attestations.push({ ...attestation, witnessIds });
			continue;
		}
		orphanedDecisions.push({
			kind: 'ambiguousAttestation',
			attestationId: attestation.id,
			missingReadingIds,
		});
	}

	const decidedReadings = proposal.map(reading => {
		const parentReadingId = applicable.has(reading.id)
			? (applicable.get(reading.id) ?? null)
			: reading.parentReadingId;
		const recordedType = readingTypes.get(reading.id) ?? null;
		const { readingTags: _readingTags, ...untagged } = reading;
		const tagIds = decisions.readingTags?.[reading.id] ?? [];
		const decided = {
			...untagged,
			manualWitnessIds: manualByReading.get(reading.id) ?? [],
			...(tagIds.length > 0 ? { readingTags: [...tagIds] } : {}),
			// A subreading recorded as "no type" falls back to the proposed type.
			readingType:
				recordedType !== null || (readingTypes.has(reading.id) && parentReadingId === null)
					? recordedType
					: reading.readingType,
			certainty: certainties.has(reading.id)
				? (certainties.get(reading.id) ?? null)
				: reading.certainty,
		};
		if (!applicable.has(reading.id)) return decided;
		return {
			...decided,
			parentReadingId,
			isSubreading: parentReadingId !== null,
			autoGenerated: false,
		};
	});
	const readings = dropEmptiedReadings(
		decidedReadings,
		withoutWitnesses(
			decidedReadings,
			new Set([
				...attestations.flatMap(attestation => attestation.witnessIds),
				...(decisions.unresolvedAttestations ?? []).map(
					attestation => attestation.witnessId
				),
			])
		),
		...manualByReading.keys(),
		...attestations.flatMap(attestation => attestation.targetReadingIds),
		...(decisions.unresolvedAttestations ?? []).flatMap(
			attestation => attestation.candidateReadingIds
		)
	);

	const mainReadingIdOf = makeMainReadingIdOf(readings);

	const baseTextReading = baseWitnessId
		? readings.find(reading => reading.witnessIds.includes(baseWitnessId))
		: undefined;
	const baseTextReadingId =
		baseTextReading && !baseTextReading.isLacuna ? mainReadingIdOf(baseTextReading.id) : null;

	let lemmaReadingId: string | null = null;
	const designatedLemmaId = decisions.lemmaReadingId ?? null;
	if (designatedLemmaId !== null) {
		if (readingIds.has(designatedLemmaId)) {
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

	const labelled = relabelReadings(
		readings,
		baseTextReadingId ? baseWitnessId : null,
		decisions.preserveReadings && designatedLemmaId === null ? null : lemmaReadingId,
		options?.vocabulary
	);
	const citation = citationOrder(labelled);

	const manualIds =
		options?.manualWitnesses?.map(witness => witness.id) ??
		Object.keys(decisions.manualTestimony ?? {});
	const ambiguousIds = new Set(attestations.flatMap(attestation => attestation.witnessIds));
	return {
		uncitedManualWitnessIds: manualIds.filter(
			id => decisions.manualTestimony?.[id]?.kind === 'uncited' && !ambiguousIds.has(id)
		),
		nonAttestingManualWitnessIds: manualIds.filter(
			id =>
				decisions.manualTestimony?.[id]?.kind === 'nonAttestation' && !ambiguousIds.has(id)
		),
		unrecordedManualWitnessIds: (options?.manualWitnesses ?? [])
			.filter(
				witness =>
					witness.treatment === 'full' &&
					!decisions.manualTestimony?.[witness.id] &&
					!ambiguousIds.has(witness.id)
			)
			.map(witness => witness.id),
		readings: labelled,
		unconfirmedWitnessIds: [...(decisions.unconfirmedWitnessIds ?? [])],
		unresolvedAttestations: (decisions.unresolvedAttestations ?? []).map(attestation => ({
			...attestation,
			candidateReadingIds: [...attestation.candidateReadingIds],
		})),
		ambiguousAttestations: attestations.map(attestation => {
			const targets = citation.filter(reading =>
				attestation.targetReadingIds.includes(reading.id)
			);
			const targetLabels = targets.map(reading => reading.label);
			return {
				id: attestation.id,
				witnessIds: [...attestation.witnessIds],
				targetReadingIds: targets.map(reading => reading.id),
				targetLabels,
				label: `zw ${targetLabels.join('/')}`,
			};
		}),
		orphanedDecisions,
		lemmaReadingId,
		baseTextReadingId,
		needsLemmaDecision,
	};
}

export function withAmbiguousAttestation(
	proposal: ClassifiedReading[],
	decisions: UnitDecisions,
	draft: { witnessIds: string[]; targetReadingIds: string[] }
):
	| { ok: true; decisions: UnitDecisions; attestationId: string }
	| { ok: false; error: AmbiguousAttestationError } {
	const witnessIds = [...new Set(draft.witnessIds)];
	const targetReadingIds = [...new Set(draft.targetReadingIds)];
	if (witnessIds.length === 0) return { ok: false, error: 'no-witnesses' };
	if (targetReadingIds.length < 2) return { ok: false, error: 'too-few-targets' };

	const { readings } = applyDecisions(proposal, decisions);
	const targets = readings.filter(reading => targetReadingIds.includes(reading.id));
	if (targets.length < targetReadingIds.length) return { ok: false, error: 'target-not-found' };

	const existing = decisions.ambiguousAttestations ?? [];
	if (existing.some(attestation => attestation.witnessIds.some(id => witnessIds.includes(id)))) {
		return { ok: false, error: 'witness-already-ambiguous' };
	}
	if (
		!witnessIds.every(id =>
			readings.some(reading =>
				[...reading.witnessIds, ...(reading.manualWitnessIds ?? [])].includes(id)
			)
		)
	) {
		return { ok: false, error: 'witness-not-attesting' };
	}
	if (
		targets.some(target =>
			[...target.witnessIds, ...(target.manualWitnessIds ?? [])].every(id =>
				witnessIds.includes(id)
			)
		)
	) {
		return { ok: false, error: 'target-emptied' };
	}

	const attestationId = crypto.randomUUID();
	const next = cloneUnitDecisions(decisions);
	next.ambiguousAttestations = [
		...(next.ambiguousAttestations ?? []),
		{ id: attestationId, witnessIds, targetReadingIds },
	];
	return { ok: true, decisions: next, attestationId };
}

/** Orphaned work; arcs walked too since `derived` lives only there. */
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
