import type {
	AlignmentCellKind,
	GapMetadata,
	RegularizationType,
	WitnessTextSegment,
} from './collation-types';
import type { CollationTokenInput, CollationWitnessInput } from './collation-worker-types';
import { isPunctuationToken, joinTokenTexts } from './token-text';

export interface AlignmentCell {
	text: string | null;
	regularizedText: string | null;
	alignmentValue: string | null;
	sourceTokenIds: string[];
	kind: AlignmentCellKind;
	gap: GapMetadata | null;
	isOmission: boolean;
	isLacuna: boolean;
	isRegularized: boolean;
	ruleIds: string[];
	regularizationTypes: RegularizationType[];
	originalSegments?: WitnessTextSegment[];
}

export interface AlignmentColumn {
	id: string;
	index: number;
	cells: Map<string, AlignmentCell>;
	merged: boolean;
	mergedWith?: string[];
	splitInto?: AlignmentColumn[];
}

export interface SerializedAlignmentColumn {
	id: string;
	index: number;
	cells: Array<[string, AlignmentCell]>;
	merged: boolean;
	mergedWith?: string[];
	splitInto?: SerializedAlignmentColumn[];
}

export interface AlignmentSnapshot {
	witnessOrder: string[];
	columns: SerializedAlignmentColumn[];
}

export function serializeAlignmentColumns(columns: AlignmentColumn[]): SerializedAlignmentColumn[] {
	const serializeColumn = (column: AlignmentColumn): SerializedAlignmentColumn => ({
		id: column.id,
		index: column.index,
		cells: [...column.cells.entries()],
		merged: column.merged,
		mergedWith: column.mergedWith,
		splitInto: column.splitInto?.map(serializeColumn),
	});

	return columns.map(serializeColumn);
}

export function deserializeAlignmentColumns(
	columns: SerializedAlignmentColumn[]
): AlignmentColumn[] {
	const deserializeColumn = (column: SerializedAlignmentColumn): AlignmentColumn => ({
		id: column.id,
		index: column.index,
		cells: new Map(
			column.cells.map(([witnessId, cell]) => [
				witnessId,
				{
					text: cell.text ?? null,
					regularizedText: cell.regularizedText ?? cell.text ?? null,
					alignmentValue:
						cell.alignmentValue ?? cell.regularizedText ?? cell.text ?? null,
					sourceTokenIds: cell.sourceTokenIds ?? [],
					// Kind recovers from gap source when unstamped.
					kind:
						cell.kind ??
						(cell.isOmission
							? 'omission'
							: cell.isLacuna
								? cell.gap?.source === 'untranscribed'
									? 'untranscribed'
									: 'gap'
								: 'text'),
					gap: cell.gap ?? null,
					isOmission: cell.isOmission,
					isLacuna: cell.isLacuna,
					isRegularized:
						cell.isRegularized ??
						(cell.text ?? null) !== (cell.regularizedText ?? cell.text ?? null),
					ruleIds: cell.ruleIds ?? [],
					regularizationTypes: cell.regularizationTypes ?? [],
					originalSegments: Array.isArray(cell.originalSegments)
						? cell.originalSegments
								.filter(
									(segment): segment is WitnessTextSegment =>
										typeof segment?.text === 'string' &&
										typeof segment?.hasUnclear === 'boolean' &&
										typeof segment?.isPunctuation === 'boolean' &&
										typeof segment?.isSupplied === 'boolean'
								)
								.map(segment => ({ ...segment }))
						: undefined,
				},
			])
		),
		merged: column.merged,
		mergedWith: column.mergedWith,
		splitInto: column.splitInto?.map(deserializeColumn),
	});

	return columns.map(deserializeColumn);
}

export function cloneAlignmentColumn(column: AlignmentColumn): AlignmentColumn {
	return {
		id: column.id,
		index: column.index,
		cells: new Map(column.cells),
		merged: column.merged,
		mergedWith: column.mergedWith ? [...column.mergedWith] : undefined,
		splitInto: column.splitInto?.map(cloneAlignmentColumn),
	};
}

function tokenToJoinablePart(token: CollationTokenInput) {
	return {
		text: token.t,
		isPunctuation: token.isPunctuation,
		originalSegments: token.originalSegments,
	};
}

function mergeIgnoredPunctuationIntoPreviousToken(
	tokens: CollationTokenInput[],
	ignorePunctuation: boolean
): CollationTokenInput[] {
	if (!ignorePunctuation) return tokens.map(token => ({ ...token }));

	const prepared: CollationTokenInput[] = [];
	for (const token of tokens) {
		const cloned: CollationTokenInput = {
			...token,
			sourceTokenIds: token.sourceTokenIds ? [...token.sourceTokenIds] : undefined,
			originalSegments: token.originalSegments?.map(segment => ({ ...segment })),
			gap: token.gap ? { ...token.gap } : token.gap,
			ruleIds: token.ruleIds ? [...token.ruleIds] : undefined,
			regularizationTypes: token.regularizationTypes
				? [...token.regularizationTypes]
				: undefined,
		};
		if (!isPunctuationToken(tokenToJoinablePart(cloned))) {
			prepared.push(cloned);
			continue;
		}
		const previous = prepared[prepared.length - 1];
		if (!previous || previous.kind !== 'text') continue;
		previous.t = joinTokenTexts([{ text: previous.t }, tokenToJoinablePart(cloned)]);
		previous.sourceTokenIds = [
			...(previous.sourceTokenIds ?? []),
			...(cloned.sourceTokenIds ?? []),
		];
		previous.originalSegments = [
			...(previous.originalSegments ?? []),
			...(cloned.originalSegments ?? []),
		];
	}
	return prepared;
}

export function witnessInputFromAlignment(
	columns: AlignmentColumn[],
	witnessId: string,
	ignorePunctuation: boolean
): CollationWitnessInput {
	const tokens = columns
		.map(col => col.cells.get(witnessId))
		.filter((cell): cell is AlignmentCell => Boolean(cell) && !cell!.isOmission)
		.map(cell => ({
			t: cell.text ?? '',
			n: cell.alignmentValue ?? '',
			sourceTokenIds: cell.sourceTokenIds,
			kind: cell.kind === 'omission' ? ('text' as const) : cell.kind,
			displayRegularized: cell.regularizedText,
			originalSegments: cell.originalSegments?.map(segment => ({ ...segment })),
			gap: cell.gap,
			ruleIds: cell.ruleIds,
			regularizationTypes: cell.regularizationTypes,
		}));
	const preparedTokens = mergeIgnoredPunctuationIntoPreviousToken(tokens, ignorePunctuation);
	return {
		id: witnessId,
		content: joinTokenTexts(preparedTokens.map(token => tokenToJoinablePart(token))),
		tokens: preparedTokens,
	};
}
