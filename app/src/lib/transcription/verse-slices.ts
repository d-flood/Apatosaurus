import type {
	TranscriptionColumn,
	TranscriptionLine,
	TranscriptionPage,
} from '@apatosaurus/tei-transcription';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { StoredTranscriptionDocument } from './content';
import dictionaryText from './verse-slice-dictionary.txt?raw';

interface MilestoneState {
	book: string;
	chapter: string;
	verse: string;
}

interface SliceBuilder {
	pages: TranscriptionPage[];
	sourcePage: TranscriptionPage | null;
	sourceColumn: TranscriptionColumn | null;
	lastLineOrdinal: number;
	firstPosition: number;
	lastPosition: number;
}

type ShellEntry = ['page', number, TranscriptionPage] | ['column', number, TranscriptionColumn];

export interface IndexedVerseSlices {
	/**
	 * Runs of whole lines in document order: the milestone state the run starts
	 * in, then newline-separated JSON entries of lines and the page and column
	 * shells they sit in, restated at the start of each run.
	 */
	chunks: string[];
	/** First and last chunk each verse's slice draws on, or null for an empty slice. */
	ranges: Map<string, [number, number] | null>;
}

const dictionary = strToU8(dictionaryText);
// Never pushed into a slice: it stands in for lines the verse is not active in.
const SKIPPED_LINE = { type: 'line', items: [] } as unknown as TranscriptionLine;

/**
 * Keeps every line where a verse is active at any point, plus the page and
 * column shells (and empty columns or pages) between them, so witness
 * extraction on a slice matches extraction on the whole document.
 */
export function sliceDocumentByVerse(
	document: StoredTranscriptionDocument,
	verseIdentifiers: Iterable<string>
): Map<string, TranscriptionPage[]> {
	const builders = walkVerseSlices(document.pages, verseIdentifiers, emptyState());
	return new Map([...builders].map(([identifier, builder]) => [identifier, builder.pages]));
}

/** Splits pages into chunks of at least `targetLength` line characters, and maps verses onto them. */
export function indexVerseSlices(
	document: StoredTranscriptionDocument,
	verseIdentifiers: Iterable<string>,
	targetLength: number
): IndexedVerseSlices {
	const chunks: string[] = [];
	const chunkStarts: number[] = [];
	const state = emptyState();
	let entries: string[] = [];
	let chunkState = '';
	let length = 0;
	let position = 0;

	function open(restated: string[]) {
		if (entries.length > 0) return;
		chunkStarts.push(position);
		chunkState = JSON.stringify([state.book, state.chapter, state.verse]);
		entries = [...restated];
	}

	function close() {
		chunks.push(`${chunkState}\n${entries.join('\n')}`);
		entries = [];
		length = 0;
	}

	document.pages.forEach((page, pageIndex) => {
		const pageEntry = JSON.stringify(['page', pageIndex, { ...page, columns: [] }]);
		open([]);
		entries.push(pageEntry);
		position++;
		page.columns.forEach((column, columnIndex) => {
			const columnEntry = JSON.stringify(['column', columnIndex, { ...column, lines: [] }]);
			open([pageEntry]);
			entries.push(columnEntry);
			position++;
			for (const line of column.lines) {
				open([pageEntry, columnEntry]);
				const lineJson = JSON.stringify(line);
				entries.push(lineJson);
				length += lineJson.length;
				position++;
				for (const item of line.items) advanceState(state, item);
				if (length >= targetLength) close();
			}
		});
	});
	if (entries.length > 0) close();

	const chunkAt = (target: number) => {
		let index = 0;
		while (index + 1 < chunkStarts.length && chunkStarts[index + 1] <= target) index++;
		return index;
	};
	const builders = walkVerseSlices(document.pages, verseIdentifiers, emptyState());
	const ranges = new Map<string, [number, number] | null>();
	for (const [identifier, builder] of builders)
		ranges.set(
			identifier,
			builder.firstPosition < 0
				? null
				: [chunkAt(builder.firstPosition), chunkAt(builder.lastPosition)]
		);
	return { chunks, ranges };
}

/**
 * Rebuilds one verse's `sliceDocumentByVerse` slice from the consecutive
 * chunks its range covers, parsing only lines that can change the milestone
 * state or belong to the verse.
 */
export function sliceVerseFromChunks(
	chunkTexts: string[],
	verseIdentifier: string
): TranscriptionPage[] {
	if (chunkTexts.length === 0) return [];
	const [book, chapter, verse] = JSON.parse(chunkTexts[0].slice(0, chunkTexts[0].indexOf('\n')));
	const initialState: MilestoneState = { book, chapter, verse };
	const state = { ...initialState };
	const pages: TranscriptionPage[] = [];
	let pageIndex = -1;
	let columnIndex = -1;
	for (const text of chunkTexts)
		for (const entry of text.split('\n').slice(1)) {
			if (entry.startsWith('{')) {
				const parse =
					activeVerseIdentifier(state) === verseIdentifier ||
					entry.includes('"milestone"');
				const line = parse ? (JSON.parse(entry) as TranscriptionLine) : SKIPPED_LINE;
				if (parse) for (const item of line.items) advanceState(state, item);
				pages.at(-1)!.columns.at(-1)!.lines.push(line);
				continue;
			}
			const shell = JSON.parse(entry) as ShellEntry;
			if (shell[0] === 'page') {
				if (shell[1] === pageIndex) continue;
				pageIndex = shell[1];
				columnIndex = -1;
				pages.push(shell[2]);
			} else if (shell[1] !== columnIndex) {
				columnIndex = shell[1];
				pages.at(-1)!.columns.push(shell[2]);
			}
		}
	return walkVerseSlices(pages, [verseIdentifier], initialState).get(verseIdentifier)!.pages;
}

export function compressVerseSliceChunk(json: string): Uint8Array {
	return deflateSync(strToU8(json), { dictionary });
}

export function decompressVerseSliceChunk(bytes: Uint8Array): string {
	return strFromU8(inflateSync(bytes, { dictionary }));
}

function walkVerseSlices(
	pages: TranscriptionPage[],
	verseIdentifiers: Iterable<string>,
	state: MilestoneState
): Map<string, SliceBuilder> {
	const builders = new Map<string, SliceBuilder>();
	for (const identifier of verseIdentifiers)
		builders.set(identifier, {
			pages: [],
			sourcePage: null,
			sourceColumn: null,
			lastLineOrdinal: -2,
			firstPosition: -1,
			lastPosition: -1,
		});
	let ordinal = 0;
	let position = 0;

	function touch(builder: SliceBuilder) {
		if (builder.firstPosition < 0) builder.firstPosition = position;
		builder.lastPosition = position;
	}

	function pageShell(builder: SliceBuilder, page: TranscriptionPage): TranscriptionPage {
		if (builder.sourcePage !== page) {
			builder.sourcePage = page;
			builder.sourceColumn = null;
			builder.pages.push({ ...page, columns: [] });
		}
		return builder.pages[builder.pages.length - 1];
	}

	function columnShell(
		builder: SliceBuilder,
		page: TranscriptionPage,
		column: TranscriptionColumn
	): TranscriptionColumn {
		const shell = pageShell(builder, page);
		if (builder.sourceColumn !== column) {
			builder.sourceColumn = column;
			shell.columns.push({ ...column, lines: [] });
		}
		return shell.columns[shell.columns.length - 1];
	}

	for (const page of pages) {
		if (page.columns.length === 0) {
			const builder = builders.get(activeVerseIdentifier(state));
			if (builder) {
				pageShell(builder, page);
				touch(builder);
			}
		}
		position++;
		for (const column of page.columns) {
			if (column.lines.length === 0) {
				const builder = builders.get(activeVerseIdentifier(state));
				if (builder) {
					columnShell(builder, page, column);
					touch(builder);
				}
			}
			position++;
			for (const line of column.lines) {
				const startState = { ...state };
				const active = new Set([activeVerseIdentifier(state)]);
				for (const item of line.items)
					if (advanceState(state, item)) active.add(activeVerseIdentifier(state));
				for (const identifier of active) {
					const builder = builders.get(identifier);
					if (!builder) continue;
					const startsRange = builder.lastLineOrdinal !== ordinal - 1;
					columnShell(builder, page, column).lines.push(
						startsRange ? withLeadingState(line, startState) : line
					);
					builder.lastLineOrdinal = ordinal;
					touch(builder);
				}
				ordinal++;
				position++;
			}
		}
	}
	return builders;
}

function emptyState(): MilestoneState {
	return { book: '', chapter: '', verse: '' };
}

function advanceState(state: MilestoneState, item: TranscriptionLine['items'][number]): boolean {
	if (item.type !== 'milestone') return false;
	if (item.kind === 'book') state.book = item.attrs.book || state.book;
	if (item.kind === 'chapter') {
		state.book = item.attrs.book || state.book;
		state.chapter = item.attrs.chapter || state.chapter;
	}
	if (item.kind === 'verse') {
		state.book = item.attrs.book || state.book;
		state.chapter = item.attrs.chapter || state.chapter;
		state.verse = item.attrs.verse || state.verse;
	}
	return true;
}

function activeVerseIdentifier({ book, chapter, verse }: MilestoneState): string {
	if (!book && !chapter && !verse) return '';
	if (!chapter && !verse) return book;
	if (!chapter) return `${book} ${verse}`;
	if (!verse) return `${book} ${chapter}`;
	return `${book} ${chapter}:${verse}`;
}

/** Restores the milestone state a range starts in, which the slice drops. */
function withLeadingState(line: TranscriptionLine, state: MilestoneState): TranscriptionLine {
	return {
		...line,
		items: [
			{
				type: 'milestone',
				kind: 'verse',
				attrs: { book: state.book, chapter: state.chapter, verse: state.verse },
			},
			...line.items,
		],
	};
}
