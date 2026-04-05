import {
	AlignmentTable,
	collate,
	type AlignmentTableRow,
	type TokenData,
} from 'collatex-tsport';
import type { AlignmentSnapshot, SerializedAlignmentColumn } from './alignment-snapshot';
import type {
	CollationRunPayload,
	CollationRunResult,
	CollationTokenInput,
	CollationWitnessInput,
} from './collation-worker-types';
import type {
	AlignmentCellKind,
	GapMetadata,
	RegularizationType,
	WitnessTextSegment,
} from './collation-types';
import { joinTokenTexts } from './token-text';

type TableCell = AlignmentTableRow['cells'][number];
type TableToken = NonNullable<TableCell>[number];

function getTokenIsPunctuation(token: TableToken): boolean | undefined {
	return typeof token.tokenData?.isPunctuation === 'boolean'
		? token.tokenData.isPunctuation
		: undefined;
}

function getTokenOriginalSegments(token: TableToken): WitnessTextSegment[] | undefined {
	const segments = token.tokenData?.originalSegments;
	if (!Array.isArray(segments)) return undefined;
	return segments.flatMap((segment) => {
		if (
			typeof segment?.text === 'string' &&
			typeof segment?.hasUnclear === 'boolean' &&
			typeof segment?.isPunctuation === 'boolean' &&
			typeof segment?.isSupplied === 'boolean'
		) {
			return [{ ...segment }];
		}
		return [];
	});
}

function makeId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `alignment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toPretokenizedTokens(tokens: CollationTokenInput[]): TokenData[] {
	return tokens.map((token) => ({ ...token }));
}

function normalizeCellText(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function toCellText(cell: TableCell): string | null {
	if (!cell || cell.length === 0) return null;
	const text = normalizeCellText(
		joinTokenTexts(
			cell.map((token: TableToken) => ({
				text: typeof token.tokenData?.t === 'string' ? token.tokenData.t : token.content,
				isPunctuation: getTokenIsPunctuation(token),
				originalSegments: getTokenOriginalSegments(token),
			})),
		),
	);
	return text.length > 0 ? text : null;
}

function toCellRegularizedText(cell: TableCell): string | null {
	if (!cell || cell.length === 0) return null;
	const text = normalizeCellText(
		joinTokenTexts(
			cell.map((token: TableToken) => {
				const displayRegularized = token.tokenData?.displayRegularized;
				if (typeof displayRegularized === 'string') {
					return {
						text: displayRegularized,
						isPunctuation: getTokenIsPunctuation(token),
						originalSegments: getTokenOriginalSegments(token),
					};
				}
				if (displayRegularized === null) return { text: '' };
				const normalized = token.tokenData?.n;
				return {
					text: typeof normalized === 'string' ? normalized : token.normalized,
					isPunctuation: getTokenIsPunctuation(token),
					originalSegments: getTokenOriginalSegments(token),
				};
			}),
		),
	);
	return text.length > 0 ? text : null;
}

function toCellAlignmentValue(cell: TableCell): string | null {
	if (!cell || cell.length === 0) return null;
	const text = normalizeCellText(
		joinTokenTexts(
			cell.map((token: TableToken) => ({
				text: typeof token.tokenData?.n === 'string' ? token.tokenData.n : token.normalized,
				isPunctuation: getTokenIsPunctuation(token),
				originalSegments: getTokenOriginalSegments(token),
			})),
		),
	);
	return text.length > 0 ? text : null;
}

function toCellRuleIds(cell: TableCell): string[] {
	if (!cell || cell.length === 0) return [];
	const ids = new Set<string>();
	for (const token of cell) {
		const ruleIds = token.tokenData?.ruleIds;
		if (!Array.isArray(ruleIds)) continue;
		for (const ruleId of ruleIds) {
			if (typeof ruleId === 'string' && ruleId.length > 0) ids.add(ruleId);
		}
	}
	return [...ids];
}

function toCellRegularizationTypes(cell: TableCell): RegularizationType[] {
	if (!cell || cell.length === 0) return [];
	const types = new Set<RegularizationType>();
	for (const token of cell) {
		const tokenTypes = token.tokenData?.regularizationTypes;
		if (!Array.isArray(tokenTypes)) continue;
		for (const type of tokenTypes) {
			if (type === 'none' || type === 'ns') types.add(type);
		}
	}
	return [...types];
}

function toCellSourceTokenIds(cell: TableCell): string[] {
	if (!cell || cell.length === 0) return [];
	const ids = new Set<string>();
	for (const token of cell) {
		const tokenIds = token.tokenData?.sourceTokenIds;
		if (!Array.isArray(tokenIds)) continue;
		for (const tokenId of tokenIds) {
			if (typeof tokenId === 'string' && tokenId.length > 0) ids.add(tokenId);
		}
	}
	return [...ids];
}

function toCellKind(cell: TableCell): AlignmentCellKind {
	if (!cell || cell.length === 0) return 'omission';
	const kinds = new Set<AlignmentCellKind>();
	for (const token of cell) {
		const tokenKind = token.tokenData?.kind;
		if (tokenKind === 'gap' || tokenKind === 'untranscribed' || tokenKind === 'text') {
			kinds.add(tokenKind);
		}
	}
	if (kinds.size === 0 || kinds.has('text')) return 'text';
	if (kinds.has('gap')) return 'gap';
	if (kinds.has('untranscribed')) return 'untranscribed';
	return 'text';
}

function toCellGap(cell: TableCell): GapMetadata | null {
	if (!cell || cell.length === 0) return null;
	for (const token of cell) {
		const gap = token.tokenData?.gap as GapMetadata | undefined;
		if (gap) return gap;
	}
	return null;
}

function toCellOriginalSegments(cell: TableCell): WitnessTextSegment[] | undefined {
	if (!cell || cell.length === 0) return undefined;
	const segments: WitnessTextSegment[] = [];
	for (const token of cell) {
		const tokenSegments = token.tokenData?.originalSegments;
		if (!Array.isArray(tokenSegments)) continue;
		for (const segment of tokenSegments) {
			if (
				typeof segment?.text === 'string' &&
				typeof segment?.hasUnclear === 'boolean' &&
				typeof segment?.isPunctuation === 'boolean' &&
				typeof segment?.isSupplied === 'boolean'
			) {
				segments.push({ ...segment });
			}
		}
	}
	return segments.length > 0 ? segments : undefined;
}

function toPackageWitness(witness: CollationWitnessInput) {
	if (Array.isArray(witness.tokens) && witness.tokens.length > 0) {
		return {
			id: witness.id,
			tokens: toPretokenizedTokens(witness.tokens),
		};
	}

	return {
		id: witness.id,
		content: witness.content,
	};
}

function buildSnapshot(
	table: AlignmentTable,
	witnesses: CollationWitnessInput[],
): AlignmentSnapshot {
	const rowByWitnessId = new Map(
		table.rows.map((row: AlignmentTableRow) => [row.witness.sigil, row] as const),
	);
	const orderedWitnessIds = witnesses.map((witness) => witness.id);
	const orderedRows = orderedWitnessIds.map((witnessId) => rowByWitnessId.get(witnessId) ?? null);
	const columnCount = Math.max(...orderedRows.map((row) => row?.cells.length ?? 0), 0);
	const columns: SerializedAlignmentColumn[] = [];

	for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
		columns.push({
			id: makeId(),
			index: columnIndex,
			cells: orderedWitnessIds.map((witnessId, rowIndex) => {
				const cell = orderedRows[rowIndex]?.cells[columnIndex] ?? null;
				const text = toCellText(cell);
				const kind = toCellKind(cell);
				const regularizedText = toCellRegularizedText(cell);
				const alignmentValue = toCellAlignmentValue(cell);
				const sourceTokenIds = toCellSourceTokenIds(cell);
				const gap = toCellGap(cell);
				const originalSegments = toCellOriginalSegments(cell);
				const ruleIds = toCellRuleIds(cell);
				const regularizationTypes = toCellRegularizationTypes(cell);
				return [
					witnessId,
					{
						text,
						alignmentValue,
						regularizedText,
						sourceTokenIds,
						kind,
						gap,
						isOmission: kind === 'omission',
						isLacuna: kind === 'gap' || kind === 'untranscribed',
						isRegularized:
							kind === 'text' &&
							text !== null &&
							regularizedText !== null &&
							text !== regularizedText,
						originalSegments,
						ruleIds,
						regularizationTypes,
					},
				];
			}),
			merged: false,
		});
	}

	return {
		witnessOrder: orderedWitnessIds,
		columns,
	};
}

export function collateToAlignmentSnapshot(payload: CollationRunPayload): CollationRunResult {
	if (payload.witnesses.length < 2) {
		throw new Error('At least two witnesses are required for collation.');
	}
	const segmentation = payload.options?.segmentation ?? true;

	const table = collate(
		{
			witnesses: payload.witnesses.map(toPackageWitness),
		},
		{
			output: 'table',
			segmentation,
		},
	) as AlignmentTable;

	return {
		snapshot: buildSnapshot(table, payload.witnesses),
	};
}
