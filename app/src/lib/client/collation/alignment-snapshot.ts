import type {
	AlignmentCellKind,
	GapMetadata,
	RegularizationType,
	WitnessTextSegment,
} from './collation-types';

export interface AlignmentCell {
	text: string | null;
	regularizedText: string | null;
	alignmentValue: string | null;
	sourceTokenIds: string[];
	kind: AlignmentCellKind;
	gap: GapMetadata | null;
	isOmission: boolean;
	isLacuna: boolean;
	isRegularized: boolean;
	ruleIds: string[];
	regularizationTypes: RegularizationType[];
	originalSegments?: WitnessTextSegment[];
}

export interface AlignmentColumn {
	id: string;
	index: number;
	cells: Map<string, AlignmentCell>;
	merged: boolean;
	mergedWith?: string[];
	splitInto?: AlignmentColumn[];
}

export interface SerializedAlignmentColumn {
	id: string;
	index: number;
	cells: Array<[string, AlignmentCell]>;
	merged: boolean;
	mergedWith?: string[];
	splitInto?: SerializedAlignmentColumn[];
}

export interface AlignmentSnapshot {
	witnessOrder: string[];
	columns: SerializedAlignmentColumn[];
}

export function serializeAlignmentColumns(columns: AlignmentColumn[]): SerializedAlignmentColumn[] {
	const serializeColumn = (column: AlignmentColumn): SerializedAlignmentColumn => ({
		id: column.id,
		index: column.index,
		cells: [...column.cells.entries()],
		merged: column.merged,
		mergedWith: column.mergedWith,
		splitInto: column.splitInto?.map(serializeColumn),
	});

	return columns.map(serializeColumn);
}

export function deserializeAlignmentColumns(
	columns: SerializedAlignmentColumn[],
): AlignmentColumn[] {
	const deserializeColumn = (column: SerializedAlignmentColumn): AlignmentColumn => ({
		id: column.id,
		index: column.index,
		cells: new Map(
			column.cells.map(([witnessId, cell]) => [
				witnessId,
				{
					text: cell.text ?? null,
					regularizedText: cell.regularizedText ?? cell.text ?? null,
					alignmentValue:
						cell.alignmentValue ??
						cell.regularizedText ??
						cell.text ??
						null,
					sourceTokenIds: cell.sourceTokenIds ?? [],
					kind:
						cell.kind ??
						(cell.isOmission
							? 'omission'
							: cell.isLacuna
								? 'gap'
								: 'text'),
					gap: cell.gap ?? null,
					isOmission: cell.isOmission,
					isLacuna: cell.isLacuna,
					isRegularized:
						cell.isRegularized ??
						((cell.text ?? null) !== (cell.regularizedText ?? cell.text ?? null)),
					ruleIds: cell.ruleIds ?? [],
					regularizationTypes: cell.regularizationTypes ?? [],
					originalSegments: Array.isArray(cell.originalSegments)
						? cell.originalSegments
								.filter(
									(segment): segment is WitnessTextSegment =>
										typeof segment?.text === 'string' &&
										typeof segment?.hasUnclear === 'boolean' &&
										typeof segment?.isPunctuation === 'boolean' &&
										typeof segment?.isSupplied === 'boolean',
								)
								.map((segment) => ({ ...segment }))
						: undefined,
				},
			]),
		),
		merged: column.merged,
		mergedWith: column.mergedWith,
		splitInto: column.splitInto?.map(deserializeColumn),
	});

	return columns.map(deserializeColumn);
}

export function cloneAlignmentColumn(column: AlignmentColumn): AlignmentColumn {
	return {
		id: column.id,
		index: column.index,
		cells: new Map(column.cells),
		merged: column.merged,
		mergedWith: column.mergedWith ? [...column.mergedWith] : undefined,
		splitInto: column.splitInto?.map(cloneAlignmentColumn),
	};
}
