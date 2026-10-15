import type { AlignmentCell } from './alignment-snapshot';
import type { CollationTokenInput } from './collation-worker-types';
import type {
	AlignmentCellKind,
	GapMetadata,
	RegularizationType,
	WitnessTextSegment,
} from './collation-types';
import { joinTokenTexts } from './token-text';

function getTokenIsPunctuation(token: CollationTokenInput): boolean | undefined {
	return typeof token.isPunctuation === 'boolean' ? token.isPunctuation : undefined;
}

function getTokenOriginalSegments(token: CollationTokenInput): WitnessTextSegment[] | undefined {
	const segments = token.originalSegments;
	if (!Array.isArray(segments)) return undefined;
	return segments.flatMap(segment => {
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

function normalizeCellText(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function toCellText(cell: CollationTokenInput[]): string | null {
	if (!cell || cell.length === 0) return null;
	const text = normalizeCellText(
		joinTokenTexts(
			cell.map((token: CollationTokenInput) => ({
				text: token.t,
				isPunctuation: getTokenIsPunctuation(token),
				originalSegments: getTokenOriginalSegments(token),
			}))
		)
	);
	return text.length > 0 ? text : null;
}

function toCellRegularizedText(cell: CollationTokenInput[]): string | null {
	if (!cell || cell.length === 0) return null;
	const text = normalizeCellText(
		joinTokenTexts(
			cell.map((token: CollationTokenInput) => {
				const displayRegularized = token.displayRegularized;
				if (typeof displayRegularized === 'string') {
					return {
						text: displayRegularized,
						isPunctuation: getTokenIsPunctuation(token),
						originalSegments: getTokenOriginalSegments(token),
					};
				}
				if (displayRegularized === null) return { text: '' };
				return {
					text: token.n,
					isPunctuation: getTokenIsPunctuation(token),
					originalSegments: getTokenOriginalSegments(token),
				};
			})
		)
	);
	return text.length > 0 ? text : null;
}

function toCellAlignmentValue(cell: CollationTokenInput[]): string | null {
	if (!cell || cell.length === 0) return null;
	const text = normalizeCellText(
		joinTokenTexts(
			cell.map((token: CollationTokenInput) => ({
				text: token.n,
				isPunctuation: getTokenIsPunctuation(token),
				originalSegments: getTokenOriginalSegments(token),
			}))
		)
	);
	return text.length > 0 ? text : null;
}

function toCellRuleIds(cell: CollationTokenInput[]): string[] {
	if (!cell || cell.length === 0) return [];
	const ids = new Set<string>();
	for (const token of cell) {
		const ruleIds = token.ruleIds;
		if (!Array.isArray(ruleIds)) continue;
		for (const ruleId of ruleIds) {
			if (typeof ruleId === 'string' && ruleId.length > 0) ids.add(ruleId);
		}
	}
	return [...ids];
}

function toCellRegularizationTypes(cell: CollationTokenInput[]): RegularizationType[] {
	if (!cell || cell.length === 0) return [];
	const types = new Set<RegularizationType>();
	for (const token of cell) {
		const tokenTypes = token.regularizationTypes;
		if (!Array.isArray(tokenTypes)) continue;
		for (const type of tokenTypes) {
			if (type === 'none' || type === 'ns') types.add(type);
		}
	}
	return [...types];
}

function toCellSourceTokenIds(cell: CollationTokenInput[]): string[] {
	if (!cell || cell.length === 0) return [];
	const ids = new Set<string>();
	for (const token of cell) {
		const tokenIds = token.sourceTokenIds;
		if (!Array.isArray(tokenIds)) continue;
		for (const tokenId of tokenIds) {
			if (typeof tokenId === 'string' && tokenId.length > 0) ids.add(tokenId);
		}
	}
	return [...ids];
}

function toCellKind(cell: CollationTokenInput[]): AlignmentCellKind {
	if (!cell || cell.length === 0) return 'omission';
	const kinds = new Set<AlignmentCellKind>();
	for (const token of cell) {
		const tokenKind = token.kind;
		if (tokenKind === 'gap' || tokenKind === 'untranscribed' || tokenKind === 'text') {
			kinds.add(tokenKind);
		}
	}
	if (kinds.size === 0 || kinds.has('text')) return 'text';
	if (kinds.has('gap')) return 'gap';
	if (kinds.has('untranscribed')) return 'untranscribed';
	return 'text';
}

function toCellGap(cell: CollationTokenInput[]): GapMetadata | null {
	if (!cell || cell.length === 0) return null;
	for (const token of cell) {
		const gap = token.gap as GapMetadata | undefined;
		if (gap) return gap;
	}
	return null;
}

function toCellOriginalSegments(cell: CollationTokenInput[]): WitnessTextSegment[] | undefined {
	if (!cell || cell.length === 0) return undefined;
	const segments: WitnessTextSegment[] = [];
	for (const token of cell) {
		const tokenSegments = token.originalSegments;
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

export function alignmentCellFromTokens(cell: CollationTokenInput[]): AlignmentCell {
	const text = toCellText(cell);
	const kind = toCellKind(cell);
	const regularizedText = toCellRegularizedText(cell);
	const alignmentValue = toCellAlignmentValue(cell);
	const sourceTokenIds = toCellSourceTokenIds(cell);
	const gap = toCellGap(cell);
	const originalSegments = toCellOriginalSegments(cell);
	const ruleIds = toCellRuleIds(cell);
	const regularizationTypes = toCellRegularizationTypes(cell);
	return {
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
	};
}
