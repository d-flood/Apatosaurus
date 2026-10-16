import {
	deserializeAlignmentColumns,
	serializeAlignmentColumns,
	type AlignmentColumn,
	type SerializedAlignmentColumn,
} from './alignment-snapshot';
import {
	COLLATION_PHASES,
	type AlignmentLayout,
	type AlignmentDisplayMode,
	type ClassifiedReading,
	type CollationPhase,
	type RegularizationRule,
	type ReadingArc,
	type SuppliedTextMode,
	type WitnessConfig,
	type ManualWitnessOverride,
	type WitnessSource,
	type WitnessSourceToken,
} from './collation-types';
import { applyDecisions, type UnitDecisions } from './collation-decisions';
import { buildReadingProposal, isUntypedSubreading } from './collation-reading-proposal';
import {
	buildVariationUnitSpans,
	validDeclaredUnits,
	type DeclaredUnit,
} from './collation-variation-units';
import type { ReadingTypeDefinition } from './reading-types';

export const COLLATION_DOCUMENT_ARTIFACT_TYPE = 'collation_document_v1';

export interface CollationSegment {
	id: string;
	name: string;
	members: string[];
}

interface CollationWitnessNode {
	type: 'witness';
	id: string;
	siglum: string;
	transcriptionId: string;
	kind?: WitnessConfig['kind'];
	handId?: string;
	source?: WitnessSource;
	content: string;
	fullContent?: string;
	fragmentaryContent?: string;
	treatment: WitnessConfig['treatment'];
	isBaseText: boolean;
	isExcluded: boolean;
	overridesDefault: boolean;
	fullSourceTokens?: Array<
		WitnessSourceToken & {
			tokenId: string;
			sourceRef: {
				witnessId: string;
				transcriptionId: string;
				index: number;
			};
		}
	>;
	fragmentarySourceTokens?: Array<
		WitnessSourceToken & {
			tokenId: string;
			sourceRef: {
				witnessId: string;
				transcriptionId: string;
				index: number;
			};
		}
	>;
	sourceTokens: Array<
		WitnessSourceToken & {
			tokenId: string;
			sourceRef: {
				witnessId: string;
				transcriptionId: string;
				index: number;
			};
		}
	>;
}

interface CollationAlignmentNode {
	declaredUnits?: DeclaredUnit[];
	type: 'alignment';
	witnessOrder: string[];
	columns: SerializedAlignmentColumn[];
}

interface CollationVariationUnitNode {
	type: 'variationUnit';
	id: string;
	unitId: string;
	columnId: string | null;
	readings: ClassifiedReading[];
	decisions: UnitDecisions;
}

interface CollationApparatusNode {
	type: 'apparatus';
	units: CollationVariationUnitNode[];
}

interface CollationStemmaUnitNode {
	type: 'stemmaUnit';
	id: string;
	unitId: string;
	columnId: string | null;
	arcs: ReadingArc[];
	/** Unset until decided; in-memory default is 10. */
	connectivity?: number | 'absolute';
}

interface CollationStemmaNode {
	type: 'stemma';
	units: CollationStemmaUnitNode[];
}

export interface ImportNote {
	id: string;
	unitId: string | null;
	detail: string;
}

export interface CollationDocument {
	importNotes?: ImportNote[];
	type: 'collationDocument';
	version: 1;
	meta: {
		collationId: string | null;
		projectId: string | null;
		projectName: string | null;
	};
	flow: {
		phase: CollationPhase;
		furthestPhase: CollationPhase;
		alignmentDisplayMode: AlignmentDisplayMode;
		alignmentLayout: AlignmentLayout;
	};
	setup: {
		segment: CollationSegment;
		witnesses: CollationWitnessNode[];
		manualWitnessOverrides?: ManualWitnessOverride[];
	};
	settings: {
		regularizationRules: RegularizationRule[];
		ignoreWordBreaks: boolean;
		lowercase: boolean;
		ignoreTokenWhitespace: boolean;
		ignorePunctuation: boolean;
		suppliedTextMode: SuppliedTextMode;
		segmentation: boolean;
	};
	alignment: CollationAlignmentNode | null;
	apparatus: CollationApparatusNode | null;
	stemma: CollationStemmaNode | null;
}

export interface CollationDocumentSeed {
	importNotes?: ImportNote[];
	collationId: string | null;
	projectId: string | null;
	projectName: string | null;
	phase: CollationPhase;
	furthestPhase: CollationPhase;
	segment: CollationSegment;
	witnesses: WitnessConfig[];
	manualWitnessOverrides?: ManualWitnessOverride[];
	rules: RegularizationRule[];
	ignoreWordBreaks: boolean;
	lowercase: boolean;
	ignoreTokenWhitespace: boolean;
	ignorePunctuation: boolean;
	suppliedTextMode: SuppliedTextMode;
	segmentation: boolean;
	alignmentColumns: AlignmentColumn[];
	declaredUnits?: DeclaredUnit[];
	witnessOrder: string[];
	classifiedReadings: Map<string, ClassifiedReading[]>;
	unitDecisions: Map<string, UnitDecisions>;
	readingArcs: Map<string, ReadingArc[]>;
	alignmentDisplayMode: AlignmentDisplayMode;
	alignmentLayout: AlignmentLayout;
}

export interface HydratedCollationDocument {
	importNotes?: ImportNote[];
	collationId: string | null;
	projectId: string | null;
	projectName: string | null;
	phase: CollationPhase;
	furthestPhase: CollationPhase;
	segment: CollationSegment;
	witnesses: WitnessConfig[];
	manualWitnessOverrides?: ManualWitnessOverride[];
	rules: RegularizationRule[];
	ignoreWordBreaks: boolean;
	lowercase: boolean;
	ignoreTokenWhitespace: boolean;
	ignorePunctuation: boolean;
	suppliedTextMode: SuppliedTextMode;
	segmentation: boolean;
	alignmentColumns: SerializedAlignmentColumn[];
	declaredUnits: DeclaredUnit[];
	witnessOrder: string[];
	classifiedReadings: Array<[string, ClassifiedReading[]]>;
	unitDecisions: Array<[string, UnitDecisions]>;
	readingArcs: Array<[string, ReadingArc[]]>;
	alignmentDisplayMode: AlignmentDisplayMode;
	alignmentLayout: AlignmentLayout;
}

function makeSourceTokenId(witnessId: string, index: number): string {
	return `${witnessId}::source::${index}`;
}

/** Unknown phases come from newer builds, so clamp instead of resetting progress. */
function normalizePhase(value: unknown): CollationPhase {
	if (value === 'regularization') return 'alignment';
	if (COLLATION_PHASES.includes(value as CollationPhase)) return value as CollationPhase;
	return typeof value === 'string' ? 'review' : 'setup';
}

function normalizeDisplayMode(value: unknown): AlignmentDisplayMode {
	return value === 'original' ? 'original' : 'regularized';
}

function normalizeAlignmentLayout(value: unknown): AlignmentLayout {
	return value === 'variation-units' ? 'variation-units' : 'grid';
}

function normalizeSuppliedTextMode(value: unknown): SuppliedTextMode {
	return value === 'gap' ? 'gap' : 'clear';
}

function isPersistedConnectivity(value: unknown): value is number | 'absolute' {
	return (
		value === 'absolute' || (typeof value === 'number' && Number.isInteger(value) && value > 0)
	);
}

function hasValidStemmaConnectivity(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
	const units = (value as Record<string, unknown>).units;
	if (!Array.isArray(units)) return true;
	return units.every(unit => {
		if (!unit || typeof unit !== 'object' || Array.isArray(unit)) return true;
		const candidate = unit as Record<string, unknown>;
		return !('connectivity' in candidate) || isPersistedConnectivity(candidate.connectivity);
	});
}

function hasApparatusConnectivity(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const units = (value as Record<string, unknown>).units;
	if (!Array.isArray(units)) return false;
	return units.some(unit => {
		if (!unit || typeof unit !== 'object' || Array.isArray(unit)) return false;
		const decisions = (unit as Record<string, unknown>).decisions;
		return Boolean(decisions && typeof decisions === 'object' && 'connectivity' in decisions);
	});
}

function isStringList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function isAmbiguousAttestation(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.id === 'string' &&
		isStringList(candidate.witnessIds) &&
		candidate.witnessIds.length > 0 &&
		isStringList(candidate.targetReadingIds) &&
		new Set(candidate.targetReadingIds).size >= 2
	);
}

function hasValidAmbiguousAttestations(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
	const units = (value as Record<string, unknown>).units;
	if (!Array.isArray(units)) return true;
	return units.every(unit => {
		if (!unit || typeof unit !== 'object' || Array.isArray(unit)) return true;
		const decisions = (unit as Record<string, unknown>).decisions;
		if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions)) return true;
		const record = decisions as Record<string, unknown>;
		const spanning = record.spanningReadingIds;
		if (
			spanning !== undefined &&
			(!isStringList(spanning) ||
				spanning.some(id => !id.trim()) ||
				new Set(spanning).size !== spanning.length)
		)
			return false;
		const resolutions = record.overlapResolutions;
		if (
			resolutions !== undefined &&
			(!resolutions ||
				typeof resolutions !== 'object' ||
				Array.isArray(resolutions) ||
				!Object.entries(resolutions).every(([id, value]) => {
					if (!id.trim() || !value || typeof value !== 'object' || Array.isArray(value))
						return false;
					const entry = value as Record<string, unknown>;
					return (
						entry.kind === 'overlapped' ||
						(entry.kind === 'reading' &&
							typeof entry.readingId === 'string' &&
							Boolean(entry.readingId.trim()))
					);
				}))
		)
			return false;
		const testimony = record.manualTestimony;
		if (
			testimony !== undefined &&
			(!testimony ||
				typeof testimony !== 'object' ||
				Array.isArray(testimony) ||
				!Object.entries(testimony).every(([id, value]) => {
					if (!id.trim() || !value || typeof value !== 'object' || Array.isArray(value))
						return false;
					const entry = value as Record<string, unknown>;
					return (
						entry.kind === 'nonAttestation' ||
						entry.kind === 'uncited' ||
						(entry.kind === 'reading' &&
							typeof entry.readingId === 'string' &&
							Boolean(entry.readingId.trim()))
					);
				}))
		)
			return false;
		const authored = record.authoredReadings;
		if (
			authored !== undefined &&
			(!Array.isArray(authored) ||
				!authored.every(value => {
					if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
					const entry = value as Record<string, unknown>;
					return (
						typeof entry.id === 'string' &&
						Boolean(entry.id.trim()) &&
						(entry.text === null || typeof entry.text === 'string') &&
						typeof entry.isOmission === 'boolean' &&
						typeof entry.order === 'number' &&
						Number.isFinite(entry.order) &&
						entry.parentReadingId === null &&
						entry.readingType === null
					);
				}) ||
				new Set(authored.map(entry => entry.id)).size !== authored.length)
		)
			return false;
		const tags = record.readingTags;
		if (
			tags !== undefined &&
			(!tags ||
				typeof tags !== 'object' ||
				Array.isArray(tags) ||
				!Object.entries(tags).every(
					([readingId, ids]) =>
						Boolean(readingId.trim()) &&
						isStringList(ids) &&
						ids.every(id => Boolean(id.trim())) &&
						new Set(ids).size === ids.length
				))
		)
			return false;
		const unconfirmed = record.unconfirmedWitnessIds;
		if (
			unconfirmed !== undefined &&
			(!Array.isArray(unconfirmed) || !unconfirmed.every(id => typeof id === 'string'))
		)
			return false;
		const unresolved = record.unresolvedAttestations;
		if (
			unresolved !== undefined &&
			(!Array.isArray(unresolved) ||
				!unresolved.every(value => {
					if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
					const attestation = value as Record<string, unknown>;
					return (
						typeof attestation.witnessId === 'string' &&
						Array.isArray(attestation.candidateReadingIds) &&
						attestation.candidateReadingIds.every(id => typeof id === 'string') &&
						new Set(attestation.candidateReadingIds).size >= 2
					);
				}))
		)
			return false;
		const attestations = record.ambiguousAttestations;
		return (
			attestations === undefined ||
			(Array.isArray(attestations) && attestations.every(isAmbiguousAttestation))
		);
	});
}

function assertCollationSegment(value: unknown): CollationSegment {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Collation segment is required.');
	}
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
		throw new Error('Collation segment id is required.');
	}
	if (typeof candidate.name !== 'string' || !candidate.name.trim()) {
		throw new Error('Collation segment name is required.');
	}
	if (
		!Array.isArray(candidate.members) ||
		candidate.members.some(member => typeof member !== 'string' || member.length === 0)
	) {
		throw new Error('A collation segment must contain at least one member.');
	}
	const members = [...new Set(candidate.members as string[])];
	if (members.length === 0) {
		throw new Error('A collation segment must contain at least one member.');
	}
	return {
		id: candidate.id,
		name: candidate.name,
		members,
	};
}

function normalizeWitnesses(witnesses: WitnessConfig[]): CollationWitnessNode[] {
	return witnesses.map(witness => ({
		type: 'witness',
		id: witness.witnessId,
		siglum: witness.siglum,
		transcriptionId: witness.transcriptionId,
		kind: witness.kind,
		handId: witness.handId,
		source: witness.source,
		content: witness.content,
		fullContent: witness.fullContent,
		fragmentaryContent: witness.fragmentaryContent,
		treatment: witness.treatment,
		isBaseText: witness.isBaseText,
		isExcluded: witness.isExcluded,
		overridesDefault: witness.overridesDefault,
		fullSourceTokens: (witness.fullTokens ?? []).map((token, index) => ({
			...token,
			tokenId: makeSourceTokenId(`${witness.witnessId}::full`, index),
			sourceRef: {
				witnessId: witness.witnessId,
				transcriptionId: witness.transcriptionId,
				index,
			},
		})),
		fragmentarySourceTokens: (witness.fragmentaryTokens ?? []).map((token, index) => ({
			...token,
			tokenId: makeSourceTokenId(`${witness.witnessId}::fragmentary`, index),
			sourceRef: {
				witnessId: witness.witnessId,
				transcriptionId: witness.transcriptionId,
				index,
			},
		})),
		sourceTokens: witness.tokens.map((token, index) => ({
			...token,
			tokenId: makeSourceTokenId(witness.witnessId, index),
			sourceRef: {
				witnessId: witness.witnessId,
				transcriptionId: witness.transcriptionId,
				index,
			},
		})),
	}));
}

/** Legacy nodes carry `sourceVersion`/`sourceContentHash` instead of `source`. */
export function readWitnessSource(
	raw: Record<string, unknown>,
	legacyCapturedAt = ''
): WitnessSource | undefined {
	const transcriptionId = typeof raw.transcriptionId === 'string' ? raw.transcriptionId : '';
	const source = raw.source as Record<string, unknown> | null | undefined;
	if (source && typeof source === 'object') {
		const sourceTranscriptionId =
			typeof source.transcriptionId === 'string' ? source.transcriptionId : transcriptionId;
		if (source.kind === 'version' && typeof source.versionId === 'string') {
			return {
				kind: 'version',
				transcriptionId: sourceTranscriptionId,
				versionId: source.versionId,
			};
		}
		if (source.kind === 'current') {
			return {
				kind: 'current',
				transcriptionId: sourceTranscriptionId,
				capturedAt: typeof source.capturedAt === 'string' ? source.capturedAt : '',
				contentHash: typeof source.contentHash === 'string' ? source.contentHash : '',
			};
		}
		return undefined;
	}
	if (!transcriptionId) return undefined;
	if (typeof raw.sourceVersion === 'string' && raw.sourceVersion) {
		return { kind: 'version', transcriptionId, versionId: raw.sourceVersion };
	}
	return {
		kind: 'current',
		transcriptionId,
		capturedAt: legacyCapturedAt,
		contentHash: typeof raw.sourceContentHash === 'string' ? raw.sourceContentHash : '',
	};
}

function parseWitnesses(nodes: unknown): WitnessConfig[] {
	if (!Array.isArray(nodes)) return [];
	const parsed: WitnessConfig[] = [];
	for (const node of nodes) {
		if (!node || typeof node !== 'object') continue;
		const raw = node as Record<string, unknown>;
		if (typeof raw.id !== 'string' || typeof raw.siglum !== 'string') continue;
		const parseSourceTokens = (input: unknown): WitnessSourceToken[] =>
			Array.isArray(input)
				? input
						.filter(
							(token): token is WitnessSourceToken =>
								Boolean(token) && typeof token === 'object'
						)
						.map<WitnessSourceToken>(token => {
							const candidate = token as unknown as Record<string, unknown>;
							const kind: WitnessSourceToken['kind'] =
								candidate.kind === 'gap' || candidate.kind === 'untranscribed'
									? candidate.kind
									: 'text';
							const gap: WitnessSourceToken['gap'] =
								candidate.gap && typeof candidate.gap === 'object'
									? (() => {
											const rawGap = candidate.gap as Record<string, unknown>;
											const source: NonNullable<
												WitnessSourceToken['gap']
											>['source'] =
												rawGap.source === 'supplied'
													? 'supplied'
													: rawGap.source === 'untranscribed'
														? 'untranscribed'
														: 'gap';
											return {
												source,
												reason:
													typeof rawGap.reason === 'string'
														? rawGap.reason
														: '',
												unit:
													typeof rawGap.unit === 'string'
														? rawGap.unit
														: '',
												extent:
													typeof rawGap.extent === 'string'
														? rawGap.extent
														: '',
											};
										})()
									: null;
							return {
								kind,
								original:
									typeof candidate.original === 'string'
										? candidate.original
										: '',
								segments: Array.isArray(candidate.segments)
									? candidate.segments
											.filter(
												(
													segment
												): segment is NonNullable<
													WitnessSourceToken['segments'][number]
												> => Boolean(segment) && typeof segment === 'object'
											)
											.map(segment => {
												const rawSegment = segment as unknown as Record<
													string,
													unknown
												>;
												return {
													text:
														typeof rawSegment.text === 'string'
															? rawSegment.text
															: '',
													hasUnclear: rawSegment.hasUnclear === true,
													isPunctuation:
														rawSegment.isPunctuation === true,
													isSupplied: rawSegment.isSupplied === true,
												};
											})
									: [],
								gap,
							};
						})
				: [];
		const sourceTokens = parseSourceTokens(raw.sourceTokens);
		const fullSourceTokens = parseSourceTokens(raw.fullSourceTokens);
		const fragmentarySourceTokens = parseSourceTokens(raw.fragmentarySourceTokens);
		parsed.push({
			witnessId: raw.id,
			siglum: raw.siglum,
			transcriptionId: typeof raw.transcriptionId === 'string' ? raw.transcriptionId : '',
			kind: raw.kind === 'corrector' ? 'corrector' : 'firsthand',
			handId: typeof raw.handId === 'string' ? raw.handId : undefined,
			source: readWitnessSource(raw),
			content: typeof raw.content === 'string' ? raw.content : '',
			tokens: sourceTokens,
			fullContent: typeof raw.fullContent === 'string' ? raw.fullContent : undefined,
			fullTokens: fullSourceTokens,
			fragmentaryContent:
				typeof raw.fragmentaryContent === 'string' ? raw.fragmentaryContent : undefined,
			fragmentaryTokens: fragmentarySourceTokens,
			treatment:
				raw.treatment === 'full' || raw.treatment === 'fragmentary'
					? raw.treatment
					: 'inherit',
			isBaseText: raw.isBaseText === true,
			isExcluded: raw.isExcluded === true,
			overridesDefault: raw.overridesDefault === true,
		});
	}
	return parsed;
}

/** Designated base-text witness, or null when none testifies. Never falls back. */
export function findBaseTextWitnessId(
	witnesses: Pick<WitnessConfig, 'witnessId' | 'isBaseText' | 'isExcluded'>[]
): string | null {
	const designated = witnesses.find(witness => witness.isBaseText);
	if (!designated || designated.isExcluded) return null;
	return designated.witnessId;
}

function buildApparatus(
	classifiedReadings: Map<string, ClassifiedReading[]>,
	unitDecisions: Map<string, UnitDecisions>,
	alignmentColumns: AlignmentColumn[],
	baseWitnessId: string | null,
	sourceWitnessIds: string[],
	declaredUnits: DeclaredUnit[]
): CollationApparatusNode | null {
	if (classifiedReadings.size === 0 && unitDecisions.size === 0) return null;
	const unitIds = new Set([...classifiedReadings.keys(), ...unitDecisions.keys()]);
	const units = [...unitIds]
		.map(unitId => {
			const span = buildVariationUnitSpans(alignmentColumns, declaredUnits).find(
				span => span.unitId === unitId
			);
			const columnId = span?.columnIds[0] ?? null;
			const { connectivity: _, ...decisions } = unitDecisions.get(unitId) ?? {};
			return {
				type: 'variationUnit' as const,
				id: unitId,
				unitId,
				columnId,
				readings: applyDecisions(
					classifiedReadings.get(unitId) ??
						buildReadingProposal({
							columns: alignmentColumns.filter(column =>
								span?.columnIds.includes(column.id)
							),
							spanColumnIds: span?.columnIds ?? [],
							sourceWitnessIds,
							baseWitnessId,
						}).readings,
					unitDecisions.get(unitId) ?? {},
					{ baseWitnessId }
				)
					.readings.filter(
						reading =>
							!decisions.authoredReadings?.some(
								authored => authored.id === reading.id
							)
					)
					.map(({ manualWitnessIds: _, ...reading }) => reading),
				decisions,
			};
		})
		.sort(
			(a, b) =>
				alignmentColumns.findIndex(column => column.id === a.columnId) -
				alignmentColumns.findIndex(column => column.id === b.columnId)
		);
	return { type: 'apparatus', units };
}

function buildStemma(
	readingArcs: Map<string, ReadingArc[]>,
	unitDecisions: Map<string, UnitDecisions>,
	alignmentColumns: AlignmentColumn[],
	declaredUnits: DeclaredUnit[]
): CollationStemmaNode | null {
	const unitIds = new Set([
		...readingArcs.keys(),
		...[...unitDecisions.entries()]
			.filter(([, decisions]) => decisions.connectivity !== undefined)
			.map(([unitId]) => unitId),
	]);
	if (unitIds.size === 0) return null;
	const units = [...unitIds]
		.map(unitId => {
			const columnId =
				buildVariationUnitSpans(alignmentColumns, declaredUnits).find(
					span => span.unitId === unitId
				)?.columnIds[0] ?? null;
			const connectivity = unitDecisions.get(unitId)?.connectivity;
			return {
				type: 'stemmaUnit' as const,
				id: unitId,
				unitId,
				columnId,
				arcs: readingArcs.get(unitId) ?? [],
				...(connectivity === undefined ? {} : { connectivity }),
			};
		})
		.sort(
			(a, b) =>
				alignmentColumns.findIndex(column => column.id === a.columnId) -
				alignmentColumns.findIndex(column => column.id === b.columnId)
		);
	return { type: 'stemma', units };
}

export function buildCollationDocument(seed: CollationDocumentSeed): CollationDocument {
	return {
		type: 'collationDocument',
		version: 1,
		...(seed.importNotes?.length
			? { importNotes: seed.importNotes.map(note => ({ ...note })) }
			: {}),
		meta: {
			collationId: seed.collationId,
			projectId: seed.projectId,
			projectName: seed.projectName,
		},
		flow: {
			phase: seed.phase,
			furthestPhase: seed.furthestPhase,
			alignmentDisplayMode: seed.alignmentDisplayMode,
			alignmentLayout: seed.alignmentLayout,
		},
		setup: {
			segment: assertCollationSegment(seed.segment),
			witnesses: normalizeWitnesses(seed.witnesses),
			...(seed.manualWitnessOverrides?.length
				? {
						manualWitnessOverrides: seed.manualWitnessOverrides.map(entry => ({
							...entry,
						})),
					}
				: {}),
		},
		settings: {
			regularizationRules: seed.rules,
			ignoreWordBreaks: seed.ignoreWordBreaks,
			lowercase: seed.lowercase,
			ignoreTokenWhitespace: seed.ignoreTokenWhitespace,
			ignorePunctuation: seed.ignorePunctuation,
			suppliedTextMode: seed.suppliedTextMode,
			segmentation: seed.segmentation,
		},
		alignment:
			seed.alignmentColumns.length > 0
				? {
						type: 'alignment',
						witnessOrder: seed.witnessOrder,
						columns: serializeAlignmentColumns(seed.alignmentColumns),
						...(seed.declaredUnits?.length
							? {
									declaredUnits: validDeclaredUnits(
										seed.alignmentColumns,
										seed.declaredUnits
									),
								}
							: {}),
					}
				: null,
		apparatus: buildApparatus(
			seed.classifiedReadings,
			seed.unitDecisions,
			seed.alignmentColumns,
			findBaseTextWitnessId(seed.witnesses),
			seed.witnesses.filter(witness => !witness.isExcluded).map(witness => witness.witnessId),
			seed.declaredUnits ?? []
		),
		stemma: buildStemma(
			seed.readingArcs,
			seed.unitDecisions,
			seed.alignmentColumns,
			seed.declaredUnits ?? []
		),
	};
}

function preservedCollationReadings(
	document: CollationDocument
): Array<[string, ClassifiedReading[]]> {
	const columns = deserializeAlignmentColumns(document.alignment?.columns ?? []);
	const spans = new Map(
		buildVariationUnitSpans(columns, document.alignment?.declaredUnits).map(span => [
			span.unitId,
			span,
		])
	);
	const witnesses = document.setup.witnesses.filter(witness => !witness.isExcluded);
	const baseWitnessId = witnesses.find(witness => witness.isBaseText)?.id ?? null;
	return (document.apparatus?.units ?? [])
		.filter(
			unit =>
				unit.decisions?.preserveReadings &&
				typeof unit.unitId === 'string' &&
				Array.isArray(unit.readings)
		)
		.map(unit => {
			const span = spans.get(unit.unitId);
			if (!span) return [unit.unitId, unit.readings];
			const proposal = buildReadingProposal({
				columns: columns.slice(span.startIndex, span.endIndex + 1),
				spanColumnIds: span.columnIds,
				sourceWitnessIds: witnesses.map(witness => witness.id),
				baseWitnessId,
			});
			const types = new Map(
				proposal.readings.map(reading => [reading.id, reading.readingType])
			);
			return [
				unit.unitId,
				unit.readings.map(reading =>
					reading.parentReadingId !== null && reading.readingType === null
						? { ...reading, readingType: types.get(reading.id) ?? null }
						: reading
				),
			];
		});
}

export function hydrateCollationDocument(document: CollationDocument): HydratedCollationDocument {
	const decisionsByUnit = new Map(
		document.apparatus?.units
			?.filter(unit => typeof unit.unitId === 'string')
			.map(unit => {
				const { connectivity: _, ...decisions } = unit.decisions ?? {};
				return [unit.unitId, decisions] as [string, UnitDecisions];
			}) ?? []
	);
	for (const unit of document.stemma?.units ?? []) {
		if (typeof unit.unitId !== 'string' || !isPersistedConnectivity(unit.connectivity)) {
			continue;
		}
		decisionsByUnit.set(unit.unitId, {
			...decisionsByUnit.get(unit.unitId),
			connectivity: unit.connectivity,
		});
	}
	return {
		importNotes: document.importNotes?.map(note => ({ ...note })) ?? [],
		collationId: document.meta.collationId ?? null,
		projectId: document.meta.projectId ?? null,
		projectName: document.meta.projectName ?? null,
		phase: normalizePhase(document.flow?.phase),
		furthestPhase: normalizePhase(document.flow?.furthestPhase),
		segment: assertCollationSegment(document.setup?.segment),
		witnesses: parseWitnesses(document.setup?.witnesses),
		manualWitnessOverrides:
			document.setup.manualWitnessOverrides?.map(entry => ({ ...entry })) ?? [],
		rules: Array.isArray(document.settings?.regularizationRules)
			? document.settings.regularizationRules
			: [],
		ignoreWordBreaks: document.settings?.ignoreWordBreaks === true,
		lowercase: document.settings?.lowercase === true,
		ignoreTokenWhitespace: document.settings?.ignoreTokenWhitespace !== false,
		ignorePunctuation: document.settings?.ignorePunctuation === true,
		suppliedTextMode: normalizeSuppliedTextMode(document.settings?.suppliedTextMode),
		segmentation: document.settings?.segmentation !== false,
		alignmentColumns:
			document.alignment && Array.isArray(document.alignment.columns)
				? document.alignment.columns
				: [],
		declaredUnits: validDeclaredUnits(
			deserializeAlignmentColumns(document.alignment?.columns ?? []),
			document.alignment?.declaredUnits ?? []
		),
		witnessOrder:
			document.alignment && Array.isArray(document.alignment.witnessOrder)
				? document.alignment.witnessOrder.filter(
						(id): id is string => typeof id === 'string'
					)
				: [],
		classifiedReadings: preservedCollationReadings(document),
		unitDecisions: [...decisionsByUnit],
		readingArcs:
			document.stemma?.units
				?.filter(unit => typeof unit.unitId === 'string' && Array.isArray(unit.arcs))
				.map(unit => [unit.unitId, unit.arcs] as [string, ReadingArc[]]) ?? [],
		alignmentDisplayMode: normalizeDisplayMode(document.flow?.alignmentDisplayMode),
		alignmentLayout: normalizeAlignmentLayout(document.flow?.alignmentLayout),
	};
}

export function countUntypedSubreadings(
	document: CollationDocument,
	vocabulary: readonly ReadingTypeDefinition[]
): number {
	const columns = deserializeAlignmentColumns(document.alignment?.columns ?? []);
	const witnesses = document.setup.witnesses.filter(witness => !witness.isExcluded);
	const baseWitnessId = witnesses.find(witness => witness.isBaseText)?.id ?? null;
	const activeIds = new Set(witnesses.map(witness => witness.id));
	const sourceWitnessIds = [
		...new Set([
			baseWitnessId ?? witnesses[0]?.id,
			...(document.alignment?.witnessOrder ?? []),
			...activeIds,
		]),
	].filter((id): id is string => id !== undefined && activeIds.has(id));
	const savedUnits = new Map(
		(document.apparatus?.units ?? []).map(unit => [unit.unitId, unit] as const)
	);
	const preservedReadings = new Map(preservedCollationReadings(document));
	let count = 0;
	for (const span of buildVariationUnitSpans(columns, document.alignment?.declaredUnits)) {
		const saved = savedUnits.get(span.unitId);
		const decisions = saved?.decisions ?? {};
		const preserved = preservedReadings.get(span.unitId);
		const readings = Array.isArray(preserved)
			? preserved
			: buildReadingProposal({
					columns: columns.slice(span.startIndex, span.endIndex + 1),
					spanColumnIds: span.columnIds,
					sourceWitnessIds,
					baseWitnessId,
				}).readings;
		count += applyDecisions(readings, decisions, { baseWitnessId, vocabulary }).readings.filter(
			reading => isUntypedSubreading(reading, vocabulary)
		).length;
	}
	return count;
}

function hasValidDeclaredUnits(alignment: unknown): boolean {
	if (!alignment || typeof alignment !== 'object') return true;
	const { declaredUnits, columns } = alignment as Record<string, unknown>;
	if (declaredUnits === undefined) return true;
	if (!Array.isArray(declaredUnits) || !Array.isArray(columns)) return false;
	const indices = new Map(columns.map((column, index) => [(column as { id: string }).id, index]));
	return declaredUnits.every(unit => {
		if (!unit || typeof unit !== 'object' || Array.isArray(unit)) return false;
		const { firstColumnId, lastColumnId } = unit;
		if (
			typeof firstColumnId !== 'string' ||
			!firstColumnId.trim() ||
			typeof lastColumnId !== 'string' ||
			!lastColumnId.trim()
		)
			return false;
		const first = indices.get(firstColumnId);
		const last = indices.get(lastColumnId);
		return first === undefined || last === undefined || first <= last;
	});
}

function hasValidManualWitnessOverrides(setup: unknown): boolean {
	if (!setup || typeof setup !== 'object') return false;
	const overrides = (setup as Record<string, unknown>).manualWitnessOverrides;
	if (overrides === undefined) return true;
	const ids = new Set<string>();
	return (
		Array.isArray(overrides) &&
		overrides.every(entry => {
			if (
				!entry ||
				typeof entry !== 'object' ||
				typeof entry.manualWitnessId !== 'string' ||
				!entry.manualWitnessId.trim() ||
				ids.has(entry.manualWitnessId) ||
				typeof entry.isExcluded !== 'boolean' ||
				!['inherit', 'full', 'fragmentary'].includes(entry.treatment)
			)
				return false;
			ids.add(entry.manualWitnessId);
			return true;
		})
	);
}

function hasValidImportNotes(value: unknown): boolean {
	if (value === undefined) return true;
	if (!Array.isArray(value)) return false;
	const ids = new Set<string>();
	return value.every(note => {
		if (!note || typeof note !== 'object' || Array.isArray(note)) return false;
		if (typeof note.id !== 'string' || !note.id.trim() || ids.has(note.id)) return false;
		ids.add(note.id);
		return (
			(note.unitId === null ||
				(typeof note.unitId === 'string' && Boolean(note.unitId.trim()))) &&
			typeof note.detail === 'string' &&
			Boolean(note.detail.trim())
		);
	});
}

export function parseCollationDocument(value: unknown): CollationDocument | null {
	let raw = value;
	if (typeof value === 'string') {
		try {
			raw = JSON.parse(value);
		} catch {
			return null;
		}
	}
	if (!raw || typeof raw !== 'object') return null;
	const candidate = raw as Record<string, unknown>;
	if (
		candidate.type !== 'collationDocument' ||
		candidate.version !== 1 ||
		!hasValidImportNotes(candidate.importNotes) ||
		!hasValidManualWitnessOverrides(candidate.setup) ||
		!hasValidDeclaredUnits(candidate.alignment) ||
		!hasValidStemmaConnectivity(candidate.stemma) ||
		hasApparatusConnectivity(candidate.apparatus) ||
		!hasValidAmbiguousAttestations(candidate.apparatus)
	)
		return null;
	try {
		assertCollationSegment((candidate.setup as Record<string, unknown> | undefined)?.segment);
	} catch {
		return null;
	}
	return candidate as unknown as CollationDocument;
}

export function serializeCollationDocument(document: CollationDocument): string {
	assertCollationSegment(document.setup.segment);
	return JSON.stringify(document);
}
