import type { AlignmentColumn } from './alignment-snapshot';
import { buildVariationUnitSpans } from './collation-variation-units';
import type { ClassifiedReading, WitnessConfig } from './collation-types';

export interface ProjectedWitnessRow {
	witnessId: string;
	transcriptionId: string | null;
	sourceVersion: string;
	content: string;
	position: number;
}

export interface ProjectedTokenRow {
	witnessId: string;
	tokenIndex: number;
	tokenText: string;
}

export interface ProjectedReadingRow {
	readingOrder: number;
	readingText: string;
	isOmission: boolean;
	isLacuna: boolean;
	witnessIds: string[];
}

export interface ProjectedVariationUnitRow {
	startIndex: number;
	endIndex: number;
	unitType: string;
	baseText: string;
	readings: ProjectedReadingRow[];
}

export interface CollationProjection {
	witnesses: ProjectedWitnessRow[];
	tokens: ProjectedTokenRow[];
	variationUnits: ProjectedVariationUnitRow[];
}

export function buildCollationProjection(input: {
	witnesses: WitnessConfig[];
	alignmentColumns: AlignmentColumn[];
	getReadingsForUnit: (unitIndex: number) => ClassifiedReading[];
	getBaseTextForVariationUnit: (unitIndex: number) => string;
	getBaseWitnessId: () => string | null;
}): CollationProjection {
	const activeWitnesses = input.witnesses.filter((witness) => !witness.isExcluded);
	const witnesses = activeWitnesses.map((witness, position) => ({
		witnessId: witness.witnessId,
		transcriptionId: witness.transcriptionId || null,
		sourceVersion: witness.sourceVersion ?? '',
		content: witness.content,
		position,
	}));

	const tokens = activeWitnesses.flatMap((witness) =>
		witness.tokens.map((token, tokenIndex) => ({
			witnessId: witness.witnessId,
			tokenIndex,
			tokenText: token.original,
		})),
	);

	const baseWitnessId = input.getBaseWitnessId();
	const variationUnits = buildVariationUnitSpans(input.alignmentColumns).map(
		({ startIndex, endIndex }) => {
			const readings = [...input.getReadingsForUnit(startIndex)].sort(
				(a, b) => a.order - b.order,
			);
			const baseReading =
				(baseWitnessId
					? readings.find((reading) => reading.witnessIds.includes(baseWitnessId))
					: undefined) ?? readings[0];
			return {
				startIndex,
				endIndex,
				unitType: 'variation',
				baseText: input.getBaseTextForVariationUnit(startIndex) || baseReading?.text || '',
				readings: readings.map((reading, readingOrder) => ({
					readingOrder,
					readingText: reading.text ?? '',
					isOmission: reading.isOmission,
					isLacuna: reading.isLacuna,
					witnessIds: reading.witnessIds,
				})),
			};
		},
	);

	return {
		witnesses,
		tokens,
		variationUnits,
	};
}
