import type { WitnessTextSegment } from './collation-types';

const PUNCTUATION_ONLY_PATTERN = /^[.?!,;:]+$/u;
const TOKEN_PATTERN = /[.?!,;:]+|[^.?!,;:\s]+/gu;

function normalizePiece(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

export function isPunctuationOnlyText(text: string): boolean {
	const normalized = normalizePiece(text);
	return normalized.length > 0 && PUNCTUATION_ONLY_PATTERN.test(normalized);
}

export function arePunctuationOnlySegments(segments: WitnessTextSegment[] | undefined): boolean {
	return Array.isArray(segments) && segments.length > 0 && segments.every((segment) => segment.isPunctuation);
}

export function isPunctuationToken(options: {
	text: string;
	isPunctuation?: boolean;
	originalSegments?: WitnessTextSegment[];
}): boolean {
	if (options.isPunctuation === true) return true;
	if (arePunctuationOnlySegments(options.originalSegments)) return true;
	return isPunctuationOnlyText(options.text);
}

export function joinTokenTexts(
	parts: Array<{
		text: string | null | undefined;
		isPunctuation?: boolean;
		originalSegments?: WitnessTextSegment[];
	}>,
): string {
	let result = '';
	for (const part of parts) {
		if (typeof part.text !== 'string') continue;
		const normalized = normalizePiece(part.text);
		if (normalized.length === 0) continue;
		if (result.length === 0) {
			result = normalized;
			continue;
		}
		if (
			isPunctuationToken({
				text: normalized,
				isPunctuation: part.isPunctuation,
				originalSegments: part.originalSegments,
			})
		) {
			result += normalized;
			continue;
		}
		result += ` ${normalized}`;
	}
	return result;
}

export function tokenizeDisplayText(text: string): string[] {
	return text.match(TOKEN_PATTERN) ?? [];
}
