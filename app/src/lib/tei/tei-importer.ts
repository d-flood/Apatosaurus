import {
	parseTei,
	toProseMirror,
	type ProseMirrorJSON,
	type TranscriptionDocument,
} from '@apatopwa/tei-transcription';

export function importTEI(xmlString: string): ProseMirrorJSON {
	return toProseMirror(parseTei(xmlString));
}

export function importTEIDocument(xmlString: string): TranscriptionDocument {
	return parseTei(xmlString);
}
