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
	TranscriptionDocument,
} from './types';

interface ExportContext {
	xml: string[];
	currentVerse?: string;
	currentBook?: string;
	currentChapter?: string;
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
		| 'teiWrapper';
	content?: ProseMirrorJSON[];
	attrs?: Record<string, any>;
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
		exportNodes(pmJSON.content, context);
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

function exportNodes(nodes: ProseMirrorJSON[] | undefined, context: ExportContext): void {
	if (!nodes) return;
	for (const node of nodes) {
		exportNode(node, context);
	}
}

function exportNode(node: ProseMirrorJSON, context: ExportContext): void {
	switch (node.type) {
		case 'page':
			closeAllDivs(context);
			context.xml.push(`<pb${serializeAttrs(mergeTeiAttrs(node.attrs, {
				'xml:id': node.attrs?.pageId || node.attrs?.teiAttrs?.['xml:id'],
				n: node.attrs?.teiAttrs?.n || node.attrs?.pageName || '',
				type: node.attrs?.teiAttrs?.type || 'folio',
				break: node.attrs?.wrapped ? 'no' : undefined,
			}))}/>`);
			exportNodes(node.content, context);
			break;

		case 'column':
			closeAllDivs(context);
			context.xml.push(`<cb${serializeAttrs(mergeTeiAttrs(node.attrs, {
				n: node.attrs?.teiAttrs?.n || String(node.attrs?.columnNumber || 1),
				break: node.attrs?.wrapped ? 'no' : undefined,
				type: node.attrs?.zone ? 'frame' : undefined,
				subtype: node.attrs?.zone || undefined,
			}))}/>`);
			exportNodes(node.content, context);
			break;

		case 'line':
			context.xml.push(`<lb${serializeAttrs(mergeTeiAttrs(node.attrs, {
				break: node.attrs?.wrapped ? 'no' : undefined,
				rend: node.attrs?.paragraphStart ? (node.attrs?.teiAttrs?.rend || 'hang') : undefined,
			}))}/>`);
			exportLineContent(node.content, context);
			break;

		default:
			if (node.content) exportNodes(node.content, context);
			break;
	}
}

function exportLineContent(nodes: ProseMirrorJSON[] | undefined, context: ExportContext): void {
	if (!nodes) return;

	const words = groupIntoWords(nodes);
	for (let index = 0; index < words.length; index += 1) {
		const word = words[index];
		if (word.type === 'verse') {
			closeAnonymousAb(context);
			const verseId = buildVerseId(word.attrs);
			if (context.insideVerse && context.currentVerse !== verseId) {
				closeVerse(context);
			}
			openVerse(context, verseId);
			continue;
		}

		if (word.type === 'book') {
			context.currentBook = word.attrs?.book || '';
			continue;
		}

		if (word.type === 'chapter') {
			context.currentChapter = word.attrs?.chapter || '';
			continue;
		}

		if (word.type === 'gap') {
			ensureAnonymousAb(context);
			const attrs = word.attrs || {};
			let tagAttrs = '';
			if (attrs.reason) tagAttrs += ` reason="${escapeXml(attrs.reason)}"`;
			if (attrs.unit) tagAttrs += ` unit="${escapeXml(attrs.unit)}"`;
			if (attrs.extent) tagAttrs += ` extent="${escapeXml(attrs.extent)}"`;
			context.xml.push(`<gap${tagAttrs}/>`);
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
			context.xml.push(serializeStructuredAtom(word.attrs || {}));
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
				`<note type="untranscribed" subtype="${escapeXml(attrs.reason || 'Untranscribed')}" n="${escapeXml(attrs.extent || 'partial')}"/>`
			);
			continue;
		}

		if (word.type === 'correctionNode') {
			ensureAnonymousAb(context);
			exportCorrectionNode(word.attrs || {}, context);
			continue;
		}

		if (word.type === 'fw') {
			ensureAnonymousAb(context);
			exportFormWork(word.attrs || {}, context);
			continue;
		}

		if (word.type === 'teiWrapper') {
			ensureAnonymousAb(context);
			context.xml.push(serializeStructuredWrapper(word.attrs || {}));
			continue;
		}

		if (word.type === 'word' && word.content) {
			const wrapper = getWholeWordWrapperMark(word.content);
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

	for (const node of nodes) {
		if (
			node.type === 'verse' ||
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
				words.push({ type: 'word', content: currentWord });
				currentWord = [];
			}
			words.push({ type: node.type as WordGroup['type'], attrs: node.attrs });
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
					words.push({ type: 'word', content: currentWord });
					currentWord = [];
				}
				continue;
			}
			currentWord.push(node);
		}
	}

	if (currentWord.length > 0) {
		words.push({ type: 'word', content: currentWord });
	}

	return words;
}

function exportWord(nodes: ProseMirrorJSON[], context: ExportContext): void {
	const hasPunctuation = nodes.some(node =>
		node.marks?.some(mark => mark.type === 'punctuation')
	);
	if (hasPunctuation) {
		for (const node of nodes) {
			const punctuationMark = node.marks?.find(mark => mark.type === 'punctuation');
			if (punctuationMark) {
				context.xml.push(
					`<pc${serializeAttrs(extractTeiAttrs(punctuationMark.attrs))}>${escapeXml(node.text || '')}</pc>`
				);
			}
		}
		return;
	}

	const hasCorrection = nodes.some(node =>
		node.marks?.some(mark => mark.type === 'correction')
	);
	if (hasCorrection) {
		exportCorrection(nodes, context);
		return;
	}

	const wholeWordWrapper = getWholeWordWrapperMark(nodes);
	if (wholeWordWrapper) {
		const innerWord = buildWordXml(nodes, [wholeWordWrapper.type]);
		context.xml.push(
			`<${escapeXml(String(wholeWordWrapper.attrs?.tag || 'seg'))}${serializeAttrs(wholeWordWrapper.attrs?.teiAttrs || {})}>${innerWord}</${escapeXml(String(wholeWordWrapper.attrs?.tag || 'seg'))}>`
		);
		return;
	}

	context.xml.push(buildWordXml(nodes));
}

function buildWordXml(nodes: ProseMirrorJSON[], skipMarks: string[] = []): string {
	let wordContent = `<w${serializeAttrs(extractWordAttrs(nodes))}>`;
	for (const node of nodes) {
		if (node.type === 'metamark') {
			wordContent += serializeMetamarkAttrs(extractTeiAttrs(node.attrs));
			continue;
		}
		if (node.type === 'teiAtom') {
			wordContent += serializeStructuredAtom(node.attrs || {});
			continue;
		}
		if (node.type === 'teiWrapper') {
			wordContent += serializeStructuredWrapper(node.attrs || {});
			continue;
		}
		wordContent += exportTextWithMarksInline(node, ['correction', 'word', 'punctuation', ...skipMarks]);
	}
	wordContent += '</w>';
	return wordContent;
}

function buildWrappedWordSequenceXml(
	words: WordGroup[],
	wrapper: { type: 'teiSpan'; attrs?: Record<string, any> }
): string {
	const tag = escapeXml(String(wrapper.attrs?.tag || 'seg'));
	const attrs = serializeAttrs(wrapper.attrs?.teiAttrs || {});
	return [
		`<${tag}${attrs}>`,
		...words.map(word => buildWordXml(word.content || [], [wrapper.type])),
		`</${tag}>`,
	].join('');
}

function exportCorrection(nodes: ProseMirrorJSON[], context: ExportContext): void {
	const correctionMark = nodes[0]?.marks?.find(mark => mark.type === 'correction');
	if (!correctionMark) return;

	const corrections = correctionMark.attrs?.corrections || [];
	context.xml.push('<app>');

	const originalContext: ExportContext = {
		xml: [],
		insideVerse: false,
		anonymousAbOpen: false,
		bookDivOpen: false,
		chapterDivOpen: false,
	};
	exportWord(stripMarks(nodes, ['correction']), originalContext);
	context.xml.push(`<rdg type="orig">${originalContext.xml.join('')}</rdg>`);

	for (const correction of corrections) {
		exportCorrectionReading(correction, context);
	}

	context.xml.push('</app>');
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
	let currentWord: ProseMirrorJSON[] = [];

	for (const node of content) {
		if (node.type === 'text') {
			if (node.text === ' ') {
				currentWord = flushInlineWord(currentWord, context);
				continue;
			}

			currentWord.push(node);
			continue;
		}

		if (node.type === 'lineBreak') {
			currentWord = flushInlineWord(currentWord, context);
			context.xml.push(`<lb${serializeAttrs(extractTeiAttrs(node.attrs))}/>`);
			continue;
		}

		if (node.type === 'pageBreak') {
			currentWord = flushInlineWord(currentWord, context);
			context.xml.push(`<pb${serializeAttrs(extractTeiAttrs(node.attrs))}/>`);
			continue;
		}

		if (node.type === 'columnBreak') {
			currentWord = flushInlineWord(currentWord, context);
			context.xml.push(`<cb${serializeAttrs(extractTeiAttrs(node.attrs))}/>`);
			continue;
		}

		if (node.type === 'gap') {
			currentWord = flushInlineWord(currentWord, context);
			const attrs = node.attrs || {};
			let tagAttrs = '';
			if (attrs.reason) tagAttrs += ` reason="${escapeXml(attrs.reason)}"`;
			if (attrs.unit) tagAttrs += ` unit="${escapeXml(attrs.unit)}"`;
			if (attrs.extent) tagAttrs += ` extent="${escapeXml(attrs.extent)}"`;
			context.xml.push(`<gap${tagAttrs}/>`);
			continue;
		}

		if (node.type === 'space') {
			currentWord = flushInlineWord(currentWord, context);
			context.xml.push(`<space${serializeAttrs(extractTeiAttrs(node.attrs))}/>`);
			continue;
		}

		if (node.type === 'handShift') {
			currentWord = flushInlineWord(currentWord, context);
			context.xml.push(`<handShift${serializeAttrs(extractTeiAttrs(node.attrs))}/>`);
			continue;
		}

		if (node.type === 'teiMilestone') {
			currentWord = flushInlineWord(currentWord, context);
			context.xml.push(`<milestone${serializeAttrs(extractTeiAttrs(node.attrs))}/>`);
			continue;
		}

		if (node.type === 'metamark') {
			if (!node.attrs?.wordInline) {
				currentWord = flushInlineWord(currentWord, context);
			}
			if (node.attrs?.wordInline) {
				currentWord.push(node);
			} else {
				context.xml.push(serializeMetamarkAttrs(extractTeiAttrs(node.attrs)));
			}
			continue;
		}

		if (node.type === 'teiAtom') {
			if (!node.attrs?.wordInline) {
				currentWord = flushInlineWord(currentWord, context);
			}
			if (node.attrs?.wordInline) {
				currentWord.push(node);
			} else {
				context.xml.push(serializeStructuredAtom(node.attrs || {}));
			}
			continue;
		}

		if (node.type === 'teiWrapper') {
			if (!node.attrs?.wordInline) {
				currentWord = flushInlineWord(currentWord, context);
			}
			if (node.attrs?.wordInline) {
				currentWord.push(node);
			} else {
				context.xml.push(serializeStructuredWrapper(node.attrs || {}));
			}
			continue;
		}

		if (node.type === 'fw') {
			currentWord = flushInlineWord(currentWord, context);
			exportFormWork(node.attrs || {}, context);
			continue;
		}

		if (node.type === 'correctionNode') {
			currentWord = flushInlineWord(currentWord, context);
			exportCorrectionNode(node.attrs || {}, context);
			continue;
		}
	}

	flushInlineWord(currentWord, context);
}

function flushInlineWord(
	currentWord: ProseMirrorJSON[],
	context: ExportContext
): ProseMirrorJSON[] {
	if (currentWord.length === 0) {
		return currentWord;
	}

	exportWord(currentWord, context);
	return [];
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
				marks: item.marks?.map(mark => ({
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
					mark.type === 'secl'
						? { attrs: { teiAttrs: mark.attrs || {} } }
						: {}),
					...(mark.type === 'teiSpan'
						? { attrs: { tag: mark.attrs.tag, teiAttrs: mark.attrs.teiAttrs || {} } }
						: {}),
				})),
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

		if (item.type === 'space') {
			content.push({
				type: 'space',
				attrs: { teiAttrs: item.attrs },
			});
			continue;
		}

		if (item.type === 'handShift') {
			content.push({
				type: 'handShift',
				attrs: { teiAttrs: item.attrs },
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
			});
			continue;
		}

		if (item.type === 'teiMilestone') {
			content.push({
				type: 'teiMilestone',
				attrs: { teiAttrs: item.attrs },
			});
			continue;
		}

		if (item.type === 'fw') {
			content.push({
				type: 'fw',
				attrs: {
					...item.attrs,
					content: createStructuredFormWorkContent(inlineItemsToProseMirror(item.content)),
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

function exportCorrectionReading(
	correction: Record<string, any>,
	context: ExportContext
): void {
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

function exportTextWithMarksInline(
	node: ProseMirrorJSON,
	skipMarks: string[] = []
): string {
	const text = node.text || '';
	const marks = (node.marks || []).filter(mark => !skipMarks.includes(mark.type));
	if (marks.length === 0) {
		return escapeXml(text);
	}

	let output = escapeXml(text);
	const openTags: string[] = [];
	const closeTags: string[] = [];

	for (const mark of marks) {
		switch (mark.type) {
			case 'lacunose':
				openTags.push(`<supplied${serializeAttrs(extractTeiAttrs(mark.attrs))}>`);
				closeTags.unshift('</supplied>');
				break;

			case 'unclear':
				openTags.push(`<unclear${serializeAttrs(extractTeiAttrs(mark.attrs))}>`);
				closeTags.unshift('</unclear>');
				break;

			case 'hi':
				openTags.push(`<hi${serializeAttrs(extractTeiAttrs(mark.attrs))}>`);
				closeTags.unshift('</hi>');
				break;

			case 'damage':
				openTags.push(`<damage${serializeAttrs(extractTeiAttrs(mark.attrs))}>`);
				closeTags.unshift('</damage>');
				break;

			case 'surplus':
				openTags.push(`<surplus${serializeAttrs(extractTeiAttrs(mark.attrs))}>`);
				closeTags.unshift('</surplus>');
				break;

			case 'secl':
				openTags.push(`<secl${serializeAttrs(extractTeiAttrs(mark.attrs))}>`);
				closeTags.unshift('</secl>');
				break;

			case 'teiSpan':
				openTags.push(
					`<${escapeXml(String(mark.attrs?.tag || 'seg'))}${serializeAttrs(mark.attrs?.teiAttrs || {})}>`
				);
				closeTags.unshift(`</${escapeXml(String(mark.attrs?.tag || 'seg'))}>`);
				break;

			case 'abbreviation': {
				const type = mark.attrs?.type || '';
				if (type === 'ligature') {
					const rend = mark.attrs?.rend || text || '¯';
					const expansion = mark.attrs?.expansion || '';
					openTags.push(`<ex rend="${escapeXml(rend)}">`);
					closeTags.unshift('</ex>');
					output = escapeXml(expansion);
					break;
				}

				openTags.push(`<abbr${type ? ` type="${escapeXml(type)}"` : ''}>`);
				openTags.push('<hi rend="overline">');
				closeTags.unshift('</abbr>');
				if (mark.attrs?.expansion) {
					closeTags.unshift(`<ex rend="¯">${escapeXml(mark.attrs.expansion)}</ex>`);
				}
				closeTags.unshift('</hi>');
				break;
			}
		}
	}

	return openTags.join('') + output + closeTags.join('');
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
			mark =>
				mark.type === 'teiSpan' &&
				JSON.stringify(mark.attrs || {}) === signature
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
	return !!candidate && JSON.stringify(candidate.attrs || {}) === JSON.stringify(wrapper.attrs || {});
}

function exportFormWork(attrs: Record<string, any>, context: ExportContext): void {
	const segAttrs = {
		...(attrs.segAttrs || {}),
		type: attrs.segType || attrs.segAttrs?.type || undefined,
		subtype: attrs.segSubtype || attrs.segAttrs?.subtype || undefined,
		place: attrs.segPlace || attrs.segAttrs?.place || undefined,
		hand: attrs.segHand || attrs.segAttrs?.hand || undefined,
		rend: attrs.segRend || attrs.segAttrs?.rend || undefined,
		n: attrs.segN || attrs.segAttrs?.n || undefined,
	};
	const fwAttrs = {
		...(attrs.teiAttrs || {}),
		type: attrs.type || attrs.teiAttrs?.type || undefined,
		subtype: attrs.subtype || attrs.teiAttrs?.subtype || undefined,
		place: attrs.place || attrs.teiAttrs?.place || undefined,
		hand: attrs.hand || attrs.teiAttrs?.hand || undefined,
		n: attrs.n || attrs.teiAttrs?.n || undefined,
		rend: attrs.rend || attrs.teiAttrs?.rend || undefined,
	};

	if (Object.values(segAttrs).some(value => value !== undefined && value !== '')) {
		context.xml.push(`<seg${serializeAttrs(segAttrs)}>`);
	}

	context.xml.push(`<fw${serializeAttrs(fwAttrs)}>`);
	exportInlineContent(flattenStructuredFormWorkContent(attrs.content), context);
	context.xml.push('</fw>');

	if (Object.values(segAttrs).some(value => value !== undefined && value !== '')) {
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

function closeAllDivs(context: ExportContext): void {
	closeAnonymousAb(context);
	closeVerse(context);
	if (context.chapterDivOpen) {
		context.xml.push('</div>');
		context.chapterDivOpen = false;
	}
	if (context.bookDivOpen) {
		context.xml.push('</div>');
		context.bookDivOpen = false;
	}
}

function ensureCurrentDivs(context: ExportContext): void {
	if (context.currentBook && !context.bookDivOpen) {
		context.xml.push(`<div type="book" n="${escapeXml(context.currentBook)}">`);
		context.bookDivOpen = true;
	}

	if (context.currentChapter && !context.chapterDivOpen) {
		const chapterId =
			context.currentBook && !context.currentChapter.startsWith(`${context.currentBook}.`)
				? `${context.currentBook}.${context.currentChapter}`
				: context.currentChapter;
		context.xml.push(`<div type="chapter" n="${escapeXml(chapterId)}">`);
		context.chapterDivOpen = true;
	}
}

function buildVerseId(attrs?: Record<string, any>): string {
	if (!attrs) return '';
	if (attrs.chapter && attrs.verse) return `${attrs.chapter}.${attrs.verse}`;
	return attrs.verse || '';
}

function extractTeiAttrs(attrs: Record<string, any> | undefined): Record<string, string | undefined> {
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

function serializeStructuredAtom(attrs: Record<string, any>): string {
	if (attrs.teiNode && typeof attrs.teiNode === 'object') {
		return serializeTeiNode(attrs.teiNode);
	}
	if (attrs.node && typeof attrs.node === 'object') {
		return serializeTeiNode(attrs.node);
	}

	const tag = String(attrs.tag || 'note');
	const teiAttrs = (attrs.teiAttrs as Record<string, string>) || {};
	const text = attrs.text ? escapeXml(String(attrs.text)) : '';
	if (!text) {
		return `<${tag}${serializeAttrs(teiAttrs)}/>`;
	}
	return `<${tag}${serializeAttrs(teiAttrs)}>${text}</${tag}>`;
}

function serializeStructuredWrapper(attrs: Record<string, any>): string {
	if (attrs.teiNode && typeof attrs.teiNode === 'object') {
		return serializeTeiNode(attrs.teiNode);
	}

	const node: TeiElementNode = {
		type: 'element',
		tag: String(attrs.tag || 'seg'),
		attrs:
			attrs.teiAttrs && typeof attrs.teiAttrs === 'object'
				? (attrs.teiAttrs as Record<string, string>)
				: undefined,
		children: Array.isArray(attrs.children) ? attrs.children : [],
	};
	return serializeTeiNode(node);
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
	return (
		' ' +
		pairs
			.map(([key, value]) => `${key}="${escapeXml(String(value))}"`)
			.join(' ')
	);
}
