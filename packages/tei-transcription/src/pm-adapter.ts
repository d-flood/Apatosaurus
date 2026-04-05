import { normalizeDocument } from './normalize';
import {
	createStructuredFormWorkContent,
	flattenStructuredFormWorkContent,
} from './formwork-pm';
import type {
	BoundaryItem,
	CorrectionReading,
	FrameZone,
	InlineItem,
	LineItem,
	ProseMirrorJSON,
	TextItem,
	TextMark,
	TranscriptionColumn,
	TranscriptionDocument,
	TranscriptionLine,
	TranscriptionPage,
} from './types';

export function toProseMirror(document: TranscriptionDocument): ProseMirrorJSON {
	return {
		type: 'manuscript',
		content: document.pages.map(page => ({
			type: 'page',
			attrs: {
				pageId: page.pageId || page.teiAttrs?.['xml:id'] || page.id,
				pageName: page.id,
				...(page.wrapped ? { wrapped: true } : {}),
				...(page.teiAttrs ? { teiAttrs: page.teiAttrs } : {}),
			},
			content: page.columns.map(column => ({
				type: 'column',
				attrs: {
					columnNumber: column.number,
					...(column.wrapped ? { wrapped: true } : {}),
					...(column.zone ? { zone: column.zone } : {}),
					...(column.teiAttrs ? { teiAttrs: column.teiAttrs } : {}),
				},
				content: column.lines.map(line => ({
					type: 'line',
					attrs: {
						lineNumber: line.number,
						...(line.wrapped ? { wrapped: true } : {}),
						...(line.paragraphStart ? { 'paragraph-start': true } : {}),
						...(line.teiAttrs ? { teiAttrs: line.teiAttrs } : {}),
					},
					content: toProseMirrorLineContent(line),
				})),
			})),
		})),
	};
}

function toProseMirrorLineContent(line: TranscriptionLine): ProseMirrorJSON[] {
	const content: ProseMirrorJSON[] = [];

	for (const item of line.items) {
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

		if (item.type === 'milestone') {
			if (item.kind === 'book') {
				content.push({
					type: 'book',
					attrs: { book: item.attrs.book || '' },
				});
			}
			if (item.kind === 'chapter') {
				content.push({
					type: 'chapter',
					attrs: {
						book: item.attrs.book || '',
						chapter: item.attrs.chapter || '',
					},
				});
			}
			if (item.kind === 'verse') {
				content.push({
					type: 'verse',
					attrs: {
						book: item.attrs.book || '',
						chapter: item.attrs.chapter || '',
						verse: item.attrs.verse || '',
					},
				});
			}
			continue;
		}

		if (item.type === 'teiMilestone') {
			content.push({
				type: 'teiMilestone',
				attrs: { teiAttrs: item.attrs },
			});
			continue;
		}

		if (item.type === 'editorialAction') {
			content.push({
				type: 'editorialAction',
				attrs: {
					tag: item.tag,
					summary: item.summary,
					teiAttrs: item.attrs || {},
					...(item.structure ? { structure: item.structure } : {}),
				},
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
					teiNode: item.node,
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

		if (item.type === 'gap') {
			content.push({
				type: 'gap',
				attrs: item.attrs,
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

		if (item.type === 'untranscribed') {
			content.push({
				type: 'untranscribed',
				attrs: item.attrs,
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

		if (item.type === 'fw') {
			content.push({
				type: 'fw',
				attrs: {
					...item.attrs,
					content: createStructuredFormWorkContent(inlineItemsToProseMirror(item.content)),
				},
			});
		}
	}

	return content;
}

export function inlineItemsToProseMirror(items: InlineItem[]): ProseMirrorJSON[] {
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

		if (item.type === 'teiMilestone') {
			content.push({
				type: 'teiMilestone',
				attrs: { teiAttrs: item.attrs },
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
					teiNode: item.node,
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

export function fromProseMirror(pm: ProseMirrorJSON): TranscriptionDocument {
	const document: TranscriptionDocument = {
		type: 'transcriptionDocument',
		pages: [],
	};

	for (const pageNode of pm.content || []) {
		if (pageNode.type !== 'page') continue;
		const page: TranscriptionPage = {
			type: 'page' as const,
			id: pageNode.attrs?.pageName || '',
			pageId:
				typeof pageNode.attrs?.pageId === 'string' && pageNode.attrs.pageId.length > 0
					? pageNode.attrs.pageId
					: typeof pageNode.attrs?.teiAttrs?.['xml:id'] === 'string'
						? pageNode.attrs.teiAttrs['xml:id']
						: undefined,
			wrapped: pageNode.attrs?.wrapped || undefined,
			teiAttrs: extractOptionalTeiAttrs(pageNode.attrs),
			columns: [],
		};

			for (const columnNode of pageNode.content || []) {
				if (columnNode.type !== 'column') continue;
				const column: TranscriptionColumn = {
					type: 'column' as const,
					number: columnNode.attrs?.columnNumber || 1,
					wrapped: columnNode.attrs?.wrapped || undefined,
					zone: (columnNode.attrs?.zone as FrameZone) || undefined,
					teiAttrs: extractOptionalTeiAttrs(columnNode.attrs),
					lines: [],
				};

				for (const lineNode of columnNode.content || []) {
					if (lineNode.type !== 'line') continue;
					const line: TranscriptionLine = {
						type: 'line',
						number: lineNode.attrs?.lineNumber || 1,
						wrapped: lineNode.attrs?.wrapped || undefined,
						paragraphStart: lineNode.attrs?.['paragraph-start'] || undefined,
						teiAttrs: extractOptionalTeiAttrs(lineNode.attrs),
						items: fromProseMirrorLineContent(lineNode.content || []),
					};
					column.lines.push(line);
				}

			page.columns.push(column);
		}

		document.pages.push(page);
	}

	return normalizeDocument(document);
}

function proseMirrorTextNodeToItems(node: ProseMirrorJSON): Array<TextItem | BoundaryItem> {
	const text = node.text || '';
	if (text.length === 0) return [];

	const marks = (node.marks || []).map(mark => convertMark(mark));
	const items: Array<TextItem | BoundaryItem> = [];
	for (const part of text.split(/(\s+)/)) {
		if (!part) continue;
		if (/^\s+$/.test(part)) {
			items.push({ type: 'boundary', kind: 'word' });
			continue;
		}
		items.push({
			type: 'text',
			text: part,
			marks,
		});
	}

	return items;
}

function fromProseMirrorLineContent(nodes: ProseMirrorJSON[]): LineItem[] {
	const items: LineItem[] = [];

	for (const node of nodes) {
		if (node.type === 'text') {
			items.push(...proseMirrorTextNodeToItems(node));
			continue;
		}

		if (node.type === 'book') {
			items.push({
				type: 'milestone',
				kind: 'book',
				attrs: { book: node.attrs?.book || '' },
			});
			continue;
		}

		if (node.type === 'chapter') {
			items.push({
				type: 'milestone',
				kind: 'chapter',
				attrs: {
					book: node.attrs?.book || '',
					chapter: node.attrs?.chapter || '',
				},
			});
			continue;
		}

		if (node.type === 'verse') {
			items.push({
				type: 'milestone',
				kind: 'verse',
				attrs: {
					book: node.attrs?.book || '',
					chapter: node.attrs?.chapter || '',
					verse: node.attrs?.verse || '',
				},
			});
			continue;
		}

		if (node.type === 'gap') {
			items.push({
				type: 'gap',
				attrs: node.attrs || {},
			});
			continue;
		}

		if (node.type === 'space') {
			items.push({
				type: 'space',
				attrs: extractTeiAttrs(node.attrs),
			});
			continue;
		}

		if (node.type === 'handShift') {
			items.push({
				type: 'handShift',
				attrs: extractTeiAttrs(node.attrs),
			});
			continue;
		}

		if (node.type === 'teiMilestone') {
			items.push({
				type: 'teiMilestone',
				attrs: extractTeiAttrs(node.attrs),
			});
			continue;
		}

		if (node.type === 'editorialAction') {
			items.push({
				type: 'editorialAction',
				tag:
					(node.attrs?.tag as 'undo' | 'redo' | 'substJoin' | 'transpose' | 'listTranspose') ||
					'undo',
				summary: String(node.attrs?.summary || ''),
				attrs: extractOptionalTeiAttrs(node.attrs),
				structure:
					node.attrs?.structure && typeof node.attrs.structure === 'object'
						? node.attrs.structure
						: undefined,
			});
			continue;
		}

		if (node.type === 'metamark') {
			items.push({
				type: 'metamark',
				summary: String(node.attrs?.summary || 'metamark'),
				attrs: extractTeiAttrs(node.attrs),
				wordInline: !!node.attrs?.wordInline,
			});
			continue;
		}

		if (node.type === 'teiAtom') {
			items.push({
				type: 'teiAtom',
				tag: String(node.attrs?.tag || 'note') as any,
				summary: String(node.attrs?.summary || node.attrs?.tag || 'tei'),
				attrs: node.attrs?.teiAttrs || {},
				node: node.attrs?.teiNode,
				wordInline: !!node.attrs?.wordInline,
				text: String(node.attrs?.text || ''),
			});
			continue;
		}

		if (node.type === 'teiWrapper') {
			items.push({
				type: 'teiWrapper',
				tag: String(node.attrs?.tag || 'seg'),
				summary: String(node.attrs?.summary || node.attrs?.tag || 'wrapper'),
				attrs: extractOptionalTeiAttrs(node.attrs),
				children: Array.isArray(node.attrs?.children) ? node.attrs.children : [],
				wordInline: !!node.attrs?.wordInline,
				text: String(node.attrs?.text || ''),
			});
			continue;
		}

		if (node.type === 'untranscribed') {
			items.push({
				type: 'untranscribed',
				attrs: node.attrs || {},
			});
			continue;
		}

		if (node.type === 'correctionNode') {
			items.push({
				type: 'correctionOnly',
				corrections: (node.attrs?.corrections || []).map((correction: any) => ({
					...correction,
					content: proseMirrorToInlineItems(correction.content || []),
				})),
			});
			continue;
		}

		if (node.type === 'fw') {
			const rawContent = flattenStructuredFormWorkContent(node.attrs?.content);
			items.push({
				type: 'fw',
				attrs: {
					type: node.attrs?.type || '',
					subtype: node.attrs?.subtype || '',
					place: node.attrs?.place || '',
					hand: node.attrs?.hand || '',
					n: node.attrs?.n || '',
					rend: node.attrs?.rend || '',
					teiAttrs: node.attrs?.teiAttrs || {},
					segType: node.attrs?.segType || '',
					segSubtype: node.attrs?.segSubtype || '',
					segPlace: node.attrs?.segPlace || '',
					segHand: node.attrs?.segHand || '',
					segRend: node.attrs?.segRend || '',
					segN: node.attrs?.segN || '',
					segAttrs: node.attrs?.segAttrs || {},
				},
				content: proseMirrorToInlineItems(rawContent),
			});
		}
	}

	return items;
}

export function proseMirrorToInlineItems(nodes: ProseMirrorJSON[]): InlineItem[] {
	const items: InlineItem[] = [];

	for (const node of nodes) {
		if (node.type === 'text') {
			items.push(...proseMirrorTextNodeToItems(node));
			continue;
		}

		if (node.type === 'pageBreak') {
			items.push({
				type: 'pageBreak',
				attrs: extractTeiAttrs(node.attrs),
			});
			continue;
		}

		if (node.type === 'lineBreak') {
			items.push({
				type: 'lineBreak',
				attrs: extractTeiAttrs(node.attrs),
			});
			continue;
		}

		if (node.type === 'columnBreak') {
			items.push({
				type: 'columnBreak',
				attrs: extractTeiAttrs(node.attrs),
			});
			continue;
		}

		if (node.type === 'space') {
			items.push({
				type: 'space',
				attrs: extractTeiAttrs(node.attrs),
			});
			continue;
		}

		if (node.type === 'handShift') {
			items.push({
				type: 'handShift',
				attrs: extractTeiAttrs(node.attrs),
			});
			continue;
		}

		if (node.type === 'metamark') {
			items.push({
				type: 'metamark',
				summary: String(node.attrs?.summary || 'metamark'),
				attrs: extractTeiAttrs(node.attrs),
				wordInline: !!node.attrs?.wordInline,
			});
			continue;
		}

		if (node.type === 'teiMilestone') {
			items.push({
				type: 'teiMilestone',
				attrs: extractTeiAttrs(node.attrs),
			});
			continue;
		}

		if (node.type === 'teiAtom') {
			items.push({
				type: 'teiAtom',
				tag: String(node.attrs?.tag || 'note') as any,
				summary: String(node.attrs?.summary || node.attrs?.tag || 'tei'),
				attrs: node.attrs?.teiAttrs || {},
				node: node.attrs?.teiNode,
				wordInline: !!node.attrs?.wordInline,
				text: String(node.attrs?.text || ''),
			});
			continue;
		}

		if (node.type === 'teiWrapper') {
			items.push({
				type: 'teiWrapper',
				tag: String(node.attrs?.tag || 'seg'),
				summary: String(node.attrs?.summary || node.attrs?.tag || 'wrapper'),
				attrs: extractOptionalTeiAttrs(node.attrs),
				children: Array.isArray(node.attrs?.children) ? node.attrs.children : [],
				wordInline: !!node.attrs?.wordInline,
				text: String(node.attrs?.text || ''),
			});
			continue;
		}

		if (node.type === 'fw') {
			const rawContent = flattenStructuredFormWorkContent(node.attrs?.content);
			items.push({
				type: 'fw',
				attrs: {
					type: node.attrs?.type || '',
					subtype: node.attrs?.subtype || '',
					place: node.attrs?.place || '',
					hand: node.attrs?.hand || '',
					n: node.attrs?.n || '',
					rend: node.attrs?.rend || '',
					teiAttrs: node.attrs?.teiAttrs || {},
					segType: node.attrs?.segType || '',
					segSubtype: node.attrs?.segSubtype || '',
					segPlace: node.attrs?.segPlace || '',
					segHand: node.attrs?.segHand || '',
					segRend: node.attrs?.segRend || '',
					segN: node.attrs?.segN || '',
					segAttrs: node.attrs?.segAttrs || {},
				},
				content: proseMirrorToInlineItems(rawContent),
			});
			continue;
		}

		if (node.type === 'correctionNode') {
			items.push({
				type: 'correctionOnly',
				corrections: (node.attrs?.corrections || []).map((correction: any) => ({
					...correction,
					content: proseMirrorToInlineItems(correction.content || []),
				})),
			});
			continue;
		}
	}

	return items;
}

function convertMark(mark: { type: string; attrs?: Record<string, any> }): TextMark {
	if (mark.type === 'abbreviation') {
		return { type: 'abbreviation', attrs: mark.attrs || {} };
	}

	if (
		mark.type === 'word' ||
		mark.type === 'lacunose' ||
		mark.type === 'unclear' ||
		mark.type === 'punctuation' ||
		mark.type === 'hi' ||
		mark.type === 'damage' ||
		mark.type === 'surplus' ||
		mark.type === 'secl'
	) {
		return {
			type: mark.type,
			attrs: extractTeiAttrs(mark.attrs),
		} as TextMark;
	}

	if (mark.type === 'teiSpan') {
		return {
			type: 'teiSpan',
			attrs: {
				tag: String(mark.attrs?.tag || 'seg'),
				teiAttrs: extractTeiAttrs(mark.attrs),
			},
		};
	}

	if (mark.type === 'correction') {
		return {
			type: 'correction',
			attrs: {
				corrections: ((mark.attrs?.corrections as CorrectionReading[]) || []).map(correction => ({
					...correction,
					content: proseMirrorToInlineItems((correction as any).content || []),
				})),
			},
		};
	}

	return { type: mark.type as TextMark['type'] } as TextMark;
}

function extractTeiAttrs(attrs: Record<string, any> | undefined): Record<string, string> {
	if (!attrs) return {};
	if (attrs.teiAttrs && typeof attrs.teiAttrs === 'object') {
		return attrs.teiAttrs as Record<string, string>;
	}
	return attrs as Record<string, string>;
}

function extractOptionalTeiAttrs(
	attrs: Record<string, any> | undefined
): Record<string, string> | undefined {
	const teiAttrs =
		attrs?.teiAttrs && typeof attrs.teiAttrs === 'object'
			? (attrs.teiAttrs as Record<string, string>)
			: {};
	return Object.keys(teiAttrs).length > 0 ? teiAttrs : undefined;
}
