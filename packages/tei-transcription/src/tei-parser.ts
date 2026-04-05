import { WORD_BOUNDARY_ITEM, normalizeDocument } from './normalize';
import { isSimpleCorrectionApp } from './tei-apparatus';
import { createTeiAtomItem, isRecognizedTeiAtomTag } from './tei-atom';
import {
	createEditorialActionItem,
	isEditorialActionTag,
} from './tei-editorial';
import { extractTeiHeaderInfo, extractTeiMetadataFromHeader } from './tei-header';
import { getInlineSpanHandling, isFlatInlineSpanTag } from './tei-inline';
import { createMetamarkItem } from './tei-metamark';
import { parseChildNodes, parseElementTree } from './tei-tree';
import type {
	CorrectionReading,
	EditorialActionItem,
	FormWorkItem,
	GapItem,
	HandShiftItem,
	InlineItem,
	LineItem,
	MetamarkItem,
	MilestoneItem,
	ProseMirrorJSON,
	SpaceItem,
	TeiWrapperItem,
	TeiMilestoneItem,
	TextItem,
	TextMark,
	TranscriptionColumn,
	TranscriptionDocument,
	TranscriptionLine,
	TranscriptionPage,
	UntranscribedItem,
	FrameZone,
} from './types';

interface ParseContext {
	currentBook?: string;
	currentChapter?: string;
	currentVerse?: string;
	currentPage?: string;
	currentPageAttrs?: Record<string, string>;
	currentColumn: number;
	currentColumnAttrs?: Record<string, string>;
	currentColumnZone?: FrameZone;
	currentLine: number;
	currentLineAttrs?: Record<string, string>;
	currentLineWrapped?: boolean;
	currentLineParagraphStart?: boolean;
	currentColumnWrapped?: boolean;
	currentPageWrapped?: boolean;
	pendingBookMilestone?: MilestoneItem;
	pendingChapterMilestone?: MilestoneItem;
	bookMilestoneEmitted?: string;
	chapterMilestoneEmitted?: string;
	pages: TranscriptionPage[];
	currentPageColumns?: TranscriptionColumn[];
	currentColumnLines?: TranscriptionLine[];
	currentLineItems?: LineItem[];
}

export function parseTei(xmlString: string): TranscriptionDocument {
	const parser = new DOMParser();
	const doc = parser.parseFromString(xmlString, 'application/xml');

	if (doc.getElementsByTagName('parsererror').length > 0) {
		throw new Error('Failed to parse XML');
	}

	const context: ParseContext = {
		pages: [],
		currentColumn: 1,
		currentLine: 1,
	};

	const teiRoot = doc.getElementsByTagName('TEI')[0] || doc.documentElement;
	const textElement = getImmediateChildElement(teiRoot, 'text');
	const body = textElement ? getImmediateChildElement(textElement, 'body') : null;
	validateSupportedTeiDocument(teiRoot, textElement);
	if (body) {
		processNode(body, context);
	}

	flushCurrentLine(context);
	flushCurrentColumn(context);
	flushCurrentPage(context);

	const textPreservation = textElement
		? collectTextPreservation(textElement)
		: {
				textAttrs: undefined,
				bodyAttrs: undefined,
				front: undefined,
				back: undefined,
				textLeading: undefined,
				textBetweenFrontBody: undefined,
				textBetweenBodyBack: undefined,
				textTrailing: undefined,
			};

	const header = extractTeiHeaderInfo(teiRoot, textElement);

	return normalizeDocument({
		type: 'transcriptionDocument',
		pages: context.pages,
		metadata: extractTeiMetadataFromHeader(header),
		header,
		teiAttrs: optionalAttributes(collectAttributes(teiRoot, getNamespaceAttributeNames(teiRoot))),
		textAttrs: textPreservation.textAttrs,
		bodyAttrs: textPreservation.bodyAttrs,
		teiHeader: getImmediateChildElement(teiRoot, 'teiheader')
			? parseElementTree(getImmediateChildElement(teiRoot, 'teiheader')!)
			: undefined,
		front: textPreservation.front,
		back: textPreservation.back,
		textLeading: textPreservation.textLeading,
		textBetweenFrontBody: textPreservation.textBetweenFrontBody,
		textBetweenBodyBack: textPreservation.textBetweenBodyBack,
		textTrailing: textPreservation.textTrailing,
		resourceNodes: getImmediateResourceNodes(teiRoot),
		nestedTei: getImmediateChildrenTrees(teiRoot, 'tei'),
		facsimile: getImmediateChildrenTrees(teiRoot, 'facsimile'),
		standOff: getImmediateChildrenTrees(teiRoot, 'standoff'),
		sourceDoc: getImmediateChildrenTrees(teiRoot, 'sourcedoc'),
	});
}

function processNode(node: Node, context: ParseContext): void {
	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent || '';
			if (text.trim()) {
				ensureLineItems(context);
				pushText(context.currentLineItems!, { type: 'text', text });
			}
			continue;
		}

		if (child.nodeType !== Node.ELEMENT_NODE) continue;
		const element = child as Element;
		const tagName = element.tagName.toLowerCase();

		switch (tagName) {
			case 'pb':
				handlePageBreak(element, context);
				break;

			case 'cb':
				handleColumnBreak(element, context, false);
				break;

			case 'lb':
				handleLineBreak(element, context, false);
				break;

			case 'div':
				handleDiv(element, context);
				break;

			case 'ab':
				handleVerseBlock(element, context);
				break;

			case 'w':
				emitPendingMilestones(context);
				processWordElement(element, context, withWordAttrs(element, []));
				appendWordBoundary(context.currentLineItems!);
				break;

			case 'pc':
				emitPendingMilestones(context);
				ensureLineItems(context);
				pushText(context.currentLineItems!, {
					type: 'text',
					text: element.textContent || '',
					marks: [{ type: 'punctuation', attrs: collectAttributes(element) }],
				});
				break;

			case 'gap':
				emitPendingMilestones(context);
				ensureLineItems(context);
				context.currentLineItems!.push(createGapItem(element));
				break;

			case 'space':
				emitPendingMilestones(context);
				ensureLineItems(context);
				context.currentLineItems!.push(createSpaceItem(element));
				break;

			case 'handshift':
				emitPendingMilestones(context);
				ensureLineItems(context);
				context.currentLineItems!.push(createHandShiftItem(element));
				break;

			case 'milestone':
				emitPendingMilestones(context);
				ensureLineItems(context);
				context.currentLineItems!.push(createTeiMilestoneItem(element));
				break;

			case 'note':
				if (element.getAttribute('type') === 'untranscribed') {
					emitPendingMilestones(context);
					ensureLineItems(context);
					context.currentLineItems!.push(createUntranscribedItem(element));
				} else {
					emitPendingMilestones(context);
					ensureLineItems(context);
					context.currentLineItems!.push(createTeiAtomLineItem(element));
				}
				break;

			case 'app':
				emitPendingMilestones(context);
				processApparatusElement(element, context);
				break;

			case 'listapp':
			case 'notegrp':
				throw unsupportedElementError(element, 'Multi-witness apparatus is out of scope');
				break;

			case 'seg':
				emitPendingMilestones(context);
				handleSegmentElement(element, context);
				break;

			case 'fw':
				emitPendingMilestones(context);
				ensureLineItems(context);
				context.currentLineItems!.push(createFormWorkItem(element));
				break;

			case 'supplied':
				emitPendingMilestones(context);
				processContainerContent(element, context, [
					{ type: 'lacunose', attrs: collectAttributes(element) },
				]);
				break;

			case 'damage':
				emitPendingMilestones(context);
				processContainerContent(element, context, [
					{ type: 'damage', attrs: collectAttributes(element) },
				]);
				break;

			case 'surplus':
				emitPendingMilestones(context);
				processContainerContent(element, context, [
					{ type: 'surplus', attrs: collectAttributes(element) },
				]);
				break;

			case 'secl':
				emitPendingMilestones(context);
				processContainerContent(element, context, [
					{ type: 'secl', attrs: collectAttributes(element) },
				]);
				break;

			case 'unclear':
				emitPendingMilestones(context);
				processContainerContent(element, context, [
					{ type: 'unclear', attrs: collectAttributes(element) },
				]);
				break;

			case 'hi':
				emitPendingMilestones(context);
				processContainerContent(element, context, [
					{ type: 'hi', attrs: collectAttributes(element) },
				]);
				break;

			case 'abbr':
				emitPendingMilestones(context);
				processContainerContent(element, context, []);
				break;

			case 'ex':
				emitPendingMilestones(context);
				processContainerContent(element, context, []);
				break;

			default:
				if (tagName === 'metamark' && !hasMeaningfulChildContent(element)) {
					emitPendingMilestones(context);
					ensureLineItems(context);
					context.currentLineItems!.push(createMetamarkLineItem(element));
					break;
				}

				if (isFlatInlineSpanTag(tagName)) {
					emitPendingMilestones(context);
					const handling = getInlineSpanHandling(element);
					if (handling === 'flat') {
						processContainerContent(element, context, [createTeiSpanMark(element)]);
					} else if (handling === 'structured') {
						ensureLineItems(context);
						context.currentLineItems!.push(createTeiWrapperItem(element));
					} else {
						throw unsupportedElementError(
							element,
							'Non-flat inline wrappers are out of scope for the single-witness transcription model'
						);
					}
					break;
				}

				if (isEditorialActionTag(tagName)) {
					emitPendingMilestones(context);
					ensureLineItems(context);
					context.currentLineItems!.push(createEditorialActionLineItem(element));
					break;
				}

				if (isRecognizedTeiAtomTag(tagName)) {
					emitPendingMilestones(context);
					ensureLineItems(context);
					context.currentLineItems!.push(createTeiAtomLineItem(element));
					break;
				}

				throw unsupportedElementError(element);
				break;
		}
	}
}

function handleDiv(element: Element, context: ParseContext): void {
	const divType = element.getAttribute('type');
	const divN = element.getAttribute('n') || '';

	if (divType === 'book') {
		context.currentBook = divN;
		if (context.currentBook !== context.bookMilestoneEmitted) {
			context.pendingBookMilestone = {
				type: 'milestone',
				kind: 'book',
				attrs: { book: divN },
			};
		}
	}

	if (divType === 'chapter') {
		context.currentChapter = divN.split('.').pop() || divN;
		if (context.currentChapter !== context.chapterMilestoneEmitted) {
			context.pendingChapterMilestone = {
				type: 'milestone',
				kind: 'chapter',
				attrs: {
					book: context.currentBook || '',
					chapter: context.currentChapter,
				},
			};
		}
	}

	processNode(element, context);
}

function handleVerseBlock(element: Element, context: ParseContext): void {
	const abN = element.getAttribute('n');
	if (abN) {
		context.currentVerse = abN;
		ensureLineItems(context);
		emitPendingMilestones(context);
		context.currentLineItems!.push(createVerseMilestone(abN, context.currentBook, context.currentChapter));
	}
	processNode(element, context);
}

function handlePageBreak(element: Element, context: ParseContext, insideWord = false): void {
	flushCurrentLine(context);
	flushCurrentColumn(context);
	flushCurrentPage(context);

	context.currentPage = element.getAttribute('n') || '';
	context.currentPageAttrs = collectAttributes(element);
	context.currentColumn = 0;
	context.currentLine = 1;
	context.currentPageWrapped = element.getAttribute('break') === 'no' && insideWord;
	ensurePageColumns(context);
}

const VALID_FRAME_ZONES: ReadonlySet<string> = new Set(['top', 'left', 'center', 'right', 'bottom']);

function handleColumnBreak(element: Element, context: ParseContext, insideWord: boolean): void {
	flushCurrentLine(context);
	flushCurrentColumn(context);

	const nAttr = element.getAttribute('n');
	const columnMatch = nAttr?.match(/C(\d+)/);
	context.currentColumn = columnMatch ? parseInt(columnMatch[1], 10) : context.currentColumn + 1;
	context.currentColumnAttrs = collectAttributes(element);
	context.currentLine = 1;

	const typeAttr = element.getAttribute('type');
	const subtypeAttr = element.getAttribute('subtype');
	if (typeAttr === 'frame' && subtypeAttr && VALID_FRAME_ZONES.has(subtypeAttr)) {
		context.currentColumnZone = subtypeAttr as FrameZone;
		// Remove type/subtype from teiAttrs since they'll be re-derived from zone
		if (context.currentColumnAttrs) {
			delete context.currentColumnAttrs['type'];
			delete context.currentColumnAttrs['subtype'];
		}
	} else {
		context.currentColumnZone = undefined;
	}

	const isContinuation = element.getAttribute('break') === 'no' && insideWord;
	if (isContinuation || context.currentPageWrapped) {
		context.currentColumnWrapped = true;
		context.currentLineWrapped = true;
	}

	ensureColumnLines(context);
}

function handleLineBreak(element: Element, context: ParseContext, insideWord: boolean): void {
	const hadContent = (context.currentLineItems?.length || 0) > 0;
	if (!hadContent) {
		context.currentLineAttrs = collectAttributes(element);
		if (element.getAttribute('rend') === 'hang') {
			context.currentLineParagraphStart = true;
		}
		if (insideWord) {
			context.currentLineWrapped = true;
		}
		return;
	}

	flushCurrentLine(context);
	context.currentLine += 1;
	context.currentLineAttrs = collectAttributes(element);
	if (insideWord) {
		context.currentLineWrapped = true;
	}
	if (element.getAttribute('rend') === 'hang') {
		context.currentLineParagraphStart = true;
	}
	ensureLineItems(context);
}

function processWordElement(
	wordElement: Element,
	context: ParseContext,
	activeMarks: TextMark[]
): void {
	ensureLineItems(context);

	for (const child of Array.from(wordElement.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent || '';
			if (hasMeaningfulText(text)) {
				ensureLineItems(context);
				pushText(context.currentLineItems!, { type: 'text', text, marks: activeMarks });
			}
			continue;
		}

		if (child.nodeType !== Node.ELEMENT_NODE) continue;
		const element = child as Element;
		const tagName = element.tagName.toLowerCase();

		if (tagName === 'lb') {
			handleLineBreak(element, context, true);
			continue;
		}

		if (tagName === 'cb') {
			handleColumnBreak(element, context, true);
			continue;
		}

		if (tagName === 'pb') {
			handlePageBreak(element, context, true);
			continue;
		}

		if (tagName === 'supplied') {
			processWordElement(element, context, [
				...activeMarks,
				{ type: 'lacunose', attrs: collectAttributes(element) },
			]);
			continue;
		}

		if (tagName === 'damage') {
			processWordElement(element, context, [
				...activeMarks,
				{ type: 'damage', attrs: collectAttributes(element) },
			]);
			continue;
		}

		if (tagName === 'surplus') {
			processWordElement(element, context, [
				...activeMarks,
				{ type: 'surplus', attrs: collectAttributes(element) },
			]);
			continue;
		}

		if (tagName === 'secl') {
			processWordElement(element, context, [
				...activeMarks,
				{ type: 'secl', attrs: collectAttributes(element) },
			]);
			continue;
		}

		if (tagName === 'unclear') {
			processWordElement(element, context, [
				...activeMarks,
				{ type: 'unclear', attrs: collectAttributes(element) },
			]);
			continue;
		}

		if (tagName === 'hi') {
			processWordElement(element, context, [
				...activeMarks,
				{ type: 'hi', attrs: collectAttributes(element) },
			]);
			continue;
		}

		if (isFlatInlineSpanTag(tagName)) {
			const handling = getInlineSpanHandling(element);
			if (handling === 'flat') {
				processWordElement(element, context, [
					...activeMarks,
					createTeiSpanMark(element),
				]);
			} else {
				if (tagName === 'metamark') {
					ensureLineItems(context);
					context.currentLineItems!.push(createMetamarkLineItem(element, true));
				} else if (isRecognizedTeiAtomTag(tagName)) {
					ensureLineItems(context);
					context.currentLineItems!.push(createTeiAtomInlineItem(element, true));
				} else if (handling === 'structured') {
					ensureLineItems(context);
					context.currentLineItems!.push(createTeiWrapperItem(element, true));
				} else {
					throw unsupportedElementError(
						element,
						'Non-flat inline wrappers are out of scope for the single-witness transcription model'
					);
				}
			}
			continue;
		}

		if (tagName === 'space') {
			ensureLineItems(context);
			context.currentLineItems!.push(createSpaceItem(element));
			continue;
		}

		if (tagName === 'gap') {
			ensureLineItems(context);
			context.currentLineItems!.push(createGapItem(element));
			continue;
		}

		if (tagName === 'handshift') {
			ensureLineItems(context);
			context.currentLineItems!.push(createHandShiftItem(element));
			continue;
		}

		if (tagName === 'milestone') {
			ensureLineItems(context);
			context.currentLineItems!.push(createTeiMilestoneItem(element));
			continue;
		}

		if (tagName === 'abbr') {
			const abbrType = element.getAttribute('type') || 'nomSac';
			const expansion = extractExpansionText(element);
			const abbrText = extractAbbrText(element);
			ensureLineItems(context);
			pushText(context.currentLineItems!, {
				type: 'text',
				text: abbrText,
				marks: [...activeMarks, { type: 'abbreviation', attrs: { type: abbrType, expansion } }],
			});
			continue;
		}

		if (tagName === 'ex') {
			const rend = element.getAttribute('rend') || '¯';
			const expansion = element.textContent || '';
			ensureLineItems(context);
			pushText(context.currentLineItems!, {
				type: 'text',
				text: rend,
				marks: [...activeMarks, { type: 'abbreviation', attrs: { type: 'ligature', rend, expansion } }],
			});
			continue;
		}

		ensureLineItems(context);
		if (isRecognizedTeiAtomTag(tagName)) {
			context.currentLineItems!.push(createTeiAtomInlineItem(element, true));
		} else {
			throw unsupportedElementError(element);
		}
	}
}

function processApparatusElement(appElement: Element, context: ParseContext): void {
	processApparatusElementWithMarks(appElement, context, []);
}

function processApparatusElementWithMarks(
	appElement: Element,
	context: ParseContext,
	baseMarks: TextMark[]
): void {
	if (!isSimpleCorrectionApp(appElement)) {
		throw unsupportedElementError(
			appElement,
			'Only single-witness correction-style app/rdg structures are supported'
		);
	}

	const readings = Array.from(appElement.getElementsByTagName('rdg')) as Element[];
	const corrections = collectCorrectionReadings(readings, baseMarks);

	const origReading = readings.find(rdg => {
		const type = rdg.getAttribute('type');
		return type === 'orig' || !type;
	});

	if (!origReading) {
		throw unsupportedElementError(appElement, 'Correction-style app requires an orig reading');
	}

	if (corrections.length === 0) {
		processReadingContent(origReading, context, baseMarks);
		return;
	}

	if (!hasReadingContent(origReading)) {
		ensureLineItems(context);
		context.currentLineItems!.push({
			type: 'correctionOnly',
			corrections,
		});
		return;
	}

	processReadingContent(origReading, context, [
		...baseMarks,
		{ type: 'correction', attrs: { corrections } },
	]);
}

function processContainerContent(
	element: Element,
	context: ParseContext,
	marks: TextMark[]
): void {
	for (const child of Array.from(element.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent || '';
			if (text.trim()) {
				ensureLineItems(context);
				pushText(context.currentLineItems!, { type: 'text', text, marks });
			}
			continue;
		}

		if (child.nodeType !== Node.ELEMENT_NODE) continue;
		const element = child as Element;
		const tagName = element.tagName.toLowerCase();

		if (tagName === 'w') {
			processWordElement(element, context, withWordAttrs(element, marks));
			appendWordBoundary(context.currentLineItems!);
			continue;
		}

		if (tagName === 'space') {
			ensureLineItems(context);
			context.currentLineItems!.push(createSpaceItem(element));
			continue;
		}

		if (tagName === 'gap') {
			ensureLineItems(context);
			context.currentLineItems!.push(createGapItem(element));
			continue;
		}

		if (tagName === 'handshift') {
			ensureLineItems(context);
			context.currentLineItems!.push(createHandShiftItem(element));
			continue;
		}

		if (tagName === 'milestone') {
			ensureLineItems(context);
			context.currentLineItems!.push(createTeiMilestoneItem(element));
			continue;
		}

		if (tagName === 'pb') {
			handlePageBreak(element, context, false);
			continue;
		}

		if (tagName === 'cb') {
			handleColumnBreak(element, context, false);
			continue;
		}

		if (tagName === 'lb') {
			handleLineBreak(element, context, false);
			continue;
		}

		if (tagName === 'app') {
			processApparatusElementWithMarks(element, context, marks);
			continue;
		}

		if (tagName === 'seg') {
			processContainerContent(element, context, marks);
			continue;
		}

		if (tagName === 'fw') {
			ensureLineItems(context);
			context.currentLineItems!.push(createFormWorkItem(element, null, marks));
			continue;
		}

		if (tagName === 'supplied') {
			processContainerContent(element, context, [
				...marks,
				{ type: 'lacunose', attrs: collectAttributes(element) },
			]);
			continue;
		}

		if (tagName === 'damage') {
			processContainerContent(element, context, [
				...marks,
				{ type: 'damage', attrs: collectAttributes(element) },
			]);
			continue;
		}

		if (tagName === 'surplus') {
			processContainerContent(element, context, [
				...marks,
				{ type: 'surplus', attrs: collectAttributes(element) },
			]);
			continue;
		}

		if (tagName === 'secl') {
			processContainerContent(element, context, [
				...marks,
				{ type: 'secl', attrs: collectAttributes(element) },
			]);
			continue;
		}

		if (tagName === 'unclear') {
			processContainerContent(element, context, [
				...marks,
				{ type: 'unclear', attrs: collectAttributes(element) },
			]);
			continue;
		}

		if (tagName === 'hi') {
			processContainerContent(element, context, [
				...marks,
				{ type: 'hi', attrs: collectAttributes(element) },
			]);
			continue;
		}

		if (isFlatInlineSpanTag(tagName)) {
			const handling = getInlineSpanHandling(element);
			if (handling === 'flat') {
				processContainerContent(element, context, [...marks, createTeiSpanMark(element)]);
			} else {
				if (tagName === 'metamark') {
					ensureLineItems(context);
					context.currentLineItems!.push(createMetamarkLineItem(element));
				} else if (isRecognizedTeiAtomTag(tagName)) {
					ensureLineItems(context);
					context.currentLineItems!.push(createTeiAtomLineItem(element));
				} else if (handling === 'structured') {
					ensureLineItems(context);
					context.currentLineItems!.push(createTeiWrapperItem(element));
				} else {
					throw unsupportedElementError(
						element,
						'Non-flat inline wrappers are out of scope for the single-witness transcription model'
					);
				}
			}
			continue;
		}

		if (tagName === 'pc') {
			ensureLineItems(context);
			pushText(context.currentLineItems!, {
				type: 'text',
				text: element.textContent || '',
				marks: [...marks, { type: 'punctuation', attrs: collectAttributes(element) }],
			});
			continue;
		}

		if (tagName === 'abbr') {
			const abbrType = element.getAttribute('type') || 'nomSac';
			const expansion = extractExpansionText(element);
			ensureLineItems(context);
			pushText(context.currentLineItems!, {
				type: 'text',
				text: extractAbbrText(element),
				marks: [...marks, { type: 'abbreviation', attrs: { type: abbrType, expansion } }],
			});
			continue;
		}

		if (tagName === 'ex') {
			const rend = element.getAttribute('rend') || '¯';
			const expansion = element.textContent || '';
			ensureLineItems(context);
			pushText(context.currentLineItems!, {
				type: 'text',
				text: rend,
				marks: [...marks, { type: 'abbreviation', attrs: { type: 'ligature', rend, expansion } }],
			});
			continue;
		}

		ensureLineItems(context);
		if (isRecognizedTeiAtomTag(tagName)) {
			context.currentLineItems!.push(createTeiAtomLineItem(element));
		} else {
			throw unsupportedElementError(element);
		}
	}
}

function processReadingContent(
	rdgElement: Element,
	context: ParseContext,
	marks: TextMark[]
): void {
	processContainerContent(rdgElement, context, marks);
}

function processInlineElementToInlineContent(
	element: Element,
	activeMarks: TextMark[] = []
): InlineItem[] {
	const content: InlineItem[] = [];

	const tagName = element.tagName.toLowerCase();

	if (tagName === 'pb') {
		content.push({
			type: 'pageBreak',
			attrs: collectAttributes(element),
		});
		return content;
	}

	if (tagName === 'lb') {
		content.push({
			type: 'lineBreak',
			attrs: collectAttributes(element),
		});
		return content;
	}

	if (tagName === 'cb') {
		content.push(createColumnBreakItem(element));
		return content;
	}

	if (tagName === 'w') {
		content.push(...processWordForInlineContent(element, withWordAttrs(element, activeMarks)));
		appendWordBoundary(content);
		return content;
	}

	if (tagName === 'space') {
		content.push(createSpaceItem(element));
		return content;
	}

	if (tagName === 'gap') {
		content.push(createGapItem(element));
		return content;
	}

	if (tagName === 'handshift') {
		content.push(createHandShiftItem(element));
		return content;
	}

	if (tagName === 'milestone') {
		content.push(createTeiMilestoneItem(element));
		return content;
	}

	if (tagName === 'pc') {
		pushText(content, {
			type: 'text',
			text: element.textContent || '',
			marks: [...activeMarks, { type: 'punctuation', attrs: collectAttributes(element) }],
		});
		return content;
	}

	if (tagName === 'app') {
		return processApparatusToInlineContent(element, activeMarks);
	}

	if (tagName === 'seg') {
		const fwChildren = Array.from(element.childNodes).filter(
			child =>
				child.nodeType === Node.ELEMENT_NODE &&
				(child as Element).tagName.toLowerCase() === 'fw'
		) as Element[];
		if (fwChildren.length > 0) {
			return fwChildren.map(fwChild => createFormWorkItem(fwChild, element, activeMarks));
		}
		return processReadingToInlineContent(element, activeMarks);
	}

	if (tagName === 'fw') {
		return [createFormWorkItem(element, null, activeMarks)];
	}

	if (tagName === 'supplied') {
		return processInlineContainerToInlineContent(element, [
			...activeMarks,
			{ type: 'lacunose', attrs: collectAttributes(element) },
		]);
	}

	if (tagName === 'damage') {
		return processInlineContainerToInlineContent(element, [
			...activeMarks,
			{ type: 'damage', attrs: collectAttributes(element) },
		]);
	}

	if (tagName === 'surplus') {
		return processInlineContainerToInlineContent(element, [
			...activeMarks,
			{ type: 'surplus', attrs: collectAttributes(element) },
		]);
	}

	if (tagName === 'secl') {
		return processInlineContainerToInlineContent(element, [
			...activeMarks,
			{ type: 'secl', attrs: collectAttributes(element) },
		]);
	}

	if (tagName === 'unclear') {
		return processInlineContainerToInlineContent(element, [
			...activeMarks,
			{ type: 'unclear', attrs: collectAttributes(element) },
		]);
	}

	if (tagName === 'hi') {
		return processInlineContainerToInlineContent(element, [
			...activeMarks,
			{ type: 'hi', attrs: collectAttributes(element) },
		]);
	}

	if (tagName === 'abbr') {
		const abbrType = element.getAttribute('type') || 'nomSac';
		const expansion = extractExpansionText(element);
		pushText(content, {
			type: 'text',
			text: extractAbbrText(element),
			marks: [...activeMarks, { type: 'abbreviation', attrs: { type: abbrType, expansion } }],
		});
		return content;
	}

	if (tagName === 'ex') {
		const rend = element.getAttribute('rend') || '¯';
		const expansion = element.textContent || '';
		pushText(content, {
			type: 'text',
			text: rend,
			marks: [
				...activeMarks,
				{ type: 'abbreviation', attrs: { type: 'ligature', rend, expansion } },
			],
		});
		return content;
	}

	if (isFlatInlineSpanTag(tagName)) {
		const handling = getInlineSpanHandling(element);
		if (handling === 'flat') {
			return processInlineContainerToInlineContent(element, [
				...activeMarks,
				createTeiSpanMark(element),
			]);
		}
		if (tagName === 'metamark') {
			return [createMetamarkInlineItem(element)];
		}
		if (isRecognizedTeiAtomTag(tagName)) {
			return [createTeiAtomInlineItem(element)];
		}
		if (handling === 'structured') {
			return [createTeiWrapperItem(element)];
		}
		throw unsupportedElementError(
			element,
			'Non-flat inline wrappers are out of scope for the single-witness transcription model'
		);
	}

	if (isRecognizedTeiAtomTag(tagName)) {
		return [createTeiAtomInlineItem(element)];
	}

	throw unsupportedElementError(element);
}

function processReadingToInlineContent(
	element: Element,
	activeMarks: TextMark[] = []
): InlineItem[] {
	const content: InlineItem[] = [];

	for (const child of Array.from(element.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent || '';
			if (text.trim()) {
				pushText(content, { type: 'text', text, marks: activeMarks });
			}
			continue;
		}

		if (child.nodeType !== Node.ELEMENT_NODE) continue;
		const childElement = child as Element;
		if (
			childElement.tagName.toLowerCase() === 'fw' &&
			element.tagName.toLowerCase() === 'seg'
		) {
			content.push(createFormWorkItem(childElement, null, activeMarks));
			continue;
		}
		content.push(...processInlineElementToInlineContent(childElement, activeMarks));
	}

	return trimInlineBoundaries(content);
}

function processApparatusToInlineContent(
	appElement: Element,
	baseMarks: TextMark[] = []
): InlineItem[] {
	if (!isSimpleCorrectionApp(appElement)) {
		throw unsupportedElementError(
			appElement,
			'Only single-witness correction-style app/rdg structures are supported'
		);
	}

	const readings = Array.from(appElement.getElementsByTagName('rdg')) as Element[];
	const corrections = collectCorrectionReadings(readings, baseMarks);

	const origReading = readings.find(rdg => {
		const type = rdg.getAttribute('type');
		return type === 'orig' || !type;
	});

	if (!origReading) {
		throw unsupportedElementError(appElement, 'Correction-style app requires an orig reading');
	}

	if (corrections.length === 0) {
		return processReadingToInlineContent(origReading, baseMarks);
	}

	if (!hasReadingContent(origReading)) {
		return [
			{
				type: 'correctionOnly',
				corrections,
			},
		];
	}

	return applyCorrectionMarkToInlineItems(processReadingToInlineContent(origReading, baseMarks), corrections);
}

function collectCorrectionReadings(
	readings: Element[],
	baseMarks: TextMark[] = []
): CorrectionReading[] {
	const corrections: CorrectionReading[] = [];

	for (const rdg of readings) {
		if (rdg.getAttribute('wit')) {
			throw unsupportedElementError(rdg, 'Witness-based rdg semantics are out of scope');
		}
		const rdgType = rdg.getAttribute('type');
		if (!rdgType || rdgType === 'orig') continue;

		const segElements = Array.from(rdg.getElementsByTagName('seg')) as Element[];
		const contentElement = segElements[0] || rdg;
		const correction: CorrectionReading = {
			hand: rdg.getAttribute('hand') || 'unknown',
			content: processReadingToInlineContent(contentElement, baseMarks),
		};

		const readingAttrs = collectAttributes(rdg, new Set(['hand']));
		if (Object.keys(readingAttrs).length > 0) {
			correction.readingAttrs = readingAttrs;
		}
		if (rdg.getAttribute('rend')) {
			correction.rend = rdg.getAttribute('rend') || undefined;
		}

		if (segElements[0]?.getAttribute('type')) {
			correction.type = segElements[0].getAttribute('type') || undefined;
		}
		if (segElements[0]?.getAttribute('subtype')) {
			correction.position = segElements[0].getAttribute('subtype') || undefined;
		}
		if (segElements[0]) {
			const segmentAttrs = collectAttributes(segElements[0]);
			if (Object.keys(segmentAttrs).length > 0) {
				correction.segmentAttrs = segmentAttrs;
			}
		}

		corrections.push(correction);
	}

	return corrections;
}

function processWordForInlineContent(wordElement: Element, activeMarks: TextMark[]): InlineItem[] {
	const content: InlineItem[] = [];

	for (const child of Array.from(wordElement.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent || '';
			if (hasMeaningfulText(text)) {
				pushText(content, { type: 'text', text, marks: activeMarks });
			}
			continue;
		}

		if (child.nodeType !== Node.ELEMENT_NODE) continue;
		const el = child as Element;
		const tagName = el.tagName.toLowerCase();

		if (tagName === 'lb') {
			content.push({
				type: 'lineBreak',
				attrs: collectAttributes(el),
			});
			continue;
		}

		if (tagName === 'supplied') {
			content.push(
				...processWordForInlineContent(el, [
					...activeMarks,
					{ type: 'lacunose', attrs: collectAttributes(el) },
				])
			);
			continue;
		}

		if (tagName === 'damage') {
			content.push(
				...processWordForInlineContent(el, [
					...activeMarks,
					{ type: 'damage', attrs: collectAttributes(el) },
				])
			);
			continue;
		}

		if (tagName === 'surplus') {
			content.push(
				...processWordForInlineContent(el, [
					...activeMarks,
					{ type: 'surplus', attrs: collectAttributes(el) },
				])
			);
			continue;
		}

		if (tagName === 'secl') {
			content.push(
				...processWordForInlineContent(el, [
					...activeMarks,
					{ type: 'secl', attrs: collectAttributes(el) },
				])
			);
			continue;
		}

		if (tagName === 'unclear') {
			content.push(
				...processWordForInlineContent(el, [
					...activeMarks,
					{ type: 'unclear', attrs: collectAttributes(el) },
				])
			);
			continue;
		}

		if (tagName === 'hi') {
			content.push(
				...processWordForInlineContent(el, [
					...activeMarks,
					{ type: 'hi', attrs: collectAttributes(el) },
				])
			);
			continue;
		}

		if (isFlatInlineSpanTag(tagName)) {
			const handling = getInlineSpanHandling(el);
			if (handling === 'flat') {
				content.push(
					...processWordForInlineContent(el, [
						...activeMarks,
						createTeiSpanMark(el),
					])
				);
			} else {
				if (tagName === 'metamark') {
					content.push(createMetamarkInlineItem(el, true));
				} else if (isRecognizedTeiAtomTag(tagName)) {
					content.push(createTeiAtomInlineItem(el, true));
				} else if (handling === 'structured') {
					content.push(createTeiWrapperItem(el, true));
				} else {
					throw unsupportedElementError(
						el,
						'Non-flat inline wrappers are out of scope for the single-witness transcription model'
					);
				}
			}
			continue;
		}

		if (tagName === 'space') {
			content.push(createSpaceItem(el));
			continue;
		}

		if (tagName === 'gap') {
			content.push(createGapItem(el));
			continue;
		}

		if (tagName === 'handshift') {
			content.push(createHandShiftItem(el));
			continue;
		}

		if (tagName === 'milestone') {
			content.push(createTeiMilestoneItem(el));
			continue;
		}

		if (tagName === 'abbr') {
			const abbrType = el.getAttribute('type') || 'nomSac';
			const expansion = extractExpansionText(el);
			pushText(content, {
				type: 'text',
				text: extractAbbrText(el),
				marks: [...activeMarks, { type: 'abbreviation', attrs: { type: abbrType, expansion } }],
			});
			continue;
		}

		if (tagName === 'ex') {
			const rend = el.getAttribute('rend') || '¯';
			const expansion = el.textContent || '';
			pushText(content, {
				type: 'text',
				text: rend,
				marks: [...activeMarks, { type: 'abbreviation', attrs: { type: 'ligature', rend, expansion } }],
			});
			continue;
		}

		if (isRecognizedTeiAtomTag(tagName)) {
			content.push(createTeiAtomInlineItem(el, true));
		} else {
			throw unsupportedElementError(el);
		}
	}

	return content;
}

function hasReadingContent(rdgElement: Element): boolean {
	return !!rdgElement.textContent?.trim();
}

function processInlineContainerToInlineContent(
	element: Element,
	activeMarks: TextMark[]
): InlineItem[] {
	const content: InlineItem[] = [];

	for (const child of Array.from(element.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent || '';
			if (hasMeaningfulText(text)) {
				pushText(content, { type: 'text', text, marks: activeMarks });
			}
			continue;
		}

		if (child.nodeType !== Node.ELEMENT_NODE) continue;
		content.push(...processInlineElementToInlineContent(child as Element, activeMarks));
	}

	return content;
}

function trimInlineBoundaries(items: InlineItem[]): InlineItem[] {
	while (items[0]?.type === 'boundary') {
		items.shift();
	}
	while (items[items.length - 1]?.type === 'boundary') {
		items.pop();
	}
	return items;
}

function emitPendingMilestones(context: ParseContext): void {
	ensureLineItems(context);

	if (context.pendingBookMilestone) {
		context.currentLineItems!.push(context.pendingBookMilestone);
		context.bookMilestoneEmitted = context.currentBook;
		context.pendingBookMilestone = undefined;
	}

	if (context.pendingChapterMilestone) {
		context.currentLineItems!.push(context.pendingChapterMilestone);
		context.chapterMilestoneEmitted = context.currentChapter;
		context.pendingChapterMilestone = undefined;
	}
}

function createVerseMilestone(
	verseId: string,
	book?: string,
	chapter?: string
): MilestoneItem {
	const parts = verseId.split('.');
	return {
		type: 'milestone',
		kind: 'verse',
		attrs: {
			book: book || '',
			chapter: chapter || '',
			verse: parts[parts.length - 1] || '',
		},
	};
}

function withWordAttrs(wordElement: Element, marks: TextMark[]): TextMark[] {
	const attrs = collectAttributes(wordElement);
	if (Object.keys(attrs).length === 0) return marks;
	return [...marks, { type: 'word', attrs }];
}

function createGapItem(gapElement: Element): GapItem {
	return {
		type: 'gap',
		attrs: {
			reason: gapElement.getAttribute('reason') || '',
			unit: gapElement.getAttribute('unit') || '',
			extent: gapElement.getAttribute('extent') || '',
		},
	};
}

function createColumnBreakItem(columnBreakElement: Element): InlineItem {
	return {
		type: 'columnBreak',
		attrs: collectAttributes(columnBreakElement),
	};
}

function createSpaceItem(spaceElement: Element): SpaceItem {
	return {
		type: 'space',
		attrs: collectAttributes(spaceElement),
	};
}

function createHandShiftItem(handShiftElement: Element): HandShiftItem {
	return {
		type: 'handShift',
		attrs: collectAttributes(handShiftElement),
	};
}

function createTeiMilestoneItem(milestoneElement: Element): TeiMilestoneItem {
	return {
		type: 'teiMilestone',
		attrs: collectAttributes(milestoneElement),
	};
}

function createEditorialActionLineItem(element: Element): EditorialActionItem {
	return createEditorialActionItem(element);
}

function createMetamarkLineItem(element: Element, wordInline = false): MetamarkItem {
	return createMetamarkItem(element, wordInline);
}

function createMetamarkInlineItem(element: Element, wordInline = false): MetamarkItem {
	return createMetamarkItem(element, wordInline);
}

function createTeiAtomLineItem(element: Element, wordInline = false) {
	return createTeiAtomItem(element, wordInline);
}

function createTeiAtomInlineItem(element: Element, wordInline = false) {
	return createTeiAtomItem(element, wordInline);
}

function createTeiWrapperItem(element: Element, wordInline = false): TeiWrapperItem {
	const text = normalizeTeiWrapperText(element.textContent || '') || undefined;
	return {
		type: 'teiWrapper',
		tag: element.tagName,
		summary: createTeiWrapperSummary(element),
		attrs: optionalAttributes(collectAttributes(element)),
		children: parseChildNodes(element.childNodes),
		wordInline,
		...(text ? { text } : {}),
	};
}

function createFormWorkItem(
	fwElement: Element,
	enclosingSeg?: Element | null,
	activeMarks: TextMark[] = []
): FormWorkItem {
	const teiAttrs = collectAttributes(fwElement);
	const segAttrs = enclosingSeg ? collectAttributes(enclosingSeg) : {};

	return {
		type: 'fw',
		attrs: {
			type: teiAttrs.type || '',
			subtype: teiAttrs.subtype || '',
			place: teiAttrs.place || '',
			hand: teiAttrs.hand || '',
			n: teiAttrs.n || '',
			rend: teiAttrs.rend || '',
			teiAttrs,
			segType: segAttrs.type || '',
			segSubtype: segAttrs.subtype || '',
			segPlace: segAttrs.place || '',
			segHand: segAttrs.hand || '',
			segRend: segAttrs.rend || '',
			segN: segAttrs.n || '',
			segAttrs,
		},
		content: processReadingToInlineContent(fwElement, activeMarks),
	};
}

function createUntranscribedItem(noteElement: Element): UntranscribedItem {
	return {
		type: 'untranscribed',
		attrs: {
			reason:
				noteElement.getAttribute('reason') ||
				noteElement.getAttribute('subtype') ||
				'Untranscribed',
			extent:
				noteElement.getAttribute('extent') ||
				noteElement.getAttribute('n') ||
				'partial',
		},
	};
}

function createTeiSpanMark(element: Element): TextMark {
	return {
		type: 'teiSpan',
		attrs: {
			tag: element.tagName,
			teiAttrs: collectAttributes(element),
		},
	};
}

function hasMeaningfulChildContent(element: Element): boolean {
	return Array.from(element.childNodes).some(child => {
		if (child.nodeType === Node.ELEMENT_NODE) return true;
		if (child.nodeType === Node.TEXT_NODE) {
			return !!child.textContent?.trim();
		}
		return false;
	});
}

function createTeiWrapperSummary(element: Element): string {
	const text = normalizeTeiWrapperText(element.textContent || '');
	if (!text) {
		return `<${element.tagName}>`;
	}
	const preview = text.length > 32 ? `${text.slice(0, 29)}...` : text;
	return `<${element.tagName}> ${preview}`;
}

function normalizeTeiWrapperText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function hasMeaningfulText(value: string): boolean {
	return value.trim().length > 0;
}

function optionalAttributes(
	attrs: Record<string, string>
): Record<string, string> | undefined {
	return Object.keys(attrs).length > 0 ? attrs : undefined;
}

function ensurePageColumns(context: ParseContext): void {
	if (!context.currentPageColumns) {
		context.currentPageColumns = [];
	}
}

function ensureColumnLines(context: ParseContext): void {
	if (!context.currentColumnLines) {
		context.currentColumnLines = [];
	}
}

function ensureLineItems(context: ParseContext): void {
	if (!context.currentLineItems) {
		context.currentLineItems = [];
	}
}

function flushCurrentLine(context: ParseContext): void {
	if (!context.currentLineItems || context.currentLineItems.length === 0) {
		context.currentLineItems = undefined;
		context.currentLineWrapped = false;
		return;
	}

	ensureColumnLines(context);
	context.currentColumnLines!.push({
		type: 'line',
		number: context.currentLine,
		wrapped: context.currentLineWrapped || undefined,
		paragraphStart: context.currentLineParagraphStart || undefined,
		teiAttrs:
			context.currentLineAttrs && Object.keys(context.currentLineAttrs).length > 0
				? context.currentLineAttrs
				: undefined,
		items: context.currentLineItems,
	});

	context.currentLineItems = undefined;
	context.currentLineWrapped = false;
	context.currentLineParagraphStart = false;
	context.currentLineAttrs = undefined;
	context.bookMilestoneEmitted = undefined;
	context.chapterMilestoneEmitted = undefined;
	context.pendingBookMilestone = undefined;
	context.pendingChapterMilestone = undefined;
}

function flushCurrentColumn(context: ParseContext): void {
	if (!context.currentColumnLines) {
		context.currentColumnWrapped = false;
		return;
	}

	ensurePageColumns(context);
	context.currentPageColumns!.push({
		type: 'column',
		number: context.currentColumn || 1,
		wrapped: context.currentColumnWrapped || undefined,
		zone: context.currentColumnZone || undefined,
		teiAttrs:
			context.currentColumnAttrs && Object.keys(context.currentColumnAttrs).length > 0
				? context.currentColumnAttrs
				: undefined,
		lines: context.currentColumnLines,
	});

	context.currentColumnLines = undefined;
	context.currentColumnWrapped = false;
	context.currentColumnAttrs = undefined;
	context.currentColumnZone = undefined;
}

function flushCurrentPage(context: ParseContext): void {
	if (!context.currentPageColumns || context.currentPage === undefined) {
		context.currentPageWrapped = false;
		return;
	}

	context.pages.push({
		type: 'page',
		id: context.currentPage || '',
		pageId: context.currentPageAttrs?.['xml:id'] || undefined,
		wrapped: context.currentPageWrapped || undefined,
		teiAttrs:
			context.currentPageAttrs && Object.keys(context.currentPageAttrs).length > 0
				? context.currentPageAttrs
				: undefined,
		columns: context.currentPageColumns,
	});

	context.currentPageColumns = undefined;
	context.currentPageWrapped = false;
	context.currentPageAttrs = undefined;
}

function appendWordBoundary(items: Array<LineItem | InlineItem>): void {
	const previous = items[items.length - 1];
	if (
		!previous ||
		previous.type === 'boundary' ||
		previous.type === 'lineBreak' ||
		previous.type === 'columnBreak'
	)
		return;
	items.push(WORD_BOUNDARY_ITEM as any);
}

function applyCorrectionMarkToInlineItems(
	items: InlineItem[],
	corrections: CorrectionReading[]
): InlineItem[] {
	return items.map(item => {
		if (item.type !== 'text') {
			return item;
		}

		return {
			...item,
			marks: [
				...(item.marks || []),
				{
					type: 'correction',
					attrs: { corrections },
				},
			],
		};
	});
}

function pushText<T extends TextItem>(items: Array<LineItem | InlineItem>, item: T): void {
	const previous = items[items.length - 1];
	if (previous && previous.type === 'text' && sameMarks(previous.marks, item.marks)) {
		previous.text += item.text;
		return;
	}
	items.push(item as any);
}

function sameMarks(a?: TextMark[], b?: TextMark[]): boolean {
	return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function handleSegmentElement(element: Element, context: ParseContext): void {
	const fwChildren = Array.from(element.childNodes).filter(
		child =>
			child.nodeType === Node.ELEMENT_NODE &&
			(child as Element).tagName.toLowerCase() === 'fw'
	) as Element[];

	if (fwChildren.length > 0) {
		ensureLineItems(context);
		for (const fwChild of fwChildren) {
			context.currentLineItems!.push(createFormWorkItem(fwChild, element));
		}
		return;
	}

	processNode(element, context);
}

function collectAttributes(
	element: Element,
	excluded: Set<string> = new Set()
): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const attr of Array.from(element.attributes)) {
		if (excluded.has(attr.name)) continue;
		attrs[attr.name] = attr.value;
	}
	return attrs;
}

function extractAbbrText(abbrElement: Element): string {
	let text = '';
	for (const child of Array.from(abbrElement.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			text += child.textContent || '';
			continue;
		}
		if (child.nodeType !== Node.ELEMENT_NODE) continue;
		const element = child as Element;
		if (element.tagName.toLowerCase() !== 'ex') {
			text += extractAbbrText(element);
		}
	}
	return text;
}

function extractExpansionText(abbrElement: Element): string {
	return Array.from(abbrElement.getElementsByTagName('ex'))
		.map(ex => ex.textContent || '')
		.join('');
}

function collectTextPreservation(textElement: Element): {
	textAttrs?: Record<string, string>;
	bodyAttrs?: Record<string, string>;
	front?: ReturnType<typeof parseElementTree>;
	back?: ReturnType<typeof parseElementTree>;
	textLeading?: ReturnType<typeof parseChildNodes>;
	textBetweenFrontBody?: ReturnType<typeof parseChildNodes>;
	textBetweenBodyBack?: ReturnType<typeof parseChildNodes>;
	textTrailing?: ReturnType<typeof parseChildNodes>;
} {
	const textAttrs = collectAttributes(textElement);
	const bodyElement = getImmediateChildElement(textElement, 'body');
	const bodyAttrs = bodyElement ? collectAttributes(bodyElement) : {};
	const frontElement = getImmediateChildElement(textElement, 'front');
	const backElement = getImmediateChildElement(textElement, 'back');

	const leading: Node[] = [];
	const betweenFrontBody: Node[] = [];
	const betweenBodyBack: Node[] = [];
	const trailing: Node[] = [];
	let seenFront = false;
	let seenBody = false;
	let seenBack = false;

	for (const child of Array.from(textElement.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE && !(child.textContent || '').trim()) {
			continue;
		}
		if (child.nodeType !== Node.ELEMENT_NODE) {
			continue;
		}

		const element = child as Element;
		const tagName = element.tagName.toLowerCase();
		if (tagName === 'front') {
			seenFront = true;
			continue;
		}
		if (tagName === 'body') {
			seenBody = true;
			continue;
		}
		if (tagName === 'back') {
			seenBack = true;
			continue;
		}

		if (!seenFront && !seenBody) {
			leading.push(child);
			continue;
		}
		if (seenFront && !seenBody) {
			betweenFrontBody.push(child);
			continue;
		}
		if (seenBody && !seenBack) {
			betweenBodyBack.push(child);
			continue;
		}
		trailing.push(child);
	}

	return {
		textAttrs: Object.keys(textAttrs).length > 0 ? textAttrs : undefined,
		bodyAttrs: Object.keys(bodyAttrs).length > 0 ? bodyAttrs : undefined,
		front: frontElement ? parseElementTree(frontElement) : undefined,
		back: backElement ? parseElementTree(backElement) : undefined,
		textLeading: leading.length > 0 ? parseChildNodes(leading) : undefined,
		textBetweenFrontBody: betweenFrontBody.length > 0 ? parseChildNodes(betweenFrontBody) : undefined,
		textBetweenBodyBack: betweenBodyBack.length > 0 ? parseChildNodes(betweenBodyBack) : undefined,
		textTrailing: trailing.length > 0 ? parseChildNodes(trailing) : undefined,
	};
}

function getImmediateChildrenTrees(root: Element, tagName: string) {
	const items = Array.from(root.childNodes)
		.filter(
			child =>
				child.nodeType === Node.ELEMENT_NODE &&
				(child as Element).tagName.toLowerCase() === tagName.toLowerCase()
		)
		.map(child => parseElementTree(child as Element));
	return items.length > 0 ? items : undefined;
}

function getImmediateChildElement(root: Element, tagName: string): Element | null {
	const child = Array.from(root.childNodes).find(
		child =>
			child.nodeType === Node.ELEMENT_NODE &&
			(child as Element).tagName.toLowerCase() === tagName.toLowerCase()
	);
	return (child as Element | undefined) || null;
}

function getImmediateResourceNodes(root: Element) {
	const resources = Array.from(root.childNodes)
		.filter(child => child.nodeType === Node.ELEMENT_NODE)
		.map(child => child as Element)
		.filter(element => {
			const tagName = element.tagName.toLowerCase();
			return tagName !== 'teiheader' && tagName !== 'text' && tagName !== 'tei';
		})
		.map(element => parseElementTree(element));
	return resources.length > 0 ? resources : undefined;
}

function getNamespaceAttributeNames(element: Element): Set<string> {
	const names = new Set<string>();
	for (const attr of Array.from(element.attributes)) {
		if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) {
			names.add(attr.name);
		}
	}
	return names;
}

function validateSupportedTeiDocument(teiRoot: Element, textElement: Element | null): void {
	for (const child of Array.from(teiRoot.childNodes)) {
		if (child.nodeType !== Node.ELEMENT_NODE) continue;
		const element = child as Element;
		const tagName = element.tagName.toLowerCase();
		if (!['teiheader', 'text', 'facsimile', 'sourcedoc', 'standoff', 'tei'].includes(tagName)) {
			throw unsupportedElementError(element, 'Unsupported top-level TEI element');
		}
	}

	if (!textElement) {
		throw new Error('Expected TEI text/body content');
	}

	for (const child of Array.from(textElement.childNodes)) {
		if (child.nodeType !== Node.ELEMENT_NODE) continue;
		const element = child as Element;
		const tagName = element.tagName.toLowerCase();
		if (!['front', 'body', 'back', 'milestone'].includes(tagName)) {
			throw unsupportedElementError(element, 'Unsupported text-level TEI element');
		}
	}
}

function unsupportedElementError(element: Element, reason?: string): Error {
	const attrs = Array.from(element.attributes || [])
		.map(attr => `${attr.name}="${attr.value}"`)
		.join(' ');
	const attrsSuffix = attrs ? ` ${attrs}` : '';
	return new Error(`${reason || 'Unsupported TEI element'}: <${element.tagName}${attrsSuffix}>`);
}
