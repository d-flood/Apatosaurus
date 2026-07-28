import type { TranscriptionDocument } from '$lib/tei/tei-transcription';

export type EditorJson = Record<string, any>;

const DEFAULT_TEXTS = ['1', '2', '3', '4'];
const FRAME_ZONES = ['top', 'left', 'center', 'right', 'bottom'] as const;

export interface EditorLineOptions {
	text?: string;
	content?: EditorJson[];
	lineId?: string;
	lineNumber?: number;
	attrs?: EditorJson;
}

export function editorLine(options: EditorLineOptions = {}): EditorJson {
	const { text = '', content, lineId = 'line-1', lineNumber = 1, attrs = {} } = options;
	const lineContent = content ?? (text ? [{ type: 'text', text }] : []);
	return {
		type: 'line',
		attrs: { lineNumber, lineId, ...attrs },
		...(lineContent.length ? { content: lineContent } : {}),
	};
}

export interface EditorColumnOptions {
	texts?: string[];
	lines?: EditorJson[];
	columnId?: string;
	columnNumber?: number;
	lineIdStart?: number;
	attrs?: EditorJson;
}

export function editorColumn(options: EditorColumnOptions = {}): EditorJson {
	const {
		texts = DEFAULT_TEXTS,
		lines,
		columnId = 'col-1',
		columnNumber = 1,
		lineIdStart = 1,
		attrs = {},
	} = options;
	return {
		type: 'column',
		attrs: { columnNumber, columnId, ...attrs },
		content:
			lines ??
			texts.map((text, index) =>
				editorLine({ text, lineNumber: index + 1, lineId: `line-${lineIdStart + index}` })
			),
	};
}

export interface EditorPlainPageOptions {
	pageId?: string;
	pageName?: string;
	texts?: string[][];
	columns?: EditorJson[];
	columnIdStart?: number;
	lineIdStart?: number;
	attrs?: EditorJson;
}

export function editorPlainPage(options: EditorPlainPageOptions = {}): EditorJson {
	const {
		pageId = 'page-1',
		pageName = '1r',
		texts = [DEFAULT_TEXTS.map(text => `a${text}`), DEFAULT_TEXTS.map(text => `b${text}`)],
		columns,
		columnIdStart = 1,
		lineIdStart = 1,
		attrs = {},
	} = options;
	let nextLineId = lineIdStart;
	return {
		type: 'page',
		attrs: { pageId, pageName, ...attrs },
		content:
			columns ??
			texts.map((columnTexts, index) => {
				const column = editorColumn({
					texts: columnTexts,
					columnNumber: index + 1,
					columnId: `col-${columnIdStart + index}`,
					lineIdStart: nextLineId,
				});
				nextLineId += columnTexts.length;
				return column;
			}),
	};
}

export interface EditorFramedPageOptions {
	pageId?: string;
	pageName?: string;
	texts?: string[][];
	columnIdStart?: number;
	lineIdStart?: number;
	attrs?: EditorJson;
}

export function editorFramedPage(options: EditorFramedPageOptions = {}): EditorJson {
	const {
		pageId = 'page-1',
		pageName = '1r',
		texts = FRAME_ZONES.map(zone => DEFAULT_TEXTS.map(text => `${zone}-${text}`)),
		columnIdStart = 1,
		lineIdStart = 1,
		attrs = {},
	} = options;
	let nextLineId = lineIdStart;
	return {
		type: 'page',
		attrs: { pageId, pageName, ...attrs },
		content: FRAME_ZONES.map((zone, index) => {
			const columnTexts = texts[index] ?? DEFAULT_TEXTS.map(text => `${zone}-${text}`);
			const column = editorColumn({
				texts: columnTexts,
				columnNumber: index + 1,
				columnId: `col-${columnIdStart + index}`,
				lineIdStart: nextLineId,
				attrs: { zone, teiAttrs: { rend: zone } },
			});
			nextLineId += columnTexts.length;
			return column;
		}),
	};
}

export interface EditorDocumentOptions {
	pages?: EditorJson[];
	nodeIds?: boolean;
	interestingLineContent?: EditorJson[];
}

export function editorDocument(options: EditorDocumentOptions = {}): EditorJson {
	const document_ = {
		type: 'manuscript',
		content: options.pages ?? [
			editorPlainPage({
				pageId: 'page-1',
				pageName: '1r',
				texts: [['a1', 'a2', 'a3', 'a4']],
				columnIdStart: 1,
				lineIdStart: 1,
			}),
			editorPlainPage({
				pageId: 'page-2',
				pageName: '1v',
				texts: [
					['b1', 'b2', 'b3', 'b4'],
					['c1', 'c2', 'c3', 'c4'],
				],
				columnIdStart: 2,
				lineIdStart: 5,
			}),
			editorPlainPage({
				pageId: 'page-3',
				pageName: '2r',
				texts: [['d1', 'd2', 'd3', 'd4']],
				columnIdStart: 4,
				lineIdStart: 13,
			}),
		],
	};
	if (options.nodeIds === false) {
		// Match imported JSON that omits identity and lets schema defaults supply numbering.
		for (const page of document_.content) {
			for (const column of page.content) {
				delete column.attrs.columnId;
				for (const line of column.content) {
					delete line.attrs.lineId;
					delete line.attrs.lineNumber;
				}
			}
		}
	}
	if (options.interestingLineContent) {
		const interestingLine = document_.content[1]?.content?.[0]?.content?.[1];
		if (!interestingLine) throw new Error('editor document has no middle line');
		interestingLine.content = options.interestingLineContent;
	}
	return document_;
}

export interface TranscriptionLineOptions {
	text?: string;
	number?: number;
	items?: EditorJson[];
	attrs?: EditorJson;
}

export function transcriptionLine(options: TranscriptionLineOptions = {}): EditorJson {
	const { text = '', number = 1, items, attrs = {} } = options;
	return {
		type: 'line',
		number,
		items: items ?? (text ? [{ type: 'text', text }] : []),
		...attrs,
	};
}

export interface TranscriptionColumnOptions {
	number?: number;
	texts?: string[];
	lines?: EditorJson[];
	attrs?: EditorJson;
}

export function transcriptionColumn(options: TranscriptionColumnOptions = {}): EditorJson {
	const { number = 1, texts = DEFAULT_TEXTS, lines, attrs = {} } = options;
	return {
		type: 'column',
		number,
		lines: lines ?? texts.map((text, index) => transcriptionLine({ text, number: index + 1 })),
		...attrs,
	};
}

export interface TranscriptionPlainPageOptions {
	id?: string;
	pageId?: string;
	texts?: string[][];
	columns?: EditorJson[];
	attrs?: EditorJson;
}

export function transcriptionPlainPage(options: TranscriptionPlainPageOptions = {}): EditorJson {
	const {
		id = '1r',
		pageId = 'page-1',
		texts = [DEFAULT_TEXTS.map(text => `a${text}`), DEFAULT_TEXTS.map(text => `b${text}`)],
		columns,
		attrs = {},
	} = options;
	return {
		type: 'page',
		id,
		pageId,
		columns:
			columns ??
			texts.map((columnTexts, index) =>
				transcriptionColumn({ number: index + 1, texts: columnTexts })
			),
		...attrs,
	};
}

export interface TranscriptionFramedPageOptions {
	id?: string;
	pageId?: string;
	texts?: string[][];
	attrs?: EditorJson;
}

export function transcriptionFramedPage(options: TranscriptionFramedPageOptions = {}): EditorJson {
	const {
		id = '1r',
		pageId = 'page-1',
		texts = FRAME_ZONES.map(zone => DEFAULT_TEXTS.map(text => `${zone}-${text}`)),
		attrs = {},
	} = options;
	return {
		type: 'page',
		id,
		pageId,
		columns: FRAME_ZONES.map((zone, index) =>
			transcriptionColumn({
				number: index + 1,
				texts: texts[index],
				attrs: { zone, teiAttrs: { rend: zone } },
			})
		),
		...attrs,
	};
}

export interface TranscriptionDocumentOptions {
	pages?: EditorJson[];
}

export function transcriptionDocument(
	options: TranscriptionDocumentOptions = {}
): TranscriptionDocument {
	return {
		type: 'transcriptionDocument',
		pages: (options.pages ?? [
			transcriptionPlainPage({
				id: '1r',
				pageId: 'page-1',
				texts: [['a1', 'a2', 'a3', 'a4']],
			}),
			transcriptionPlainPage({
				id: '1v',
				pageId: 'page-2',
				texts: [
					['b1', 'b2', 'b3', 'b4'],
					['c1', 'c2', 'c3', 'c4'],
				],
			}),
			transcriptionPlainPage({
				id: '2r',
				pageId: 'page-3',
				texts: [['d1', 'd2', 'd3', 'd4']],
			}),
		]) as TranscriptionDocument['pages'],
	};
}

export interface MarginaliaLineOptions {
	text?: string;
	lineId?: string;
	lineNumber?: number;
	attrs?: EditorJson;
}

export function marginaliaLine(options: MarginaliaLineOptions = {}): EditorJson {
	const { text = '', lineId = 'line-1', lineNumber = 1, attrs = {} } = options;
	return {
		type: 'marginaliaLine',
		attrs: { lineNumber, lineId, ...attrs },
		...(text ? { content: [{ type: 'text', text }] } : {}),
	};
}

export interface MarginaliaColumnOptions {
	texts?: string[];
	lines?: EditorJson[];
	columnId?: string;
	columnNumber?: number;
	lineIdStart?: number;
	attrs?: EditorJson;
}

export function marginaliaColumn(options: MarginaliaColumnOptions = {}): EditorJson {
	const {
		texts = DEFAULT_TEXTS,
		lines,
		columnId = 'col-1',
		columnNumber = 1,
		lineIdStart = 1,
		attrs = {},
	} = options;
	return {
		type: 'marginaliaColumn',
		attrs: { columnNumber, columnId, ...attrs },
		content:
			lines ??
			texts.map((text, index) =>
				marginaliaLine({
					text,
					lineNumber: index + 1,
					lineId: `line-${lineIdStart + index}`,
				})
			),
	};
}

export interface MarginaliaDocumentOptions {
	columns?: EditorJson[];
}

export function marginaliaDocument(options: MarginaliaDocumentOptions = {}): EditorJson {
	return {
		type: 'doc',
		content: options.columns ?? [
			marginaliaColumn({
				texts: ['a1', 'a2', 'a3', 'a4'],
				columnId: 'col-1',
				columnNumber: 1,
				lineIdStart: 1,
			}),
			marginaliaColumn({
				texts: ['b1', 'b2', 'b3', 'b4'],
				columnId: 'col-2',
				columnNumber: 2,
				lineIdStart: 5,
			}),
		],
	};
}

function jsonOf(document_: any): EditorJson {
	return typeof document_?.toJSON === 'function' ? document_.toJSON() : document_;
}

function textOf(node: EditorJson): string {
	if (typeof node.text === 'string') return node.text;
	const children = node.content ?? node.items ?? [];
	return children.map(textOf).join('');
}

export function modelDocumentSnapshot(document_: any): string[][][] {
	const json = jsonOf(document_);
	const pages = json.type === 'transcriptionDocument' ? (json.pages ?? []) : (json.content ?? []);
	return pages.map((page: EditorJson) => {
		const columns = page.columns ?? page.content ?? [];
		return columns.map((column: EditorJson) => {
			const lines = column.lines ?? column.content ?? [];
			return lines.map((line: EditorJson) => textOf(line));
		});
	});
}

export function domDocumentSnapshot(container: ParentNode): string[][][] {
	return Array.from(container.querySelectorAll('.page')).map(page =>
		Array.from(page.querySelectorAll('.column')).map(column =>
			Array.from(column.querySelectorAll('.line')).map(
				line => line.querySelector('.line-content')?.textContent ?? ''
			)
		)
	);
}

export function domMarginaliaSnapshot(container: ParentNode): string[][] {
	return Array.from(container.querySelectorAll('.marginalia-column')).map(column =>
		Array.from(column.querySelectorAll('.marginalia-line')).map(
			line => line.querySelector('.line-content')?.textContent ?? ''
		)
	);
}

export function structuralAttributeSnapshot(document_: any): EditorJson[] {
	const json = jsonOf(document_);
	return (json.content ?? []).map((page: EditorJson) => ({
		attrs: page.attrs ?? {},
		columns: (page.content ?? []).map((column: EditorJson) => ({
			attrs: column.attrs ?? {},
			lines: (column.content ?? []).map((line: EditorJson) => line.attrs ?? {}),
		})),
	}));
}
