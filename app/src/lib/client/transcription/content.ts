import { normalizeDocument, type TranscriptionDocument } from '$lib/tei/tei-transcription';

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
		return normalizeStoredTranscriptionDocument(value);
	}

	if (typeof value !== 'string') return null;

	try {
		const parsed = JSON.parse(value);
		return isTranscriptionDocument(parsed)
			? normalizeStoredTranscriptionDocument(parsed)
			: null;
	} catch {
		return null;
	}
}

export function serializeTranscriptionDocument(document: StoredTranscriptionDocument): string {
	return JSON.stringify(normalizeStoredTranscriptionDocument(document));
}

export function getReferenceEditionsUsed(document: StoredTranscriptionDocument): string[] {
	return [...(document.referenceEditionsUsed || [])];
}

export function addReferenceEditionUsed(
	document: StoredTranscriptionDocument,
	editionId: string
): StoredTranscriptionDocument {
	const normalizedId = editionId.trim();
	if (!normalizedId) return document;
	return {
		...document,
		referenceEditionsUsed: [
			...new Set([...(document.referenceEditionsUsed || []), normalizedId]),
		],
	};
}

function normalizeStoredTranscriptionDocument(
	document: StoredTranscriptionDocument
): StoredTranscriptionDocument {
	const normalized = normalizeDocument(document);
	const referenceEditionsUsed = normalized.referenceEditionsUsed
		?.filter((editionId): editionId is string => typeof editionId === 'string')
		.map(editionId => editionId.trim())
		.filter(Boolean);

	return {
		...normalized,
		...(referenceEditionsUsed && referenceEditionsUsed.length > 0
			? { referenceEditionsUsed: [...new Set(referenceEditionsUsed)] }
			: {}),
	};
}
