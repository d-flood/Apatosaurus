import type {
	BoundaryItem,
	InlineItem,
	LineItem,
	TextItem,
	TranscriptionColumn,
	TranscriptionPage,
	TranscriptionDocument,
	TranscriptionLine,
} from './types';

const WORD_BOUNDARY: BoundaryItem = { type: 'boundary', kind: 'word' };

function sameMarks(a: TextItem['marks'], b: TextItem['marks']): boolean {
	return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function normalizeInlineItems<T extends InlineItem>(items: T[]): T[] {
	const normalized: T[] = [];

	for (const item of items) {
		if (item.type === 'text') {
			if (!item.text) continue;
			const previous = normalized[normalized.length - 1];
			if (
				previous &&
				previous.type === 'text' &&
				sameMarks(previous.marks, item.marks)
			) {
				previous.text += item.text;
				continue;
			}
		}

		if (item.type === 'boundary') {
			const previous = normalized[normalized.length - 1];
			if (
				!previous ||
				previous.type === 'boundary' ||
				previous.type === 'pageBreak' ||
				previous.type === 'lineBreak' ||
				previous.type === 'columnBreak'
			) {
				continue;
			}
		}

		if (item.type === 'correctionOnly') {
			normalized.push({
				...item,
				corrections: item.corrections.map(correction => ({
					...correction,
					content: normalizeInlineItems(correction.content),
				})),
			} as T);
			continue;
		}

		if (item.type === 'fw') {
			normalized.push({
				...item,
				content: normalizeInlineItems(item.content),
			} as T);
			continue;
		}

		normalized.push(item);
	}

	while (normalized[normalized.length - 1]?.type === 'boundary') {
		normalized.pop();
	}

	return normalized;
}

function normalizeLineItems(items: LineItem[]): LineItem[] {
	const normalized: LineItem[] = [];

	for (const item of items) {
		if (item.type === 'text') {
			if (!item.text) continue;
			const previous = normalized[normalized.length - 1];
			if (previous && previous.type === 'text' && sameMarks(previous.marks, item.marks)) {
				previous.text += item.text;
				continue;
			}
			normalized.push(item);
			continue;
		}

		if (item.type === 'boundary') {
			const previous = normalized[normalized.length - 1];
			if (!previous || previous.type === 'boundary') {
				continue;
			}
			normalized.push(item);
			continue;
		}

		if (item.type === 'correctionOnly') {
			normalized.push({
				...item,
				corrections: item.corrections.map(correction => ({
					...correction,
					content: normalizeInlineItems(correction.content),
				})),
			});
			continue;
		}

		if (item.type === 'fw') {
			normalized.push({
				...item,
				content: normalizeInlineItems(item.content),
			});
			continue;
		}

		normalized.push(item);
	}

	while (normalized[normalized.length - 1]?.type === 'boundary') {
		normalized.pop();
	}

	return normalized;
}

function normalizeLine(line: TranscriptionLine): TranscriptionLine {
	return {
		...line,
		items: normalizeLineItems(line.items),
	};
}

function createEmptyLine(number: number = 1): TranscriptionLine {
	return {
		type: 'line',
		number,
		items: [],
	};
}

function normalizeColumn(column: TranscriptionColumn): TranscriptionColumn {
	const normalizedLines = column.lines.map(normalizeLine).filter(line => line.items.length > 0);

	return {
		...column,
		lines: normalizedLines.length > 0 ? normalizedLines : [createEmptyLine(1)],
	};
}

function createEmptyColumn(number: number = 1): TranscriptionColumn {
	return {
		type: 'column',
		number,
		lines: [createEmptyLine(1)],
	};
}

function createPageId(): string {
	if (typeof globalThis.crypto?.randomUUID === 'function') {
		return `page-${globalThis.crypto.randomUUID()}`;
	}
	return `page-${Math.random().toString(36).slice(2, 12)}`;
}

function normalizePage(page: TranscriptionPage): TranscriptionPage {
	const normalizedColumns = page.columns.map(normalizeColumn);

	return {
		...page,
		pageId: page.pageId || page.teiAttrs?.['xml:id'] || createPageId(),
		columns: normalizedColumns.length > 0 ? normalizedColumns : [createEmptyColumn(1)],
	};
}

export function normalizeDocument(document: TranscriptionDocument): TranscriptionDocument {
	return {
		...document,
		pages: document.pages.map(normalizePage),
	};
}

export const WORD_BOUNDARY_ITEM = WORD_BOUNDARY;
