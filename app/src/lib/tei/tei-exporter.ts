import {
	serializeTei,
	type TeiMetadata as TEIMetadata,
	type TranscriptionDocument,
} from '@apatosaurus/tei-transcription';

export type { TEIMetadata };

export function exportTEIDocument(document: TranscriptionDocument, metadata?: TEIMetadata): string {
	return serializeTei(document, metadata);
}
