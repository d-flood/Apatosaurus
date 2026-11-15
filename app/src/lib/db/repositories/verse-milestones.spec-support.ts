import type { LineItem } from '@apatosaurus/tei-transcription';

// Book and chapter milestones carry the context TEI needs to name each verse.
export function verseMilestones(verses: string[]): LineItem[] {
	let currentBook = '';
	let currentChapter = '';
	return verses.flatMap(identifier => {
		const [book, chapterVerse] = identifier.split(' ');
		const [chapter, verse] = chapterVerse.split(':');
		const items: LineItem[] = [];
		if (book !== currentBook)
			items.push({ type: 'milestone' as const, kind: 'book' as const, attrs: { book } });
		if (book !== currentBook || chapter !== currentChapter)
			items.push({
				type: 'milestone' as const,
				kind: 'chapter' as const,
				attrs: { book, chapter },
			});
		currentBook = book;
		currentChapter = chapter;
		items.push({
			type: 'milestone' as const,
			kind: 'verse' as const,
			attrs: { book, chapter, verse },
		});
		return items;
	});
}
