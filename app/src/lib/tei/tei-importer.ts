import {
	parseTei,
	toProseMirror,
	type ProseMirrorJSON,
	type TeiParseOptions,
	type TranscriptionDocument,
} from '@apatosaurus/tei-transcription';
import { prepareManuscriptDocumentEntry } from '$lib/editor/structure';

export function importTEI(xmlString: string): ProseMirrorJSON {
	return prepareManuscriptDocumentEntry(toProseMirror(parseTei(xmlString)))
		.doc as ProseMirrorJSON;
}

export function importTEIDocument(
	xmlString: string,
	options: TeiParseOptions = {}
): TranscriptionDocument {
	const document = parseTei(xmlString, options);
	prepareManuscriptDocumentEntry(toProseMirror(document));
	return document;
}
