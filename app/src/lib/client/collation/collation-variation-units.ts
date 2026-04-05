import type { AlignmentCell, AlignmentColumn } from './alignment-snapshot';
import type { AlignmentDisplayMode } from './collation-types';
import { isPunctuationToken, joinTokenTexts } from './token-text';

export interface VariationUnitSpan {
	startIndex: number;
	endIndex: number;
	columnIds: string[];
}

export interface DisplaySegment {
	text: string;
	hasUnclear: boolean;
}

export interface CollapsedReadingDisplay {
	id: string;
	label: string;
	witnessIds: string[];
	segments: DisplaySegment[];
	isBase: boolean;
	isOmission: boolean;
	isLacuna: boolean;
	hasRegularization: boolean;
}

export interface CollapsedReadingGroupDisplay {
	id: string;
	parent: CollapsedReadingDisplay;
	children: CollapsedReadingDisplay[];
}

interface WitnessRowGroupLike {
	witnessIds: string[];
}

interface ReadingBucket {
	id: string;
	equivalenceKeys: Set<string>;
	originalKey: string;
	witnessIds: string[];
	segments: DisplaySegment[];
	originalText: string | null;
	normalizedText: string | null;
	isBase: boolean;
	isOmission: boolean;
	isLacuna: boolean;
	hasRegularization: boolean;
	allCellsRegularized: boolean;
	regularizationTypes: Set<string>;
	ruleIds: Set<string>;
}

export interface ReadingFamilyBucket {
	id: string;
	originalKey: string;
	equivalenceKeys: string[];
	witnessIds: string[];
	segments: DisplaySegment[];
	originalText: string | null;
	normalizedText: string | null;
	isBase: boolean;
	isOmission: boolean;
	isLacuna: boolean;
	hasRegularization: boolean;
	allCellsRegularized: boolean;
	regularizationTypes: string[];
	ruleIds: string[];
}

export interface ReadingFamilyGroup {
	id: string;
	equivalenceKey: string;
	parent: ReadingFamilyBucket;
	children: ReadingFamilyBucket[];
}

interface ReadingFamilyWitnessEntry {
	witnessId: string;
	cells: Array<AlignmentCell | undefined>;
}

export function getAlignmentCellCollapseValue(cell: AlignmentCell | undefined): string {
	if (!cell || cell.isOmission || cell.text === null) return '__OMISSION__';
	if (cell.kind === 'gap' || cell.kind === 'untranscribed') {
		return [
			cell.kind,
			cell.gap?.source ?? '',
			cell.gap?.reason ?? '',
			cell.gap?.unit ?? '',
			cell.gap?.extent ?? '',
		].join('::');
	}
	return cell.alignmentValue ?? cell.regularizedText ?? cell.text ?? '__OMISSION__';
}

export function getOriginalReadingKey(cell: AlignmentCell | undefined): string {
	if (!cell || cell.isOmission) return '__OMISSION__';
	if (cell.kind === 'gap' || cell.kind === 'untranscribed') {
		return [
			cell.kind,
			cell.text ?? '',
			cell.gap?.source ?? '',
			cell.gap?.reason ?? '',
			cell.gap?.unit ?? '',
			cell.gap?.extent ?? '',
		].join('::');
	}

	if (Array.isArray(cell.originalSegments) && cell.originalSegments.length > 0) {
		const normalizedSegments = getCellSegments(cell, 'original').reduce<DisplaySegment[]>((acc, segment) => {
			const previous = acc[acc.length - 1];
			if (previous && previous.hasUnclear === segment.hasUnclear) {
				previous.text += segment.text;
				return acc;
			}
			acc.push({ ...segment });
			return acc;
		}, []);
		return normalizedSegments
			.map((segment) => `${segment.text}::${segment.hasUnclear ? '1' : '0'}`)
			.join('\u0001');
	}

	return [cell.text ?? '', cell.isRegularized ? 'regularized' : 'original'].join('::');
}

function getAlignmentCellsCollapseValue(cells: Array<AlignmentCell | undefined>): string {
	return cells.map(cell => getAlignmentCellCollapseValue(cell)).join('\u0002');
}

function getOriginalReadingKeyForCells(cells: Array<AlignmentCell | undefined>): string {
	return cells.map(cell => getOriginalReadingKey(cell)).join('\u0002');
}

function getCellVisibleText(cell: AlignmentCell, alignmentDisplayMode: AlignmentDisplayMode): string | null {
	if (cell.kind === 'gap') {
		return alignmentDisplayMode === 'regularized' ? '<gap>' : cell.text;
	}

	if (cell.kind === 'untranscribed') {
		return alignmentDisplayMode === 'regularized' ? '<untranscribed>' : cell.text;
	}

	return alignmentDisplayMode === 'regularized' ? cell.regularizedText : cell.text;
}

function getCellSegments(
	cell: AlignmentCell,
	alignmentDisplayMode: AlignmentDisplayMode,
): DisplaySegment[] {
	if (
		alignmentDisplayMode !== 'original' ||
		!Array.isArray(cell.originalSegments) ||
		cell.originalSegments.length === 0
	) {
		return [{ text: getCellVisibleText(cell, alignmentDisplayMode) ?? '', hasUnclear: false }];
	}

	return cell.originalSegments
		.filter((segment) => segment.text.length > 0)
		.map((segment) => ({ text: segment.text, hasUnclear: segment.hasUnclear }));
}

function getCellsSegments(
	cells: Array<AlignmentCell | undefined>,
	alignmentDisplayMode: AlignmentDisplayMode,
): DisplaySegment[] {
	return cells.flatMap(cell => {
		if (!cell) return [];
		return getCellSegments(cell, alignmentDisplayMode).filter(segment => segment.text.length > 0);
	});
}

function joinCellsText(
	cells: Array<AlignmentCell | undefined>,
	mode: 'original' | 'normalized',
): string | null {
	const value = joinTokenTexts(
		cells.map(cell => ({
			text: mode === 'normalized' ? (cell?.regularizedText ?? cell?.text) : (cell?.text ?? null),
			originalSegments: cell?.originalSegments,
			isPunctuation:
				mode === 'normalized'
					? false
					: Boolean(
						cell?.text &&
							isPunctuationToken({
								text: cell.text,
								originalSegments: cell.originalSegments,
							})
					),
		}))
	);
	return value.length > 0 ? value : null;
}

export function readingText(reading: {
	isOmission: boolean;
	isLacuna: boolean;
	segments: DisplaySegment[];
}): string {
	if (reading.isOmission) return 'om.';
	if (reading.isLacuna) return 'lac.';
	const text = reading.segments.map((segment) => segment.text).join('');
	return text.length > 0 ? text : '—';
}

export function indexToReadingLabel(index: number): string {
	const alphabet = 'abcdefghijklmnopqrstuvwxyz';
	let label = '';
	let value = index;
	do {
		label = alphabet[value % alphabet.length] + label;
		value = Math.floor(value / alphabet.length) - 1;
	} while (value >= 0);
	return label;
}

function buildReadingBucketId(columnId: string, originalKey: string): string {
	return `${columnId}::${originalKey}`;
}

function compareReadingBuckets(a: ReadingBucket, b: ReadingBucket): number {
	if (a.isBase !== b.isBase) return a.isBase ? -1 : 1;
	if (a.witnessIds.length !== b.witnessIds.length) return b.witnessIds.length - a.witnessIds.length;
	return readingText(a).localeCompare(readingText(b));
}

function toDisplayReading(reading: ReadingBucket, label: string): CollapsedReadingDisplay {
	return {
		id: reading.id,
		label,
		witnessIds: [...reading.witnessIds],
		segments: reading.segments.map((segment) => ({ ...segment })),
		isBase: reading.isBase,
		isOmission: reading.isOmission,
		isLacuna: reading.isLacuna,
		hasRegularization: reading.hasRegularization,
	};
}

function toFamilyBucket(reading: ReadingBucket): ReadingFamilyBucket {
	return {
		id: reading.id,
		originalKey: reading.originalKey,
		equivalenceKeys: [...reading.equivalenceKeys],
		witnessIds: [...reading.witnessIds],
		segments: reading.segments.map(segment => ({ ...segment })),
		originalText: reading.originalText,
		normalizedText: reading.normalizedText,
		isBase: reading.isBase,
		isOmission: reading.isOmission,
		isLacuna: reading.isLacuna,
		hasRegularization: reading.hasRegularization,
		allCellsRegularized: reading.allCellsRegularized,
		regularizationTypes: [...reading.regularizationTypes],
		ruleIds: [...reading.ruleIds],
	};
}

function buildReadingBuckets(
	entries: ReadingFamilyWitnessEntry[],
	baseWitnessId: string | null,
	columnId: string,
): ReadingBucket[] {
	const buckets = new Map<string, ReadingBucket>();

	for (const entry of entries) {
		const originalKey = getOriginalReadingKeyForCells(entry.cells);
		const equivalenceKey = getAlignmentCellsCollapseValue(entry.cells);
		const existing = buckets.get(originalKey);
		if (existing) {
			existing.witnessIds.push(entry.witnessId);
			if (baseWitnessId && entry.witnessId === baseWitnessId) existing.isBase = true;
			existing.hasRegularization =
				existing.hasRegularization || entry.cells.some(cell => Boolean(cell?.isRegularized));
			existing.allCellsRegularized =
				existing.allCellsRegularized &&
				entry.cells.every(cell => !cell || Boolean(cell.isRegularized));
			existing.equivalenceKeys.add(equivalenceKey);
			for (const cell of entry.cells) {
				if (!cell) continue;
				for (const type of cell.regularizationTypes) existing.regularizationTypes.add(type);
				for (const ruleId of cell.ruleIds) existing.ruleIds.add(ruleId);
			}
			continue;
		}

		const isOmission =
			entry.cells.length === 0 ||
			entry.cells.every(cell => !cell || cell.isOmission || cell.text === null);
		const isLacuna =
			!isOmission && entry.cells.some(cell => Boolean(cell?.isLacuna)) && !entry.cells.some(cell => Boolean(cell?.text?.trim()));
		const segments = getCellsSegments(entry.cells, 'original');
		buckets.set(originalKey, {
			id: buildReadingBucketId(columnId, originalKey),
			originalKey,
			equivalenceKeys: new Set([equivalenceKey]),
			witnessIds: [entry.witnessId],
			segments: segments.length > 0 ? segments : [{ text: '—', hasUnclear: false }],
			originalText: isOmission || isLacuna ? null : joinCellsText(entry.cells, 'original'),
			normalizedText: isOmission || isLacuna ? null : joinCellsText(entry.cells, 'normalized'),
			isBase: Boolean(baseWitnessId && entry.witnessId === baseWitnessId),
			isOmission,
			isLacuna,
			hasRegularization: entry.cells.some(cell => Boolean(cell?.isRegularized)),
			allCellsRegularized:
				entry.cells.length > 0 && entry.cells.every(cell => !cell || Boolean(cell.isRegularized)),
			regularizationTypes: new Set(entry.cells.flatMap(cell => cell?.regularizationTypes ?? [])),
			ruleIds: new Set(entry.cells.flatMap(cell => cell?.ruleIds ?? [])),
		});
	}

	return [...buckets.values()].sort(compareReadingBuckets);
}

export function buildReadingFamilyGroups({
	entries,
	baseWitnessId,
	columnId = 'family',
}: {
	entries: ReadingFamilyWitnessEntry[];
	baseWitnessId: string | null;
	columnId?: string;
}): ReadingFamilyGroup[] {
	const sortedBuckets = buildReadingBuckets(entries, baseWitnessId, columnId);
	const primaryIds = new Set<string>();
	const bucketsByEquivalenceKey = new Map<string, ReadingBucket[]>();

	for (const reading of sortedBuckets) {
		for (const equivalenceKey of reading.equivalenceKeys) {
			const existing = bucketsByEquivalenceKey.get(equivalenceKey) ?? [];
			existing.push(reading);
			bucketsByEquivalenceKey.set(equivalenceKey, existing);
		}
	}

	for (const [equivalenceKey, group] of bucketsByEquivalenceKey.entries()) {
		const sortedGroup = [...group].sort(compareReadingBuckets);
		const preferredParent = sortedGroup[0];
		if (!preferredParent) continue;
		primaryIds.add(preferredParent.id);
		bucketsByEquivalenceKey.set(equivalenceKey, sortedGroup);
	}

	const parentIdByChildId = new Map<string, string>();
	for (const reading of sortedBuckets) {
		const equivalenceKeys = [...reading.equivalenceKeys];
		if (equivalenceKeys.length === 0) {
			primaryIds.add(reading.id);
			continue;
		}
		const preferredParent = equivalenceKeys
			.map(equivalenceKey => bucketsByEquivalenceKey.get(equivalenceKey) ?? [])
			.flat()
			.find(candidate => primaryIds.has(candidate.id) && candidate.id !== reading.id) ?? null;
		if (preferredParent) {
			parentIdByChildId.set(reading.id, preferredParent.id);
		} else {
			primaryIds.add(reading.id);
		}
	}

	const primaryReadings = sortedBuckets.filter(reading => primaryIds.has(reading.id));
	return primaryReadings.map(reading => {
		const equivalenceKey = [...reading.equivalenceKeys][0] ?? reading.originalKey;
		const children = sortedBuckets.filter(
			candidate => parentIdByChildId.get(candidate.id) === reading.id
		);
		return {
			id: reading.id,
			equivalenceKey,
			parent: toFamilyBucket(reading),
			children: children.map(toFamilyBucket),
		};
	});
}

export function buildCollapsedReadingGroups({
	column,
	groupedRows,
	alignmentDisplayMode,
	baseWitnessId,
}: {
	column: AlignmentColumn;
	groupedRows: WitnessRowGroupLike[];
	alignmentDisplayMode: AlignmentDisplayMode;
	baseWitnessId: string | null;
}): CollapsedReadingGroupDisplay[] {
	const families = buildReadingFamilyGroups({
		entries: groupedRows.flatMap(row =>
			row.witnessIds.map(witnessId => ({
				witnessId,
				cells: [column.cells.get(witnessId)],
			}))
		),
		baseWitnessId,
		columnId: column.id,
	});
	if (alignmentDisplayMode === 'regularized') {
		return families.map((group, index) => ({
			id: group.id,
			parent: toDisplayReading(
				{
					id: group.parent.id,
					originalKey: group.parent.originalKey,
					equivalenceKeys: new Set(group.parent.equivalenceKeys),
					witnessIds: [group.parent, ...group.children].flatMap(reading => reading.witnessIds),
					segments:
						group.parent.isOmission || group.parent.isLacuna
							? [{ text: '—', hasUnclear: false }]
							: [{ text: group.parent.normalizedText ?? group.parent.originalText ?? '—', hasUnclear: false }],
					originalText: group.parent.originalText,
					normalizedText: group.parent.normalizedText,
					isBase: group.parent.isBase,
					isOmission: group.parent.isOmission,
					isLacuna: group.parent.isLacuna,
					hasRegularization: [group.parent, ...group.children].some(reading => reading.hasRegularization),
					allCellsRegularized: group.parent.allCellsRegularized,
					regularizationTypes: new Set(group.parent.regularizationTypes),
					ruleIds: new Set(group.parent.ruleIds),
				},
				`${indexToReadingLabel(index)}.`
			),
			children: [],
		}));
	}
	const primaryLabelById = new Map<string, string>();
	for (const [index, group] of families.entries()) {
		primaryLabelById.set(group.parent.id, indexToReadingLabel(index));
	}

	return families.map(group => {
		const labelRoot = primaryLabelById.get(group.parent.id) ?? '?';
		return {
			id: group.id,
			parent: toDisplayReading(
				{
					id: group.parent.id,
					originalKey: group.parent.originalKey,
					equivalenceKeys: new Set(group.parent.equivalenceKeys),
					witnessIds: group.parent.witnessIds,
					segments:
						getCellsSegments([column.cells.get(group.parent.witnessIds[0] ?? '')], 'original').length > 0
							? getCellsSegments([column.cells.get(group.parent.witnessIds[0] ?? '')], 'original')
							: [{ text: '—', hasUnclear: false }],
					originalText: group.parent.originalText,
					normalizedText: group.parent.normalizedText,
					isBase: group.parent.isBase,
					isOmission: group.parent.isOmission,
					isLacuna: group.parent.isLacuna,
					hasRegularization: group.parent.hasRegularization,
					allCellsRegularized: group.parent.allCellsRegularized,
					regularizationTypes: new Set(group.parent.regularizationTypes),
					ruleIds: new Set(group.parent.ruleIds),
				},
				`${labelRoot}.`
			),
			children: group.children.map((child, index) =>
				toDisplayReading(
					{
						id: child.id,
						originalKey: child.originalKey,
						equivalenceKeys: new Set(child.equivalenceKeys),
						witnessIds: child.witnessIds,
						segments:
							getCellsSegments([column.cells.get(child.witnessIds[0] ?? '')], 'original').length > 0
								? getCellsSegments([column.cells.get(child.witnessIds[0] ?? '')], 'original')
								: [{ text: '—', hasUnclear: false }],
						originalText: child.originalText,
						normalizedText: child.normalizedText,
						isBase: child.isBase,
						isOmission: child.isOmission,
						isLacuna: child.isLacuna,
						hasRegularization: child.hasRegularization,
						allCellsRegularized: child.allCellsRegularized,
						regularizationTypes: new Set(child.regularizationTypes),
						ruleIds: new Set(child.ruleIds),
					},
					`${labelRoot}${index + 1}`
				)
			),
		};
	});
}

export function isVariationColumn(column: AlignmentColumn): boolean {
	const normalizedBucket = new Set<string>();
	const originalBucket = new Set<string>();
	let hasOmission = false;
	for (const [, cell] of column.cells) {
		if (cell.isOmission || cell.text === null) {
			hasOmission = true;
			continue;
		}
		normalizedBucket.add(getAlignmentCellCollapseValue(cell));
		originalBucket.add(getOriginalReadingKey(cell));
	}
	return (
		normalizedBucket.size > 1 ||
		originalBucket.size > 1 ||
		(hasOmission && (normalizedBucket.size > 0 || originalBucket.size > 0))
	);
}

export function buildVariationUnitSpans(columns: AlignmentColumn[]): VariationUnitSpan[] {
	return columns.flatMap((column, index) =>
		isVariationColumn(column)
			? [
					{
						startIndex: index,
						endIndex: index,
						columnIds: [column.id],
					} satisfies VariationUnitSpan,
				]
			: [],
	);
}
