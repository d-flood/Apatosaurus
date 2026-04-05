import type { ProseMirrorJSON } from './types';

type FormWorkDoc = ProseMirrorJSON & {
	type: 'doc';
	content: FormWorkColumnNode[];
};

type FormWorkColumnNode = ProseMirrorJSON & {
	type: 'marginaliaColumn';
	attrs?: Record<string, any>;
	content: FormWorkLineNode[];
};

type FormWorkLineNode = ProseMirrorJSON & {
	type: 'marginaliaLine';
	attrs?: Record<string, any>;
	content?: ProseMirrorJSON[];
};

export function createStructuredFormWorkContent(nodes: ProseMirrorJSON[]): FormWorkDoc {
	const columns: FormWorkColumnNode[] = [];
	let currentColumnBreakAttrs: Record<string, any> | undefined;
	let currentLineBreakAttrs: Record<string, any> | undefined;
	let currentLineNodes: ProseMirrorJSON[] = [];
	let currentColumn: FormWorkColumnNode | null = null;

	function ensureColumn(): FormWorkColumnNode {
		if (currentColumn) {
			return currentColumn;
		}

		currentColumn = {
			type: 'marginaliaColumn',
			attrs: {
				columnNumber: columns.length + 1,
				...(currentColumnBreakAttrs && Object.keys(currentColumnBreakAttrs).length > 0
					? { breakAttrs: currentColumnBreakAttrs }
					: {}),
			},
			content: [],
		};
		columns.push(currentColumn);
		currentColumnBreakAttrs = undefined;
		return currentColumn;
	}

	function pushLine(): void {
		const column = ensureColumn();
		column.content.push({
			type: 'marginaliaLine',
			attrs: {
				lineNumber: column.content.length + 1,
				...(currentLineBreakAttrs && Object.keys(currentLineBreakAttrs).length > 0
					? {
						breakAttrs: currentLineBreakAttrs,
						wrapped: currentLineBreakAttrs.break === 'no',
					}
					: {}),
			},
			content: currentLineNodes,
		});
		currentLineNodes = [];
		currentLineBreakAttrs = undefined;
	}

	for (const node of nodes) {
		if (node.type === 'columnBreak') {
			pushLine();
			currentColumn = null;
			currentColumnBreakAttrs = node.attrs?.teiAttrs || {};
			continue;
		}

		if (node.type === 'lineBreak') {
			pushLine();
			currentLineBreakAttrs = node.attrs?.teiAttrs || {};
			continue;
		}

		currentLineNodes.push(node);
	}

	pushLine();

	return {
		type: 'doc',
		content: columns.length > 0 ? columns : [createEmptyColumn(1)],
	};
}

export function flattenStructuredFormWorkContent(content: unknown): ProseMirrorJSON[] {
	if (Array.isArray(content)) {
		return content as ProseMirrorJSON[];
	}

	if (!isStructuredFormWorkContent(content)) {
		return [];
	}

	const flattened: ProseMirrorJSON[] = [];
	for (const [columnIndex, column] of content.content.entries()) {
		if (columnIndex > 0) {
			flattened.push({
				type: 'columnBreak',
				attrs: { teiAttrs: column.attrs?.breakAttrs || {} },
			});
		}

		for (const [lineIndex, line] of (column.content || []).entries()) {
			if (lineIndex > 0) {
				flattened.push({
					type: 'lineBreak',
					attrs: { teiAttrs: line.attrs?.breakAttrs || {} },
				});
			}

			flattened.push(...((line.content || []) as ProseMirrorJSON[]));
		}
	}

	return flattened;
}

export function isStructuredFormWorkContent(content: unknown): content is FormWorkDoc {
	return !!content && typeof content === 'object' && (content as Record<string, any>).type === 'doc';
}

export function createEmptyStructuredFormWorkContent(): FormWorkDoc {
	return {
		type: 'doc',
		content: [createEmptyColumn(1)],
	};
}

function createEmptyColumn(columnNumber: number): FormWorkColumnNode {
	return {
		type: 'marginaliaColumn',
		attrs: { columnNumber },
		content: [
			{
				type: 'marginaliaLine',
				attrs: { lineNumber: 1 },
				content: [],
			},
		],
	};
}
