import { serializeAlignmentColumns, type AlignmentColumn, type SerializedAlignmentColumn } from './alignment-snapshot';
import type { AggregatedVerse } from './gather-verses';
import type {
	AlignmentLayout,
	AlignmentDisplayMode,
	ClassifiedReading,
	CollationPhase,
	RegularizationRule,
	StemmaEdge,
	SuppliedTextMode,
	WitnessConfig,
	WitnessSourceToken,
} from './collation-types';

export const COLLATION_DOCUMENT_ARTIFACT_TYPE = 'collation_document_v1';

export interface CollationWitnessNode {
	type: 'witness';
	id: string;
	siglum: string;
	transcriptionId: string;
	kind?: WitnessConfig['kind'];
	handId?: string;
	sourceVersion?: string;
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
	unitIndex: number;
	columnId: string | null;
	readings: ClassifiedReading[];
}

export interface CollationApparatusNode {
	type: 'apparatus';
	units: CollationVariationUnitNode[];
}

export interface CollationStemmaUnitNode {
	type: 'stemmaUnit';
	id: string;
	unitIndex: number;
	columnId: string | null;
	edges: StemmaEdge[];
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
		selectedVerse: AggregatedVerse | null;
		selectedBook: string;
		selectedChapter: string;
		selectedVerseNum: string;
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
	selectedVerse: AggregatedVerse | null;
	selectedBook: string;
	selectedChapter: string;
	selectedVerseNum: string;
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
	stemmaEdges: Map<string, StemmaEdge[]>;
	alignmentDisplayMode: AlignmentDisplayMode;
	alignmentLayout: AlignmentLayout;
}

export interface HydratedCollationDocument {
	collationId: string | null;
	projectId: string | null;
	projectName: string | null;
	phase: CollationPhase;
	furthestPhase: CollationPhase;
	selectedVerse: AggregatedVerse | null;
	selectedBook: string;
	selectedChapter: string;
	selectedVerseNum: string;
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
	stemmaEdges: Array<[string, StemmaEdge[]]>;
	alignmentDisplayMode: AlignmentDisplayMode;
	alignmentLayout: AlignmentLayout;
}

function makeSourceTokenId(witnessId: string, index: number): string {
	return `${witnessId}::source::${index}`;
}

function normalizePhase(value: unknown): CollationPhase {
	return value === 'alignment' ||
		value === 'readings' ||
		value === 'stemma' ||
		value === 'regularization'
		? value
		: 'setup';
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

function normalizeWitnesses(witnesses: WitnessConfig[]): CollationWitnessNode[] {
	return witnesses.map((witness) => ({
		type: 'witness',
		id: witness.witnessId,
		siglum: witness.siglum,
		transcriptionId: witness.transcriptionId,
		kind: witness.kind,
		handId: witness.handId,
		sourceVersion: witness.sourceVersion,
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
						.filter((token): token is WitnessSourceToken => Boolean(token) && typeof token === 'object')
						.map<WitnessSourceToken>((token) => {
							const candidate = token as unknown as Record<string, unknown>;
							const kind: WitnessSourceToken['kind'] =
								candidate.kind === 'gap' || candidate.kind === 'untranscribed'
									? candidate.kind
									: 'text';
							const gap: WitnessSourceToken['gap'] =
								candidate.gap && typeof candidate.gap === 'object'
									? (() => {
											const rawGap = candidate.gap as Record<string, unknown>;
											const source: NonNullable<WitnessSourceToken['gap']>['source'] =
												rawGap.source === 'supplied'
													? 'supplied'
													: rawGap.source === 'untranscribed'
														? 'untranscribed'
														: 'gap';
											return {
												source,
												reason: typeof rawGap.reason === 'string' ? rawGap.reason : '',
												unit: typeof rawGap.unit === 'string' ? rawGap.unit : '',
												extent: typeof rawGap.extent === 'string' ? rawGap.extent : '',
											};
										})()
									: null;
							return {
								kind,
								original: typeof candidate.original === 'string' ? candidate.original : '',
								segments: Array.isArray(candidate.segments)
									? candidate.segments
											.filter((segment): segment is NonNullable<WitnessSourceToken['segments'][number]> =>
												Boolean(segment) && typeof segment === 'object',
											)
											.map((segment) => {
												const rawSegment = segment as unknown as Record<string, unknown>;
												return {
													text: typeof rawSegment.text === 'string' ? rawSegment.text : '',
													hasUnclear: rawSegment.hasUnclear === true,
													isPunctuation: rawSegment.isPunctuation === true,
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
			content: typeof raw.content === 'string' ? raw.content : '',
			tokens: sourceTokens,
			fullContent: typeof raw.fullContent === 'string' ? raw.fullContent : undefined,
			fullTokens: fullSourceTokens,
			fragmentaryContent:
				typeof raw.fragmentaryContent === 'string' ? raw.fragmentaryContent : undefined,
			fragmentaryTokens: fragmentarySourceTokens,
			treatment:
				raw.treatment === 'full' || raw.treatment === 'fragmentary' ? raw.treatment : 'inherit',
			isBaseText: raw.isBaseText === true,
			isExcluded: raw.isExcluded === true,
			overridesDefault: raw.overridesDefault === true,
		});
	}
	return parsed;
}

function buildVariationUnitId(columnId: string | null, unitIndex: number): string {
	return columnId ? `unit:${columnId}` : `unit:index:${unitIndex}`;
}

function buildApparatus(
	classifiedReadings: Map<string, ClassifiedReading[]>,
	alignmentColumns: AlignmentColumn[],
): CollationApparatusNode | null {
	if (classifiedReadings.size === 0) return null;
	const units = [...classifiedReadings.entries()]
		.map(([key, readings]) => {
			const unitIndex = Number.parseInt(key, 10);
			const columnId = Number.isFinite(unitIndex) ? alignmentColumns[unitIndex]?.id ?? null : null;
			return {
				type: 'variationUnit' as const,
				id: buildVariationUnitId(columnId, Number.isFinite(unitIndex) ? unitIndex : 0),
				unitIndex: Number.isFinite(unitIndex) ? unitIndex : 0,
				columnId,
				readings,
			};
		})
		.sort((a, b) => a.unitIndex - b.unitIndex);
	return { type: 'apparatus', units };
}

function buildStemma(
	stemmaEdges: Map<string, StemmaEdge[]>,
	alignmentColumns: AlignmentColumn[],
): CollationStemmaNode | null {
	if (stemmaEdges.size === 0) return null;
	const units = [...stemmaEdges.entries()]
		.map(([key, edges]) => {
			const unitIndex = Number.parseInt(key, 10);
			const columnId = Number.isFinite(unitIndex) ? alignmentColumns[unitIndex]?.id ?? null : null;
			return {
				type: 'stemmaUnit' as const,
				id: buildVariationUnitId(columnId, Number.isFinite(unitIndex) ? unitIndex : 0),
				unitIndex: Number.isFinite(unitIndex) ? unitIndex : 0,
				columnId,
				edges,
			};
		})
		.sort((a, b) => a.unitIndex - b.unitIndex);
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
			selectedVerse: seed.selectedVerse,
			selectedBook: seed.selectedBook,
			selectedChapter: seed.selectedChapter,
			selectedVerseNum: seed.selectedVerseNum,
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
		apparatus: buildApparatus(seed.classifiedReadings, seed.alignmentColumns),
		stemma: buildStemma(seed.stemmaEdges, seed.alignmentColumns),
	};
}

export function hydrateCollationDocument(document: CollationDocument): HydratedCollationDocument {
	return {
		collationId: document.meta.collationId ?? null,
		projectId: document.meta.projectId ?? null,
		projectName: document.meta.projectName ?? null,
		phase: normalizePhase(document.flow?.phase),
		furthestPhase: normalizePhase(document.flow?.furthestPhase),
		selectedVerse: document.setup?.selectedVerse ?? null,
		selectedBook: document.setup?.selectedBook ?? '',
		selectedChapter: document.setup?.selectedChapter ?? '',
		selectedVerseNum: document.setup?.selectedVerseNum ?? '',
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
				? document.alignment.witnessOrder.filter((id): id is string => typeof id === 'string')
				: [],
		classifiedReadings:
			document.apparatus?.units
				?.filter((unit) => Number.isFinite(unit.unitIndex) && Array.isArray(unit.readings))
				.map((unit) => [String(unit.unitIndex), unit.readings] as [string, ClassifiedReading[]]) ?? [],
		stemmaEdges:
			document.stemma?.units
				?.filter((unit) => Number.isFinite(unit.unitIndex) && Array.isArray(unit.edges))
				.map((unit) => [String(unit.unitIndex), unit.edges] as [string, StemmaEdge[]]) ?? [],
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
	if (candidate.type !== 'collationDocument' || candidate.version !== 1) return null;
	return candidate as unknown as CollationDocument;
}

export function serializeCollationDocument(document: CollationDocument): string {
	return JSON.stringify(document);
}
