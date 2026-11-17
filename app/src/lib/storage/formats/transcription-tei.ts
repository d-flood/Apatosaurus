import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import {
	isWholeWordWrapperTag,
	parseElementTree,
	parseTei,
	serializeTei,
	serializeTeiNode,
	type TeiElementNode,
	type InlineItem,
	type LineItem,
	type TeiNode,
	type TextMark,
	type TranscriptionDocument,
	type TranscriptionLine,
	type TranscriptionPage,
} from '@apatosaurus/tei-transcription';

import { hashContent } from '$lib/storage/content-hash';
import { teiContentHash } from '$lib/storage/tei-content';
import {
	coerceTranscriptionDocument,
	type StoredTranscriptionDocument,
} from '$lib/transcription/content';

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
	return withHashes(finalizeXml(serializeTei(teiDocument(record, version, false))));
}

/**
 * Also returns the record that parsing the written XML yields: pages as written, the rest from
 * parsing a page-less copy. `contentCoerced` skips coercing content that already was.
 */
export async function serializeTranscriptionTeiWithRecord(
	record: TranscriptionTeiRecord,
	{ contentCoerced = false } = {}
): Promise<SerializedTranscriptionTei & { record: TranscriptionTeiRecord }> {
	const document = teiDocument(record, null, contentCoerced);
	const xml = finalizeXml(serializeTei(document));
	const shell = withXmlDom(() => parseTei(finalizeXml(serializeTei({ ...document, pages: [] }))));
	const { document: parsed, iiif } = splitTranscriptionTeiIiif({
		...shell,
		pages: asParsedPages(document.pages),
	});
	return { ...(await withHashes(xml)), record: transcriptionRecordFromTei(parsed, iiif) };
}

const FRAME_ZONES = new Set(['top', 'left', 'center', 'right', 'bottom']);

// Adds what the parser derives from serialized pb, cb, lb and milestones, which pages the editor
// built lack. Mirrors pageBreakXml, columnBreakXml, lineBreakXml and the div and ab labels.
function asParsedPages(pages: TranscriptionPage[]): TranscriptionPage[] {
	const correctionLeads: CorrectionLeads = new WeakMap();
	const parsedLines = parsedLineItems(
		pages.flatMap(page => page.columns.flatMap(column => column.lines)),
		correctionLeads
	);
	let nextLine = 0;
	let book = '';
	// The parser drops empty lines but keeps their hang for the next line with content, and the wrap
	// their <lb> took inside a word for the next line in the column.
	let carriedHang = false;
	let carriedWrap = false;
	// Book and chapter milestones open their <div> only before the next content, where they parse.
	let pendingDivs: LineItem[] = [];
	// Lists each line's items for correction spans, with an empty entry where an empty line writes
	// its own break.
	const written: LineItem[][] = [];
	const parsedPages = pages.map(page => {
		const pageAttrs = parsedAttrs(page.teiAttrs, {
			'xml:id': page.pageId || page.teiAttrs?.['xml:id'] || page.id,
			n: page.teiAttrs?.n || page.id || '',
			type: page.teiAttrs ? page.teiAttrs.type : 'folio',
			break: page.wrapped ? 'no' : undefined,
		});
		let previousColumn = 0;
		const columns = page.columns.map((column, columnIndex) => {
			let wrapImplied = columnIndex === 0 && Boolean(page.wrapped);
			const columnAttrs = parsedAttrs(column.teiAttrs, {
				n: column.teiAttrs?.n,
				break: column.wrapped && !wrapImplied ? 'no' : undefined,
				type: column.zone ? 'frame' : undefined,
				subtype: column.zone || undefined,
			});
			const match = columnAttrs?.n?.match(/C(\d+)/);
			const number = match ? parseInt(match[1], 10) : previousColumn + 1;
			previousColumn = number;
			if (columnAttrs?.type === 'frame' && FRAME_ZONES.has(columnAttrs.subtype ?? '')) {
				delete columnAttrs.type;
				delete columnAttrs.subtype;
			}
			wrapImplied ||= Boolean(column.wrapped);
			const lines: TranscriptionLine[] = [];
			column.lines.forEach((line, lineIndex) => {
				const lineAttrs = parsedAttrs(line.teiAttrs, {
					break:
						line.wrapped && !(lineIndex === 0 && wrapImplied) && !line.teiAttrs
							? 'no'
							: undefined,
					rend: line.paragraphStart ? line.teiAttrs?.rend || 'hang' : undefined,
				});
				const { items: lineItems, wraps } = parsedLines[nextLine++];
				const own = lineItems.map(item => {
					if (item.type === 'teiAtom' && item.text === '') {
						const { text: _text, ...rest } = item;
						return rest;
					}
					if (item.type !== 'milestone') return item;
					const label = item.sourceLabel ?? milestoneLabel(item.kind, item.attrs, book);
					if (item.kind === 'book') book = item.attrs.book || '';
					return item.sourceLabel === undefined && label
						? { ...item, sourceLabel: label }
						: item;
				});
				if (lineIndex === 0) carriedWrap = false;
				const hangs = lineAttrs?.rend === 'hang';
				const items = pendingDivs.length > 0 ? [...pendingDivs, ...own] : own;
				let end = items.length;
				while (end > 0 && isDivMilestone(items[end - 1])) end -= 1;
				pendingDivs = end < items.length ? items.splice(end) : [];
				if (items[items.length - 1]?.type === 'boundary') items.pop();
				if (items.length === 0) {
					carriedHang ||= hangs;
					carriedWrap ||= wraps;
					if (!wraps) written.push(items);
					return;
				}
				written.push(items);
				const {
					type,
					number: _n,
					wrapped: _w,
					paragraphStart: _p,
					teiAttrs: _a,
					items: _i,
					...rest
				} = line;
				lines.push({
					type,
					number: lines.length + 1,
					wrapped: wraps || carriedWrap || undefined,
					paragraphStart: hangs || carriedHang || undefined,
					teiAttrs: lineAttrs,
					items,
					...rest,
				});
				carriedHang = carriedWrap = false;
			});
			const { type, number: _n, wrapped, zone, teiAttrs: _a, lines: _l, ...rest } = column;
			const teiAttrs = Object.keys(columnAttrs ?? {}).length ? columnAttrs : undefined;
			return {
				type,
				number,
				wrapped,
				zone,
				teiAttrs,
				lines: lines.length ? lines : [{ type: 'line' as const, number: 1, items: [] }],
				...rest,
			};
		});
		const { type, id: _i, pageId: _p, wrapped, teiAttrs: _a, columns: _c, ...rest } = page;
		return {
			type,
			id: pageAttrs?.n || '',
			pageId: pageAttrs?.['xml:id'] || undefined,
			wrapped,
			teiAttrs: pageAttrs,
			columns,
			...rest,
		};
	});
	withParsedCorrectionOrder(written, correctionLeads);
	return parsedPages;
}

// A wrapped line's breaks go inside the <w> that ends the line before it, which then spans both
// lines. `wraps` tells whether a line's break went there.
function parsedLineItems(
	lines: TranscriptionLine[],
	correctionLeads: CorrectionLeads
): Array<{ items: LineItem[]; wraps: boolean }> {
	const stream: LineItem[] = [];
	const wraps: boolean[] = [];
	let endsInWord = false;
	for (const line of lines) {
		const wrapped: boolean = Boolean(line.wrapped) && endsInWord;
		if (wraps.length > 0) stream.push(wrapped ? LINE_BREAK : LINE_END);
		for (const item of line.items) stream.push(item);
		wraps.push(wrapped);
		const last = line.items.findLast(item => item.type !== 'boundary');
		endsInWord = last ? isWordPart(last) : wrapped;
	}
	return parsedItems(stream, correctionLeads).map((items, index) => ({
		items,
		wraps: wraps[index],
	}));
}

// Separate lines in the stream: a break inside a word, or the end of a line's words.
const LINE_BREAK = { type: 'lineBreak' } as unknown as LineItem;
const LINE_END = { type: 'lineEnd' } as unknown as LineItem;

// Mirrors groupIntoWords and exportWord. The parser records a boundary only after a </w>, so one
// precedes an element written between words and none follows a <pc>; it takes word marks from <w>
// and whole-word wrappers from around it.
function parsedItems(items: LineItem[], correctionLeads: CorrectionLeads): LineItem[][] {
	let line: LineItem[] = [];
	const lines = [line];
	let word: LineItem[] = [];
	const push = (item: LineItem) => {
		if (item === LINE_BREAK || item === LINE_END) {
			lines.push((line = []));
			return;
		}
		const previous = line[line.length - 1];
		if (item.type === 'boundary' && (!previous || previous.type === 'boundary')) return;
		if (item.type !== 'text' || previous?.type !== 'text' || !sameMarks(previous, item)) {
			line.push(item);
			return;
		}
		const merged = { ...previous, text: previous.text + item.text };
		if (correctionLeads.has(previous) || correctionLeads.has(item))
			correctionLeads.set(merged, [
				...leadsOf(previous, correctionLeads),
				...leadsOf(item, correctionLeads),
			]);
		line[line.length - 1] = merged;
	};
	// Consecutive words with the same whole-word wrapper share one wrapper element.
	let sequence: TextMark | undefined;
	// `closed` is true at a boundary, false at another element and unset at a line end, which a word
	// spanning lines keeps.
	const close = (closed?: boolean) => {
		if (word.length === 0) return;
		if (word.includes(LINE_BREAK)) closed = undefined;
		const own = wholeWordWrapper(word);
		const punctuationOnly = word.every(isPunctuationText);
		const wrapper =
			sequence && own && sameMark(own, sequence)
				? sequence
				: punctuationOnly
					? undefined
					: own;
		sequence = wrapper;
		// A wrapped word that is not closed, or only punctuation, has no <w>.
		const bare = wrapper !== undefined && (closed === false || punctuationOnly);
		// One <app> holds the whole word, under its first correction.
		const correction = wrapper ? undefined : firstMark(word, isCorrection);
		const runs = punctuationRuns(word);
		runs.forEach((run, index) => {
			const inWord = !bare && !isPunctuationText(run[0]);
			const wordMark = inWord ? firstMark(run, mark => mark.type === 'word') : undefined;
			// exportWord wraps each run of word text on its own.
			const runWrapper = wrapper ?? (inWord ? wholeWordWrapper(run) : undefined);
			const lead: TextMark[] = runWrapper ? [runWrapper] : [];
			if (wordMark && Object.keys(wordMark.attrs ?? {}).length > 0) lead.push(wordMark);
			for (const item of run) {
				const marked = withLeadMarks(item, lead);
				if (!correction) push(marked);
				else {
					const corrected = withCorrection(marked, correction);
					correctionLeads.set(corrected, leadsBefore(markList(item)));
					push(corrected);
				}
			}
			// A <pc> after it joins the word and drops the boundary, except inside a wrapper.
			if (inWord && (wrapper || index === runs.length - 1)) push(WORD_BOUNDARY);
		});
		word = [];
	};
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index];
		const next = items[index + 1];
		const previous = word[word.length - 1];
		// The serializer groups each line on its own, so a gap starting a line joins no word before it.
		const joins =
			item.type === 'gap'
				? (previous !== undefined && previous !== LINE_BREAK) ||
					next?.type === 'boundary' ||
					next === LINE_BREAK
				: item === LINE_BREAK || isWordPart(item);
		if (item === LINE_END) {
			close();
			sequence = undefined;
			push(item);
		} else if (item.type === 'boundary') close(true);
		// A wrapped line takes in a gap that ends the line before it as a word of its own.
		else if (item.type === 'gap' && previous === LINE_BREAK && next === LINE_BREAK) {
			close();
			word.push(item);
		} else if (joins) {
			if (item.type === 'text' && previous?.type === 'text' && splitsWord(previous, item))
				close(false);
			word.push(item);
		} else {
			close(false);
			sequence = undefined;
			push(item);
		}
	}
	close();
	for (const items of lines) if (items[items.length - 1]?.type === 'boundary') items.pop();
	return lines;
}

const WORD_BOUNDARY: LineItem = { type: 'boundary', kind: 'word' };

const isDivMilestone = (item: LineItem) => item.type === 'milestone' && item.kind !== 'verse';

function isWordPart(item: LineItem): boolean {
	if (item.type === 'text' || item.type === 'gap') return true;
	return (
		(item.type === 'metamark' || item.type === 'teiAtom' || item.type === 'teiWrapper') &&
		Boolean(item.wordInline)
	);
}

function splitsWord(previous: TextItem, item: TextItem): boolean {
	const correction = (entry: TextItem) => entry.marks?.find(isCorrection);
	const wrappers = (entry: TextItem) => entry.marks?.filter(isWholeWordWrapper) ?? [];
	const [a, b] = [correction(previous), correction(item)];
	return (
		(isPunctuationText(previous) !== isPunctuationText(item) &&
			(a && b ? !sameMark(a, b) : a !== b)) ||
		!sameMarkList(wrappers(previous), wrappers(item))
	);
}

function wholeWordWrapper(word: LineItem[]): TextMark | undefined {
	let wrapper: TextMark | undefined;
	for (const item of word) {
		if (item.type !== 'text' || !item.text) continue;
		if (!wrapper) wrapper = item.marks?.find(isWholeWordWrapper);
		if (!wrapper || !item.marks?.some(mark => sameMark(mark, wrapper!))) return undefined;
	}
	return wrapper;
}

function firstMark(items: LineItem[], matches: (mark: TextMark) => boolean) {
	for (const item of items) {
		const mark = markList(item).find(matches);
		if (mark) return mark;
	}
}

function punctuationRuns(word: LineItem[]): LineItem[][] {
	if (!word.some(isPunctuationText)) return [word];
	const runs: LineItem[][] = [];
	for (const item of word) {
		const run = runs[runs.length - 1];
		if (run && isPunctuationText(run[0]) === isPunctuationText(item)) run.push(item);
		else runs.push([item]);
	}
	return runs;
}

// Puts the wrapper and <w> marks first and drops other word marks, which <pc> and bare wrapper
// content lose.
function withLeadMarks(item: LineItem, lead: TextMark[]): LineItem {
	if (item.type !== 'text' && item.type !== 'gap') return item;
	const own = markList(item);
	if (lead.length === 0 && !own.some(mark => mark.type === 'word')) return item;
	const marks = [
		...lead,
		...own.filter(mark => mark.type !== 'word' && !lead.some(other => sameMark(mark, other))),
	];
	if (sameMarkList(marks, own)) return item;
	if (item.type === 'text') return { ...item, marks };
	const { marks: _marks, ...gap } = item;
	return marks.length ? { ...gap, marks } : gap;
}

function withCorrection(item: LineItem, correction: TextMark): LineItem {
	if (item.type !== 'text' && item.type !== 'gap') return item;
	const own = markList(item).find(isCorrection);
	if (own && sameMark(own, correction)) return item;
	const marks = own
		? markList(item).map(mark => (mark === own ? correction : mark))
		: [...markList(item), correction];
	return { ...item, marks };
}

// outerCorrectionMarks reads the marks each source node had before its correction, and none from a
// node that only takes its word's correction.
type CorrectionLeads = WeakMap<object, TextMark[][]>;

function leadsBefore(marks: TextMark[]): TextMark[][] {
	const index = marks.findIndex(isCorrection);
	return index < 0 ? [] : [marks.slice(0, index)];
}

const leadsOf = (item: MarkedItem, correctionLeads: CorrectionLeads) =>
	correctionLeads.get(item) ?? leadsBefore(item.marks ?? []);

const NO_MARKS: TextMark[] = [];

const markList = (item: LineItem): TextMark[] => ('marks' in item && item.marks) || NO_MARKS;

const sameMark = (a: TextMark, b: TextMark) =>
	a === b || (a.type === b.type && JSON.stringify(a.attrs) === JSON.stringify(b.attrs));

const sameMarkList = (a: TextMark[], b: TextMark[]) =>
	a.length === b.length && a.every((mark, index) => sameMark(mark, b[index]));

type TextItem = Extract<LineItem, { type: 'text' }>;

const isPunctuationText = (item: LineItem) =>
	item.type === 'text' && Boolean(item.marks?.some(mark => mark.type === 'punctuation'));

const isWholeWordWrapper = (mark: TextMark) =>
	mark.type === 'teiSpan' && isWholeWordWrapperTag(mark.attrs.tag);

const sameMarks = (a: TextItem, b: TextItem) => sameMarkList(a.marks ?? [], b.marks ?? []);

type MarkedItem = { marks?: TextMark[] };

// Mirrors outerCorrectionMarks: marks every node of an <app> span shares before its correction wrap
// the <app>, so they parse before the correction and the rest after it. A span crosses one line
// break but not the two around an empty line.
function withParsedCorrectionOrder(lines: LineItem[][], correctionLeads: CorrectionLeads): void {
	let span: Array<{ items: MarkedItem[]; index: number }> = [];
	let signature: string | null = null;
	const close = () => {
		reorderCorrectionSpan(span, correctionLeads);
		span = [];
		signature = null;
	};
	for (const items of lines) {
		if (items.length === 0) close();
		items.forEach((item, index) => {
			if (item.type === 'boundary') return;
			const correction = (item as MarkedItem).marks?.find(isCorrection);
			const next = correction ? JSON.stringify(correction.attrs ?? {}) : null;
			if (next === null || next !== signature) close();
			if (next === null) return;
			signature = next;
			span.push({ items: items as MarkedItem[], index });
		});
	}
	close();
}

function reorderCorrectionSpan(
	span: Array<{ items: MarkedItem[]; index: number }>,
	correctionLeads: CorrectionLeads
): void {
	if (span.length === 0) return;
	const marksOf = ({ items, index }: (typeof span)[number]) => items[index].marks!;
	const leads = span.flatMap(({ items, index }) => leadsOf(items[index], correctionLeads));
	const key = (mark: TextMark) => JSON.stringify(mark);
	const outer = (leads[0] ?? [])
		.map(key)
		.filter(mark => leads.every(lead => lead.some(other => key(other) === mark)));
	const outerMarks = outer.map(mark => leads[0].find(candidate => key(candidate) === mark)!);
	const wrapped = (marks: TextMark[] = []) => [
		...outerMarks,
		...marks.filter(mark => !outer.includes(key(mark))),
	];
	for (const entry of span) {
		const marks = marksOf(entry);
		const correction = marks.find(isCorrection) as Extract<TextMark, { type: 'correction' }>;
		const readings =
			outer.length === 0
				? correction.attrs.corrections
				: correction.attrs.corrections.map(reading => ({
						...reading,
						content: mergeTexts(
							reading.content.map(item =>
								item.type === 'text'
									? { ...item, marks: wrapped(item.marks) }
									: item
							)
						),
					}));
		entry.items[entry.index] = {
			...entry.items[entry.index],
			marks: [
				...outerMarks,
				{ ...correction, attrs: { ...correction.attrs, corrections: readings } },
				...marks.filter(mark => !isCorrection(mark) && !outer.includes(key(mark))),
			],
		};
	}
}

const isCorrection = (mark: TextMark) => mark.type === 'correction';

function mergeTexts(items: InlineItem[]): InlineItem[] {
	const merged: InlineItem[] = [];
	for (const item of items) {
		const previous = merged.at(-1);
		if (
			item.type === 'text' &&
			previous?.type === 'text' &&
			JSON.stringify(previous.marks ?? []) === JSON.stringify(item.marks ?? [])
		)
			merged[merged.length - 1] = { ...previous, text: previous.text + item.text };
		else merged.push(item);
	}
	return merged;
}

function milestoneLabel(
	kind: 'book' | 'chapter' | 'verse',
	attrs: Record<string, string>,
	book: string
): string {
	if (kind === 'book') return attrs.book || '';
	if (kind === 'verse')
		return attrs.chapter && attrs.verse ? `${attrs.chapter}.${attrs.verse}` : attrs.verse || '';
	const chapter = attrs.chapter || '';
	return book && chapter && !chapter.startsWith(`${book}.`) ? `${book}.${chapter}` : chapter;
}

function parsedAttrs(
	attrs: Record<string, string> | undefined,
	overrides: Record<string, string | undefined>
): Record<string, string> | undefined {
	const merged: Record<string, string | undefined> = { ...attrs };
	for (const [key, value] of Object.entries(overrides))
		if (value !== undefined) merged[key] = value;
	const kept = Object.entries(merged).filter((entry): entry is [string, string] =>
		Boolean(entry[1])
	);
	return kept.length ? Object.fromEntries(kept) : undefined;
}

function teiDocument(
	record: TranscriptionTeiRecord,
	version: TranscriptionTeiVersion | null,
	contentCoerced: boolean
): TranscriptionDocument {
	const normalized = nfcDeep(record) as TranscriptionTeiRecord;
	const document =
		contentCoerced && normalized.content_json === record.content_json
			? (record.content_json as unknown as StoredTranscriptionDocument)
			: coerceTranscriptionDocument(structuredClone(normalized.content_json));
	if (!document) {
		throw new Error(
			`Project transcription ${record.project_transcription_id} has invalid content.`
		);
	}
	const header = buildHeader(
		document,
		normalized,
		version && (nfcDeep(version) as TranscriptionTeiVersion)
	);
	return {
		...document,
		pages: withIiifPageFacs(withPageIds(document.pages), normalized.page_canvas_links),
		teiHeader: header,
		textAttrs: withLanguage(document.textAttrs, normalized.language),
		resourceNodes: [...nonAppResources(document), ...buildIiifNodes(normalized)],
		facsimile: undefined,
		sourceDoc: undefined,
		standOff: undefined,
	};
}

async function withHashes(xml: string): Promise<SerializedTranscriptionTei> {
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
	const { document, iiif } = splitTranscriptionTeiIiif(withXmlDom(() => parseTei(xml)));
	const record = transcriptionRecordFromTei(document, iiif);
	return { ...record, content_json: JSON.parse(JSON.stringify(record.content_json)) };
}

function transcriptionRecordFromTei(
	parsed: TranscriptionDocument,
	iiif: TranscriptionIiif
): TranscriptionTeiRecord {
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
		content_json: document as unknown as JsonValue,
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
	document: StoredTranscriptionDocument,
	record: TranscriptionTeiRecord,
	version: TranscriptionTeiVersion | null
): TeiElementNode {
	const header = document.teiHeader
		? (structuredClone(document.teiHeader) as TeiElementNode)
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
	patchSourceDesc(ensureChild(fileDesc, 'sourceDesc', ['*']), record, document);
	patchLanguage(header, record.language, document.textAttrs?.['xml:lang']);
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

function patchSourceDesc(
	sourceDesc: TeiElementNode,
	record: TranscriptionTeiRecord,
	document: StoredTranscriptionDocument
): void {
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
	const editionIds = document.referenceEditionsUsed ?? [];
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
						text(document.referenceEditionAttributions?.[id] ?? '')
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

// eslint-disable-next-line no-control-regex
const ASCII = /^[\x00-\x7f]*$/;

// Returns the input itself when nothing changes, so the save path skips copying a large document.
function nfcDeep(value: unknown): unknown {
	if (typeof value === 'string') return ASCII.test(value) ? value : value.normalize('NFC');
	if (!value || typeof value !== 'object') return value;
	let copy: Record<string, unknown> | unknown[] | null = null;
	for (const key of Object.keys(value)) {
		const child = (value as Record<string, unknown>)[key];
		const next = nfcDeep(child);
		if (next === child) continue;
		copy ??= Array.isArray(value) ? [...value] : { ...value };
		(copy as Record<string, unknown>)[key] = next;
	}
	return copy ?? value;
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
