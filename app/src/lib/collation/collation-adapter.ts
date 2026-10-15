import { AlignmentTable, collate, type AlignmentTableRow, type TokenData } from 'collatex-tsport';
import { alignmentCellFromTokens } from './alignment-cell';
import type { AlignmentSnapshot, SerializedAlignmentColumn } from './alignment-snapshot';
import type {
	CollationRunPayload,
	CollationRunResult,
	CollationTokenInput,
	CollationWitnessInput,
} from './collation-worker-types';

function makeId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `alignment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toPretokenizedTokens(tokens: CollationTokenInput[]): TokenData[] {
	return tokens.map(token => ({ ...token }));
}

function toPackageWitness(witness: CollationWitnessInput) {
	if (Array.isArray(witness.tokens) && witness.tokens.length > 0) {
		return {
			id: witness.id,
			tokens: toPretokenizedTokens(witness.tokens),
		};
	}

	return {
		id: witness.id,
		content: witness.content,
	};
}

function buildSnapshot(
	table: AlignmentTable,
	witnesses: CollationWitnessInput[]
): AlignmentSnapshot {
	const rowByWitnessId = new Map(
		table.rows.map((row: AlignmentTableRow) => [row.witness.sigil, row] as const)
	);
	const orderedWitnessIds = witnesses.map(witness => witness.id);
	const orderedRows = orderedWitnessIds.map(witnessId => rowByWitnessId.get(witnessId) ?? null);
	const columnCount = Math.max(...orderedRows.map(row => row?.cells.length ?? 0), 0);
	const columns: SerializedAlignmentColumn[] = [];

	for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
		columns.push({
			id: makeId(),
			index: columnIndex,
			cells: orderedWitnessIds.map((witnessId, rowIndex) => {
				const cell = orderedRows[rowIndex]?.cells[columnIndex] ?? null;
				return [
					witnessId,
					alignmentCellFromTokens(
						(cell ?? []).map(token => ({
							...token.tokenData,
							t:
								typeof token.tokenData?.t === 'string'
									? token.tokenData.t
									: token.content,
							n:
								typeof token.tokenData?.n === 'string'
									? token.tokenData.n
									: token.normalized,
						}))
					),
				];
			}),
			merged: false,
		});
	}

	return {
		witnessOrder: orderedWitnessIds,
		columns,
	};
}

export function collateToAlignmentSnapshot(payload: CollationRunPayload): CollationRunResult {
	if (payload.witnesses.length < 2) {
		throw new Error('At least two witnesses are required for collation.');
	}
	const segmentation = payload.options?.segmentation ?? true;

	const table = collate(
		{
			witnesses: payload.witnesses.map(toPackageWitness),
		},
		{
			output: 'table',
			segmentation,
		}
	) as AlignmentTable;

	return {
		snapshot: buildSnapshot(table, payload.witnesses),
	};
}
