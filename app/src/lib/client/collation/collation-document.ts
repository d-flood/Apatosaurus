import {
	serializeAlignmentColumns,
	type AlignmentColumn,
	type SerializedAlignmentColumn,
} from './alignment-snapshot';
import type {
	AlignmentLayout,
	AlignmentDisplayMode,
	ClassifiedReading,
	CollationPhase,
	RegularizationRule,
	ReadingArc,
	SuppliedTextMode,
	WitnessConfig,
	WitnessSourceToken,
} from './collation-types';
import { applyDecisions, type UnitDecisions } from './collation-decisions';
import { variationUnitId } from './collation-unit-id';

export const COLLATION_DOCUMENT_ARTIFACT_TYPE = 'collation_document_v1';

export interface CollationSegment {
	id: string;
	name: string;
	members: string[];
}

export interface CollationWitnessNode {
	type: 'witness';
	id: string;
	siglum: string;
	transcriptionId: string;
	kind?: WitnessConfig['kind'];
	handId?: string;
	sourceVersion?: string;
	sourceContentHash?: string;
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

export interface CollationAlignmentNode {
	type: 'alignment';
	witnessOrder: string[];
	columns: SerializedAlignmentColumn[];
}

export interface CollationVariationUnitNode {
	type: 'variationUnit';
	id: string;
	unitId: string;
	columnId: string | null;
	readings: ClassifiedReading[];
	decisions: UnitDecisions;
}

export interface CollationApparatusNode {
	type: 'apparatus';
	units: CollationVariationUnitNode[];
}

export interface CollationStemmaUnitNode {
	type: 'stemmaUnit';
	id: string;
	unitId: string;
	columnId: string | null;
	arcs: ReadingArc[];
	/** Omitted until a scholar establishes a value; the in-memory default is 10. */
	connectivity?: number | 'absolute';
}

export interface CollationStemmaNode {
	type: 'stemma';
	units: CollationStemmaUnitNode[];
}

export interface CollationDocument {
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
	collationId: string | null;
	projectId: string | null;
	projectName: string | null;
	phase: CollationPhase;
	furthestPhase: CollationPhase;
	segment: CollationSegment;
	witnesses: WitnessConfig[];
	rules: RegularizationRule[];
	ignoreWordBreaks: boolean;
	lowercase: boolean;
	ignoreTokenWhitespace: boolean;
	ignorePunctuation: boolean;
	suppliedTextMode: SuppliedTextMode;
	segmentation: boolean;
	alignmentColumns: AlignmentColumn[];
	witnessOrder: string[];
	classifiedReadings: Map<string, ClassifiedReading[]>;
	unitDecisions: Map<string, UnitDecisions>;
	readingArcs: Map<string, ReadingArc[]>;
	alignmentDisplayMode: AlignmentDisplayMode;
	alignmentLayout: AlignmentLayout;
}

export interface HydratedCollationDocument {
	collationId: string | null;
	projectId: string | null;
	projectName: string | null;
	phase: CollationPhase;
	furthestPhase: CollationPhase;
	segment: CollationSegment;
	witnesses: WitnessConfig[];
	rules: RegularizationRule[];
	ignoreWordBreaks: boolean;
	lowercase: boolean;
	ignoreTokenWhitespace: boolean;
	ignorePunctuation: boolean;
	suppliedTextMode: SuppliedTextMode;
	segmentation: boolean;
	alignmentColumns: SerializedAlignmentColumn[];
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

function normalizePhase(value: unknown): CollationPhase {
	return value === 'setup' ||
		value === 'alignment' ||
		value === 'readings' ||
		value === 'stemma' ||
		value === 'review' ||
		value === 'regularization'
		? value
		: 'review';
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
		sourceVersion: witness.sourceVersion,
		sourceContentHash: witness.sourceContentHash,
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
			sourceVersion: typeof raw.sourceVersion === 'string' ? raw.sourceVersion : '',
			sourceContentHash:
				typeof raw.sourceContentHash === 'string' ? raw.sourceContentHash : undefined,
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

/**
 * The witness a scholar designated as the base text, or null when none is designated or the
 * designated one is excluded and so testifies nowhere. Never stands another witness in.
 */
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
	baseWitnessId: string | null
): CollationApparatusNode | null {
	if (classifiedReadings.size === 0 && unitDecisions.size === 0) return null;
	const unitIds = new Set([...classifiedReadings.keys(), ...unitDecisions.keys()]);
	const units = [...unitIds]
		.map(unitId => {
			const columnId =
				alignmentColumns.find(column => variationUnitId(column.id) === unitId)?.id ?? null;
			const { connectivity: _, ...decisions } = unitDecisions.get(unitId) ?? {};
			return {
				type: 'variationUnit' as const,
				id: unitId,
				unitId,
				columnId,
				readings: applyDecisions(
					classifiedReadings.get(unitId) ?? [],
					unitDecisions.get(unitId) ?? {},
					{ baseWitnessId }
				).readings,
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
	alignmentColumns: AlignmentColumn[]
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
				alignmentColumns.find(column => variationUnitId(column.id) === unitId)?.id ?? null;
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
					}
				: null,
		apparatus: buildApparatus(
			seed.classifiedReadings,
			seed.unitDecisions,
			seed.alignmentColumns,
			findBaseTextWitnessId(seed.witnesses)
		),
		stemma: buildStemma(seed.readingArcs, seed.unitDecisions, seed.alignmentColumns),
	};
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
		collationId: document.meta.collationId ?? null,
		projectId: document.meta.projectId ?? null,
		projectName: document.meta.projectName ?? null,
		phase: normalizePhase(document.flow?.phase),
		furthestPhase: normalizePhase(document.flow?.furthestPhase),
		segment: assertCollationSegment(document.setup?.segment),
		witnesses: parseWitnesses(document.setup?.witnesses),
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
		witnessOrder:
			document.alignment && Array.isArray(document.alignment.witnessOrder)
				? document.alignment.witnessOrder.filter(
						(id): id is string => typeof id === 'string'
					)
				: [],
		classifiedReadings: [],
		unitDecisions: [...decisionsByUnit],
		readingArcs:
			document.stemma?.units
				?.filter(unit => typeof unit.unitId === 'string' && Array.isArray(unit.arcs))
				.map(unit => [unit.unitId, unit.arcs] as [string, ReadingArc[]]) ?? [],
		alignmentDisplayMode: normalizeDisplayMode(document.flow?.alignmentDisplayMode),
		alignmentLayout: normalizeAlignmentLayout(document.flow?.alignmentLayout),
	};
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
		!hasValidStemmaConnectivity(candidate.stemma) ||
		hasApparatusConnectivity(candidate.apparatus)
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
