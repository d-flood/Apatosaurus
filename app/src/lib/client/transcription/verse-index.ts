import { TranscriptionVerseIndex } from '$generated/index';
import { Transcription, type TranscriptionRow } from '$generated/models/Transcription';
import type { TranscriptionVerseIndexRow } from '$generated/models/TranscriptionVerseIndex';
import { ensureDjazzkitRuntime } from '$lib/client/djazzkit-runtime';
import { getSyncClient, resumeNotifications, suppressNotifications } from '@djazzkit/core';
import {
	coerceTranscriptionDocument,
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

export type VerseIndexRow = TranscriptionVerseIndexRow;

export async function getVerseIndexRows(): Promise<VerseIndexRow[]> {
	await ensureDjazzkitRuntime();
	return TranscriptionVerseIndex.objects.all().all();
}

export async function getVerseIndexRowsForVerse(
	verseIdentifier: string,
	transcriptionIds?: string[],
): Promise<VerseIndexRow[]> {
	await ensureDjazzkitRuntime();
	const uniqueTranscriptionIds =
		Array.isArray(transcriptionIds) && transcriptionIds.length > 0
			? [...new Set(transcriptionIds.filter(Boolean))]
			: [];
	let query = TranscriptionVerseIndex.objects
		.filter((fields) => fields.verse_identifier.eq(verseIdentifier))
		.filter((fields) => fields._djazzkit_deleted.eq(false));
	if (uniqueTranscriptionIds.length > 0) {
		query = query.filter((fields) => fields.transcription.inList(uniqueTranscriptionIds));
	}
	return query.all();
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
	await ensureDjazzkitRuntime();

	const uniqueByIdentifier = new Map<string, VerseNode>();
	for (const verse of extractVersesFromDocument(document)) {
		const identifier = normalizeVerseIdentifier(verse);
		if (!identifier || uniqueByIdentifier.has(identifier)) continue;
		uniqueByIdentifier.set(identifier, verse);
	}

	const now = new Date().toISOString();
	const existing = await TranscriptionVerseIndex.objects.filter((f) =>
		f.transcription.eq(transcriptionId),
	).all();
	const existingByIdentifier = new Map(existing.map((row) => [row.verse_identifier, row]));

	for (const row of existing) {
		if (!uniqueByIdentifier.has(row.verse_identifier)) {
			await TranscriptionVerseIndex.objects.delete(row._djazzkit_id);
		}
	}

	const rowsToCreate: Array<Record<string, string | number | boolean>> = [];
	for (const [identifier, verse] of uniqueByIdentifier) {
		if (existingByIdentifier.has(identifier)) continue;
		rowsToCreate.push({
			_djazzkit_id: crypto.randomUUID(),
			_djazzkit_rev: 0,
			_djazzkit_deleted: false,
			_djazzkit_updated_at: now,
			transcription_id: transcriptionId as unknown as string,
			verse_identifier: identifier,
			book: verse.book,
			chapter: verse.chapter,
			verse: verse.verse,
			last_indexed_at: now,
		});
	}

	if (rowsToCreate.length > 0) {
		await TranscriptionVerseIndex.objects.createMany(rowsToCreate);
	}
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
	await ensureDjazzkitRuntime();

	const ids = [...new Set(transcriptionIds.filter(Boolean))];
	if (ids.length === 0) {
		return {
			processed: 0,
			succeeded: 0,
			failed: 0,
			failures: [],
		};
	}

	const failures: VerseIndexRebuildFailure[] = [];
	let succeeded = 0;
	let completed = 0;
	const total = ids.length;
	const shouldSuppressReactiveNotifications = options.suppressReactiveNotifications === true;
	const syncClient = options.pauseUploads ? getSyncClient() : null;

	if (shouldSuppressReactiveNotifications) {
		suppressNotifications();
	}
	syncClient?.setUploadsPaused(true);

	try {
		for (const transcriptionId of ids) {
			const transcription = await Transcription.objects
				.filter((fields) => fields._djazzkit_id.eq(transcriptionId))
				.filter((fields) => fields._djazzkit_deleted.eq(false))
				.first();
			const label = transcription ? formatTranscriptionLabel(transcription) : transcriptionId;

			options.onProgress?.({
				completed,
				total,
				currentLabel: label,
				currentTranscriptionId: transcriptionId,
			});

			try {
				if (!transcription) {
					throw new Error('Transcription was not found');
				}
				const document = coerceTranscriptionDocument(transcription.content_json);
				if (!document) {
					throw new Error('Transcription content is missing or invalid');
				}
				await syncVerseIndexFromDocument(transcription._djazzkit_id, document);
				succeeded += 1;
			} catch (error) {
				failures.push({
					transcriptionId,
					label,
					message: error instanceof Error ? error.message : 'Failed to rebuild verse index',
				});
			} finally {
				completed += 1;
				options.onProgress?.({
					completed,
					total,
					currentLabel: label,
					currentTranscriptionId: transcriptionId,
				});
			}
		}
	} finally {
		syncClient?.setUploadsPaused(false);
		if (shouldSuppressReactiveNotifications) {
			await resumeNotifications();
		}
	}

	return {
		processed: ids.length,
		succeeded,
		failed: failures.length,
		failures,
	};
}

function formatTranscriptionLabel(transcription: Pick<TranscriptionRow, '_djazzkit_id' | 'siglum' | 'title'>): string {
	return transcription.siglum?.trim() || transcription.title?.trim() || transcription._djazzkit_id;
}
