import { hashContent } from './content-hash';

const REVISION_DESC = /\n?[ \t]*<revisionDesc[\s>][\s\S]*?<\/revisionDesc>/;
const BASED_ON_IDNO = /\n?[ \t]*<idno type="apatosaurus-based-on(?:-hash)?"(?:\/>|>[^<]*<\/idno>)/g;
const ORIGIN_BIBL = /\n?[ \t]*<bibl type="apatosaurus-origin"[^>]*?(?:\/>|>[\s\S]*?<\/bibl>)/;

export function isTeiDocument(raw: string): boolean {
	return raw.trimStart().startsWith('<');
}

// Strips what changes without changing content: save times, Version notes, the based-on
// Version and where the transcription was copied from.
export function teiContentText(xml: string): string {
	const headerEnd = xml.indexOf('</teiHeader>');
	if (headerEnd < 0) return xml;
	const header = xml
		.slice(0, headerEnd)
		.replace(REVISION_DESC, '')
		.replace(BASED_ON_IDNO, '')
		.replace(ORIGIN_BIBL, '');
	return header + xml.slice(headerEnd);
}

export function teiContentHash(xml: string): Promise<string> {
	return hashContent(teiContentText(xml));
}
