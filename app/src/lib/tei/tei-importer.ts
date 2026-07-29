import {
	parseTei,
	toProseMirror,
	type ProseMirrorJSON,
	type TranscriptionDocument,
} from './tei-transcription';
import { prepareManuscriptDocumentEntry } from '$lib/client/transcriptionEditorStructure';

export function importTEI(xmlString: string): ProseMirrorJSON {
	return prepareManuscriptDocumentEntry(toProseMirror(parseTei(xmlString))).doc as ProseMirrorJSON;
}

export function importTEIDocument(xmlString: string): TranscriptionDocument {
	const document = parseTei(xmlString);
	prepareManuscriptDocumentEntry(toProseMirror(document));
	return document;
}
