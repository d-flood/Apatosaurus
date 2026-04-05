import type { EditorState, Transaction } from '@tiptap/pm/state';

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

export interface ManuscriptStructureRepairResult {
	doc: JsonNode;
	repaired: boolean;
	issues: string[];
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
	return isRecord(node) && typeof node.type === 'string' && MAIN_LINE_CONTENT_NODE_NAMES.has(node.type);
}

function buildEmptyLine(lineNumber: number): JsonNode {
	return {
		type: 'line',
		attrs: { lineNumber },
		content: [],
	};
}

function buildEmptyColumn(columnNumber: number): JsonNode {
	return {
		type: 'column',
		attrs: { columnNumber },
		content: [buildEmptyLine(1)],
	};
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
			issues.push(`${path}: dropped invalid line child ${String((child as JsonNode)?.type || '[unknown]')}`);
			return null;
		})
		.filter((child): child is JsonNode => child !== null);

	return {
		...cloneJsonNode(node),
		type: 'line',
		content,
	};
}

function wrapRecoveredLineContent(
	content: JsonNode[],
	columnNumber: number,
	lineNumber: number
): JsonNode {
	return {
		type: 'column',
		attrs: { columnNumber },
		content: [
			{
				type: 'line',
				attrs: { lineNumber },
				content,
			},
		],
	};
}

function repairColumnNode(node: JsonNode, columnNumber: number, issues: string[], path: string): JsonNode {
	const rawChildren = Array.isArray(node.content) ? node.content : [];
	const lines: JsonNode[] = [];
	let recoveredLineContent: JsonNode[] = [];

	const flushRecoveredLineContent = () => {
		if (recoveredLineContent.length === 0) return;
		lines.push({
			type: 'line',
			attrs: { lineNumber: lines.length + 1 },
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

		issues.push(`${path}: dropped invalid column child ${String((child as JsonNode)?.type || '[unknown]')}`);
	}

	flushRecoveredLineContent();

	if (lines.length === 0) {
		lines.push(buildEmptyLine(1));
		issues.push(`${path}: inserted empty line into column with no valid line children`);
	}

	return {
		...cloneJsonNode(node),
		type: 'column',
		attrs: {
			...(isRecord(node.attrs) ? cloneJsonNode(node.attrs) : {}),
			columnNumber,
		},
		content: lines.map((line, lineIndex) => ({
			...line,
			attrs: {
				...(isRecord(line.attrs) ? cloneJsonNode(line.attrs) : {}),
				lineNumber: lineIndex + 1,
			},
		})),
	};
}

function repairPageNode(node: JsonNode, issues: string[], path: string): JsonNode {
	const rawChildren = Array.isArray(node.content) ? node.content : [];
	const columns: JsonNode[] = [];
	let recoveredLineContent: JsonNode[] = [];

	const flushRecoveredColumn = () => {
		if (recoveredLineContent.length === 0) return;
		columns.push(wrapRecoveredLineContent(recoveredLineContent, columns.length + 1, 1));
		recoveredLineContent = [];
	};

	for (const child of rawChildren) {
		if (isRecord(child) && child.type === 'column') {
			flushRecoveredColumn();
			columns.push(repairColumnNode(child, columns.length + 1, issues, `${path}.column[${columns.length}]`));
			continue;
		}

		if (isRecord(child) && child.type === 'line') {
			flushRecoveredColumn();
			columns.push({
				type: 'column',
				attrs: { columnNumber: columns.length + 1 },
				content: [sanitizeLineNode(child, issues, `${path}.syntheticColumn.line[0]`)],
			});
			issues.push(`${path}: wrapped stray line into a synthetic column`);
			continue;
		}

		if (isAllowedMainLineContentNode(child)) {
			const sanitized = sanitizeLineContentNode(child);
			if (sanitized) {
				recoveredLineContent.push(sanitized);
				issues.push(`${path}: wrapped stray ${child.type} node into a synthetic column/line`);
			}
			continue;
		}

		issues.push(`${path}: dropped invalid page child ${String((child as JsonNode)?.type || '[unknown]')}`);
	}

	flushRecoveredColumn();

	if (columns.length === 0) {
		columns.push(buildEmptyColumn(1));
		issues.push(`${path}: inserted empty column into page with no valid columns`);
	}

	return {
		...cloneJsonNode(node),
		type: 'page',
		content: columns.map((column, columnIndex) =>
			repairColumnNode(column, columnIndex + 1, issues, `${path}.column[${columnIndex}]`)
		),
	};
}

export function repairManuscriptStructureJson(input: unknown): ManuscriptStructureRepairResult {
	const issues: string[] = [];
	const doc = isRecord(input) ? cloneJsonNode(input) : { type: 'manuscript', content: [] };

	if (doc.type !== 'manuscript') {
		issues.push(`root: expected manuscript but found ${String(doc.type || '[unknown]')}; reset to empty manuscript`);
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
			content: [wrapRecoveredLineContent(recoveredLineContent, 1, 1)],
		});
		recoveredLineContent = [];
	};

	for (const child of rawPages) {
		if (isRecord(child) && child.type === 'page') {
			flushRecoveredPage();
			pages.push(repairPageNode(child, issues, `page[${pages.length}]`));
			continue;
		}

		if (isRecord(child) && child.type === 'column') {
			flushRecoveredPage();
			pages.push({
				type: 'page',
				attrs: {},
				content: [repairColumnNode(child, 1, issues, `page[${pages.length}].column[0]`)],
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
						attrs: { columnNumber: 1 },
						content: [sanitizeLineNode(child, issues, `page[${pages.length}].column[0].line[0]`)],
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
				issues.push(`root: wrapped stray ${child.type} node into a synthetic page/column/line`);
			}
			continue;
		}

		issues.push(`root: dropped invalid manuscript child ${String((child as JsonNode)?.type || '[unknown]')}`);
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
			lineId: null,
			'paragraph-start': false,
		},
		currentLine.content.cut(afterOffset, currentLine.content.size)
	);

	const firstColumnLines = [...linesBefore, firstLine];
	const secondColumnLines = [secondLine, ...linesAfter];

	const nextColumnNumber = Math.max(
		0,
		...state.doc.content.content.flatMap(pageNode =>
			pageNode.type.name === 'page'
				? pageNode.content.content
						.filter(columnNode => columnNode.type.name === 'column')
						.map(columnNode => Number(columnNode.attrs?.columnNumber) || 0)
				: []
		)
	) + 1;

	const newFirstColumn = state.schema.nodes.column.create(
		{ ...columnNode.attrs },
		firstColumnLines.length > 0 ? firstColumnLines : [state.schema.nodes.line.create({ lineNumber: 1 })]
	);
	const newSecondColumn = state.schema.nodes.column.create(
		{ columnNumber: nextColumnNumber, columnId: null },
		secondColumnLines.length > 0 ? secondColumnLines : [state.schema.nodes.line.create({ lineNumber: 1 })]
	);

	return state.tr.replaceWith(
		columnPos,
		columnPos + columnNode.nodeSize,
		[newFirstColumn, newSecondColumn]
	);
}
