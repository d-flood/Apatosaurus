import { createStructuredFormWorkContent, flattenStructuredFormWorkContent } from './formwork-pm';
import { toProseMirror } from './pm-adapter';
import { serializeEditorialActionStructure } from './tei-editorial';
import { generateTeiHeaderXml } from './tei-header-serializer';
import { isWholeWordWrapperTag } from './tei-inline';
import { serializeTeiNode, serializeTeiNodes } from './tei-tree';
import type {
	InlineItem,
	ProseMirrorJSON,
	TeiElementNode,
	TeiMetadata,
	TextMark,
	TranscriptionDocument,
} from './types';

interface ExportContext {
	xml: string[];
	currentVerse?: string;
	currentBook?: string;
	currentChapter?: string;
	currentBookSourceLabel?: string;
	currentChapterSourceLabel?: string;
	insideVerse: boolean;
	anonymousAbOpen: boolean;
	bookDivOpen: boolean;
	chapterDivOpen: boolean;
}

interface WordGroup {
	type:
		| 'word'
		| 'verse'
		| 'gap'
		| 'space'
		| 'handShift'
		| 'metamark'
		| 'teiAtom'
		| 'teiMilestone'
		| 'editorialAction'
		| 'book'
		| 'chapter'
		| 'untranscribed'
		| 'correctionNode'
		| 'fw'
		| 'teiWrapper'
		| 'pageBreak'
		| 'lineBreak'
		| 'columnBreak'
		| 'breaks';
	content?: ProseMirrorJSON[];
	attrs?: Record<string, any>;
	node?: ProseMirrorJSON;
	// False when another element follows the word with no boundary, so the source had no </w>.
	closed?: boolean;
}

export function serializeTei(document: TranscriptionDocument, metadata?: TeiMetadata): string {
	const pmJSON = toProseMirror(document);
	return serializeProseMirrorToTei(pmJSON, metadata, document);
}

export function serializeProseMirrorToTei(
	pmJSON: ProseMirrorJSON,
	metadata?: TeiMetadata,
	document?: TranscriptionDocument
): string {
	const context: ExportContext = {
		xml: [],
		insideVerse: false,
		anonymousAbOpen: false,
		bookDivOpen: false,
		chapterDivOpen: false,
	};

	context.xml.push('<?xml version="1.0" encoding="UTF-8"?>', createTeiRootOpenTag(document));

	generateHeader(context, metadata, document);
	if (document?.resourceNodes && document.resourceNodes.length > 0) {
		pushStructuredSections(context, document.resourceNodes.map(serializeTeiNode));
	} else {
		pushStructuredSections(context, serializeTeiNodes(document?.facsimile));
		pushStructuredSections(context, serializeTeiNodes(document?.sourceDoc));
		pushStructuredSections(context, serializeTeiNodes(document?.standOff));
	}
	context.xml.push(`<text${serializeAttrs(document?.textAttrs || {})}>`);
	pushStructuredSections(context, serializeTeiNodes(document?.textLeading));
	if (document?.front) {
		context.xml.push(serializeTeiNode(document.front));
	}
	pushStructuredSections(context, serializeTeiNodes(document?.textBetweenFrontBody));
	context.xml.push(`<body${serializeAttrs(document?.bodyAttrs || {})}>`);

	if (pmJSON.type === 'manuscript' && pmJSON.content) {
		exportBody(pmJSON.content, context);
	}

	closeAllDivs(context);
	context.xml.push('</body>');
	pushStructuredSections(context, serializeTeiNodes(document?.textBetweenBodyBack));
	if (document?.back) {
		context.xml.push(serializeTeiNode(document.back));
	}
	pushStructuredSections(context, serializeTeiNodes(document?.textTrailing));
	context.xml.push('</text>');
	pushStructuredSections(context, serializeTeiNodes(document?.nestedTei));
	context.xml.push('</TEI>');
	return context.xml.join('\n');
}

function generateHeader(
	context: ExportContext,
	metadata?: TeiMetadata,
	document?: TranscriptionDocument
): void {
	context.xml.push(generateTeiHeaderXml(metadata, document, { serializeAttrs, escapeXml }));
}

interface BodyLine {
	breaks: string[];
	wrapped: boolean;
	content: ProseMirrorJSON[];
}

function collectBodyLines(nodes: ProseMirrorJSON[] | undefined): BodyLine[] {
	const lines: BodyLine[] = [];
	let breaks: string[] = [];
	// A wrapped page or column break already wraps the lines that follow it.
	let wrapImplied = false;
	const visit = (node: ProseMirrorJSON) => {
		if (node.type === 'line') {
			breaks.push(lineBreakXml(node, wrapImplied));
			lines.push({ breaks, wrapped: Boolean(node.attrs?.wrapped), content: node.content ?? [] });
			breaks = [];
			wrapImplied = false;
			return;
		}
		if (node.type === 'page') {
			breaks.push(pageBreakXml(node));
			wrapImplied = Boolean(node.attrs?.wrapped);
		}
		if (node.type === 'column') {
			breaks.push(columnBreakXml(node, wrapImplied));
			wrapImplied ||= Boolean(node.attrs?.wrapped);
		}
		for (const child of node.content ?? []) visit(child);
	};
	for (const node of nodes ?? []) visit(node);
	if (breaks.length > 0) lines.push({ breaks, wrapped: false, content: [] });
	return lines;
}

// A word broken across a line, column or page break stays one <w> with the breaks inside it.
function exportBody(nodes: ProseMirrorJSON[] | undefined, context: ExportContext): void {
	const groups: WordGroup[] = [];
	for (const line of collectBodyLines(nodes)) {
		const words = groupIntoWords(line.content);
		const last = groups[groups.length - 1];
		const previous =
			line.wrapped && last?.type === 'gap' && last.node
				? (groups[groups.length - 1] = { type: 'word', content: [last.node] })
				: last;
		const first = words[0];
		if (line.wrapped && previous?.type === 'word') {
			const continues = first?.type === 'word';
			previous.content = [
				...(previous.content ?? []),
				structuralBreak(line.breaks.join(''), true),
				...(continues ? (first.content ?? []) : []),
			];
			groups.push(...(continues ? words.slice(1) : words));
			continue;
		}
		groups.push({ type: 'breaks', attrs: { xml: line.breaks.join('\n') } }, ...words);
	}
	exportWordGroups(groups, context);
}

function structuralBreak(xml: string, inWord: boolean): ProseMirrorJSON {
	return { type: 'structuralBreak', attrs: { xml, inWord } };
}

function pageBreakXml(node: ProseMirrorJSON): string {
	return `<pb${serializeAttrs(
		mergeTeiAttrs(node.attrs, {
			'xml:id': node.attrs?.pageId || node.attrs?.teiAttrs?.['xml:id'],
			n: node.attrs?.teiAttrs?.n || node.attrs?.pageName || '',
			type: node.attrs?.teiAttrs ? node.attrs.teiAttrs.type : 'folio',
			break: node.attrs?.wrapped ? 'no' : undefined,
		})
	)}/>`;
}

function columnBreakXml(node: ProseMirrorJSON, wrapImplied: boolean): string {
	return `<cb${serializeAttrs(
		mergeTeiAttrs(node.attrs, {
			n: node.attrs?.teiAttrs?.n,
			break: node.attrs?.wrapped && !wrapImplied ? 'no' : undefined,
			type: node.attrs?.zone ? 'frame' : undefined,
			subtype: node.attrs?.zone || undefined,
		})
	)}/>`;
}

// Parsed lines keep the source's own break attribute; an <lb> inside <w> wraps without one.
function lineBreakXml(node: ProseMirrorJSON, wrapImplied: boolean): string {
	return `<lb${serializeAttrs(
		mergeTeiAttrs(node.attrs, {
			break: node.attrs?.wrapped && !wrapImplied && !node.attrs?.teiAttrs ? 'no' : undefined,
			rend: node.attrs?.['paragraph-start'] ? node.attrs?.teiAttrs?.rend || 'hang' : undefined,
		})
	)}/>`;
}

function exportWordGroups(words: WordGroup[], context: ExportContext): void {
	for (let index = 0; index < words.length; index += 1) {
		const word = words[index];
		if (word.type === 'verse') {
			closeAnonymousAb(context);
			const verseId = getSourceLabel(word.attrs) ?? buildVerseId(word.attrs);
			closeVerse(context);
			openVerse(context, verseId);
			continue;
		}

		if (word.type === 'book') {
			closeAllDivs(context);
			context.currentBook = word.attrs?.book || '';
			context.currentBookSourceLabel = getSourceLabel(word.attrs);
			continue;
		}

		if (word.type === 'chapter') {
			closeChapterDiv(context);
			context.currentChapter = word.attrs?.chapter || '';
			context.currentChapterSourceLabel = getSourceLabel(word.attrs);
			continue;
		}

		if (word.type === 'breaks') {
			context.xml.push(word.attrs?.xml ?? '');
			continue;
		}

		const correctionMark = findGroupCorrectionMark(word);
		if (correctionMark) {
			const correctedGroups = [word];
			index = collectCorrectedGroups(words, index, correctionMark, correctedGroups);
			ensureAnonymousAb(context);
			exportCorrection(correctedGroups, correctionMark, context);
			continue;
		}

		if (word.type === 'gap') {
			ensureAnonymousAb(context);
			const attrs = word.attrs || {};
			context.xml.push(
				`<gap${serializeAttrs(
					mergeCarrierAttrs(attrs, {
						reason: attrs.reason,
						unit: attrs.unit,
						extent: attrs.extent,
					})
				)}/>`
			);
			continue;
		}

		if (word.type === 'space') {
			ensureAnonymousAb(context);
			context.xml.push(`<space${serializeAttrs(extractTeiAttrs(word.attrs))}/>`);
			continue;
		}

		if (word.type === 'handShift') {
			ensureAnonymousAb(context);
			context.xml.push(`<handShift${serializeAttrs(extractTeiAttrs(word.attrs))}/>`);
			continue;
		}

		if (word.type === 'metamark') {
			ensureAnonymousAb(context);
			context.xml.push(serializeMetamarkAttrs(extractTeiAttrs(word.attrs)));
			continue;
		}

		if (word.type === 'teiAtom') {
			ensureAnonymousAb(context);
			context.xml.push(serializeStructuredAtom(word.attrs || {}, word.node?.marks));
			continue;
		}

		if (word.type === 'teiMilestone') {
			ensureAnonymousAb(context);
			context.xml.push(`<milestone${serializeAttrs(extractTeiAttrs(word.attrs))}/>`);
			continue;
		}

		if (word.type === 'editorialAction') {
			ensureAnonymousAb(context);
			const structure = word.attrs?.structure;
			if (structure && typeof structure === 'object') {
				context.xml.push(serializeEditorialActionStructure(structure));
			} else {
				throw new Error('Editorial action is missing structured data');
			}
			continue;
		}

		if (word.type === 'untranscribed') {
			ensureAnonymousAb(context);
			const attrs = word.attrs || {};
			context.xml.push(
				`<note${serializeAttrs(
					mergeCarrierAttrs(attrs, {
						type: 'untranscribed',
						subtype: attrs.reason || 'Untranscribed',
						n: attrs.extent || 'partial',
					})
				)}/>`
			);
			continue;
		}

		if (word.type === 'correctionNode') {
			ensureAnonymousAb(context);
			exportCorrectionNode(word.attrs || {}, context);
			continue;
		}

		const segmentWrapper = getWordGroupSegmentWrapper(word);
		if (segmentWrapper) {
			const segmentGroups = [word];
			let segmentEnd = index;
			while (
				segmentEnd + 1 < words.length &&
				hasSameWrapper(getWordGroupSegmentWrapper(words[segmentEnd + 1]), segmentWrapper)
			) {
				segmentEnd += 1;
				segmentGroups.push(words[segmentEnd]);
			}

			if (segmentGroups.some(group => group.type === 'fw')) {
				index = segmentEnd;
				ensureAnonymousAb(context);
				const tag = escapeXml(String(segmentWrapper.attrs?.tag || 'seg'));
				context.xml.push(`<${tag}${serializeAttrs(segmentWrapper.attrs?.teiAttrs || {})}>`);
				for (const group of segmentGroups) {
					if (group.type === 'fw') {
						exportFormWork(group.attrs || {}, group.node?.content, context, false);
					} else if (group.content) {
						const content = removeWrapperMark(group.content, segmentWrapper);
						const inner = getWholeWordWrapperMark(content);
						if (inner && group.closed === false) {
							context.xml.push(buildWrappedWordSequenceXml([{ ...group, content }], inner));
						} else {
							exportWord(content, context);
						}
					}
				}
				context.xml.push(`</${tag}>`);
				continue;
			}
		}

		if (word.type === 'fw') {
			ensureAnonymousAb(context);
			exportFormWork(word.attrs || {}, word.node?.content, context);
			continue;
		}

		if (word.type === 'teiWrapper') {
			ensureAnonymousAb(context);
			context.xml.push(serializeStructuredWrapper(word.attrs || {}, word.node?.marks));
			continue;
		}

		if (word.type === 'word' && word.content) {
			const wrapper = isPunctuationOnly(word.content)
				? null
				: getWholeWordWrapperMark(word.content);
			if (wrapper) {
				const wrappedWords = [word];
				while (
					index + 1 < words.length &&
					words[index + 1]?.type === 'word' &&
					words[index + 1]?.content &&
					hasMatchingWholeWordWrapper(words[index + 1].content!, wrapper)
				) {
					wrappedWords.push(words[index + 1]);
					index += 1;
				}

				ensureAnonymousAb(context);
				context.xml.push(buildWrappedWordSequenceXml(wrappedWords, wrapper));
				continue;
			}

			ensureAnonymousAb(context);
			exportWord(word.content, context);
		}
	}
}

function groupIntoWords(nodes: ProseMirrorJSON[]): WordGroup[] {
	const words: WordGroup[] = [];
	let currentWord: ProseMirrorJSON[] = [];

	for (const [index, node] of nodes.entries()) {
		if (node.type === 'gap' && currentWord.length > 0) {
			currentWord.push(node);
			continue;
		}
		// The parser records a boundary only where </w> closes, so a gap before one was a whole <w>.
		if (node.type === 'gap' && isBoundary(nodes[index + 1])) {
			words.push({ type: 'word', content: [node] });
			continue;
		}
		if (node.type === 'structuralBreak') {
			if (node.attrs?.inWord) {
				currentWord.push(node);
				continue;
			}
			if (currentWord.length > 0) {
				words.push({ type: 'word', content: currentWord });
				currentWord = [];
			}
			words.push({ type: 'breaks', attrs: { xml: node.attrs?.xml } });
			continue;
		}
		if (isInlineBreak(node) && node.attrs?.teiAttrs?.break === 'no' && currentWord.length > 0) {
			currentWord.push(structuralBreak(inlineBreakXml(node), true));
			continue;
		}
		if (
			node.type === 'verse' ||
			node.type === 'pageBreak' ||
			node.type === 'lineBreak' ||
			node.type === 'columnBreak' ||
			node.type === 'gap' ||
			node.type === 'space' ||
			node.type === 'handShift' ||
			(node.type === 'metamark' && !node.attrs?.wordInline) ||
			(node.type === 'teiAtom' && !node.attrs?.wordInline) ||
			(node.type === 'teiWrapper' && !node.attrs?.wordInline) ||
			node.type === 'teiMilestone' ||
			node.type === 'editorialAction' ||
			node.type === 'book' ||
			node.type === 'chapter' ||
			node.type === 'untranscribed' ||
			node.type === 'correctionNode' ||
			node.type === 'fw'
		) {
			if (currentWord.length > 0) {
				words.push({ type: 'word', content: currentWord, closed: false });
				currentWord = [];
			}
			words.push({
				type: node.type as WordGroup['type'],
				attrs: node.attrs,
				node,
			});
			continue;
		}

		if (node.type === 'metamark') {
			currentWord.push(node);
			continue;
		}

		if (node.type === 'teiAtom') {
			currentWord.push(node);
			continue;
		}

		if (node.type === 'teiWrapper') {
			if (node.attrs?.wordInline) {
				currentWord.push(node);
			} else {
				if (currentWord.length > 0) {
					words.push({ type: 'word', content: currentWord });
					currentWord = [];
				}
				words.push({ type: 'teiWrapper', attrs: node.attrs });
			}
			continue;
		}

		if (node.type === 'text') {
			if (node.text === ' ') {
				if (currentWord.length > 0) {
					words.push({ type: 'word', content: currentWord, closed: true });
					currentWord = [];
				}
				continue;
			}
			const previous = currentWord[currentWord.length - 1];
			if (
				previous?.type === 'text' &&
				((isPunctuation(previous) !== isPunctuation(node) &&
					correctionSignature(previous) !== correctionSignature(node)) ||
					wrapperSignature(previous) !== wrapperSignature(node))
			) {
				words.push({ type: 'word', content: currentWord, closed: false });
				currentWord = [];
			}
			currentWord.push(node);
		}
	}

	if (currentWord.length > 0) {
		words.push({ type: 'word', content: currentWord });
	}

	return words;
}

function isBoundary(node: ProseMirrorJSON | undefined): boolean {
	return node?.type === 'text' && node.text === ' ';
}

function wrapperSignature(node: ProseMirrorJSON): string {
	return JSON.stringify(
		node.marks?.filter(mark => mark.type === 'teiSpan' && isWholeWordWrapperTag(mark.attrs?.tag)) ??
			[]
	);
}

function correctionSignature(node: ProseMirrorJSON): string {
	return JSON.stringify(node.marks?.find(mark => mark.type === 'correction')?.attrs ?? null);
}

function isPunctuationOnly(nodes: ProseMirrorJSON[]): boolean {
	return nodes.every(node => node.type === 'text' && isPunctuation(node));
}

function isPunctuation(node: ProseMirrorJSON): boolean {
	return Boolean(node.marks?.some(mark => mark.type === 'punctuation'));
}

function gapXml(attrs: Record<string, any> = {}): string {
	return `<gap${serializeAttrs(
		mergeCarrierAttrs(attrs, { reason: attrs.reason, unit: attrs.unit, extent: attrs.extent })
	)}/>`;
}

function isInlineBreak(node: ProseMirrorJSON): boolean {
	return node.type === 'lineBreak' || node.type === 'columnBreak' || node.type === 'pageBreak';
}

function inlineBreakXml(node: ProseMirrorJSON): string {
	const tag = node.type === 'pageBreak' ? 'pb' : node.type === 'columnBreak' ? 'cb' : 'lb';
	return `<${tag}${serializeAttrs(extractTeiAttrs(node.attrs))}/>`;
}

function exportWord(nodes: ProseMirrorJSON[], context: ExportContext): void {
	const hasPunctuation = nodes.some(node =>
		node.marks?.some(mark => mark.type === 'punctuation')
	);
	if (hasPunctuation) {
		// Marked and unmarked nodes can be adjacent with no split space; emit every run.
		splitOnPunctuation(nodes).forEach((run, index) => {
			if (!run.punctuation) {
				exportWord(run.nodes, context);
				return;
			}
			// A mark after word text in the same word has no boundary before it.
			const joinsLeft = index > 0;
			for (const node of run.nodes) context.xml.push(punctuationXml(node, joinsLeft));
		});
		return;
	}

	const correctionMark = findCorrectionMark(nodes);
	if (correctionMark) {
		exportCorrection([{ type: 'word', content: nodes }], correctionMark, context);
		return;
	}

	const wholeWordWrapper = getWholeWordWrapperMark(nodes);
	if (wholeWordWrapper) {
		context.xml.push(
			buildWrappedWordSequenceXml([{ type: 'word', content: nodes }], wholeWordWrapper)
		);
		return;
	}

	context.xml.push(buildWordXml(nodes));
}

function punctuationXml(node: ProseMirrorJSON, joinsLeft = false): string {
	const punctuationMark = node.marks?.find(mark => mark.type === 'punctuation');
	const attrs = { ...extractTeiAttrs(punctuationMark?.attrs) };
	if (joinsLeft) attrs.join = attrs.join === 'both' ? 'both' : 'left';
	return wrapInMarks(
		`<pc${serializeAttrs(attrs)}>${escapeXml(node.text || '')}</pc>`,
		(node.marks ?? []).filter(mark => !['punctuation', 'correction', 'word'].includes(mark.type))
	);
}

function splitOnPunctuation(
	nodes: ProseMirrorJSON[]
): { punctuation: boolean; nodes: ProseMirrorJSON[] }[] {
	const runs: { punctuation: boolean; nodes: ProseMirrorJSON[] }[] = [];
	for (const node of nodes) {
		const punctuation = Boolean(node.marks?.some(mark => mark.type === 'punctuation'));
		const current = runs[runs.length - 1];
		if (current && current.punctuation === punctuation) {
			current.nodes.push(node);
			continue;
		}
		runs.push({ punctuation, nodes: [node] });
	}
	return runs;
}

function buildWordXml(nodes: ProseMirrorJSON[]): string {
	return `<w${serializeAttrs(extractWordAttrs(nodes))}>${buildWordContentXml(nodes)}</w>`;
}

function buildWordContentXml(nodes: ProseMirrorJSON[]): string {
	let wordContent = '';
	for (const node of nodes) {
		if (node.type === 'structuralBreak') {
			wordContent += node.attrs?.xml ?? '';
			continue;
		}
		if (node.type === 'gap') {
			wordContent += wrapInMarks(
				gapXml(node.attrs),
				(node.marks ?? []).filter(mark => !['correction', 'word'].includes(mark.type))
			);
			continue;
		}
		if (node.type === 'metamark') {
			wordContent += serializeMetamarkAttrs(extractTeiAttrs(node.attrs));
			continue;
		}
		if (node.type === 'teiAtom') {
			wordContent += serializeStructuredAtom(node.attrs || {}, node.marks);
			continue;
		}
		if (node.type === 'teiWrapper') {
			wordContent += serializeStructuredWrapper(node.attrs || {}, node.marks);
			continue;
		}
		wordContent += isPunctuation(node)
			? punctuationXml(node)
			: exportTextWithMarksInline(node, ['correction', 'word', 'punctuation']);
	}
	return wordContent;
}

function buildWrappedWordSequenceXml(
	words: WordGroup[],
	wrapper: { type: 'teiSpan'; attrs?: Record<string, any> }
): string {
	const tag = escapeXml(String(wrapper.attrs?.tag || 'seg'));
	const attrs = serializeAttrs(wrapper.attrs?.teiAttrs || {});
	const innerWords = words.map(word => ({
		...word,
		content: removeWrapperMark(word.content || [], wrapper),
	}));
	const innerWrapper = getWholeWordWrapperMark(innerWords[0]?.content || []);
	const inner =
		innerWrapper &&
		innerWords.every(word => hasMatchingWholeWordWrapper(word.content || [], innerWrapper))
			? buildWrappedWordSequenceXml(innerWords, innerWrapper)
			: innerWords.map(wrappedWordXml).join('');
	return [`<${tag}${attrs}>`, inner, `</${tag}>`].join('');
}

// <pc> cannot sit inside <w>, and a word with no boundary after it had no </w>.
function wrappedWordXml(word: WordGroup): string {
	const content = word.content || [];
	if (word.closed === false || isPunctuationOnly(content)) return buildWordContentXml(content);
	return splitOnPunctuation(content)
		.map(run => (run.punctuation ? buildWordContentXml(run.nodes) : buildWordXml(run.nodes)))
		.join('');
}

function removeWrapperMark(
	nodes: ProseMirrorJSON[],
	wrapper: { type: 'teiSpan'; attrs?: Record<string, any> }
): ProseMirrorJSON[] {
	const signature = JSON.stringify(wrapper.attrs || {});
	return nodes.map(node => ({
		...node,
		marks: node.marks?.filter(
			mark => mark.type !== wrapper.type || JSON.stringify(mark.attrs || {}) !== signature
		),
	}));
}

// Corrections can cover only part of a word.
function findCorrectionMark(
	nodes: ProseMirrorJSON[]
): { type: string; attrs?: Record<string, any> } | undefined {
	for (const node of nodes) {
		const mark = node.marks?.find(candidate => candidate.type === 'correction');
		if (mark) return mark;
	}
	return undefined;
}

function findGroupCorrectionMark(
	group: WordGroup | undefined
): { type: string; attrs?: Record<string, any> } | undefined {
	if (!group) return undefined;
	if (group.type === 'word' && group.content) {
		if (getWholeWordWrapperMark(group.content)) return undefined;
		return findCorrectionMark(group.content);
	}
	return group.node?.marks?.find(mark => mark.type === 'correction');
}

// A correction may span line breaks between its words.
function collectCorrectedGroups(
	groups: WordGroup[],
	index: number,
	correctionMark: { attrs?: Record<string, any> },
	into: WordGroup[]
): number {
	while (index + 1 < groups.length) {
		const next = groups[index + 1];
		if (isSameCorrectionMark(findGroupCorrectionMark(next), correctionMark)) {
			into.push(next);
			index += 1;
			continue;
		}
		const after = groups[index + 2];
		if (
			next.type === 'breaks' &&
			isSameCorrectionMark(findGroupCorrectionMark(after), correctionMark)
		) {
			into.push(next, after);
			index += 2;
			continue;
		}
		break;
	}
	return index;
}

function isSameCorrectionMark(
	candidate: { attrs?: Record<string, any> } | undefined,
	reference: { attrs?: Record<string, any> }
): boolean {
	if (!candidate) return false;
	return JSON.stringify(candidate.attrs || {}) === JSON.stringify(reference.attrs || {});
}

// One `<app>` per span; locus is always whole words for collation.
function exportCorrection(
	groups: WordGroup[],
	correctionMark: { attrs?: Record<string, any> },
	context: ExportContext
): void {
	const corrections = correctionMark.attrs?.corrections || [];
	const outer = outerCorrectionMarks(groups);
	if (outer.length > 0) groups = groups.map(group => stripGroupMarks(group, outer));
	const wrapper = markWrapperTags(outer);
	context.xml.push(wrapper.open + '<app>');

	const originalContext: ExportContext = {
		xml: [],
		insideVerse: false,
		anonymousAbOpen: false,
		bookDivOpen: false,
		chapterDivOpen: false,
	};
	exportInlineGroups(
		groups.map(group => ({
			...group,
			content: group.content && stripMarks(group.content, ['correction']),
			node: group.node && stripMarks([group.node], ['correction'])[0],
		})),
		originalContext
	);
	context.xml.push(`<rdg type="orig">${originalContext.xml.join('')}</rdg>`);

	for (const correction of corrections) {
		exportCorrectionReading(
			outer.length > 0
				? {
						...correction,
						content: correction.content?.map(
							(node: ProseMirrorJSON) => stripGroupMarks({ type: 'word', node }, outer).node
						),
					}
				: correction,
			context
		);
	}

	context.xml.push('</app>' + wrapper.close);
}

// Mark order mirrors nesting, so marks before the correction on every node wrapped the whole <app>.
function outerCorrectionMarks(groups: WordGroup[]): Mark[] {
	const leads = groups
		.flatMap(group => group.content ?? (group.node ? [group.node] : []))
		.map(node => node.marks ?? [])
		.filter(marks => marks.some(mark => mark.type === 'correction'))
		.map(marks => marks.slice(0, marks.findIndex(mark => mark.type === 'correction')));
	if (leads.length === 0) return [];
	return leads[0].filter(mark =>
		leads.every(lead => lead.some(other => JSON.stringify(other) === JSON.stringify(mark)))
	);
}

function stripGroupMarks(group: WordGroup, marks: Mark[]): WordGroup {
	const signatures = new Set(marks.map(mark => JSON.stringify(mark)));
	const strip = (node: ProseMirrorJSON) => ({
		...node,
		marks: node.marks?.filter(mark => !signatures.has(JSON.stringify(mark))),
	});
	return { ...group, content: group.content?.map(strip), node: group.node && strip(group.node) };
}

function exportCorrectionNode(attrs: Record<string, any>, context: ExportContext): void {
	const corrections = attrs.corrections || [];
	if (corrections.length === 0) return;

	context.xml.push('<app>');
	context.xml.push('<rdg type="orig" hand="firsthand"/>');

	for (const correction of corrections) {
		exportCorrectionReading(correction, context);
	}

	context.xml.push('</app>');
}

function serializeInlineItemsToTei(content: InlineItem[]): string {
	const context: ExportContext = {
		xml: [],
		insideVerse: false,
		anonymousAbOpen: false,
		bookDivOpen: false,
		chapterDivOpen: false,
	};
	exportInlineContent(inlineItemsToProseMirror(content), context);
	return context.xml.join('');
}

function exportInlineContent(content: ProseMirrorJSON[], context: ExportContext): void {
	exportInlineGroups(groupIntoWords(content), context);
}

function exportInlineGroups(groups: WordGroup[], context: ExportContext): void {
	for (let index = 0; index < groups.length; index += 1) {
		const group = groups[index];
		const node = group.node;
		if (group.type === 'breaks') {
			context.xml.push(group.attrs?.xml ?? '');
			continue;
		}
		const correctionMark = findGroupCorrectionMark(group);
		if (correctionMark) {
			const correctedGroups = [group];
			index = collectCorrectedGroups(groups, index, correctionMark, correctedGroups);
			exportCorrection(correctedGroups, correctionMark, context);
			continue;
		}

		if (group.type === 'word' && group.content) {
			exportWord(group.content, context);
			continue;
		}
		if (!node) continue;

		if (group.type === 'lineBreak') {
			context.xml.push(`<lb${serializeAttrs(extractTeiAttrs(node.attrs))}/>`);
			continue;
		}

		if (group.type === 'pageBreak') {
			context.xml.push(`<pb${serializeAttrs(extractTeiAttrs(node.attrs))}/>`);
			continue;
		}

		if (group.type === 'columnBreak') {
			context.xml.push(`<cb${serializeAttrs(extractTeiAttrs(node.attrs))}/>`);
			continue;
		}

		if (group.type === 'gap') {
			const attrs = node.attrs || {};
			context.xml.push(
				`<gap${serializeAttrs(
					mergeCarrierAttrs(attrs, {
						reason: attrs.reason,
						unit: attrs.unit,
						extent: attrs.extent,
					})
				)}/>`
			);
			continue;
		}

		if (group.type === 'space') {
			context.xml.push(`<space${serializeAttrs(extractTeiAttrs(node.attrs))}/>`);
			continue;
		}

		if (group.type === 'handShift') {
			context.xml.push(`<handShift${serializeAttrs(extractTeiAttrs(node.attrs))}/>`);
			continue;
		}

		if (group.type === 'teiMilestone') {
			context.xml.push(`<milestone${serializeAttrs(extractTeiAttrs(node.attrs))}/>`);
			continue;
		}

		if (group.type === 'metamark') {
			context.xml.push(serializeMetamarkAttrs(extractTeiAttrs(node.attrs)));
			continue;
		}

		if (group.type === 'teiAtom') {
			context.xml.push(serializeStructuredAtom(node.attrs || {}, node.marks));
			continue;
		}

		if (group.type === 'teiWrapper') {
			context.xml.push(serializeStructuredWrapper(node.attrs || {}, node.marks));
			continue;
		}

		if (group.type === 'fw') {
			exportFormWork(node.attrs || {}, node.content, context);
			continue;
		}

		if (group.type === 'correctionNode') {
			exportCorrectionNode(node.attrs || {}, context);
			continue;
		}
	}
}

function stripMarks(nodes: ProseMirrorJSON[], markTypes: string[]): ProseMirrorJSON[] {
	return nodes.map(node => ({
		...node,
		marks: (node.marks || []).filter(mark => !markTypes.includes(mark.type)),
	}));
}

function inlineItemsToProseMirror(items: InlineItem[]): ProseMirrorJSON[] {
	const content: ProseMirrorJSON[] = [];

	for (const item of items) {
		if (item.type === 'text') {
			content.push({
				type: 'text',
				text: item.text,
				marks: inlineMarksToProseMirror(item.marks),
			});
			continue;
		}

		if (item.type === 'boundary') {
			content.push({ type: 'text', text: ' ' });
			continue;
		}

		if (item.type === 'pageBreak') {
			content.push({
				type: 'pageBreak',
				attrs: { teiAttrs: item.attrs || {} },
			});
			continue;
		}

		if (item.type === 'lineBreak') {
			content.push({
				type: 'lineBreak',
				attrs: { teiAttrs: item.attrs || {} },
			});
			continue;
		}

		if (item.type === 'columnBreak') {
			content.push({
				type: 'columnBreak',
				attrs: { teiAttrs: item.attrs || {} },
			});
			continue;
		}

		if (item.type === 'gap') {
			content.push({
				type: 'gap',
				attrs: item.attrs,
				marks: inlineMarksToProseMirror(item.marks),
			});
			continue;
		}

		if (item.type === 'space') {
			content.push({
				type: 'space',
				attrs: { teiAttrs: item.attrs },
				marks: inlineMarksToProseMirror(item.marks),
			});
			continue;
		}

		if (item.type === 'handShift') {
			content.push({
				type: 'handShift',
				attrs: { teiAttrs: item.attrs },
				marks: inlineMarksToProseMirror(item.marks),
			});
			continue;
		}

		if (item.type === 'metamark') {
			content.push({
				type: 'metamark',
				attrs: {
					summary: item.summary,
					teiAttrs: item.attrs,
					wordInline: item.wordInline || false,
				},
				marks: inlineMarksToProseMirror(item.marks),
			});
			continue;
		}

		if (item.type === 'teiAtom') {
			content.push({
				type: 'teiAtom',
				attrs: {
					tag: item.tag,
					summary: item.summary,
					teiAttrs: item.attrs || {},
					node: item.node,
					wordInline: item.wordInline || false,
					text: item.text || '',
				},
				marks: inlineMarksToProseMirror(item.marks),
			});
			continue;
		}

		if (item.type === 'teiWrapper') {
			content.push({
				type: 'teiWrapper',
				attrs: {
					tag: item.tag,
					summary: item.summary,
					teiAttrs: item.attrs || {},
					children: item.children,
					wordInline: item.wordInline || false,
					text: item.text || '',
				},
				marks: inlineMarksToProseMirror(item.marks),
			});
			continue;
		}

		if (item.type === 'teiMilestone') {
			content.push({
				type: 'teiMilestone',
				attrs: { teiAttrs: item.attrs },
				marks: inlineMarksToProseMirror(item.marks),
			});
			continue;
		}

		if (item.type === 'fw') {
			content.push({
				type: 'fw',
				attrs: {
					...item.attrs,
					content: createStructuredFormWorkContent(
						inlineItemsToProseMirror(item.content)
					),
				},
			});
			continue;
		}

		if (item.type === 'correctionOnly') {
			content.push({
				type: 'correctionNode',
				attrs: {
					corrections: item.corrections.map(correction => ({
						...correction,
						content: inlineItemsToProseMirror(correction.content),
					})),
				},
			});
			continue;
		}
	}

	return content;
}

function inlineMarksToProseMirror(marks: TextMark[] | undefined): ProseMirrorJSON['marks'] {
	return marks?.map(mark => ({
		type: mark.type,
		...(mark.type === 'abbreviation' ? { attrs: mark.attrs } : {}),
		...(mark.type === 'correction'
			? {
					attrs: {
						corrections: mark.attrs.corrections.map(correction => ({
							...correction,
							content: inlineItemsToProseMirror(correction.content),
						})),
					},
				}
			: {}),
		...(mark.type === 'word' ||
		mark.type === 'lacunose' ||
		mark.type === 'unclear' ||
		mark.type === 'punctuation' ||
		mark.type === 'hi' ||
		mark.type === 'damage' ||
		mark.type === 'surplus' ||
		mark.type === 'secl' ||
		mark.type === 'unconfirmed'
			? { attrs: { teiAttrs: mark.attrs || {} } }
			: {}),
		...(mark.type === 'teiSpan'
			? { attrs: { tag: mark.attrs.tag, teiAttrs: mark.attrs.teiAttrs || {} } }
			: {}),
	}));
}

function exportCorrectionReading(correction: Record<string, any>, context: ExportContext): void {
	const rdgAttrs = {
		type: correction.readingAttrs?.type || 'corr',
		hand: correction.hand || 'unknown',
		...(correction.readingAttrs || {}),
	};
	context.xml.push(`<rdg${serializeAttrs(rdgAttrs)}>`);
	if (correction.segmentAttrs && Object.keys(correction.segmentAttrs).length > 0) {
		context.xml.push(`<seg${serializeAttrs(correction.segmentAttrs)}>`);
		if (correction.content) {
			exportInlineContent(correction.content, context);
		}
		context.xml.push('</seg>');
	} else if (correction.content) {
		exportInlineContent(correction.content, context);
	}
	context.xml.push('</rdg>');
}

function exportTextWithMarksInline(node: ProseMirrorJSON, skipMarks: string[] = []): string {
	const text = node.text || '';
	const marks = (node.marks || []).filter(mark => !skipMarks.includes(mark.type));
	let output = escapeXml(text);
	const openTags: string[] = [];
	const closeTags: string[] = [];
	for (const mark of marks) {
		const tags = markTags(mark, text);
		if (!tags) continue;
		openTags.push(...tags.open);
		closeTags.unshift(...tags.close);
		if (tags.output !== undefined) output = tags.output;
	}
	return openTags.join('') + output + closeTags.join('');
}

type Mark = { type: string; attrs?: Record<string, any> };

function wrapInMarks(inner: string, marks: Mark[]): string {
	const { open, close } = markWrapperTags(marks);
	return open + inner + close;
}

function markWrapperTags(marks: Mark[]): { open: string; close: string } {
	const openTags: string[] = [];
	const closeTags: string[] = [];
	for (const mark of marks) {
		const tags = markTags(mark, '');
		if (!tags) continue;
		openTags.push(...tags.open);
		closeTags.unshift(...tags.close);
	}
	return { open: openTags.join(''), close: closeTags.join('') };
}

function markTags(
	mark: { type: string; attrs?: Record<string, any> },
	text: string
): { open: string[]; close: string[]; output?: string } | null {
	const simple = (tag: string, attrs: Record<string, any> = extractTeiAttrs(mark.attrs)) => ({
		open: [`<${tag}${serializeAttrs(attrs)}>`],
		close: [`</${tag}>`],
	});
	switch (mark.type) {
		case 'lacunose':
			return simple('supplied');
		case 'unclear':
		case 'hi':
		case 'damage':
		case 'surplus':
		case 'secl':
			return simple(mark.type);
		case 'unconfirmed':
			return simple('seg', { ...extractTeiAttrs(mark.attrs), type: 'unconfirmed' });
		case 'teiSpan':
			return simple(escapeXml(String(mark.attrs?.tag || 'seg')), mark.attrs?.teiAttrs || {});
		case 'abbreviation': {
			const type = mark.attrs?.type || '';
			if (type === 'ligature') {
				const rend = mark.attrs?.rend || text || '¯';
				return {
					open: [`<ex rend="${escapeXml(rend)}">`],
					close: ['</ex>'],
					output: escapeXml(mark.attrs?.expansion || ''),
				};
			}
			const expansion = mark.attrs?.expansion
				? [`<ex rend="¯">${escapeXml(mark.attrs.expansion)}</ex>`]
				: [];
			return {
				open: [`<abbr${type ? ` type="${escapeXml(type)}"` : ''}>`, '<hi rend="overline">'],
				close: ['</hi>', ...expansion, '</abbr>'],
			};
		}
		default:
			return null;
	}
}

function getWholeWordWrapperMark(
	nodes: ProseMirrorJSON[]
): { type: 'teiSpan'; attrs?: Record<string, any> } | null {
	const textNodes = nodes.filter(node => node.type === 'text' && (node.text || '').length > 0);
	if (textNodes.length === 0) return null;

	const firstMark = textNodes[0]?.marks?.find(
		mark => mark.type === 'teiSpan' && isWholeWordWrapperTag(mark.attrs?.tag)
	);
	if (!firstMark) return null;

	const signature = JSON.stringify(firstMark.attrs || {});
	for (const node of textNodes) {
		const matchingMark = node.marks?.find(
			mark => mark.type === 'teiSpan' && JSON.stringify(mark.attrs || {}) === signature
		);
		if (!matchingMark) return null;
	}

	return firstMark as { type: 'teiSpan'; attrs?: Record<string, any> };
}

function hasMatchingWholeWordWrapper(
	nodes: ProseMirrorJSON[],
	wrapper: { type: 'teiSpan'; attrs?: Record<string, any> }
): boolean {
	const candidate = getWholeWordWrapperMark(nodes);
	return (
		!!candidate && JSON.stringify(candidate.attrs || {}) === JSON.stringify(wrapper.attrs || {})
	);
}

function getWordGroupSegmentWrapper(
	group: WordGroup
): { type: 'teiSpan'; attrs?: Record<string, any> } | null {
	if (group.type === 'word') {
		const wrapper = getWholeWordWrapperMark(group.content || []);
		return wrapper?.attrs?.tag === 'seg' ? wrapper : null;
	}
	if (group.type !== 'fw') return null;
	const teiAttrs = getFormWorkSegmentAttrs(group.attrs || {});
	return Object.keys(teiAttrs).length > 0
		? { type: 'teiSpan', attrs: { tag: 'seg', teiAttrs } }
		: null;
}

function hasSameWrapper(
	candidate: { type: 'teiSpan'; attrs?: Record<string, any> } | null,
	wrapper: { type: 'teiSpan'; attrs?: Record<string, any> }
): boolean {
	return (
		!!candidate && JSON.stringify(candidate.attrs || {}) === JSON.stringify(wrapper.attrs || {})
	);
}

function getFormWorkSegmentAttrs(attrs: Record<string, any>): Record<string, any> {
	return Object.fromEntries(
		Object.entries({
			...(attrs.segAttrs || {}),
			type: attrs.segType || attrs.segAttrs?.type || undefined,
			subtype: attrs.segSubtype || attrs.segAttrs?.subtype || undefined,
			place: attrs.segPlace || attrs.segAttrs?.place || undefined,
			hand: attrs.segHand || attrs.segAttrs?.hand || undefined,
			rend: attrs.segRend || attrs.segAttrs?.rend || undefined,
			n: attrs.segN || attrs.segAttrs?.n || undefined,
		}).filter(([, value]) => value !== undefined && value !== '')
	);
}

function exportFormWork(
	attrs: Record<string, any>,
	content: ProseMirrorJSON[] | undefined,
	context: ExportContext,
	includeSegment = true
): void {
	const segAttrs = getFormWorkSegmentAttrs(attrs);
	const fwAttrs = {
		...(attrs.teiAttrs || {}),
		type: attrs.type || attrs.teiAttrs?.type || undefined,
		subtype: attrs.subtype || attrs.teiAttrs?.subtype || undefined,
		place: attrs.place || attrs.teiAttrs?.place || undefined,
		hand: attrs.hand || attrs.teiAttrs?.hand || undefined,
		n: attrs.n || attrs.teiAttrs?.n || undefined,
		rend: attrs.rend || attrs.teiAttrs?.rend || undefined,
	};

	if (includeSegment && Object.keys(segAttrs).length > 0) {
		context.xml.push(`<seg${serializeAttrs(segAttrs)}>`);
	}

	context.xml.push(`<fw${serializeAttrs(fwAttrs)}>`);
	exportInlineContent(
		Array.isArray(content) ? content : flattenStructuredFormWorkContent(attrs.content),
		context
	);
	context.xml.push('</fw>');

	if (includeSegment && Object.keys(segAttrs).length > 0) {
		context.xml.push('</seg>');
	}
}

function openVerse(context: ExportContext, verseId: string): void {
	if (context.insideVerse && context.currentVerse !== verseId) {
		closeVerse(context);
	}

	if (!context.insideVerse) {
		ensureCurrentDivs(context);
		context.xml.push(`<ab n="${escapeXml(verseId)}">`);
		context.insideVerse = true;
		context.currentVerse = verseId;
	}
}

function closeVerse(context: ExportContext): void {
	if (!context.insideVerse) return;
	context.xml.push('</ab>');
	context.insideVerse = false;
	context.currentVerse = undefined;
}

function ensureAnonymousAb(context: ExportContext): void {
	if (context.insideVerse || context.anonymousAbOpen) return;
	ensureCurrentDivs(context);
	context.xml.push('<ab>');
	context.anonymousAbOpen = true;
}

function closeAnonymousAb(context: ExportContext): void {
	if (!context.anonymousAbOpen) return;
	context.xml.push('</ab>');
	context.anonymousAbOpen = false;
}

function closeChapterDiv(context: ExportContext): void {
	closeAnonymousAb(context);
	closeVerse(context);
	if (context.chapterDivOpen) {
		context.xml.push('</div>');
		context.chapterDivOpen = false;
	}
}

function closeAllDivs(context: ExportContext): void {
	closeChapterDiv(context);
	if (context.bookDivOpen) {
		context.xml.push('</div>');
		context.bookDivOpen = false;
	}
}

function ensureCurrentDivs(context: ExportContext): void {
	if (context.currentBook && !context.bookDivOpen) {
		const bookId = context.currentBookSourceLabel ?? context.currentBook;
		context.xml.push(`<div type="book" n="${escapeXml(bookId)}">`);
		context.bookDivOpen = true;
	}

	if (context.currentChapter && !context.chapterDivOpen) {
		const chapterId =
			context.currentChapterSourceLabel ??
			(context.currentBook && !context.currentChapter.startsWith(`${context.currentBook}.`)
				? `${context.currentBook}.${context.currentChapter}`
				: context.currentChapter);
		context.xml.push(`<div type="chapter" n="${escapeXml(chapterId)}">`);
		context.chapterDivOpen = true;
	}
}

function buildVerseId(attrs?: Record<string, any>): string {
	if (!attrs) return '';
	if (attrs.chapter && attrs.verse) return `${attrs.chapter}.${attrs.verse}`;
	return attrs.verse || '';
}

function getSourceLabel(attrs?: Record<string, any>): string | undefined {
	return typeof attrs?.sourceLabel === 'string' ? attrs.sourceLabel : undefined;
}

function extractTeiAttrs(
	attrs: Record<string, any> | undefined
): Record<string, string | undefined> {
	if (!attrs) return {};
	if (attrs.teiAttrs && typeof attrs.teiAttrs === 'object') {
		return attrs.teiAttrs as Record<string, string | undefined>;
	}
	return attrs as Record<string, string | undefined>;
}

function mergeTeiAttrs(
	attrs: Record<string, any> | undefined,
	overrides: Record<string, string | undefined>
): Record<string, string | undefined> {
	const merged = {
		...extractEmbeddedTeiAttrs(attrs),
	};
	for (const [key, value] of Object.entries(overrides)) {
		if (value !== undefined) {
			merged[key] = value;
		}
	}
	return merged;
}

function mergeCarrierAttrs(
	attrs: Record<string, any>,
	namedAttrs: Record<string, string | undefined>
): Record<string, string | undefined> {
	const merged = { ...namedAttrs };
	for (const [key, value] of Object.entries(extractEmbeddedTeiAttrs(attrs))) {
		if (!(key in namedAttrs)) {
			merged[key] = value;
		}
	}
	return merged;
}

function extractEmbeddedTeiAttrs(
	attrs: Record<string, any> | undefined
): Record<string, string | undefined> {
	if (!attrs?.teiAttrs || typeof attrs.teiAttrs !== 'object') {
		return {};
	}
	return attrs.teiAttrs as Record<string, string | undefined>;
}

function extractWordAttrs(textNodes: ProseMirrorJSON[]): Record<string, string | undefined> {
	for (const node of textNodes) {
		if (node.type !== 'text') continue;
		const wordMark = node.marks?.find(mark => mark.type === 'word');
		if (wordMark) {
			return extractTeiAttrs(wordMark.attrs);
		}
	}
	return {};
}

function pushStructuredSections(context: ExportContext, sections: string[] | undefined): void {
	for (const section of sections || []) {
		context.xml.push(section);
	}
}

function serializeMetamarkAttrs(attrs: Record<string, string | undefined>): string {
	return `<metamark${serializeAttrs(attrs)}/>`;
}

function serializeStructuredAtom(
	attrs: Record<string, any>,
	marks?: ProseMirrorJSON['marks']
): string {
	let xml: string;
	if (attrs.teiNode && typeof attrs.teiNode === 'object') {
		xml = serializeTeiNode(attrs.teiNode);
	} else if (attrs.node && typeof attrs.node === 'object') {
		xml = serializeTeiNode(attrs.node);
	} else {
		const tag = String(attrs.tag || 'note');
		const teiAttrs = (attrs.teiAttrs as Record<string, string>) || {};
		const text = attrs.text ? escapeXml(String(attrs.text)) : '';
		xml = !text
			? `<${tag}${serializeAttrs(teiAttrs)}/>`
			: `<${tag}${serializeAttrs(teiAttrs)}>${text}</${tag}>`;
	}

	return wrapStructuredContentWithMarks(xml, marks);
}

function serializeStructuredWrapper(
	attrs: Record<string, any>,
	marks?: ProseMirrorJSON['marks']
): string {
	let xml: string;
	if (attrs.teiNode && typeof attrs.teiNode === 'object') {
		xml = serializeTeiNode(attrs.teiNode);
	} else {
		const node: TeiElementNode = {
			type: 'element',
			tag: String(attrs.tag || 'seg'),
			attrs:
				attrs.teiAttrs && typeof attrs.teiAttrs === 'object'
					? (attrs.teiAttrs as Record<string, string>)
					: undefined,
			children: Array.isArray(attrs.children) ? attrs.children : [],
		};
		xml = serializeTeiNode(node);
	}

	return wrapStructuredContentWithMarks(xml, marks);
}

function wrapStructuredContentWithMarks(xml: string, marks?: ProseMirrorJSON['marks']): string {
	return wrapInMarks(
		xml,
		(marks ?? []).filter(mark => !['correction', 'word', 'punctuation'].includes(mark.type))
	);
}

function createTeiRootOpenTag(document?: TranscriptionDocument): string {
	return `<TEI xmlns="http://www.tei-c.org/ns/1.0"${serializeAttrs(document?.teiAttrs || {})}>`;
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function serializeAttrs(attrs: Record<string, string | undefined>): string {
	const pairs = Object.entries(attrs).filter(([, value]) => value);
	if (pairs.length === 0) return '';
	return ' ' + pairs.map(([key, value]) => `${key}="${escapeXml(String(value))}"`).join(' ');
}
