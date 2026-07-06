import {
	getVerseIndexRowsForVerse as getDbVerseIndexRowsForVerse,
	listVerseIndexRowsForTranscription as listDbVerseIndexRowsForTranscription,
	listVerseIndexRowsForTranscriptions as listDbVerseIndexRowsForTranscriptions,
	listVerseIndexRows,
	rebuildVerseIndexForTranscriptions as rebuildDbVerseIndexForTranscriptions,
	updateTranscriptionContent,
} from '$lib/client/db/client';
import type { VerseIndexRow as DbVerseIndexRow } from '$lib/client/db/repositories/transcriptions';
import {
	serializeTranscriptionDocument,
	type StoredTranscriptionDocument,
} from '$lib/client/transcription/content';

export interface VerseNode {
	book: string;
	chapter: string;
	verse: string;
}

export interface VerseIndexRebuildProgress {
	completed: number;
	total: number;
	currentLabel: string;
	currentTranscriptionId: string;
}

export interface VerseIndexRebuildFailure {
	transcriptionId: string;
	label: string;
	message: string;
}

export interface VerseIndexRebuildResult {
	processed: number;
	succeeded: number;
	failed: number;
	failures: VerseIndexRebuildFailure[];
}

export type VerseIndexRow = DbVerseIndexRow;

export async function getVerseIndexRows(): Promise<VerseIndexRow[]> {
	return (await listVerseIndexRows()).map(mapVerseIndexRow);
}

export async function getVerseIndexRowsForTranscription(
	transcriptionId: string
): Promise<VerseIndexRow[]> {
	return (await listDbVerseIndexRowsForTranscription(transcriptionId)).map(mapVerseIndexRow);
}

export async function getVerseIndexRowsForTranscriptions(
	transcriptionIds: string[]
): Promise<VerseIndexRow[]> {
	return (await listDbVerseIndexRowsForTranscriptions(transcriptionIds)).map(mapVerseIndexRow);
}

export async function getVerseIndexRowsForVerse(
	verseIdentifier: string,
	transcriptionIds?: string[]
): Promise<VerseIndexRow[]> {
	return (await getDbVerseIndexRowsForVerse(verseIdentifier, transcriptionIds)).map(
		mapVerseIndexRow
	);
}

export function extractVersesFromDocument(document: StoredTranscriptionDocument): VerseNode[] {
	const verses: VerseNode[] = [];
	const state: VerseNode = { book: '', chapter: '', verse: '' };

	for (const page of document.pages) {
		for (const column of page.columns) {
			for (const line of column.lines) {
				for (const item of line.items) {
					if (item.type !== 'milestone') continue;
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
						verses.push({ ...state });
					}
				}
			}
		}
	}

	return verses;
}

export function normalizeVerseIdentifier(verse: VerseNode): string {
	const { book, chapter, verse: verseNum } = verse;
	if (!book && !chapter && !verseNum) return 'Unknown';
	if (!chapter && !verseNum) return book;
	if (!chapter) return `${book} ${verseNum}`;
	if (!verseNum) return `${book} ${chapter}`;
	return `${book} ${chapter}:${verseNum}`;
}

export async function syncVerseIndexFromDocument(
	transcriptionId: string,
	document: StoredTranscriptionDocument
): Promise<void> {
	await updateTranscriptionContent({
		id: transcriptionId,
		document,
		contentJson: serializeTranscriptionDocument(document),
	});
}

interface RebuildVerseIndexOptions {
	onProgress?: (progress: VerseIndexRebuildProgress) => void;
	suppressReactiveNotifications?: boolean;
	pauseUploads?: boolean;
}

export async function rebuildVerseIndexForTranscriptions(
	transcriptionIds: string[],
	options: RebuildVerseIndexOptions = {}
): Promise<VerseIndexRebuildResult> {
	const ids = [...new Set(transcriptionIds.filter(Boolean))];
	if (ids.length === 0) {
		return {
			processed: 0,
			succeeded: 0,
			failed: 0,
			failures: [],
		};
	}

	const total = ids.length;
	options.onProgress?.({ completed: 0, total, currentLabel: '', currentTranscriptionId: '' });

	const result = await rebuildDbVerseIndexForTranscriptions(ids);
	options.onProgress?.({
		completed: result.processed,
		total,
		currentLabel: '',
		currentTranscriptionId: '',
	});

	return {
		processed: result.processed,
		succeeded: result.succeeded,
		failed: result.failures.length,
		failures: result.failures,
	};
}

function mapVerseIndexRow(row: DbVerseIndexRow): VerseIndexRow {
	return row;
}
