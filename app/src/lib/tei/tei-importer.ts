import {
	parseTei,
	type TeiParseOptions,
	type TranscriptionDocument,
} from '@apatosaurus/tei-transcription';

export function importTEIDocument(
	xmlString: string,
	options: TeiParseOptions = {}
): TranscriptionDocument {
	return parseTei(xmlString, options);
}
