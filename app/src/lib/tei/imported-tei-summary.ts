import type {
	CorrectionReading,
	TeiHandInfo,
	TranscriptionDocument,
	TranscriptionLine,
} from '@apatopwa/tei-transcription';

export interface ImportedTeiSummary {
	title?: string;
	siglum?: string;
	repository?: string;
	settlement?: string;
	language?: string;
	msName?: string;
	pageCount: number;
	columnCount: number;
	lineCount: number;
	bookIdentifiers: string[];
	chapterIdentifiers: string[];
	baseHand?: string;
	witnessIds: string[];
	hands: string[];
	correctionSiteCount: number;
	correctionReadingCount: number;
	correctionHands: string[];
	handShiftTargets: string[];
	marginaliaCount: number;
	gapCount: number;
	untranscribedCount: number;
	verseIdentifiers: string[];
	firstVerse?: string;
	lastVerse?: string;
}

export function summarizeImportedTeiDocument(
	document: Pick<TranscriptionDocument, 'metadata' | 'header' | 'pages'>
): ImportedTeiSummary {
	const witnessIds = uniqueStrings(document.header?.witnessIds || []);
	const hands = uniqueStrings([
		...witnessIds,
		...(document.header?.msDescription?.hands || []).map(formatHandInfo).filter(Boolean),
	]);
	const bookIdentifiers = new Set<string>();
	const chapterIdentifiers = new Set<string>();
	const verseIdentifiers = new Set<string>();
	const correctionHands = new Set<string>();
	const handShiftTargets = new Set<string>();
	const summaryCounts = {
		correctionSiteCount: 0,
		correctionReadingCount: 0,
		marginaliaCount: 0,
		gapCount: 0,
		untranscribedCount: 0,
	};
	collectDocumentSummaries(
		document.pages,
		bookIdentifiers,
		chapterIdentifiers,
		verseIdentifiers,
		correctionHands,
		handShiftTargets,
		summaryCounts,
	);
	const sortedBooks = Array.from(bookIdentifiers).sort();
	const sortedChapters = Array.from(chapterIdentifiers).sort(compareChapterIdentifiers);
	const sortedVerses = Array.from(verseIdentifiers).sort(compareVerseIdentifiers);
	const sortedCorrectionHands = Array.from(correctionHands).sort();
	const sortedHandShiftTargets = Array.from(handShiftTargets).sort();

	return {
		title: document.metadata?.title,
		siglum: document.metadata?.idno || document.header?.msIdentifier?.idno,
		repository: document.metadata?.repository || document.header?.msIdentifier?.repository,
		settlement: document.metadata?.settlement || document.header?.msIdentifier?.settlement,
		language: document.metadata?.language || document.header?.language,
		msName: document.header?.msDescription?.msName,
		pageCount: document.pages.length,
		columnCount: document.pages.reduce((total, page) => total + page.columns.length, 0),
		lineCount: document.pages.reduce(
			(total, page) =>
				total + page.columns.reduce((columnTotal, column) => columnTotal + column.lines.length, 0),
			0,
		),
		bookIdentifiers: sortedBooks,
		chapterIdentifiers: sortedChapters,
		baseHand: inferBaseHand(witnessIds, hands),
		witnessIds,
		hands,
		correctionSiteCount: summaryCounts.correctionSiteCount,
		correctionReadingCount: summaryCounts.correctionReadingCount,
		correctionHands: sortedCorrectionHands,
		handShiftTargets: sortedHandShiftTargets,
		marginaliaCount: summaryCounts.marginaliaCount,
		gapCount: summaryCounts.gapCount,
		untranscribedCount: summaryCounts.untranscribedCount,
		verseIdentifiers: sortedVerses,
		firstVerse: sortedVerses[0],
		lastVerse: sortedVerses[sortedVerses.length - 1],
	};
}

function collectDocumentSummaries(
	pages: TranscriptionDocument['pages'],
	bookIdentifiers: Set<string>,
	chapterIdentifiers: Set<string>,
	verseIdentifiers: Set<string>,
	correctionHands: Set<string>,
	handShiftTargets: Set<string>,
	summaryCounts: {
		correctionSiteCount: number;
		correctionReadingCount: number;
		marginaliaCount: number;
		gapCount: number;
		untranscribedCount: number;
	},
) {
	for (const page of pages) {
		for (const column of page.columns) {
			for (const line of column.lines) {
				collectSummariesFromLine(
					line,
					bookIdentifiers,
					chapterIdentifiers,
					verseIdentifiers,
					correctionHands,
					handShiftTargets,
					summaryCounts,
				);
			}
		}
	}
}

function collectSummariesFromLine(
	line: TranscriptionLine,
	bookIdentifiers: Set<string>,
	chapterIdentifiers: Set<string>,
	verseIdentifiers: Set<string>,
	correctionHands: Set<string>,
	handShiftTargets: Set<string>,
	summaryCounts: {
		correctionSiteCount: number;
		correctionReadingCount: number;
		marginaliaCount: number;
		gapCount: number;
		untranscribedCount: number;
	},
) {
	for (const item of line.items) {
		if (item.type === 'milestone') {
			const book = item.attrs.book || '';
			const chapter = item.attrs.chapter || '';
			const verse = item.attrs.verse || '';
			if (item.kind === 'book' && book) {
				bookIdentifiers.add(book);
			}
			if (item.kind === 'chapter') {
				const identifier = normalizeChapterIdentifier(book, chapter);
				if (identifier) chapterIdentifiers.add(identifier);
				if (book) bookIdentifiers.add(book);
			}
			if (item.kind === 'verse') {
				const identifier = normalizeVerseIdentifier(book, chapter, verse);
				if (identifier) verseIdentifiers.add(identifier);
				if (book) bookIdentifiers.add(book);
				const chapterIdentifier = normalizeChapterIdentifier(book, chapter);
				if (chapterIdentifier) chapterIdentifiers.add(chapterIdentifier);
			}
		}
		if (item.type === 'handShift') {
			const target = item.attrs.new || item.attrs.hand || '';
			const normalizedTarget = normalizeHandRef(target);
			if (normalizedTarget) handShiftTargets.add(normalizedTarget);
		}
		if (item.type === 'correctionOnly') {
			summaryCounts.correctionSiteCount += 1;
			collectCorrectionHands(item.corrections, correctionHands, summaryCounts);
		}
		if (item.type === 'text') {
			collectCorrectionHandsFromTextItem(item, correctionHands, summaryCounts);
		}
		if (item.type === 'fw') {
			summaryCounts.marginaliaCount += 1;
		}
		if (item.type === 'gap') {
			summaryCounts.gapCount += 1;
		}
		if (item.type === 'untranscribed') {
			summaryCounts.untranscribedCount += 1;
		}
	}
}

function collectCorrectionHandsFromTextItem(
	item: Extract<TranscriptionLine['items'][number], { type: 'text' }>,
	correctionHands: Set<string>,
	summaryCounts: {
		correctionSiteCount: number;
		correctionReadingCount: number;
	},
) {
	for (const mark of item.marks || []) {
		if (mark.type === 'correction') {
			summaryCounts.correctionSiteCount += 1;
			collectCorrectionHands(mark.attrs.corrections || [], correctionHands, summaryCounts);
		}
	}
}

function collectCorrectionHands(
	corrections: CorrectionReading[],
	correctionHands: Set<string>,
	summaryCounts: { correctionReadingCount: number },
) {
	for (const correction of corrections) {
		summaryCounts.correctionReadingCount += 1;
		const normalized = normalizeHandRef(correction.hand);
		if (normalized) correctionHands.add(normalized);
	}
}

function inferBaseHand(witnessIds: string[], hands: string[]): string | undefined {
	const preferredWitness =
		witnessIds.find(id => /firsthand/i.test(id)) ||
		witnessIds.find(id => /base|main/i.test(id)) ||
		witnessIds.find(id => !/correct/i.test(id));
	if (preferredWitness) return preferredWitness;

	const preferredHand =
		hands.find(hand => /firsthand/i.test(hand)) ||
		hands.find(hand => /first hand/i.test(hand)) ||
		hands.find(hand => !/correct/i.test(hand));
	return preferredHand || undefined;
}

function normalizeHandRef(value: string): string {
	return value.trim().replace(/^#/, '');
}

function normalizeChapterIdentifier(book: string, chapter: string): string {
	if (!book && !chapter) return '';
	if (!chapter) return book.trim();
	return `${book} ${chapter}`.trim();
}

function normalizeVerseIdentifier(book: string, chapter: string, verse: string): string {
	if (!book && !chapter && !verse) return '';
	if (!chapter && !verse) return book;
	if (!chapter) return `${book} ${verse}`.trim();
	if (!verse) return `${book} ${chapter}`.trim();
	return `${book} ${chapter}:${verse}`.trim();
}

function compareVerseIdentifiers(a: string, b: string): number {
	const aParsed = parseVerseIdentifier(a);
	const bParsed = parseVerseIdentifier(b);

	if (aParsed.book !== bParsed.book) return aParsed.book.localeCompare(bParsed.book);
	if (aParsed.chapter !== bParsed.chapter) return aParsed.chapter - bParsed.chapter;
	return aParsed.verse - bParsed.verse;
}

function compareChapterIdentifiers(a: string, b: string): number {
	const aParsed = parseVerseIdentifier(a);
	const bParsed = parseVerseIdentifier(b);

	if (aParsed.book !== bParsed.book) return aParsed.book.localeCompare(bParsed.book);
	return aParsed.chapter - bParsed.chapter;
}

function parseVerseIdentifier(identifier: string): { book: string; chapter: number; verse: number } {
	const match = identifier.match(/^(.*?)(?:\s+(\d+)(?::(\d+))?)?$/);
	return {
		book: match?.[1]?.trim() || identifier,
		chapter: Number(match?.[2] || '0'),
		verse: Number(match?.[3] || '0'),
	};
}

function formatHandInfo(hand: TeiHandInfo | undefined): string {
	if (!hand) return '';
	const id = hand.attrs?.['xml:id'] || hand.attrs?.n || '';
	const text = hand.text?.trim() || '';
	if (id && text) return `${id}: ${text}`;
	return id || text;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
	return Array.from(
		new Set(
			values
				.map(value => value?.trim() || '')
				.filter(Boolean),
		),
	);
}
