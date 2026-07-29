import { Slice, type Schema } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';

import { findFirstDescendantPosition } from './proseMirrorNodeLookup';

const MAIN_LINE_CONTENT_NODE_NAMES = new Set([
	'text',
	'book',
	'chapter',
	'verse',
	'gap',
	'space',
	'handShift',
	'metamark',
	'teiAtom',
	'teiWrapper',
	'teiMilestone',
	'editorialAction',
	'untranscribed',
	'correctionNode',
	'fw',
]);

type JsonNode = Record<string, any>;

const FRAMED_PAGE_DOCUMENT_ZONE_ORDER = ['top', 'left', 'right', 'bottom', 'center'] as const;

interface ManuscriptRepairOptions {
	framedPageZoneOrder?: 'preserve' | 'visual';
	ensureNodeIds?: boolean;
}

export const LINE_SPLIT_TARGET_LINE_ID_META = 'lineSplitTargetLineId';

export interface ChangedRange {
	from: number;
	to: number;
}

export function getChangedRanges(
	transactions: readonly Transaction[],
	docSize: number
): ChangedRange[] {
	const ranges: ChangedRange[] = [];
	transactions.at(-1)?.mapping.maps.forEach(stepMap => {
		stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
			if (newFrom === newTo) {
				newFrom -= 1;
				newTo += 1;
			}
			newFrom = Math.max(0, Math.min(newFrom, docSize));
			newTo = Math.max(0, Math.min(newTo, docSize));
			ranges.push({ from: Math.min(newFrom, newTo), to: Math.max(newFrom, newTo) });
		});
	});
	return ranges;
}

function createStableEditorNodeId(prefix: string): string {
	if (typeof crypto?.randomUUID === 'function') {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface ManuscriptStructureRepairResult {
	doc: JsonNode;
	repaired: boolean;
	issues: string[];
}

export function prepareManuscriptDocumentEntry(input: unknown): ManuscriptStructureRepairResult {
	return repairManuscriptStructureJson(input, {
		framedPageZoneOrder: 'visual',
		ensureNodeIds: true,
	});
}

export function repairPastedManuscriptSlice(slice: Slice, schema: Schema): Slice {
	if (
		slice.openStart !== 0 ||
		slice.openEnd !== 0 ||
		slice.content.childCount === 0 ||
		slice.content.content.some(node => node.type.name !== 'page')
	) {
		return slice;
	}
	const repair = prepareManuscriptDocumentEntry({
		type: 'manuscript',
		content: slice.content.toJSON(),
	});
	return repair.repaired ? new Slice(schema.nodeFromJSON(repair.doc).content, 0, 0) : slice;
}

function cloneJsonNode<T>(value: T): T {
	if (typeof globalThis.structuredClone === 'function') {
		try {
			return globalThis.structuredClone(value);
		} catch {
			// Fall through to the JSON clone below for plain editor JSON payloads.
		}
	}
	return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is JsonNode {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAllowedMainLineContentNode(node: unknown): node is JsonNode {
	return (
		isRecord(node) &&
		typeof node.type === 'string' &&
		MAIN_LINE_CONTENT_NODE_NAMES.has(node.type)
	);
}

function buildEmptyLine(ensureNodeIds = false): JsonNode {
	return {
		type: 'line',
		attrs: {
			...(ensureNodeIds ? { lineId: createStableEditorNodeId('line') } : {}),
		},
	};
}

function buildEmptyColumn(ensureNodeIds = false): JsonNode {
	return {
		type: 'column',
		attrs: {
			...(ensureNodeIds ? { columnId: createStableEditorNodeId('col') } : {}),
		},
		content: [buildEmptyLine(ensureNodeIds)],
	};
}

function getFrameZoneRank(column: JsonNode): number {
	const zone = isRecord(column.attrs) ? column.attrs.zone : null;
	const rank =
		typeof zone === 'string'
			? FRAMED_PAGE_DOCUMENT_ZONE_ORDER.indexOf(
					zone as (typeof FRAMED_PAGE_DOCUMENT_ZONE_ORDER)[number]
				)
			: -1;
	return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}

function orderFramedPageColumns(columns: JsonNode[], path: string, issues: string[]): JsonNode[] {
	if (columns.length < 2) return columns;

	const zonedColumns = columns.filter(
		column => isRecord(column.attrs) && typeof column.attrs.zone === 'string'
	);
	if (zonedColumns.length !== columns.length) return columns;

	const sortedColumns = [...columns].sort((a, b) => getFrameZoneRank(a) - getFrameZoneRank(b));
	if (sortedColumns.every((column, index) => column === columns[index])) {
		return columns;
	}

	issues.push(`${path}: reordered framed page columns to match visual zone order`);
	return sortedColumns;
}

function sanitizeLineContentNode(node: JsonNode): JsonNode | null {
	if (!isAllowedMainLineContentNode(node)) {
		return null;
	}

	if (node.type === 'text') {
		const text = typeof node.text === 'string' ? node.text : '';
		if (text.length === 0) return null;
	}

	return cloneJsonNode(node);
}

function sanitizeLineNode(node: JsonNode, issues: string[], path: string): JsonNode {
	const rawContent = Array.isArray(node.content) ? node.content : [];
	const content = rawContent
		.map(child => {
			const sanitized = sanitizeLineContentNode(child);
			if (sanitized) return sanitized;
			issues.push(
				`${path}: dropped invalid line child ${String((child as JsonNode)?.type || '[unknown]')}`
			);
			return null;
		})
		.filter((child): child is JsonNode => child !== null);

	return {
		...cloneJsonNode(node),
		type: 'line',
		...(content.length > 0 ? { content } : {}),
	};
}

function wrapRecoveredLineContent(content: JsonNode[], ensureNodeIds = false): JsonNode {
	return {
		type: 'column',
		attrs: {
			...(ensureNodeIds ? { columnId: createStableEditorNodeId('col') } : {}),
		},
		content: [
			{
				type: 'line',
				attrs: {
					...(ensureNodeIds ? { lineId: createStableEditorNodeId('line') } : {}),
				},
				content,
			},
		],
	};
}

function repairColumnNode(
	node: JsonNode,
	issues: string[],
	path: string,
	options: ManuscriptRepairOptions
): JsonNode {
	const rawChildren = Array.isArray(node.content) ? node.content : [];
	const lines: JsonNode[] = [];
	let recoveredLineContent: JsonNode[] = [];

	const flushRecoveredLineContent = () => {
		if (recoveredLineContent.length === 0) return;
		lines.push({
			type: 'line',
			attrs: {
				...(options.ensureNodeIds ? { lineId: createStableEditorNodeId('line') } : {}),
			},
			content: recoveredLineContent,
		});
		recoveredLineContent = [];
	};

	for (const child of rawChildren) {
		if (isRecord(child) && child.type === 'line') {
			flushRecoveredLineContent();
			lines.push(sanitizeLineNode(child, issues, `${path}.line[${lines.length}]`));
			continue;
		}

		if (isAllowedMainLineContentNode(child)) {
			const sanitized = sanitizeLineContentNode(child);
			if (sanitized) {
				recoveredLineContent.push(sanitized);
				issues.push(`${path}: wrapped stray ${child.type} node into a synthetic line`);
			}
			continue;
		}

		issues.push(
			`${path}: dropped invalid column child ${String((child as JsonNode)?.type || '[unknown]')}`
		);
	}

	flushRecoveredLineContent();

	if (lines.length === 0) {
		lines.push(buildEmptyLine(options.ensureNodeIds));
		issues.push(`${path}: inserted empty line into column with no valid line children`);
	}

	return {
		...cloneJsonNode(node),
		type: 'column',
		attrs: {
			...(isRecord(node.attrs) ? cloneJsonNode(node.attrs) : {}),
			...(options.ensureNodeIds && !node.attrs?.columnId
				? { columnId: createStableEditorNodeId('col') }
				: {}),
		},
		content: lines.map(line => ({
			...line,
			attrs: {
				...(isRecord(line.attrs) ? cloneJsonNode(line.attrs) : {}),
				...(options.ensureNodeIds && !line.attrs?.lineId
					? { lineId: createStableEditorNodeId('line') }
					: {}),
			},
		})),
	};
}

function repairPageNode(
	node: JsonNode,
	issues: string[],
	path: string,
	options: ManuscriptRepairOptions
): JsonNode {
	const rawChildren = Array.isArray(node.content) ? node.content : [];
	const columns: JsonNode[] = [];
	let recoveredLineContent: JsonNode[] = [];

	const flushRecoveredColumn = () => {
		if (recoveredLineContent.length === 0) return;
		columns.push(wrapRecoveredLineContent(recoveredLineContent, options.ensureNodeIds));
		recoveredLineContent = [];
	};

	for (const child of rawChildren) {
		if (isRecord(child) && child.type === 'column') {
			flushRecoveredColumn();
			columns.push(
				repairColumnNode(child, issues, `${path}.column[${columns.length}]`, options)
			);
			continue;
		}

		if (isRecord(child) && child.type === 'line') {
			flushRecoveredColumn();
			columns.push({
				type: 'column',
				attrs: {
					...(options.ensureNodeIds ? { columnId: createStableEditorNodeId('col') } : {}),
				},
				content: [sanitizeLineNode(child, issues, `${path}.syntheticColumn.line[0]`)],
			});
			issues.push(`${path}: wrapped stray line into a synthetic column`);
			continue;
		}

		if (isAllowedMainLineContentNode(child)) {
			const sanitized = sanitizeLineContentNode(child);
			if (sanitized) {
				recoveredLineContent.push(sanitized);
				issues.push(
					`${path}: wrapped stray ${child.type} node into a synthetic column/line`
				);
			}
			continue;
		}

		issues.push(
			`${path}: dropped invalid page child ${String((child as JsonNode)?.type || '[unknown]')}`
		);
	}

	flushRecoveredColumn();

	if (columns.length === 0) {
		columns.push(buildEmptyColumn(options.ensureNodeIds));
		issues.push(`${path}: inserted empty column into page with no valid columns`);
	}

	const orderedColumns =
		options.framedPageZoneOrder === 'visual'
			? orderFramedPageColumns(columns, path, issues)
			: columns;

	return {
		...cloneJsonNode(node),
		type: 'page',
		content: orderedColumns.map((column, columnIndex) =>
			repairColumnNode(column, issues, `${path}.column[${columnIndex}]`, options)
		),
	};
}

export function repairManuscriptStructureJson(
	input: unknown,
	options: ManuscriptRepairOptions = {}
): ManuscriptStructureRepairResult {
	const normalizedOptions: Required<ManuscriptRepairOptions> = {
		framedPageZoneOrder: options.framedPageZoneOrder ?? 'preserve',
		ensureNodeIds: options.ensureNodeIds ?? false,
	};
	const issues: string[] = [];
	const doc = isRecord(input) ? cloneJsonNode(input) : { type: 'manuscript', content: [] };

	if (doc.type !== 'manuscript') {
		issues.push(
			`root: expected manuscript but found ${String(doc.type || '[unknown]')}; reset to empty manuscript`
		);
		return {
			doc: { type: 'manuscript', content: [] },
			repaired: true,
			issues,
		};
	}

	const rawPages = Array.isArray(doc.content) ? doc.content : [];
	const pages: JsonNode[] = [];
	let recoveredLineContent: JsonNode[] = [];

	const flushRecoveredPage = () => {
		if (recoveredLineContent.length === 0) return;
		pages.push({
			type: 'page',
			attrs: {},
			content: [
				wrapRecoveredLineContent(recoveredLineContent, normalizedOptions.ensureNodeIds),
			],
		});
		recoveredLineContent = [];
	};

	for (const child of rawPages) {
		if (isRecord(child) && child.type === 'page') {
			flushRecoveredPage();
			pages.push(repairPageNode(child, issues, `page[${pages.length}]`, normalizedOptions));
			continue;
		}

		if (isRecord(child) && child.type === 'column') {
			flushRecoveredPage();
			pages.push({
				type: 'page',
				attrs: {},
				content: [
					repairColumnNode(
						child,
						issues,
						`page[${pages.length}].column[0]`,
						normalizedOptions
					),
				],
			});
			issues.push(`root: wrapped stray column into a synthetic page`);
			continue;
		}

		if (isRecord(child) && child.type === 'line') {
			flushRecoveredPage();
			pages.push({
				type: 'page',
				attrs: {},
				content: [
					{
						type: 'column',
						attrs: {
							...(normalizedOptions.ensureNodeIds
								? { columnId: createStableEditorNodeId('col') }
								: {}),
						},
						content: [
							{
								...sanitizeLineNode(
									child,
									issues,
									`page[${pages.length}].column[0].line[0]`
								),
								attrs: {
									...(isRecord(child.attrs) ? cloneJsonNode(child.attrs) : {}),
									...(normalizedOptions.ensureNodeIds
										? { lineId: createStableEditorNodeId('line') }
										: {}),
								},
							},
						],
					},
				],
			});
			issues.push(`root: wrapped stray line into a synthetic page/column`);
			continue;
		}

		if (isAllowedMainLineContentNode(child)) {
			const sanitized = sanitizeLineContentNode(child);
			if (sanitized) {
				recoveredLineContent.push(sanitized);
				issues.push(
					`root: wrapped stray ${child.type} node into a synthetic page/column/line`
				);
			}
			continue;
		}

		issues.push(
			`root: dropped invalid manuscript child ${String((child as JsonNode)?.type || '[unknown]')}`
		);
	}

	flushRecoveredPage();

	const repairedDoc = {
		...doc,
		content: pages,
	};

	return {
		doc: repairedDoc,
		repaired: JSON.stringify(doc) !== JSON.stringify(repairedDoc),
		issues,
	};
}

export function createColumnSplitTransaction(state: EditorState): Transaction | null {
	const { selection } = state;
	const resolvedFrom = selection.$from;
	const resolvedTo = selection.$to;

	let lineDepth = -1;
	for (let depth = resolvedFrom.depth; depth >= 0; depth--) {
		if (resolvedFrom.node(depth).type.name === 'line') {
			lineDepth = depth;
			break;
		}
	}
	if (lineDepth === -1) return null;

	let columnDepth = -1;
	for (let depth = lineDepth - 1; depth >= 0; depth--) {
		if (resolvedFrom.node(depth).type.name === 'column') {
			columnDepth = depth;
			break;
		}
	}
	if (columnDepth === -1) return null;

	const lineStart = resolvedFrom.start(lineDepth);
	const lineEnd = resolvedFrom.end(lineDepth);
	if (
		selection.from < lineStart ||
		selection.to > lineEnd ||
		resolvedTo.start(lineDepth) !== lineStart
	) {
		return null;
	}

	const columnNode = resolvedFrom.node(columnDepth);
	const currentLine = resolvedFrom.node(lineDepth);
	const columnPos = resolvedFrom.before(columnDepth);
	const currentLineIndex = resolvedFrom.index(lineDepth - 1);
	const beforeOffset = selection.from - lineStart;
	const afterOffset = selection.to - lineStart;

	const linesBefore: any[] = [];
	const linesAfter: any[] = [];
	columnNode.forEach((child, _offset, index) => {
		if (child.type.name !== 'line') return;
		if (index < currentLineIndex) {
			linesBefore.push(child);
			return;
		}
		if (index > currentLineIndex) {
			linesAfter.push(child);
		}
	});

	const firstLine = currentLine.type.create(
		{ ...currentLine.attrs },
		currentLine.content.cut(0, beforeOffset)
	);
	const secondLine = currentLine.type.create(
		{
			...currentLine.attrs,
			lineId: createStableEditorNodeId('line'),
			'paragraph-start': false,
		},
		currentLine.content.cut(afterOffset, currentLine.content.size)
	);

	const firstColumnLines = [...linesBefore, firstLine];
	const secondColumnLines = [secondLine, ...linesAfter];

	const secondColumnTeiAttrs = { ...(columnNode.attrs.teiAttrs || {}) };
	delete secondColumnTeiAttrs['xml:id'];

	const newFirstColumn = state.schema.nodes.column.create(
		{ ...columnNode.attrs },
		firstColumnLines.length > 0
			? firstColumnLines
			: [state.schema.nodes.line.create({ lineId: createStableEditorNodeId('line') })]
	);
	const newSecondColumn = state.schema.nodes.column.create(
		{
			...columnNode.attrs,
			columnId: createStableEditorNodeId('col'),
			zone: null,
			teiAttrs: secondColumnTeiAttrs,
		},
		secondColumnLines.length > 0
			? secondColumnLines
			: [state.schema.nodes.line.create({ lineId: createStableEditorNodeId('line') })]
	);

	const tr = state.tr.replaceWith(columnPos, columnPos + columnNode.nodeSize, [
		newFirstColumn,
		newSecondColumn,
	]);

	const secondLinePos = columnPos + newFirstColumn.nodeSize + 1;
	tr.setSelection(TextSelection.near(tr.doc.resolve(secondLinePos + 1)));
	return tr;
}

export function createLineSplitTransaction(state: EditorState): Transaction | null {
	const { selection } = state;
	const resolvedFrom = selection.$from;
	const resolvedTo = selection.$to;

	let lineDepth = -1;
	for (let depth = resolvedFrom.depth; depth >= 0; depth--) {
		if (resolvedFrom.node(depth).type.name === 'line') {
			lineDepth = depth;
			break;
		}
	}
	if (lineDepth === -1) return null;

	let columnDepth = -1;
	for (let depth = lineDepth - 1; depth >= 0; depth--) {
		if (resolvedFrom.node(depth).type.name === 'column') {
			columnDepth = depth;
			break;
		}
	}
	if (columnDepth === -1) return null;

	const lineStart = resolvedFrom.start(lineDepth);
	const lineEnd = resolvedFrom.end(lineDepth);
	if (
		selection.from < lineStart ||
		selection.to > lineEnd ||
		resolvedTo.start(lineDepth) !== lineStart
	) {
		return null;
	}

	const currentLine = resolvedFrom.node(lineDepth);
	const linePos = resolvedFrom.before(lineDepth);
	const beforeOffset = selection.from - lineStart;
	const afterOffset = selection.to - lineStart;

	const firstLine = currentLine.type.create(
		{ ...currentLine.attrs },
		currentLine.content.cut(0, beforeOffset)
	);
	const secondLine = currentLine.type.create(
		{
			...currentLine.attrs,
			lineId: createStableEditorNodeId('line'),
			wrapped: false,
			'paragraph-start': false,
		},
		currentLine.content.cut(afterOffset, currentLine.content.size)
	);

	const tr = state.tr.replaceWith(linePos, linePos + currentLine.nodeSize, [
		firstLine,
		secondLine,
	]);
	const secondLinePos = linePos + firstLine.nodeSize;
	tr.setMeta(LINE_SPLIT_TARGET_LINE_ID_META, secondLine.attrs.lineId);
	tr.setSelection(TextSelection.near(tr.doc.resolve(secondLinePos + 1)));
	return tr;
}

export function createEmptyLineInsertTransaction(state: EditorState): Transaction | null {
	const { selection } = state;
	if (!selection.empty) return null;

	const resolvedFrom = selection.$from;

	let lineDepth = -1;
	for (let depth = resolvedFrom.depth; depth >= 0; depth--) {
		if (resolvedFrom.node(depth).type.name === 'line') {
			lineDepth = depth;
			break;
		}
	}
	if (lineDepth === -1) return null;

	let columnDepth = -1;
	for (let depth = lineDepth - 1; depth >= 0; depth--) {
		if (resolvedFrom.node(depth).type.name === 'column') {
			columnDepth = depth;
			break;
		}
	}
	if (columnDepth === -1) return null;

	const currentLine = resolvedFrom.node(lineDepth);
	if (currentLine.content.size > 0) return null;

	const columnPos = resolvedFrom.before(columnDepth);
	const linePosFallback = resolvedFrom.before(lineDepth);
	const currentLineId = currentLine.attrs?.lineId;
	const columnNode = resolvedFrom.node(columnDepth);
	let currentLinePos = -1;

	columnNode.forEach((child, offset) => {
		if (currentLinePos !== -1 || child.type.name !== 'line') return;
		const childPos = columnPos + 1 + offset;
		if (
			(currentLineId && child.attrs?.lineId === currentLineId) ||
			childPos === linePosFallback
		) {
			currentLinePos = childPos;
		}
	});
	if (currentLinePos === -1) return null;

	const preservedLine = currentLine.type.create({ ...currentLine.attrs }, currentLine.content);
	const insertedLine = currentLine.type.create(
		{
			...currentLine.attrs,
			lineId: createStableEditorNodeId('line'),
			wrapped: false,
			'paragraph-start': false,
		},
		currentLine.content.cut(0, 0)
	);

	const tr = state.tr.replaceWith(currentLinePos, currentLinePos + currentLine.nodeSize, [
		preservedLine,
		insertedLine,
	]);
	tr.setMeta(LINE_SPLIT_TARGET_LINE_ID_META, insertedLine.attrs.lineId);
	tr.setSelection(
		TextSelection.near(tr.doc.resolve(currentLinePos + preservedLine.nodeSize + 1))
	);
	return tr;
}

export function findLineStartPositionById(
	doc: any,
	lineId: string | null | undefined
): number | null {
	if (!lineId) return null;

	const position = findFirstDescendantPosition(
		doc,
		node => node.type.name === 'line' && node.attrs?.lineId === lineId
	);
	return position === null ? null : position + 1;
}
