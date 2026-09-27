/** Single derivation of verse shape shared by strip, preview, and export. */

import type { AlignmentCell, AlignmentColumn } from './alignment-snapshot';
import type { UnitView } from './collation-decisions';
import type { NonAttestation } from './collation-reading-proposal';
import type { ClassifiedReading } from './collation-types';
import type { ReadingTypeId } from './reading-types';
import { classifyWitnessAttestation, type VariationUnitSpan } from './collation-variation-units';
import { isPunctuationToken, joinTokenTexts, tokenizeDisplayText } from './token-text';

/** Word-index range in the odd/even citation convention. */
export interface DisplayedColumnSlot {
	columnId: string;
	columnIndex: number;
	start: number;
	end: number;
}

export type Segment =
	| {
			kind: 'agreed';
			text: string;
			label: string;
			columnIds: string[];
			untranscribedWitnessIds: string[];
	  }
	| {
			kind: 'unit';
			span: VariationUnitSpan;
			ordinal: number;
			label: string;
			untranscribedWitnessIds: string[];
	  };

/** Reserved non-attestation label; no reading may take it. */
export const NON_ATTESTATION_LABEL = 'zz';

const LEMMA_OPEN_MARKER = '⸂';
const LEMMA_CLOSE_MARKER = ']';

function formatSlotLabel(start: number, end: number): string {
	return start === end ? String(start) : `${start}-${end}`;
}

/** Base-text words take even positions; extra material takes the following odd one. */
export function buildDisplayedColumnSlots(
	columns: AlignmentColumn[],
	baseWitnessId: string | null
): DisplayedColumnSlot[] {
	if (!baseWitnessId) {
		return columns.map((column, index) => ({
			columnId: column.id,
			columnIndex: index,
			start: index + 1,
			end: index + 1,
		}));
	}

	let lastEvenIndex = 0;
	return columns.map((column, index) => {
		const cell = column.cells.get(baseWitnessId);
		if (cell && !cell.isOmission && cell.text && cell.text.trim().length > 0) {
			const words = Math.max(1, tokenizeDisplayText(cell.text).length);
			const start = lastEvenIndex + 2;
			const end = start + (words - 1) * 2;
			lastEvenIndex = end;
			return { columnId: column.id, columnIndex: index, start, end };
		}

		const position = lastEvenIndex + 1;
		return { columnId: column.id, columnIndex: index, start: position, end: position };
	});
}

function cellAttests(cell: AlignmentCell | undefined): boolean {
	return classifyWitnessAttestation([cell]) === 'attesting';
}

/** Agreed-column text; falls back past a non-testifying base witness. */
function agreedColumnCell(
	column: AlignmentColumn,
	baseWitnessId: string | null
): AlignmentCell | undefined {
	const baseCell = baseWitnessId ? column.cells.get(baseWitnessId) : undefined;
	if (baseCell && cellAttests(baseCell)) return baseCell;
	for (const cell of column.cells.values()) if (cellAttests(cell)) return cell;
	return undefined;
}

function joinCellTexts(cells: Array<AlignmentCell | undefined>): string {
	return joinTokenTexts(
		cells.map(cell => ({
			text: cell?.text ?? null,
			originalSegments: cell?.originalSegments,
			isPunctuation: Boolean(
				cell?.text &&
				isPunctuationToken({
					text: cell.text,
					originalSegments: cell.originalSegments,
				})
			),
		}))
	);
}

function untranscribedWitnessIds(columns: AlignmentColumn[]): string[] {
	const witnessIds = new Set<string>();
	for (const column of columns) {
		for (const [witnessId, cell] of column.cells) {
			if (cell.kind === 'untranscribed') witnessIds.add(witnessId);
		}
	}
	return [...witnessIds];
}

/** Alternating agreed/unit segments; every column appears exactly once. */
export function buildSegmentSequence(input: {
	columns: AlignmentColumn[];
	spans: VariationUnitSpan[];
	baseWitnessId: string | null;
}): Segment[] {
	const { columns, baseWitnessId } = input;
	const slots = buildDisplayedColumnSlots(columns, baseWitnessId);
	const spanByStart = new Map(input.spans.map(span => [span.startIndex, span] as const));

	const segments: Segment[] = [];
	let agreedRun: number[] = [];
	let ordinal = 0;

	const flushAgreedRun = () => {
		if (agreedRun.length === 0) return;
		const first = slots[agreedRun[0]];
		const last = slots[agreedRun[agreedRun.length - 1]];
		segments.push({
			kind: 'agreed',
			text: joinCellTexts(
				agreedRun.map(index => agreedColumnCell(columns[index], baseWitnessId))
			),
			label:
				first && last
					? formatSlotLabel(first.start, last.end)
					: formatSlotLabel(agreedRun[0] + 1, agreedRun[agreedRun.length - 1] + 1),
			columnIds: agreedRun.map(index => columns[index].id),
			untranscribedWitnessIds: untranscribedWitnessIds(
				agreedRun.map(index => columns[index])
			),
		});
		agreedRun = [];
	};

	let columnIndex = 0;
	while (columnIndex < columns.length) {
		const span = spanByStart.get(columnIndex);
		if (span) {
			flushAgreedRun();
			ordinal += 1;
			const start = slots[span.startIndex];
			const end = slots[span.endIndex];
			segments.push({
				kind: 'unit',
				span,
				ordinal,
				label:
					start && end
						? formatSlotLabel(start.start, end.end)
						: String(span.startIndex + 1),
				untranscribedWitnessIds: untranscribedWitnessIds(
					columns.slice(span.startIndex, span.endIndex + 1)
				),
			});
			columnIndex = span.endIndex + 1;
			continue;
		}
		agreedRun.push(columnIndex);
		columnIndex += 1;
	}
	flushAgreedRun();

	return segments;
}

export interface ApparatusRenderOptions {
	/** Word-index range as labelled. */
	label: string;
	siglumOf?: (witnessId: string) => string;
	/** Required: omitting it would claim testimony manuscripts do not give. */
	nonAttestation: NonAttestation;
	readingTypeLabelOf?: (readingType: ReadingTypeId) => string;
}

function readingText(reading: ClassifiedReading): string {
	if (reading.isOmission) return 'om.';
	const text = reading.text?.trim() ?? '';
	return text.length > 0 ? text : '—';
}

/** Mains in order, each followed by subreadings; every reading cited once. */
function citationOrder(readings: ClassifiedReading[]): ClassifiedReading[] {
	const subreadingsByParent = new Map<string, ClassifiedReading[]>();
	for (const reading of readings) {
		if (reading.parentReadingId === null) continue;
		const siblings = subreadingsByParent.get(reading.parentReadingId) ?? [];
		siblings.push(reading);
		subreadingsByParent.set(reading.parentReadingId, siblings);
	}

	const ordered: ClassifiedReading[] = [];
	const cited = new Set<string>();
	const cite = (reading: ClassifiedReading) => {
		if (cited.has(reading.id)) return;
		cited.add(reading.id);
		ordered.push(reading);
		for (const subreading of subreadingsByParent.get(reading.id) ?? []) cite(subreading);
	};

	for (const reading of readings) if (reading.parentReadingId === null) cite(reading);
	for (const reading of readings) cite(reading);
	return ordered;
}

/** One unit in conventional notation, non-attestation last. */
export function renderApparatusUnit(unit: UnitView, options: ApparatusRenderOptions): string {
	const siglumOf = options.siglumOf ?? ((witnessId: string) => witnessId);
	const lemma = unit.readings.find(reading => reading.id === unit.lemmaReadingId) ?? null;

	const entries = citationOrder(unit.readings).map(reading => {
		const readingType = reading.readingType;
		const typeLabel =
			readingType === null
				? ''
				: ` (${options.readingTypeLabelOf?.(readingType) ?? readingType})`;
		const sigla = reading.witnessIds.map(siglumOf).join(' ');
		return `${reading.label}${typeLabel}: ${sigla}`.trimEnd();
	});

	const nonAttesting = options.nonAttestation.witnessIds;
	if (nonAttesting.length > 0) {
		entries.push(`${NON_ATTESTATION_LABEL}: ${nonAttesting.map(siglumOf).join(' ')}`);
	}

	const lemmaText = lemma ? readingText(lemma) : '—';
	const head = `${options.label} ${LEMMA_OPEN_MARKER} ${lemmaText} ${LEMMA_CLOSE_MARKER}`;
	return entries.length > 0 ? `${head} ${entries.join(' | ')}` : head;
}
