import {
	fromProseMirror,
	serializeTei,
	type ProseMirrorJSON,
	type TeiMetadata as TEIMetadata,
	type TranscriptionDocument,
} from '@apatopwa/tei-transcription';

export type { TEIMetadata };

export function exportTEI(pmJSON: ProseMirrorJSON, metadata?: TEIMetadata): string {
	return serializeTei(fromProseMirror(pmJSON), metadata);
}

export function exportTEIDocument(
	document: TranscriptionDocument,
	metadata?: TEIMetadata
): string {
	return serializeTei(document, metadata);
}
