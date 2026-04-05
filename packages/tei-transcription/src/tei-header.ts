import type {
	TeiHeaderInfo,
	TeiMetadata,
	TeiMsIdentifier,
	TeiResponsibility,
	TeiRevisionChange,
	TeiTitle,
} from './types';
import { extractTeiMsDescriptionInfo } from './tei-msdesc';

export function extractTeiHeaderInfo(
	teiRoot: Element,
	textElement: Element | null
): TeiHeaderInfo | undefined {
	const titleStmt = getDescendantAtPath(teiRoot, ['teiHeader', 'fileDesc', 'titleStmt']);
	const publicationStmt = getDescendantAtPath(teiRoot, ['teiHeader', 'fileDesc', 'publicationStmt']);
	const msIdentifierEl = getDescendantAtPath(teiRoot, [
		'teiHeader',
		'fileDesc',
		'sourceDesc',
		'msDesc',
		'msIdentifier',
	]);
	const msDescEl = getDescendantAtPath(teiRoot, ['teiHeader', 'fileDesc', 'sourceDesc', 'msDesc']);
	const revisionDesc = getDescendantAtPath(teiRoot, ['teiHeader', 'revisionDesc']);
	const handNotes = getDescendantAtPath(teiRoot, ['teiHeader', 'profileDesc', 'handNotes']);
	const encodingDesc = getDescendantAtPath(teiRoot, ['teiHeader', 'encodingDesc']);
	const language = extractLanguage(teiRoot, textElement);
	const publicationDate = extractPublicationDate(publicationStmt);

	const header: TeiHeaderInfo = {
		...(titleStmt ? { titles: extractTitles(titleStmt) } : {}),
		...(titleStmt ? { responsibilities: extractResponsibilities(titleStmt) } : {}),
		...(msIdentifierEl ? { msIdentifier: extractMsIdentifier(msIdentifierEl) } : {}),
		...(msDescEl ? { msDescription: extractTeiMsDescriptionInfo(msDescEl) } : {}),
		...(language ? { language } : {}),
		...(handNotes ? { witnessIds: extractWitnessIds(handNotes) } : {}),
		...(publicationStmt ? { publication: extractPublicationInfo(publicationStmt) } : {}),
		...(encodingDesc ? { encoding: extractEncodingInfo(encodingDesc) } : {}),
		...(encodingDesc?.getAttribute('n')
			? { encodingVersion: encodingDesc.getAttribute('n') || undefined }
			: {}),
		...(revisionDesc ? { revisionChanges: extractRevisionChanges(revisionDesc) } : {}),
		...(publicationDate ? { publicationDate } : {}),
	};

	return Object.keys(compactObject(header)).length > 0 ? compactObject(header) : undefined;
}

export function extractTeiMetadataFromHeader(
	header: TeiHeaderInfo | undefined
): TeiMetadata | undefined {
	if (!header) return undefined;

	const documentTitle =
		header.titles?.find(title => title.type === 'document') ||
		header.titles?.find(title => !title.type) ||
		header.titles?.[0];
	const transcriber = header.responsibilities?.find(resp =>
		resp.resp.toLowerCase().includes('transcribed')
	);

	const metadata: TeiMetadata = {
		...(documentTitle?.text ? { title: documentTitle.text } : {}),
		...(transcriber?.name ? { transcriber: transcriber.name } : {}),
		...(transcriber?.when || header.publicationDate
			? { date: transcriber?.when || header.publicationDate }
			: {}),
		...(header.msIdentifier?.repository ? { repository: header.msIdentifier.repository } : {}),
		...(header.msIdentifier?.settlement ? { settlement: header.msIdentifier.settlement } : {}),
		...(header.msIdentifier?.idno ? { idno: header.msIdentifier.idno } : {}),
		...(header.language ? { language: header.language } : {}),
	};

	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function extractTitles(titleStmt: Element): TeiTitle[] {
	return getImmediateChildElements(titleStmt, 'title')
		.map(title => ({
			text: normalizeText(title.textContent || ''),
			...(title.getAttribute('type') ? { type: title.getAttribute('type') || undefined } : {}),
			...(title.getAttribute('xml:lang') ? { lang: title.getAttribute('xml:lang') || undefined } : {}),
			...(title.getAttribute('n') ? { n: title.getAttribute('n') || undefined } : {}),
			...(title.getAttribute('key') ? { key: title.getAttribute('key') || undefined } : {}),
		}))
		.filter(title => title.text);
}

function extractResponsibilities(titleStmt: Element): TeiResponsibility[] {
	return getImmediateChildElements(titleStmt, 'respStmt')
		.map(respStmt => {
			const resp = getImmediateChildElements(respStmt, 'resp')[0];
			const name =
				getImmediateChildElements(respStmt, 'name')[0] ||
				getImmediateChildElements(respStmt, 'persName')[0];
			const result: TeiResponsibility = {
				resp: normalizeText(resp?.textContent || ''),
				...(name ? { name: normalizeText(name.textContent || '') } : {}),
				...(name?.getAttribute('type') ? { nameType: name.getAttribute('type') || undefined } : {}),
				...(resp?.getAttribute('when-iso') || resp?.getAttribute('when')
					? { when: resp?.getAttribute('when-iso') || resp?.getAttribute('when') || undefined }
					: {}),
			};
			return result;
		})
		.filter(resp => resp.resp);
}

function extractMsIdentifier(msIdentifier: Element): TeiMsIdentifier | undefined {
	const value: TeiMsIdentifier = {
		...(extractImmediateChildText(msIdentifier, 'country')
			? { country: extractImmediateChildText(msIdentifier, 'country') }
			: {}),
		...(extractImmediateChildText(msIdentifier, 'settlement')
			? { settlement: extractImmediateChildText(msIdentifier, 'settlement') }
			: {}),
		...(extractImmediateChildText(msIdentifier, 'repository')
			? { repository: extractImmediateChildText(msIdentifier, 'repository') }
			: {}),
		...(extractImmediateChildText(msIdentifier, 'idno')
			? { idno: extractImmediateChildText(msIdentifier, 'idno') }
			: {}),
	};
	return Object.keys(value).length > 0 ? value : undefined;
}

function extractWitnessIds(handNotes: Element): string[] {
	const ids = Array.from(handNotes.getElementsByTagName('witness'))
		.map(witness => witness.getAttribute('xml:id') || '')
		.filter(Boolean);
	return ids.length > 0 ? ids : [];
}

function extractRevisionChanges(revisionDesc: Element): TeiRevisionChange[] {
	return getImmediateChildElements(revisionDesc, 'change')
		.map(change => ({
			text: normalizeText(change.textContent || ''),
			...(change.getAttribute('n') ? { n: change.getAttribute('n') || undefined } : {}),
			...(change.getAttribute('when') ? { when: change.getAttribute('when') || undefined } : {}),
		}))
		.filter(change => change.text);
}

function extractPublicationDate(publicationStmt: Element | null): string | undefined {
	if (!publicationStmt) return undefined;
	const date = getImmediateChildElements(publicationStmt, 'date')[0];
	return date ? normalizeText(date.textContent || '') || undefined : undefined;
}

function extractPublicationInfo(publicationStmt: Element): TeiHeaderInfo['publication'] {
	const publisher =
		getImmediateChildElements(
			getImmediateChildElements(publicationStmt, 'publisher')[0] || publicationStmt,
			'name'
		)[0]?.textContent ||
		getImmediateChildElements(publicationStmt, 'publisher')[0]?.textContent ||
		'';
	const availability = getImmediateChildElements(publicationStmt, 'availability')[0];
	const info = {
		...(normalizeText(publisher) ? { publisher: normalizeText(publisher) } : {}),
		...(extractPublicationDate(publicationStmt) ? { date: extractPublicationDate(publicationStmt) } : {}),
		...(normalizeText(availability?.textContent || '')
			? { availability: normalizeText(availability?.textContent || '') }
			: {}),
	};
	return Object.keys(info).length > 0 ? info : undefined;
}

function extractEncodingInfo(encodingDesc: Element): TeiHeaderInfo['encoding'] {
	const projectDesc = getImmediateChildElements(encodingDesc, 'projectDesc')[0];
	const editorialDecl = getImmediateChildElements(encodingDesc, 'editorialDecl')[0];
	const variantEncoding = getImmediateChildElements(encodingDesc, 'variantEncoding')[0];

	const info = {
		...(encodingDesc.getAttribute('n') ? { version: encodingDesc.getAttribute('n') || undefined } : {}),
		...(normalizeText(projectDesc?.textContent || '')
			? { projectDesc: normalizeText(projectDesc?.textContent || '') }
			: {}),
		...(normalizeText(editorialDecl?.textContent || '')
			? { editorialDecl: normalizeText(editorialDecl?.textContent || '') }
			: {}),
		...(variantEncoding?.getAttribute('method')
			? { variantEncodingMethod: variantEncoding.getAttribute('method') || undefined }
			: {}),
		...(variantEncoding?.getAttribute('location')
			? { variantEncodingLocation: variantEncoding.getAttribute('location') || undefined }
			: {}),
	};
	return Object.keys(info).length > 0 ? info : undefined;
}

function extractLanguage(root: Element, textElement: Element | null): string | undefined {
	return (
		textElement?.getAttribute('xml:lang') ||
		getDescendantAtPath(root, ['teiHeader', 'profileDesc', 'langUsage', 'language'])?.getAttribute('ident') ||
		undefined
	);
}

function extractImmediateChildText(root: Element, tagName: string): string | undefined {
	const child = getImmediateChildElements(root, tagName)[0];
	return normalizeText(child?.textContent || '') || undefined;
}

function getDescendantAtPath(root: Element, path: string[]): Element | null {
	let current: Element | null = root;
	for (const segment of path) {
		current = current ? getImmediateChildElements(current, segment)[0] || null : null;
		if (!current) return null;
	}
	return current;
}

function getImmediateChildElements(root: Element, tagName: string): Element[] {
	return Array.from(root.childNodes).filter(
		child =>
			child.nodeType === Node.ELEMENT_NODE &&
			(child as Element).tagName.toLowerCase() === tagName.toLowerCase()
	) as Element[];
}

function normalizeText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function compactObject<T extends object>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, child]) => {
			if (child == null) return false;
			if (Array.isArray(child)) return child.length > 0;
			if (typeof child === 'object') return Object.keys(child).length > 0;
			return true;
		})
	) as T;
}
