import type { TeiMetadata, TranscriptionDocument } from './types';
import { generateTeiMsDescXml } from './tei-msdesc-serializer';
import { serializeTeiNode } from './tei-tree';

export function generateTeiHeaderXml(
	metadata: TeiMetadata | undefined,
	document: TranscriptionDocument | undefined,
	helpers: {
		serializeAttrs: (attrs: Record<string, string | undefined>) => string;
		escapeXml: (text: string) => string;
	}
): string {
	const { serializeAttrs, escapeXml } = helpers;
	if (document?.teiHeader && !metadata) {
		return serializeTeiNode(document.teiHeader);
	}

	const effectiveMetadata = metadata || document?.metadata;
	const header = document?.header;
	const title = effectiveMetadata?.title || 'Untitled Transcription';
	const transcriber = effectiveMetadata?.transcriber || 'Unknown';
	const date = effectiveMetadata?.date || new Date().toISOString().split('T')[0];
	const country = header?.msIdentifier?.country || undefined;
	const repository =
		effectiveMetadata?.repository || header?.msIdentifier?.repository || 'Unknown Repository';
	const settlement =
		effectiveMetadata?.settlement || header?.msIdentifier?.settlement || 'Unknown';
	const idno = effectiveMetadata?.idno || header?.msIdentifier?.idno || 'Unknown Manuscript';
	const language = effectiveMetadata?.language || header?.language || 'grc';
	const titles = header?.titles || [{ text: title }];
	const responsibilities =
		header?.responsibilities && header.responsibilities.length > 0
			? header.responsibilities
			: [{ resp: 'Transcribed by', name: transcriber, when: date, nameType: 'person' }];
	const witnessIds = header?.witnessIds || [];
	const publication = header?.publication;
	const encoding = header?.encoding;
	const encodingVersion = encoding?.version || header?.encodingVersion || '1.0';
	const revisionChanges = header?.revisionChanges || [];
	const publicationDate = publication?.date || header?.publicationDate || date;
	const publisher = publication?.publisher || 'Apatopwa';
	const availability = publication?.availability || 'Transcription created with Apatopwa';
	const projectDesc = encoding?.projectDesc || 'Transcription created with Apatopwa';
	const msDescXml = generateTeiMsDescXml(
		{
			country,
			settlement,
			repository,
			idno,
		},
		header?.msDescription,
		{ escapeXml, serializeAttrs }
	);

	return [
		'<teiHeader>',
		'<fileDesc>',
		'<titleStmt>',
		...titles.map(currentTitle => {
			const attrs = serializeAttrs({
				type: currentTitle.type,
				'xml:lang': currentTitle.lang,
				n: currentTitle.n,
				key: currentTitle.key,
			});
			return `<title${attrs}>${escapeXml(currentTitle.text)}</title>`;
		}),
		...responsibilities.map(responsibility => {
			const respAttrs = responsibility.when
				? ` when-iso="${escapeXml(responsibility.when)}"`
				: '';
			const nameAttrs =
				responsibility.name && responsibility.nameType
					? ` type="${escapeXml(responsibility.nameType)}"`
					: '';
			return [
				'<respStmt>',
				`<resp${respAttrs}>${escapeXml(responsibility.resp)}</resp>`,
				responsibility.name
					? `<name${nameAttrs}>${escapeXml(responsibility.name)}</name>`
					: '',
				'</respStmt>',
			].join('');
		}),
		'</titleStmt>',
		'<editionStmt>',
		`<edition n="1.0">Version 1.0, published on <date when-iso="${escapeXml(date)}">${escapeXml(date)}</date></edition>`,
		'</editionStmt>',
		'<publicationStmt>',
		`<publisher><name type="org">${escapeXml(publisher)}</name></publisher>`,
		`<date>${escapeXml(publicationDate)}</date>`,
		`<availability><p>${escapeXml(availability)}</p></availability>`,
		'</publicationStmt>',
		'<sourceDesc>',
		msDescXml,
		'</sourceDesc>',
		'</fileDesc>',
		'<profileDesc>',
		'<langUsage>',
		`<language ident="${escapeXml(language)}"/>`,
		'</langUsage>',
		witnessIds.length > 0
			? [
				'<handNotes>',
				'<handNote>',
				'<listWit>',
				...witnessIds.map(id => `<witness xml:id="${escapeXml(id)}"/>`),
				'</listWit>',
				'</handNote>',
				'</handNotes>',
			].join('')
			: '',
		'</profileDesc>',
		`<encodingDesc n="${escapeXml(encodingVersion)}">`,
		`<projectDesc><p>${escapeXml(projectDesc)}</p></projectDesc>`,
		encoding?.editorialDecl
			? `<editorialDecl><p>${escapeXml(encoding.editorialDecl)}</p></editorialDecl>`
			: '',
		encoding?.variantEncodingMethod || encoding?.variantEncodingLocation
			? `<variantEncoding${serializeAttrs({
				method: encoding?.variantEncodingMethod,
				location: encoding?.variantEncodingLocation,
			})}/>`
			: '',
		'</encodingDesc>',
		revisionChanges.length > 0
			? [
				'<revisionDesc>',
				...revisionChanges.map(change =>
					`<change${serializeAttrs({ n: change.n, when: change.when })}>${escapeXml(change.text)}</change>`
				),
				'</revisionDesc>',
			].join('')
			: '',
		'</teiHeader>',
	].filter(Boolean).join('\n');
}
