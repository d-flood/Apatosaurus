import {
	normalizeDocument,
	type TranscriptionDocument,
} from '@apatopwa/tei-transcription';

export type StoredTranscriptionDocument = TranscriptionDocument;

export const TRANSCRIPTION_FORMAT = 'normalized_ast_v3';

export const EMPTY_TRANSCRIPTION_DOC: StoredTranscriptionDocument = {
	type: 'transcriptionDocument',
	pages: [],
};

export function isTranscriptionDocument(value: unknown): value is StoredTranscriptionDocument {
	return (
		typeof value === 'object' &&
		value !== null &&
		'type' in value &&
		(value as { type?: unknown }).type === 'transcriptionDocument' &&
		Array.isArray((value as { pages?: unknown }).pages)
	);
}

export function coerceTranscriptionDocument(value: unknown): StoredTranscriptionDocument | null {
	if (isTranscriptionDocument(value)) {
		return normalizeDocument(value);
	}

	if (typeof value !== 'string') return null;

	try {
		const parsed = JSON.parse(value);
		return isTranscriptionDocument(parsed) ? normalizeDocument(parsed) : null;
	} catch {
		return null;
	}
}

export function serializeTranscriptionDocument(document: StoredTranscriptionDocument): string {
	return JSON.stringify(normalizeDocument(document));
}
