import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import {
	parseElementTree,
	parseTei,
	serializeTei,
	serializeTeiNode,
	type TeiElementNode,
	type TeiNode,
	type TranscriptionDocument,
	type TranscriptionPage,
} from '@apatosaurus/tei-transcription';

import { hashContent } from '$lib/storage/content-hash';
import { teiContentHash } from '$lib/storage/tei-content';
import { coerceTranscriptionDocument } from '$lib/transcription/content';

import type { JsonValue } from '../envelope';
import type { ProjectTranscriptionPayload } from './project-transcription';
import {
	buildIiifNodes,
	isAppIiifNode,
	parseIiifNodes,
	withIiifPageFacs,
	withoutIiifPageFacs,
	type TranscriptionIiif,
} from './transcription-tei-iiif';

export type TranscriptionTeiRecord = ProjectTranscriptionPayload;

export interface SerializedTranscriptionTei {
	xml: string;
	fileHash: string;
	contentHash: string;
}

export interface TranscriptionTeiVersion {
	id: string;
	label: string;
	note: string | null;
	author_name: string;
	created_at: string;
	parent_id: string | null;
}

export interface TranscriptionTeiVersionHeader {
	transcriptionId: string;
	projectTranscriptionId: string;
	contentFormat: string;
	version: TranscriptionTeiVersion | null;
}

const IDNO = {
	transcription: 'apatosaurus-transcription',
	projectTranscription: 'apatosaurus-project-transcription',
	canonicalTranscription: 'apatosaurus-canonical-transcription',
	basedOn: 'apatosaurus-based-on',
	basedOnHash: 'apatosaurus-based-on-hash',
	contentFormat: 'apatosaurus-content-format',
	version: 'apatosaurus-version',
	parentVersion: 'apatosaurus-parent-version',
} as const;
const ORIGIN_IDNO = {
	project: 'apatosaurus-source-project',
	transcription: 'apatosaurus-source-transcription',
	revision: 'apatosaurus-source-revision',
	contentHash: 'apatosaurus-source-content-hash',
} as const;
const ORIGIN_BIBL = 'apatosaurus-origin';
const DESCRIPTION_NOTE = 'description';
const TAGS_NOTE = 'apatosaurus-tags';
const REFERENCE_EDITION = 'referenceEdition';
const OWNER_RESP = 'Owner';
const TRANSCRIBER_RESP = 'Transcribed by';
const VERSION_CHANGE = 'version';
const APP_CHANGE_TYPES = new Set(['created', 'saved', 'updated', VERSION_CHANGE]);
const REVISION_DESC_XML = /<revisionDesc(?:\s[^>]*)?>[\s\S]*?<\/revisionDesc>/;
const VERSION_CHANGE_XML = /<change\b[^>]*?\stype=(["'])version\1[^>]*?(?:\/>|>[\s\S]*?<\/change>)/;

export async function serializeTranscriptionTei(
	record: TranscriptionTeiRecord,
	version: TranscriptionTeiVersion | null = null
): Promise<SerializedTranscriptionTei> {
	const normalized = nfcDeep(record) as TranscriptionTeiRecord;
	const document = coerceTranscriptionDocument(normalized.content_json);
	if (!document) {
		throw new Error(
			`Project transcription ${record.project_transcription_id} has invalid content.`
		);
	}
	const header = buildHeader(
		document.teiHeader,
		normalized,
		version && (nfcDeep(version) as TranscriptionTeiVersion),
		document.textAttrs?.['xml:lang']
	);
	const raw = serializeTei({
		...document,
		pages: withIiifPageFacs(withPageIds(document.pages), normalized.page_canvas_links),
		teiHeader: header,
		textAttrs: withLanguage(document.textAttrs, normalized.language),
		resourceNodes: [...nonAppResources(document), ...buildIiifNodes(normalized)],
		facsimile: undefined,
		sourceDoc: undefined,
		standOff: undefined,
	});
	const xml = finalizeXml(raw);
	const [fileHash, contentHash] = await Promise.all([hashContent(xml), teiContentHash(xml)]);
	return { xml, fileHash, contentHash };
}

export function splitTranscriptionTeiIiif<T extends TranscriptionDocument>(
	parsed: T
): { document: T; iiif: TranscriptionIiif } {
	const appNodes = (parsed.resourceNodes ?? []).filter(isAppIiifNode);
	const appSurfaceIds = new Set(
		appNodes.flatMap(node =>
			children(node, 'surface').flatMap(surface => surface.attrs?.['xml:id'] ?? [])
		)
	);
	const kept = (nodes: TeiElementNode[] | undefined) => {
		const remaining = nodes?.filter(node => !isAppIiifNode(node));
		return remaining?.length ? remaining : undefined;
	};
	return {
		document: {
			...parsed,
			pages: withoutIiifPageFacs(parsed.pages, appSurfaceIds),
			resourceNodes: kept(parsed.resourceNodes),
			facsimile: kept(parsed.facsimile),
			standOff: kept(parsed.standOff),
		},
		iiif: parseIiifNodes(appNodes),
	};
}

export function parseTranscriptionTei(xml: string): TranscriptionTeiRecord {
	const { document: parsed, iiif } = splitTranscriptionTeiIiif(withXmlDom(() => parseTei(xml)));
	const header = parsed.teiHeader ?? element('teiHeader');
	const fileDesc = child(header, 'fileDesc');
	const titleStmt = child(fileDesc, 'titleStmt');
	const publicationStmt = child(fileDesc, 'publicationStmt');
	const notesStmt = child(fileDesc, 'notesStmt');
	const sourceDesc = child(fileDesc, 'sourceDesc');
	const msIdentifier = child(child(sourceDesc, 'msDesc'), 'msIdentifier');
	const origin = children(sourceDesc, 'bibl').find(node => node.attrs?.type === ORIGIN_BIBL);
	const changes = children(child(header, 'revisionDesc'), 'change');
	const change = (type: string) => changes.find(node => node.attrs?.type === type);
	const savedAt = change('saved')?.attrs?.when ?? '';
	const updated = change('updated');
	const owner = findResp(titleStmt, isOwnerResp);
	const basedOn = idnoText(publicationStmt, IDNO.basedOn);
	const editions = referenceEditionBibls(sourceDesc).filter(node => node.attrs?.['xml:id']);
	const attributions = Object.fromEntries(
		editions.flatMap(node => {
			const text = textContent(node);
			return text ? [[node.attrs!['xml:id'], text]] : [];
		})
	);
	const document = coerceTranscriptionDocument({
		...parsed,
		referenceEditionsUsed: editions.map(node => node.attrs!['xml:id']),
		referenceEditionAttributions: attributions,
	});
	if (!document) throw new Error('Transcription TEI has invalid content.');
	const capturedAt = child(origin, 'date');

	return {
		project_transcription_id: idnoText(publicationStmt, IDNO.projectTranscription) ?? '',
		id: idnoText(publicationStmt, IDNO.transcription) ?? '',
		canonical_transcription_id: idnoText(publicationStmt, IDNO.canonicalTranscription) ?? null,
		based_on_checkpoint:
			basedOn === undefined
				? null
				: { id: basedOn, content_hash: idnoText(publicationStmt, IDNO.basedOnHash) ?? '' },
		draft: { saved_at: savedAt, author_name: nameText(change('saved')) ?? null },
		origin: {
			source_type: origin?.attrs?.subtype ?? '',
			source_project_id: idnoText(origin, ORIGIN_IDNO.project) ?? null,
			source_transcription_id: idnoText(origin, ORIGIN_IDNO.transcription) ?? null,
			source_revision_id: idnoText(origin, ORIGIN_IDNO.revision) ?? null,
			source_content_hash: idnoText(origin, ORIGIN_IDNO.contentHash) ?? null,
			...(capturedAt ? { source_captured_at: capturedAt.attrs?.when ?? null } : {}),
		},
		title: normalizedText(preferredTitle(titleStmt)),
		siglum: normalizedText(child(msIdentifier, 'idno')),
		description: textContent(noteOfType(notesStmt, DESCRIPTION_NOTE)),
		content_json: JSON.parse(JSON.stringify(document)) as JsonValue,
		content_format: idnoText(publicationStmt, IDNO.contentFormat) ?? '',
		created_at: change('created')?.attrs?.when ?? '',
		updated_at: updated ? (updated.attrs?.when ?? '') : savedAt,
		owner: owner ? (nameText(owner) ?? '') : null,
		is_public: child(publicationStmt, 'availability')?.attrs?.status === 'free',
		tags: children(noteOfType(notesStmt, TAGS_NOTE), 'term').map(normalizedText),
		transcriber: nameText(findResp(titleStmt, isTranscriberResp)) ?? '',
		repository: normalizedText(child(msIdentifier, 'repository')),
		settlement: normalizedText(child(msIdentifier, 'settlement')),
		language:
			parsed.textAttrs?.['xml:lang'] ??
			child(child(child(header, 'profileDesc'), 'langUsage'), 'language')?.attrs?.ident ??
			'',
		...iiif,
	};
}

export function parseTranscriptionTeiVersion(xml: string): TranscriptionTeiVersionHeader {
	const end = xml.indexOf('</teiHeader>');
	const start = xml.lastIndexOf('<teiHeader', end);
	if (start < 0 || end < 0) throw new Error('Transcription TEI has no teiHeader.');
	const header = withXmlDom(() => {
		const doc = new DOMParser().parseFromString(
			xml.slice(start, end + '</teiHeader>'.length),
			'application/xml'
		);
		if (doc.getElementsByTagName('parsererror').length > 0)
			throw new Error('Failed to parse transcription TEI header.');
		return parseElementTree(doc.documentElement);
	});
	const publicationStmt = child(child(header, 'fileDesc'), 'publicationStmt');
	return {
		transcriptionId: idnoText(publicationStmt, IDNO.transcription) ?? '',
		projectTranscriptionId: idnoText(publicationStmt, IDNO.projectTranscription) ?? '',
		contentFormat: idnoText(publicationStmt, IDNO.contentFormat) ?? '',
		version: readVersionChange(header),
	};
}

export async function rewriteTranscriptionTeiVersion(
	xml: string,
	version: TranscriptionTeiVersion
): Promise<SerializedTranscriptionTei> {
	const header = xml.slice(0, xml.indexOf('</teiHeader>'));
	const revisionDesc = REVISION_DESC_XML.exec(header);
	const change = revisionDesc && VERSION_CHANGE_XML.exec(revisionDesc[0]);
	if (!revisionDesc || !change) throw new Error('Transcription TEI has no Version change.');
	const start = revisionDesc.index + change.index;
	const rewritten =
		xml.slice(0, start) +
		serializeTeiNode(versionChange(nfcDeep(version) as TranscriptionTeiVersion)) +
		xml.slice(start + change[0].length);
	const [fileHash, contentHash] = await Promise.all([
		hashContent(rewritten),
		teiContentHash(rewritten),
	]);
	return { xml: rewritten, fileHash, contentHash };
}

function readVersionChange(header: TeiElementNode): TranscriptionTeiVersion | null {
	const change = children(child(header, 'revisionDesc'), 'change').find(
		node => node.attrs?.type === VERSION_CHANGE
	);
	if (!change) return null;
	const note = child(change, 'note');
	return {
		id: idnoText(change, IDNO.version) ?? '',
		label: change.attrs?.n ?? '',
		note: note ? textContent(note) : null,
		author_name: nameText(change) ?? '',
		created_at: change.attrs?.when ?? '',
		parent_id: idnoText(change, IDNO.parentVersion) ?? null,
	};
}

function versionChange(version: TranscriptionTeiVersion): TeiElementNode {
	return element('change', { type: VERSION_CHANGE, when: version.created_at, n: version.label }, [
		idno(IDNO.version, version.id),
		idno(IDNO.parentVersion, version.parent_id),
		version.author_name ? element('name', {}, text(version.author_name)) : null,
		version.note === null ? null : element('note', {}, text(version.note)),
	]);
}

// Worker contexts have no DOMParser; the package parser needs one.
function withXmlDom<T>(parse: () => T): T {
	if (typeof globalThis.DOMParser !== 'undefined') return parse();
	const previousNode = globalThis.Node;
	globalThis.DOMParser = XmlDomParser as unknown as typeof globalThis.DOMParser;
	if (typeof previousNode === 'undefined')
		globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 } as typeof globalThis.Node;
	try {
		return parse();
	} finally {
		Reflect.deleteProperty(globalThis, 'DOMParser');
		if (typeof previousNode === 'undefined') Reflect.deleteProperty(globalThis, 'Node');
	}
}

function nonAppResources(document: TranscriptionDocument): TeiElementNode[] {
	const resources = document.resourceNodes ?? [
		...(document.facsimile ?? []),
		...(document.sourceDoc ?? []),
		...(document.standOff ?? []),
	];
	return resources.filter(node => !isAppIiifNode(node));
}

function withPageIds(pages: TranscriptionPage[]): TranscriptionPage[] {
	const taken = new Set(pages.map(pageXmlId).filter(Boolean));
	let next = 1;
	return pages.map(page => {
		if (pageXmlId(page)) return page;
		while (taken.has(`page-${next}`)) next += 1;
		taken.add(`page-${next}`);
		return { ...page, pageId: `page-${next}` };
	});
}

function pageXmlId(page: TranscriptionPage): string | undefined {
	return page.pageId || page.teiAttrs?.['xml:id'] || undefined;
}

function buildHeader(
	imported: TeiElementNode | undefined,
	record: TranscriptionTeiRecord,
	version: TranscriptionTeiVersion | null,
	bodyLanguage: string | undefined
): TeiElementNode {
	const header = imported
		? (structuredClone(imported) as TeiElementNode)
		: element('teiHeader', {}, [
				element('fileDesc', {}, [
					element('titleStmt'),
					element('publicationStmt', {}, [element('publisher')]),
					element('sourceDesc'),
				]),
			]);
	const fileDesc = ensureChild(header, 'fileDesc', []);
	patchTitleStmt(ensureChild(fileDesc, 'titleStmt', []), record);
	patchPublicationStmt(
		ensureChild(fileDesc, 'publicationStmt', ['titleStmt', 'editionStmt', 'extent']),
		record
	);
	patchNotesStmt(fileDesc, record);
	patchSourceDesc(ensureChild(fileDesc, 'sourceDesc', ['*']), record);
	patchLanguage(header, record.language, bodyLanguage);
	patchRevisionDesc(header, record, version);
	return header;
}

function patchTitleStmt(titleStmt: TeiElementNode, record: TranscriptionTeiRecord): void {
	const title = preferredTitle(titleStmt) ?? insertChild(titleStmt, element('title'), []);
	setNormalizedText(title, record.title);

	const respTags = ['title', 'author', 'editor', 'respStmt'];
	patchResp(titleStmt, isTranscriberResp, TRANSCRIBER_RESP, record.transcriber || null, respTags);
	patchResp(titleStmt, isOwnerResp, OWNER_RESP, record.owner, respTags);
}

function patchResp(
	titleStmt: TeiElementNode,
	matches: (node: TeiElementNode) => boolean,
	resp: string,
	name: string | null,
	after: string[]
): void {
	if (name === null) {
		titleStmt.children = (titleStmt.children ?? []).filter(
			node => !(node.type === 'element' && node.tag === 'respStmt' && matches(node))
		);
		return;
	}
	const existing = findResp(titleStmt, matches);
	if (!existing) {
		insertChild(
			titleStmt,
			element('respStmt', {}, [
				element('resp', {}, text(resp)),
				element('name', {}, text(name)),
			]),
			after
		);
		return;
	}
	const nameNode =
		child(existing, 'name') ??
		child(existing, 'persName') ??
		appendChild(existing, element('name'));
	setNormalizedText(nameNode, name);
}

function patchPublicationStmt(
	publicationStmt: TeiElementNode,
	record: TranscriptionTeiRecord
): void {
	const status = record.is_public ? 'free' : 'restricted';
	const availability =
		child(publicationStmt, 'availability') ??
		appendChild(publicationStmt, element('availability', { status }, [element('p')]));
	availability.attrs = { ...availability.attrs, status };

	replaceAppChildren(
		publicationStmt,
		node => node.tag === 'idno' && Boolean(node.attrs?.type?.startsWith('apatosaurus-')),
		[
			idno(IDNO.transcription, record.id),
			idno(IDNO.projectTranscription, record.project_transcription_id),
			idno(IDNO.canonicalTranscription, record.canonical_transcription_id),
			idno(IDNO.basedOn, record.based_on_checkpoint?.id),
			idno(IDNO.basedOnHash, record.based_on_checkpoint?.content_hash),
			idno(IDNO.contentFormat, record.content_format),
		]
	);
}

function patchNotesStmt(fileDesc: TeiElementNode, record: TranscriptionTeiRecord): void {
	const notes = [
		record.description
			? element('note', { type: DESCRIPTION_NOTE }, text(record.description))
			: null,
		record.tags.length > 0
			? element(
					'note',
					{ type: TAGS_NOTE },
					record.tags.map(tag => element('term', {}, text(tag)))
				)
			: null,
	];
	const notesStmt =
		child(fileDesc, 'notesStmt') ??
		(notes.some(Boolean)
			? insertChild(fileDesc, element('notesStmt'), [
					'titleStmt',
					'editionStmt',
					'extent',
					'publicationStmt',
					'seriesStmt',
				])
			: undefined);
	if (!notesStmt) return;
	replaceAppChildren(
		notesStmt,
		node =>
			node.tag === 'note' &&
			(node.attrs?.type === DESCRIPTION_NOTE || node.attrs?.type === TAGS_NOTE),
		notes
	);
	if (!children(notesStmt).length) removeChild(fileDesc, notesStmt);
}

function patchSourceDesc(sourceDesc: TeiElementNode, record: TranscriptionTeiRecord): void {
	patchMsIdentifier(sourceDesc, record);

	const { origin } = record;
	const originBibl = element('bibl', { type: ORIGIN_BIBL, subtype: origin.source_type }, [
		idno(ORIGIN_IDNO.project, origin.source_project_id),
		idno(ORIGIN_IDNO.transcription, origin.source_transcription_id),
		idno(ORIGIN_IDNO.revision, origin.source_revision_id),
		idno(ORIGIN_IDNO.contentHash, origin.source_content_hash),
		origin.source_captured_at === undefined
			? null
			: element('date', { when: origin.source_captured_at ?? undefined }),
	]);
	const isOrigin = (node: TeiElementNode) =>
		node.tag === 'bibl' && node.attrs?.type === ORIGIN_BIBL;
	if (children(sourceDesc).some(isOrigin)) {
		replaceAppChildren(sourceDesc, isOrigin, [originBibl]);
	} else {
		insertChild(sourceDesc, originBibl, ['msDesc', 'bibl']);
	}

	const staleEditions = new Set(referenceEditionBibls(sourceDesc));
	for (const listBibl of children(sourceDesc, 'listBibl')) {
		if (!children(listBibl).some(node => staleEditions.has(node))) continue;
		listBibl.children = (listBibl.children ?? []).filter(
			node => !(node.type === 'element' && staleEditions.has(node))
		);
		if (!children(listBibl).length) removeChild(sourceDesc, listBibl);
	}
	const document = coerceTranscriptionDocument(record.content_json);
	const editionIds = document?.referenceEditionsUsed ?? [];
	if (editionIds.length > 0) {
		appendChild(
			sourceDesc,
			element(
				'listBibl',
				{},
				editionIds.map(id =>
					element(
						'bibl',
						{ type: REFERENCE_EDITION, 'xml:id': id },
						text(document?.referenceEditionAttributions?.[id] ?? '')
					)
				)
			)
		);
	}
}

function patchMsIdentifier(sourceDesc: TeiElementNode, record: TranscriptionTeiRecord): void {
	const fields: Array<[tag: string, value: string, after: string[]]> = [
		['settlement', record.settlement, ['placeName', 'country', 'region']],
		[
			'repository',
			record.repository,
			['placeName', 'country', 'region', 'settlement', 'institution'],
		],
		[
			'idno',
			record.siglum,
			['placeName', 'country', 'region', 'settlement', 'institution', 'repository'],
		],
	];
	let msDesc = child(sourceDesc, 'msDesc');
	if (!msDesc && fields.every(([, value]) => !value)) return;
	msDesc ??= insertChild(sourceDesc, element('msDesc', {}, [element('msIdentifier')]), []);
	const msIdentifier = ensureChild(msDesc, 'msIdentifier', []);
	for (const [tag, value, after] of fields) {
		const existing = child(msIdentifier, tag);
		if (!value) {
			if (existing) removeChild(msIdentifier, existing);
			continue;
		}
		setNormalizedText(existing ?? insertChild(msIdentifier, element(tag), after), value);
	}
}

function patchLanguage(
	header: TeiElementNode,
	language: string,
	bodyLanguage: string | undefined
): void {
	const profileDesc = child(header, 'profileDesc');
	const langUsage = child(profileDesc, 'langUsage');
	const existing = child(langUsage, 'language');
	if (!language) {
		if (existing) removeChild(langUsage!, existing);
		if (langUsage && !children(langUsage).length) removeChild(profileDesc!, langUsage);
		return;
	}
	if (existing) {
		if (existing.attrs?.ident !== language) {
			existing.attrs = { ...existing.attrs, ident: language };
		}
		return;
	}
	if (language === bodyLanguage) return;
	const profile =
		profileDesc ?? insertChild(header, element('profileDesc'), ['fileDesc', 'encodingDesc']);
	const usage = langUsage ?? insertChild(profile, element('langUsage'), ['abstract', 'creation']);
	insertChild(usage, element('language', { ident: language }), []);
}

function patchRevisionDesc(
	header: TeiElementNode,
	record: TranscriptionTeiRecord,
	version: TranscriptionTeiVersion | null
): void {
	const savedAt = record.draft.saved_at;
	const changes = [
		record.created_at ? element('change', { type: 'created', when: record.created_at }) : null,
		savedAt || record.draft.author_name !== null
			? element(
					'change',
					{ type: 'saved', when: savedAt },
					record.draft.author_name === null
						? []
						: [element('name', {}, text(record.draft.author_name))]
				)
			: null,
		record.updated_at !== savedAt
			? element('change', { type: 'updated', when: record.updated_at })
			: null,
		version && versionChange(version),
	];
	const revisionDesc =
		child(header, 'revisionDesc') ??
		(changes.some(Boolean) ? appendChild(header, element('revisionDesc')) : undefined);
	if (!revisionDesc) return;
	revisionDesc.children = [
		...(revisionDesc.children ?? []).filter(
			node => !(node.type === 'element' && isAppChange(node))
		),
		...changes.filter(node => node !== null),
	];
	if (!children(revisionDesc).length) removeChild(header, revisionDesc);
}

function withLanguage(
	attrs: Record<string, string> | undefined,
	language: string
): Record<string, string> | undefined {
	const { 'xml:lang': current, ...rest } = attrs ?? {};
	if (current === language) return attrs;
	if (!language) return Object.keys(rest).length ? rest : undefined;
	return current === undefined
		? { ...rest, 'xml:lang': language }
		: { ...attrs, 'xml:lang': language };
}

function finalizeXml(xml: string): string {
	return `${xml.replace(/\r\n?/g, '\n').replace(/\n+$/, '')}\n`;
}

function nfcDeep(value: unknown): unknown {
	if (typeof value === 'string') return value.normalize('NFC');
	if (Array.isArray(value)) return value.map(nfcDeep);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [key, nfcDeep(child)])
		);
	}
	return value;
}

function isAppChange(node: TeiElementNode): boolean {
	return node.tag === 'change' && APP_CHANGE_TYPES.has(node.attrs?.type ?? '');
}

function isTranscriberResp(node: TeiElementNode): boolean {
	return /transcrib/i.test(normalizedText(child(node, 'resp')));
}

function isOwnerResp(node: TeiElementNode): boolean {
	return normalizedText(child(node, 'resp')) === OWNER_RESP;
}

function findResp(
	titleStmt: TeiElementNode | undefined,
	matches: (node: TeiElementNode) => boolean
): TeiElementNode | undefined {
	return children(titleStmt, 'respStmt').find(matches);
}

function nameText(node: TeiElementNode | undefined): string | undefined {
	const name = child(node, 'name') ?? child(node, 'persName');
	return name ? normalizedText(name) : undefined;
}

function preferredTitle(titleStmt: TeiElementNode | undefined): TeiElementNode | undefined {
	const titles = children(titleStmt, 'title');
	return (
		titles.find(title => title.attrs?.type === 'document') ??
		titles.find(title => !title.attrs?.type) ??
		titles[0]
	);
}

function noteOfType(
	notesStmt: TeiElementNode | undefined,
	type: string
): TeiElementNode | undefined {
	return children(notesStmt, 'note').find(note => note.attrs?.type === type);
}

function referenceEditionBibls(sourceDesc: TeiElementNode | undefined): TeiElementNode[] {
	return children(sourceDesc, 'listBibl').flatMap(listBibl =>
		children(listBibl, 'bibl').filter(bibl => bibl.attrs?.type === REFERENCE_EDITION)
	);
}

function idnoText(node: TeiElementNode | undefined, type: string): string | undefined {
	const match = children(node, 'idno').find(idnoNode => idnoNode.attrs?.type === type);
	return match ? textContent(match) : undefined;
}

function idno(type: string, value: string | null | undefined): TeiElementNode | null {
	return value == null ? null : element('idno', { type }, text(value));
}

// Keeps app-owned children at the position of the first one found so that rewrites are stable.
function replaceAppChildren(
	parent: TeiElementNode,
	isAppChild: (node: TeiElementNode) => boolean,
	replacements: Array<TeiElementNode | null>
): void {
	const nodes = parent.children ?? [];
	const firstIndex = nodes.findIndex(node => node.type === 'element' && isAppChild(node));
	const kept = nodes.filter(node => !(node.type === 'element' && isAppChild(node)));
	const fresh = replacements.filter(node => node !== null);
	const insertAt = firstIndex === -1 ? kept.length : firstIndex;
	parent.children = [...kept.slice(0, insertAt), ...fresh, ...kept.slice(insertAt)];
}

function setNormalizedText(node: TeiElementNode, value: string): void {
	if (normalizedText(node) === value) return;
	node.children = text(value);
}

function normalizedText(node: TeiElementNode | undefined): string {
	return textContent(node).replace(/\s+/g, ' ').trim();
}

function textContent(node: TeiNode | undefined): string {
	if (!node) return '';
	if (node.type === 'text') return node.text;
	return (node.children ?? []).map(textContent).join('');
}

function element(
	tag: string,
	attrs: Record<string, string | undefined> = {},
	nodeChildren: Array<TeiNode | null> = []
): TeiElementNode {
	const definedAttrs = Object.fromEntries(
		Object.entries(attrs).filter((entry): entry is [string, string] => Boolean(entry[1]))
	);
	const kids = nodeChildren.filter(node => node !== null);
	return {
		type: 'element',
		tag,
		...(Object.keys(definedAttrs).length ? { attrs: definedAttrs } : {}),
		...(kids.length ? { children: kids } : {}),
	};
}

function text(value: string): TeiNode[] {
	return value ? [{ type: 'text', text: value }] : [];
}

function children(node: TeiElementNode | undefined, tag?: string): TeiElementNode[] {
	return (node?.children ?? []).filter(
		(entry): entry is TeiElementNode =>
			entry.type === 'element' && (tag === undefined || entry.tag === tag)
	);
}

function child(node: TeiElementNode | undefined, tag: string): TeiElementNode | undefined {
	return children(node, tag)[0];
}

function ensureChild(parent: TeiElementNode, tag: string, after: string[]): TeiElementNode {
	return child(parent, tag) ?? insertChild(parent, element(tag), after);
}

function appendChild(parent: TeiElementNode, node: TeiElementNode): TeiElementNode {
	parent.children = [...(parent.children ?? []), node];
	return node;
}

// Inserts after the last child named in `after` ('*' means any element), else first.
function insertChild(
	parent: TeiElementNode,
	node: TeiElementNode,
	after: string[]
): TeiElementNode {
	const nodes = parent.children ?? [];
	let index = 0;
	nodes.forEach((entry, position) => {
		if (entry.type === 'element' && (after.includes('*') || after.includes(entry.tag))) {
			index = position + 1;
		}
	});
	parent.children = [...nodes.slice(0, index), node, ...nodes.slice(index)];
	return node;
}

function removeChild(parent: TeiElementNode, node: TeiElementNode): void {
	parent.children = (parent.children ?? []).filter(entry => entry !== node);
}
