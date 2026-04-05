import { getVerseIndexRows } from '$lib/client/transcription/verse-index';

export interface VerseNode {
	book: string;
	chapter: string;
	verse: string;
}

export interface AggregatedVerse {
	identifier: string;
	book: string;
	chapter: string;
	verse: string;
	count: number;
}

export function extractVerses(_ydoc: unknown): VerseNode[] {
	return [];
}

export function extractVersesFromJSON(node: any, verses: VerseNode[]): void {
	if (!node) return;
	if (node.type === 'verse' && node.attrs) {
		verses.push({
			book: node.attrs.book || '',
			chapter: node.attrs.chapter || '',
			verse: node.attrs.verse || '',
		});
	}
	if (Array.isArray(node.content)) {
		for (const child of node.content) {
			extractVersesFromJSON(child, verses);
		}
	}
}

export function normalizeVerseIdentifier(verse: VerseNode): string {
	const { book, chapter, verse: verseNum } = verse;
	if (!book && !chapter && !verseNum) return 'Unknown';
	if (!chapter && !verseNum) return book;
	if (!chapter) return `${book} ${verseNum}`;
	if (!verseNum) return `${book} ${chapter}`;
	return `${book} ${chapter}:${verseNum}`;
}

export function aggregateVerses(allVerses: VerseNode[]): Map<string, AggregatedVerse> {
	const aggregationMap = new Map<string, AggregatedVerse>();
	for (const verse of allVerses) {
		const identifier = normalizeVerseIdentifier(verse);
		if (aggregationMap.has(identifier)) {
			aggregationMap.get(identifier)!.count += 1;
		} else {
			aggregationMap.set(identifier, {
				identifier,
				book: verse.book,
				chapter: verse.chapter,
				verse: verse.verse,
				count: 1,
			});
		}
	}
	return aggregationMap;
}

export function sortVerses(verses: AggregatedVerse[]): AggregatedVerse[] {
	return verses.sort((a, b) => {
		if (a.book !== b.book) return a.book.localeCompare(b.book);
		if (a.chapter !== b.chapter) return Number(a.chapter) - Number(b.chapter);
		return Number(a.verse) - Number(b.verse);
	});
}

export async function gatherVerses(transcriptionIds?: string[]): Promise<AggregatedVerse[]> {
	const transcriptionIdSet =
		Array.isArray(transcriptionIds) && transcriptionIds.length > 0
			? new Set(transcriptionIds)
			: null;
	const rows = (await getVerseIndexRows()).filter((row) =>
		transcriptionIdSet ? transcriptionIdSet.has(String(row.transcription_id ?? '')) : true,
	);
	const verses = rows.map((row) => ({ book: row.book, chapter: row.chapter, verse: row.verse }));
	return sortVerses([...aggregateVerses(verses).values()]);
}
