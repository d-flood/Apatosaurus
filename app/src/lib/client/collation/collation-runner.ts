import { ensureDjazzkitRuntime } from '$lib/client/djazzkit-runtime';
import {
	coerceTranscriptionDocument,
	type StoredTranscriptionDocument,
} from '$lib/client/transcription/content';
import type { CorrectionReading, InlineItem } from '@apatopwa/tei-transcription';
import {
	getPreferredTranscriptionLabel,
} from '$lib/client/transcription/display';
import { Transcription, type TranscriptionRow } from '$generated/models/Transcription';
import {
	getVerseIndexRowsForVerse,
	normalizeVerseIdentifier,
} from '$lib/client/transcription/verse-index';
import type {
	GapMetadata,
	WitnessKind,
	WitnessSourceToken,
	WitnessTextSegment,
} from './collation-types';
import { joinTokenTexts } from './token-text';

interface MilestoneState {
	book: string;
	chapter: string;
	verse: string;
}

export interface PreparedWitness {
	id: string;
	siglum: string;
	kind: WitnessKind;
	handId: string;
	content: string;
	tokens: WitnessSourceToken[];
	fullContent?: string;
	fullTokens?: WitnessSourceToken[];
	fragmentaryContent?: string;
	fragmentaryTokens?: WitnessSourceToken[];
	transcriptionUid: string;
	sourceVersion: string;
}

interface WitnessExtractionOptions {
	ignoreWordBreaks?: boolean;
}

interface WitnessExtractionTarget {
	kind: WitnessKind;
	baseHand: string;
	handId: string;
	treatment: 'full' | 'fragmentary';
}

type ProcessableItem =
	| StoredTranscriptionDocument['pages'][number]['columns'][number]['lines'][number]['items'][number]
	| InlineItem;

function currentVerseIdentifier(state: MilestoneState): string {
	if (!state.book && !state.chapter && !state.verse) return '';
	return normalizeVerseIdentifier({
		book: state.book,
		chapter: state.chapter,
		verse: state.verse,
	});
}

function hasMark(item: { marks?: Array<{ type?: string }> }, markType: string): boolean {
	return Array.isArray(item.marks) && item.marks.some((mark) => mark?.type === markType);
}

function buildTextSegment(item: {
	text?: string;
	marks?: Array<{ type?: string }>;
}): WitnessTextSegment | null {
	if (typeof item.text !== 'string' || item.text.length === 0) return null;
	return {
		text: item.text,
		hasUnclear: hasMark(item, 'unclear'),
		isPunctuation: hasMark(item, 'punctuation'),
		isSupplied: hasMark(item, 'supplied'),
	};
}

function buildGapMetadata(
	source: GapMetadata['source'],
	attrs: Record<string, unknown> | undefined,
): GapMetadata {
	return {
		source,
		reason: typeof attrs?.reason === 'string' ? attrs.reason : '',
		unit: typeof attrs?.unit === 'string' ? attrs.unit : '',
		extent: typeof attrs?.extent === 'string' ? attrs.extent : '',
	};
}

function isNoBreakItem(item: { type?: string; attrs?: Record<string, unknown> } | undefined): boolean {
	return (
		(item?.type === 'lineBreak' ||
			item?.type === 'columnBreak' ||
			item?.type === 'pageBreak') &&
		item.attrs?.break === 'no'
	);
}

function breakMarkerForItemType(type: string | undefined): '\\n' | '\\c' | '\\p' | null {
	if (type === 'lineBreak' || type === 'line') return '\\n';
	if (type === 'columnBreak' || type === 'column') return '\\c';
	if (type === 'pageBreak' || type === 'page') return '\\p';
	return null;
}

function breakMarkerPriority(marker: '\\n' | '\\c' | '\\p' | null): number {
	if (marker === '\\p') return 3;
	if (marker === '\\c') return 2;
	if (marker === '\\n') return 1;
	return 0;
}

function buildWitnessContent(tokens: WitnessSourceToken[]): string {
	return joinTokenTexts(
		tokens.map((token) => ({
			text: token.original,
			originalSegments: token.segments,
		})),
	);
}

function normalizeHandRef(value: string | null | undefined): string {
	return (value || '').trim().replace(/^#/, '');
}

function inferBaseHand(document: StoredTranscriptionDocument): string {
	const witnessIds = Array.isArray(document.header?.witnessIds)
		? document.header.witnessIds.map((value) => value.trim()).filter(Boolean)
		: [];
	const handIds = Array.isArray(document.header?.msDescription?.hands)
		? document.header.msDescription.hands
				.map((hand) => {
					const id = hand?.attrs?.['xml:id'] || hand?.attrs?.n || '';
					return id.trim();
				})
				.filter(Boolean)
		: [];
	const preferredWitness =
		witnessIds.find((id) => /firsthand/i.test(id)) ||
		witnessIds.find((id) => /base|main/i.test(id)) ||
		witnessIds.find((id) => !/correct/i.test(id));
	if (preferredWitness) return normalizeHandRef(preferredWitness);
	const preferredHand =
		handIds.find((id) => /firsthand/i.test(id)) ||
		handIds.find((id) => /first hand/i.test(id)) ||
		handIds.find((id) => !/correct/i.test(id));
	return normalizeHandRef(preferredHand || 'firsthand') || 'firsthand';
}

function getCorrectionForHand(
	item: { marks?: unknown[] },
	handId: string,
): CorrectionReading | null {
	for (const mark of item.marks || []) {
		if (!mark || typeof mark !== 'object') continue;
		const rawMark = mark as { type?: string; attrs?: { corrections?: CorrectionReading[] } };
		if (rawMark.type !== 'correction') continue;
		for (const correction of rawMark.attrs?.corrections || []) {
			if (normalizeHandRef(correction.hand) === handId) {
				return correction;
			}
		}
	}
	return null;
}

function getCorrectionOnlyForHand(corrections: CorrectionReading[], handId: string): CorrectionReading | null {
	for (const correction of corrections) {
		if (normalizeHandRef(correction.hand) === handId) {
			return correction;
		}
	}
	return null;
}

function countPlaceholderTokens(text: string): number {
	return text
		.split(/(\s+)/)
		.filter((piece) => piece.length > 0 && !/^\s+$/u.test(piece)).length;
}

function buildInheritedPlaceholderTokens(text: string): WitnessSourceToken[] {
	return Array.from({ length: countPlaceholderTokens(text) }, () => ({
		kind: 'untranscribed' as const,
		original: '⊘',
		segments: [],
		gap: {
			source: 'untranscribed' as const,
			reason: 'inherited',
			unit: 'token',
			extent: '1',
		},
	}));
}

function cloneSourceToken(token: WitnessSourceToken): WitnessSourceToken {
	return {
		...token,
		segments: token.segments.map((segment) => ({ ...segment })),
		gap: token.gap ? { ...token.gap } : null,
	};
}

function cloneSourceTokens(tokens: WitnessSourceToken[]): WitnessSourceToken[] {
	return tokens.map(cloneSourceToken);
}

function formatWitnessSiglum(baseSiglum: string, handId: string, kind: WitnessKind): string {
	return kind === 'corrector' ? `${baseSiglum} ${handId}` : baseSiglum;
}

export function extractWitnessTokensForVerse(
	document: StoredTranscriptionDocument,
	targetVerseIdentifier: string,
	options: WitnessExtractionOptions = {},
	target?: WitnessExtractionTarget,
): WitnessSourceToken[] {
	const tokens: WitnessSourceToken[] = [];
	let pendingSegments: WitnessTextSegment[] = [];
	let pendingContinuationMarker: '\\n' | '\\c' | '\\p' | null = null;
	let awaitingNoBreakContinuation = false;
	const state: MilestoneState = { book: '', chapter: '', verse: '' };
	const baseHand = target?.baseHand || inferBaseHand(document);
	let currentHand = baseHand;

	function flushPendingTokenSegments(segments: WitnessTextSegment[]) {
		if (segments.length === 0) return;
		const original = segments.map((segment) => segment.text).join('').trim();
		if (original.length === 0) return;
		tokens.push({
			kind: 'text',
			original,
			segments,
			gap: null,
		});
	}

	function flushPendingTextSegments(segments: WitnessTextSegment[]) {
		let pendingTokenSegments: WitnessTextSegment[] = [];
		let pendingTokenIsPunctuation: boolean | null = null;

		function flushCurrentToken() {
			if (pendingTokenSegments.length === 0) return;
			flushPendingTokenSegments(pendingTokenSegments);
			pendingTokenSegments = [];
			pendingTokenIsPunctuation = null;
		}

		for (const segment of segments) {
			const pieces = segment.text.split(/(\s+)/).filter((piece) => piece.length > 0);
			for (const piece of pieces) {
				if (/^\s+$/u.test(piece)) {
					flushCurrentToken();
					continue;
				}

				const pieceIsPunctuation = segment.isPunctuation;
				if (
					pendingTokenIsPunctuation !== null &&
					pendingTokenIsPunctuation !== pieceIsPunctuation
				) {
					flushCurrentToken();
				}

				pendingTokenSegments.push({
					text: piece,
					hasUnclear: segment.hasUnclear,
					isPunctuation: segment.isPunctuation,
					isSupplied: segment.isSupplied,
				});
				pendingTokenIsPunctuation = pieceIsPunctuation;
			}
		}

		flushCurrentToken();
	}

	function trimTrailingPendingWhitespace() {
		while (pendingSegments.length > 0) {
			const lastSegment = pendingSegments[pendingSegments.length - 1];
			const trimmedText = lastSegment.text.replace(/\s+$/g, '');
			if (trimmedText.length > 0) {
				lastSegment.text = trimmedText;
				return;
			}
			pendingSegments.pop();
		}
	}

	function markNoBreakContinuation(marker: '\\n' | '\\c' | '\\p' | null) {
		trimTrailingPendingWhitespace();
		if (breakMarkerPriority(marker) > breakMarkerPriority(pendingContinuationMarker)) {
			pendingContinuationMarker = marker;
		}
		awaitingNoBreakContinuation = true;
	}

	function clearPendingContinuation() {
		pendingContinuationMarker = null;
		awaitingNoBreakContinuation = false;
	}

	function insertPendingContinuationMarker() {
		if (!pendingContinuationMarker) return;
		if (options.ignoreWordBreaks) {
			pendingContinuationMarker = null;
			return;
		}
		if (pendingSegments.length > 0) {
			pendingSegments[pendingSegments.length - 1].text += pendingContinuationMarker;
		} else {
			pendingSegments.push({
				text: pendingContinuationMarker,
				hasUnclear: false,
				isPunctuation: false,
				isSupplied: false,
			});
		}
		pendingContinuationMarker = null;
	}

	function flushPendingSegments() {
		insertPendingContinuationMarker();
		if (pendingSegments.length === 0) return;
		flushPendingTextSegments(pendingSegments);
		pendingSegments = [];
		clearPendingContinuation();
	}

	function appendPlaceholderTokens(text: string) {
		flushPendingSegments();
		tokens.push(...buildInheritedPlaceholderTokens(text));
	}

	function shouldUseOriginalText(item: {
		text?: string;
		marks?: unknown[];
	}): boolean {
		if (!target) {
			return true;
		}
		const correction = getCorrectionForHand(item, target.handId);
		if (correction) {
			return false;
		}
		if (target.kind === 'firsthand') {
			return currentHand === baseHand;
		}
		if (currentHand === target.handId) {
			return true;
		}
		if (target.treatment === 'full' && currentHand === baseHand) {
			return true;
		}
		return false;
	}

	function processInlineItems(items: ProcessableItem[]) {
		for (const item of items) {
			if (item.type === 'text') {
				const correction = target ? getCorrectionForHand(item, target.handId) : null;
				if (correction) {
					const previousHand = currentHand;
					currentHand = target?.handId || previousHand;
					processInlineItems(correction.content);
					currentHand = previousHand;
					continue;
				}

				if (!shouldUseOriginalText(item)) {
					appendPlaceholderTokens(item.text || '');
					continue;
				}

				const segment = buildTextSegment(item);
				if (segment && awaitingNoBreakContinuation) {
					segment.text = segment.text.replace(/^\s+/g, '');
					if (segment.text.length > 0) {
						insertPendingContinuationMarker();
						awaitingNoBreakContinuation = false;
					}
				}
				if (segment) pendingSegments.push(segment);
				continue;
			}

			if (item.type === 'boundary') {
				flushPendingSegments();
				continue;
			}

			if (item.type === 'handShift') {
				currentHand = normalizeHandRef(item.attrs.new || item.attrs.hand || '') || baseHand;
				continue;
			}

			if (isNoBreakItem(item)) {
				markNoBreakContinuation(breakMarkerForItemType(item.type));
				continue;
			}

			const breakItemType = item.type;
			if (
				breakItemType === 'lineBreak' ||
				breakItemType === 'columnBreak' ||
				breakItemType === 'pageBreak'
			) {
				flushPendingSegments();
				continue;
			}

			if (item.type === 'gap') {
				flushPendingSegments();
				tokens.push({
					kind: 'gap',
					original: '⊘',
					segments: [],
					gap: buildGapMetadata('gap', item.attrs),
				});
				continue;
			}

			if (item.type === 'untranscribed') {
				flushPendingSegments();
				tokens.push({
					kind: 'untranscribed',
					original: '⊘',
					segments: [],
					gap: buildGapMetadata('untranscribed', item.attrs),
				});
				continue;
			}

			if (item.type === 'correctionOnly') {
				const correction = target ? getCorrectionOnlyForHand(item.corrections, target.handId) : null;
				if (!correction) {
					continue;
				}
				const previousHand = currentHand;
				currentHand = target?.handId || previousHand;
				processInlineItems(correction.content);
				currentHand = previousHand;
			}
		}
	}

	function flushAtStructuralBoundary(
		kind: 'page' | 'column' | 'line',
		isContinuation: boolean | undefined,
	) {
		if (isContinuation) {
			if (currentVerseIdentifier(state) === targetVerseIdentifier) {
				markNoBreakContinuation(breakMarkerForItemType(kind));
			}
			return;
		}
		if (currentVerseIdentifier(state) === targetVerseIdentifier) {
			flushPendingSegments();
		}
	}

	for (const page of document.pages) {
		flushAtStructuralBoundary('page', page.wrapped);
		for (const column of page.columns) {
			flushAtStructuralBoundary('column', column.wrapped);
			for (const line of column.lines) {
				flushAtStructuralBoundary('line', line.wrapped);
				currentHand = baseHand;
				for (const item of line.items) {
					if (item.type === 'milestone') {
						const previousVerseIdentifier = currentVerseIdentifier(state);
						if (item.kind === 'book') {
							state.book = item.attrs.book || state.book;
						}
						if (item.kind === 'chapter') {
							state.book = item.attrs.book || state.book;
							state.chapter = item.attrs.chapter || state.chapter;
						}
						if (item.kind === 'verse') {
							state.book = item.attrs.book || state.book;
							state.chapter = item.attrs.chapter || state.chapter;
							state.verse = item.attrs.verse || state.verse;
						}
					if (
						previousVerseIdentifier === targetVerseIdentifier &&
						currentVerseIdentifier(state) !== targetVerseIdentifier
					) {
						flushPendingSegments();
					}
					if (
						previousVerseIdentifier !== targetVerseIdentifier &&
						currentVerseIdentifier(state) === targetVerseIdentifier &&
						pendingSegments.length === 0
					) {
						clearPendingContinuation();
					}
					continue;
				}

					if (currentVerseIdentifier(state) !== targetVerseIdentifier) {
						continue;
					}
					processInlineItems([item as InlineItem]);
				}
			}
		}
	}

	flushPendingSegments();

	return tokens;
}

function collectCorrectionHandsForVerse(
	document: StoredTranscriptionDocument,
	targetVerseIdentifier: string,
	baseHand: string,
): string[] {
	const state: MilestoneState = { book: '', chapter: '', verse: '' };
	let currentHand = baseHand;
	const hands = new Set<string>();

	function addHand(hand: string | undefined) {
		const normalized = normalizeHandRef(hand);
		if (normalized && normalized !== baseHand) {
			hands.add(normalized);
		}
	}

	for (const page of document.pages) {
		for (const column of page.columns) {
			for (const line of column.lines) {
				currentHand = baseHand;
				for (const item of line.items) {
					if (item.type === 'milestone') {
						if (item.kind === 'book') {
							state.book = item.attrs.book || state.book;
						}
						if (item.kind === 'chapter') {
							state.book = item.attrs.book || state.book;
							state.chapter = item.attrs.chapter || state.chapter;
						}
						if (item.kind === 'verse') {
							state.book = item.attrs.book || state.book;
							state.chapter = item.attrs.chapter || state.chapter;
							state.verse = item.attrs.verse || state.verse;
						}
						continue;
					}
					if (currentVerseIdentifier(state) !== targetVerseIdentifier) {
						continue;
					}
					if (item.type === 'handShift') {
						currentHand = normalizeHandRef(item.attrs.new || item.attrs.hand || '') || baseHand;
						continue;
					}
					if (item.type === 'text') {
						if ((item.text || '').trim()) {
							addHand(currentHand);
						}
						for (const mark of item.marks || []) {
							if (mark?.type !== 'correction') continue;
							for (const correction of mark.attrs?.corrections || []) {
								addHand(correction.hand);
							}
						}
						continue;
					}
					if (item.type === 'correctionOnly') {
						for (const correction of item.corrections) {
							addHand(correction.hand);
						}
					}
				}
			}
		}
	}

	return [...hands].sort();
}

function buildWitnessId(base: string, seen: Map<string, number>): string {
	const normalized = base.trim() || 'witness';
	const count = (seen.get(normalized) ?? 0) + 1;
	seen.set(normalized, count);
	return count === 1 ? normalized : `${normalized}#${count}`;
}

export async function gatherWitnessesForVerse(
	verseIdentifier: string,
	transcriptionIds?: string[],
	options: WitnessExtractionOptions = {},
): Promise<PreparedWitness[]> {
	await ensureDjazzkitRuntime();
	const verseRows = await getVerseIndexRowsForVerse(verseIdentifier, transcriptionIds);
	const witnesses: PreparedWitness[] = [];
	const seenWitnessIds = new Map<string, number>();
	const orderedTranscriptionIds: string[] = [];
	const seenTranscriptions = new Set<string>();
	for (const verseRow of verseRows) {
		const transcriptionId = String(verseRow.transcription_id ?? '');
		if (!transcriptionId || seenTranscriptions.has(transcriptionId)) continue;
		seenTranscriptions.add(transcriptionId);
		orderedTranscriptionIds.push(transcriptionId);
	}
	if (orderedTranscriptionIds.length === 0) return witnesses;

	const transcriptions: TranscriptionRow[] = await Transcription.objects
		.filter((fields: any) => fields._djazzkit_id.inList(orderedTranscriptionIds))
		.filter((fields: any) => fields._djazzkit_deleted.eq(false))
		.all();
	const transcriptionById = new Map(
		transcriptions.map((transcription) => [String(transcription._djazzkit_id || ''), transcription] as const),
	);

	for (const transcriptionId of orderedTranscriptionIds) {
		const transcription = transcriptionById.get(transcriptionId);
		if (!transcription) continue;
		const document = coerceTranscriptionDocument(transcription.content_json);
		if (!document) continue;
		const baseHand = inferBaseHand(document);
		const witnessBase = getPreferredTranscriptionLabel({
			document,
				siglum: typeof transcription.siglum === 'string' ? transcription.siglum : null,
				fallbackId: String(transcription._djazzkit_id || transcriptionId),
			});
		const firsthandTokens = extractWitnessTokensForVerse(document, verseIdentifier, options, {
			kind: 'firsthand',
			baseHand,
			handId: baseHand,
			treatment: 'full',
		});
		const firsthandContent = buildWitnessContent(firsthandTokens);
		if (firsthandContent) {
			witnesses.push({
				id: buildWitnessId(witnessBase, seenWitnessIds),
				siglum: witnessBase,
				kind: 'firsthand',
				handId: baseHand,
				content: firsthandContent,
				tokens: cloneSourceTokens(firsthandTokens),
				fullContent: firsthandContent,
				fullTokens: cloneSourceTokens(firsthandTokens),
				transcriptionUid: String(transcription._djazzkit_id || transcriptionId),
				sourceVersion: String(
					transcription.updated_at || transcription._djazzkit_updated_at || '',
				),
			});
		}

		const correctionHands = collectCorrectionHandsForVerse(document, verseIdentifier, baseHand);
		for (const handId of correctionHands) {
			const fullTokens = extractWitnessTokensForVerse(document, verseIdentifier, options, {
				kind: 'corrector',
				baseHand,
				handId,
				treatment: 'full',
			});
			const fragmentaryTokens = extractWitnessTokensForVerse(document, verseIdentifier, options, {
				kind: 'corrector',
				baseHand,
				handId,
				treatment: 'fragmentary',
			});
			const fullContent = buildWitnessContent(fullTokens);
			const fragmentaryContent = buildWitnessContent(fragmentaryTokens);
			if (!fullContent && !fragmentaryContent) continue;
			const siglum = formatWitnessSiglum(witnessBase, handId, 'corrector');
			witnesses.push({
				id: buildWitnessId(`${witnessBase}:${handId}`, seenWitnessIds),
				siglum,
				kind: 'corrector',
				handId,
				content: fragmentaryContent || fullContent,
				tokens: cloneSourceTokens(fragmentaryTokens.length > 0 ? fragmentaryTokens : fullTokens),
				fullContent,
				fullTokens: cloneSourceTokens(fullTokens),
				fragmentaryContent,
				fragmentaryTokens: cloneSourceTokens(fragmentaryTokens),
				transcriptionUid: String(transcription._djazzkit_id || transcriptionId),
				sourceVersion: String(
					transcription.updated_at || transcription._djazzkit_updated_at || '',
				),
			});
		}
	}

	return witnesses;
}
