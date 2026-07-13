import { deserializeAlignmentColumns, type AlignmentColumn } from './alignment-snapshot';
import { hydrateCollationDocument, type CollationDocument } from './collation-document';
import { buildVariationUnitSpans } from './collation-variation-units';
import type { ClassifiedReading, WitnessConfig } from './collation-types';

export interface ProjectedWitnessRow {
	witnessId: string;
	transcriptionId: string | null;
	sourceVersion: string;
	sourceContentHash?: string;
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

export interface SerializedCollationProjectionRows {
	witnesses: Array<{
		id: string;
		witness_id: string;
		content: string;
		position: number;
		project_transcription_id: string | null;
		transcription_id: string | null;
		source_revision_id: string;
		source_content_hash: string;
	}>;
	tokens: Array<{
		id: string;
		witness_id: string;
		token_index: number;
		token_text: string;
	}>;
	variation_units: Array<{
		id: string;
		start_index: number;
		end_index: number;
		unit_type: string;
		base_text: string;
	}>;
	readings: Array<{
		id: string;
		variation_unit_id: string;
		reading_order: number;
		reading_text: string;
		is_lacuna: boolean;
		is_omission: boolean;
	}>;
	reading_witnesses: Array<{ reading_id: string; witness_id: string }>;
}

export function buildCollationProjection(input: {
	witnesses: WitnessConfig[];
	alignmentColumns: AlignmentColumn[];
	getReadingsForUnit: (unitIndex: number) => ClassifiedReading[];
	getBaseTextForVariationUnit: (unitIndex: number) => string;
	getBaseWitnessId: () => string | null;
}): CollationProjection {
	const activeWitnesses = input.witnesses.filter(witness => !witness.isExcluded);
	const witnesses = activeWitnesses.map((witness, position) => ({
		witnessId: witness.witnessId,
		transcriptionId: witness.transcriptionId || null,
		sourceVersion: witness.sourceVersion ?? '',
		sourceContentHash: witness.sourceContentHash,
		content: witness.content,
		position,
	}));

	const tokens = activeWitnesses.flatMap(witness =>
		witness.tokens.map((token, tokenIndex) => ({
			witnessId: witness.witnessId,
			tokenIndex,
			tokenText: token.original,
		}))
	);

	const baseWitnessId = input.getBaseWitnessId();
	const variationUnits = buildVariationUnitSpans(input.alignmentColumns).map(
		({ startIndex, endIndex }) => {
			const readings = [...input.getReadingsForUnit(startIndex)].sort(
				(a, b) => a.order - b.order
			);
			const baseReading =
				(baseWitnessId
					? readings.find(reading => reading.witnessIds.includes(baseWitnessId))
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
		}
	);

	return {
		witnesses,
		tokens,
		variationUnits,
	};
}

export function buildCollationProjectionFromDocument(
	document: CollationDocument
): CollationProjection {
	const hydrated = hydrateCollationDocument(document);
	const alignmentColumns = deserializeAlignmentColumns(hydrated.alignmentColumns);
	const readingsByUnit = new Map(hydrated.classifiedReadings);
	const baseWitnessId = hydrated.witnesses.find(witness => witness.isBaseText)?.witnessId ?? null;
	return buildCollationProjection({
		witnesses: hydrated.witnesses,
		alignmentColumns,
		getReadingsForUnit: unitIndex => readingsByUnit.get(String(unitIndex)) ?? [],
		getBaseTextForVariationUnit: unitIndex => {
			const readings = readingsByUnit.get(String(unitIndex)) ?? [];
			return (
				(baseWitnessId
					? readings.find(reading => reading.witnessIds.includes(baseWitnessId))?.text
					: undefined) ??
				readings[0]?.text ??
				''
			);
		},
		getBaseWitnessId: () => baseWitnessId,
	});
}

export function buildSerializedCollationProjectionRows(
	collationId: string,
	document: CollationDocument,
	projectTranscriptionIdByTranscriptionId: ReadonlyMap<string, string> = new Map()
): SerializedCollationProjectionRows {
	const projection = buildCollationProjectionFromDocument(document);
	const variationUnits = projection.variationUnits.map((unit, index) => ({
		id: `${collationId}:unit:${index}`,
		...unit,
	}));
	const readings = variationUnits.flatMap(unit =>
		unit.readings.map((reading, index) => ({
			id: `${unit.id}:reading:${index}`,
			variationUnitId: unit.id,
			...reading,
		}))
	);

	return {
		witnesses: projection.witnesses.map((row, index) => ({
			id: `${collationId}:witness:${index}`,
			witness_id: row.witnessId,
			content: row.content,
			position: row.position,
			project_transcription_id: row.transcriptionId
				? (projectTranscriptionIdByTranscriptionId.get(row.transcriptionId) ?? null)
				: null,
			transcription_id: row.transcriptionId,
			source_revision_id: row.sourceVersion,
			source_content_hash: row.sourceContentHash ?? '',
		})),
		tokens: projection.tokens.map((row, index) => ({
			id: `${collationId}:token:${index}`,
			witness_id: row.witnessId,
			token_index: row.tokenIndex,
			token_text: row.tokenText,
		})),
		variation_units: variationUnits.map(unit => ({
			id: unit.id,
			start_index: unit.startIndex,
			end_index: unit.endIndex,
			unit_type: unit.unitType,
			base_text: unit.baseText,
		})),
		readings: readings.map(reading => ({
			id: reading.id,
			variation_unit_id: reading.variationUnitId,
			reading_order: reading.readingOrder,
			reading_text: reading.readingText,
			is_lacuna: reading.isLacuna,
			is_omission: reading.isOmission,
		})),
		reading_witnesses: readings.flatMap(reading =>
			reading.witnessIds.map(witnessId => ({ reading_id: reading.id, witness_id: witnessId }))
		),
	};
}
