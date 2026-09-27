import {
	cloneAlignmentColumn,
	type AlignmentCell,
	type AlignmentColumn,
} from './alignment-snapshot';
import { buildDisplayedColumnSlots } from './collation-apparatus';
import type {
	AlignmentCellKind,
	GapMetadata,
	RegularizationRule,
	RegularizationType,
	WitnessSourceToken,
} from './collation-types';
import { regularizeCollationText } from './regularization';
import { joinTokenTexts, tokenizeDisplayText } from './token-text';

/** What alignment edits read from the collation besides the columns themselves. */
export interface AlignmentEditContext {
	rules: RegularizationRule[];
	witnessOrder: string[];
	witnessIds: string[];
	baseWitnessId: string | null;
}

type Columns = AlignmentColumn[];
type Direction = 'left' | 'right';

function makeAlignmentCell(
	rules: RegularizationRule[],
	text: string | null,
	options?: {
		kind?: AlignmentCellKind;
		gap?: GapMetadata | null;
		alignmentValue?: string | null;
		regularizedText?: string | null;
		isLacuna?: boolean;
		sourceTokenIds?: string[];
		ruleIds?: string[];
		regularizationTypes?: RegularizationType[];
	}
): AlignmentCell {
	const kind = options?.kind ?? (text === null ? 'omission' : 'text');
	const regularizedValue =
		kind !== 'text' || text === null
			? { regularizedText: null, ruleIds: [], types: [] as RegularizationType[] }
			: regularizeCollationText(text, rules);
	const ruleIds = options?.ruleIds ?? regularizedValue.ruleIds;
	const regularizationTypes = options?.regularizationTypes ?? regularizedValue.types;
	return {
		text,
		regularizedText: options?.regularizedText ?? regularizedValue.regularizedText,
		alignmentValue:
			options?.alignmentValue ?? (kind === 'text' ? regularizedValue.regularizedText : null),
		sourceTokenIds: options?.sourceTokenIds ?? [],
		kind,
		gap: options?.gap ?? null,
		isOmission: kind === 'omission',
		isLacuna: options?.isLacuna ?? (kind === 'gap' || kind === 'untranscribed'),
		isRegularized:
			kind === 'text' &&
			text !== null &&
			regularizedValue.regularizedText !== null &&
			text !== regularizedValue.regularizedText,
		ruleIds,
		regularizationTypes,
	};
}

function reindex(columns: Columns): Columns {
	columns.forEach((column, index) => (column.index = index));
	return columns;
}

type JoinablePart = { text: string; originalSegments?: WitnessSourceToken['segments'] };

function mergeCellParts(cells: Array<AlignmentCell | undefined>, trim: boolean) {
	const parts: JoinablePart[] = [];
	const sourceTokenIds = new Set<string>();
	let isLacuna = false;
	for (const cell of cells) {
		const text = trim ? cell?.text?.trim() : cell?.text;
		if (text) parts.push({ text, originalSegments: cell?.originalSegments });
		for (const tokenId of cell?.sourceTokenIds ?? []) sourceTokenIds.add(tokenId);
		if (cell?.isLacuna) isLacuna = true;
	}
	return {
		text: parts.length > 0 ? joinTokenTexts(parts) : null,
		options: { isLacuna, sourceTokenIds: [...sourceTokenIds] },
	};
}

export function mergeColumnsIn(
	columns: Columns,
	columnIds: string[],
	context: AlignmentEditContext
): Columns {
	const indices = columnIds
		.map(id => columns.findIndex(c => c.id === id))
		.filter(i => i >= 0)
		.sort((a, b) => a - b);

	const mergedCells = new Map<string, AlignmentCell>();
	for (const witnessId of context.witnessOrder) {
		const merged = mergeCellParts(
			indices.map(idx => columns[idx].cells.get(witnessId)),
			false
		);
		mergedCells.set(witnessId, makeAlignmentCell(context.rules, merged.text, merged.options));
	}

	const mergedColumn: AlignmentColumn = {
		id: crypto.randomUUID(),
		index: indices[0],
		cells: mergedCells,
		merged: true,
		mergedWith: columnIds,
		splitInto: indices.map(idx => cloneAlignmentColumn(columns[idx])),
	};
	const next = columns.filter(c => !columnIds.includes(c.id));
	next.splice(indices[0], 0, mergedColumn);
	return reindex(next);
}

export function cellSelectionKey(witnessId: string, columnId: string): string {
	return `${witnessId}::${columnId}`;
}

function parseCellSelectionKey(key: string): { witnessId: string; columnId: string } | null {
	const idx = key.indexOf('::');
	if (idx < 0) return null;
	return { witnessId: key.slice(0, idx), columnId: key.slice(idx + 2) };
}

function selectedCellRange(columns: Columns, selectedCells: Set<string>) {
	if (selectedCells.size < 2) return null;
	const parsed = [...selectedCells]
		.map(parseCellSelectionKey)
		.filter((entry): entry is { witnessId: string; columnId: string } => entry !== null);
	if (parsed.length < 2) return null;
	const witnessId = parsed[0].witnessId;
	if (!parsed.every(entry => entry.witnessId === witnessId)) return null;

	const indices = parsed
		.map(entry => columns.findIndex(c => c.id === entry.columnId))
		.filter(idx => idx >= 0)
		.sort((a, b) => a - b);
	if (indices.length < 2) return null;
	for (let i = 1; i < indices.length; i++) {
		if (indices[i] !== indices[i - 1] + 1) return null;
	}
	return { witnessId, indices };
}

export function canMergeCells(columns: Columns, selectedCells: Set<string>): boolean {
	return selectedCellRange(columns, selectedCells) !== null;
}

export function mergeCellsIn(
	columns: Columns,
	selectedCells: Set<string>,
	rules: RegularizationRule[]
): { columns: Columns; witnessId: string; count: number } | null {
	const range = selectedCellRange(columns, selectedCells);
	if (!range) return null;
	const { witnessId, indices } = range;
	const merged = mergeCellParts(
		indices.map(idx => columns[idx].cells.get(witnessId)),
		true
	);
	const next = columns.map(col => ({ ...col, cells: new Map(col.cells) }));
	next[indices[0]].cells.set(witnessId, makeAlignmentCell(rules, merged.text, merged.options));
	for (const idx of indices.slice(1)) {
		next[idx].cells.set(witnessId, makeAlignmentCell(rules, null));
	}
	return { columns: next, witnessId, count: indices.length };
}

function expandColumnByWhitespace(column: AlignmentColumn, context: AlignmentEditContext): Columns {
	const witnessIds =
		context.witnessOrder.length > 0 ? context.witnessOrder : [...column.cells.keys()];
	const tokenizedByWitness = new Map<string, string[]>();
	let maxWords = 1;
	for (const witnessId of witnessIds) {
		const cell = column.cells.get(witnessId);
		const words = cell && !cell.isOmission && cell.text ? tokenizeDisplayText(cell.text) : [];
		tokenizedByWitness.set(witnessId, words);
		if (words.length > maxWords) maxWords = words.length;
	}

	return Array.from({ length: maxWords }, (_, wordIdx) => {
		const cells = new Map<string, AlignmentCell>();
		for (const witnessId of witnessIds) {
			const sourceCell = column.cells.get(witnessId);
			const token = tokenizedByWitness.get(witnessId)?.[wordIdx] ?? null;
			const sourceTokenIds =
				token !== null && sourceCell?.sourceTokenIds?.length
					? sourceCell.sourceTokenIds.slice(wordIdx, wordIdx + 1)
					: [];
			cells.set(
				witnessId,
				makeAlignmentCell(context.rules, token, {
					isLacuna: sourceCell?.isLacuna ?? false,
					sourceTokenIds,
				})
			);
		}
		return { id: crypto.randomUUID(), index: wordIdx, cells, merged: false };
	});
}

export function canSplitColumn(columns: Columns, columnId: string): boolean {
	const col = columns.find(c => c.id === columnId);
	if (!col) return false;
	if (col.merged) return true;
	return [...col.cells.values()].some(
		cell => Boolean(cell?.text) && (cell?.text ? tokenizeDisplayText(cell.text).length : 0) > 1
	);
}

export function splitColumnIn(
	columns: Columns,
	columnId: string,
	context: AlignmentEditContext
): Columns | null {
	const colIdx = columns.findIndex(c => c.id === columnId);
	if (colIdx < 0 || !canSplitColumn(columns, columnId)) return null;
	const col = columns[colIdx];
	const restored =
		col.merged && col.splitInto && col.splitInto.length > 0
			? col.splitInto.map(cloneAlignmentColumn)
			: expandColumnByWhitespace(col, context);
	return reindex([...columns.slice(0, colIdx), ...restored, ...columns.slice(colIdx + 1)]);
}

function slotById(columns: Columns, columnId: string, context: AlignmentEditContext) {
	return (
		buildDisplayedColumnSlots(columns, context.baseWitnessId).find(
			slot => slot.columnId === columnId
		) ?? null
	);
}

function slotAtPosition(columns: Columns, position: number, context: AlignmentEditContext) {
	return (
		buildDisplayedColumnSlots(columns, context.baseWitnessId).find(
			slot => slot.start <= position && position <= slot.end
		) ?? null
	);
}

function insertEmptyColumn(columns: Columns, atIndex: number, context: AlignmentEditContext) {
	const witnessIds =
		context.witnessOrder.length > 0 ? context.witnessOrder : [...new Set(context.witnessIds)];
	const cells = new Map<string, AlignmentCell>();
	for (const witnessId of witnessIds)
		cells.set(witnessId, makeAlignmentCell(context.rules, null));
	const next = columns.map(cloneAlignmentColumn);
	next.splice(atIndex, 0, { id: crypto.randomUUID(), index: atIndex, cells, merged: false });
	return reindex(next);
}

function isColumnFullyEmpty(column: AlignmentColumn): boolean {
	return [...column.cells.values()].every(cell => cell.isOmission && !cell.text);
}

function pruneEmptyColumnById(columns: Columns, columnId: string): Columns {
	const next = columns.map(cloneAlignmentColumn);
	const index = next.findIndex(column => column.id === columnId);
	if (index < 0 || !isColumnFullyEmpty(next[index])) return next;
	next.splice(index, 1);
	return reindex(next);
}

function resolveShiftTarget(
	columns: Columns,
	columnId: string,
	direction: Direction,
	context: AlignmentEditContext
) {
	const sourceSlot = slotById(columns, columnId, context);
	if (!sourceSlot) return null;

	const targetPosition = direction === 'left' ? sourceSlot.start - 1 : sourceSlot.end + 1;
	if (targetPosition < 1) return null;

	const targetSlot = slotAtPosition(columns, targetPosition, context);
	if (targetSlot) {
		return {
			columns,
			sourceIndex: sourceSlot.columnIndex,
			targetIndex: targetSlot.columnIndex,
			sourceColumnId: sourceSlot.columnId,
		};
	}

	const insertionIndex =
		direction === 'left' ? sourceSlot.columnIndex : sourceSlot.columnIndex + 1;
	const expanded = insertEmptyColumn(columns, insertionIndex, context);
	const expandedSourceSlot = slotById(expanded, columnId, context);
	const expandedTargetSlot = slotAtPosition(expanded, targetPosition, context);
	if (!expandedSourceSlot || !expandedTargetSlot) return null;
	return {
		columns: expanded,
		sourceIndex: expandedSourceSlot.columnIndex,
		targetIndex: expandedTargetSlot.columnIndex,
		sourceColumnId: expandedSourceSlot.columnId,
	};
}

export function canShiftToken(
	columns: Columns,
	columnId: string,
	witnessId: string,
	direction: Direction,
	context: AlignmentEditContext
): boolean {
	const sourceSlot = slotById(columns, columnId, context);
	if (!sourceSlot) return false;
	const sourceCell = columns[sourceSlot.columnIndex]?.cells.get(witnessId);
	if (!sourceCell || sourceCell.isOmission || !sourceCell.text) return false;

	const targetPosition = direction === 'left' ? sourceSlot.start - 1 : sourceSlot.end + 1;
	if (targetPosition < 1) return false;

	const targetSlot = slotAtPosition(columns, targetPosition, context);
	if (!targetSlot) return true;

	const targetCell = columns[targetSlot.columnIndex]?.cells.get(witnessId);
	return Boolean(targetCell && targetCell.isOmission && !targetCell.text);
}

export function shiftTokenIn(
	columns: Columns,
	columnId: string,
	witnessId: string,
	direction: Direction,
	context: AlignmentEditContext
): Columns | null {
	const sourceSlot = slotById(columns, columnId, context);
	if (!sourceSlot) return null;
	const sourceCell = columns[sourceSlot.columnIndex]?.cells.get(witnessId);
	if (!sourceCell || sourceCell.isOmission || !sourceCell.text) return null;

	const target = resolveShiftTarget(
		columns.map(cloneAlignmentColumn),
		columnId,
		direction,
		context
	);
	if (!target) return null;
	const next = target.columns.map(cloneAlignmentColumn);
	const targetCell = next[target.targetIndex]?.cells.get(witnessId);
	if (!targetCell || !targetCell.isOmission || targetCell.text) return null;

	next[target.targetIndex].cells.set(witnessId, { ...sourceCell });
	next[target.sourceIndex].cells.set(
		witnessId,
		makeAlignmentCell(context.rules, null, { isLacuna: sourceCell.isLacuna })
	);
	return pruneEmptyColumnById(next, target.sourceColumnId);
}
