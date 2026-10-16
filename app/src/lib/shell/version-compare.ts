import type {
	LineItem,
	TranscriptionColumn,
	TranscriptionDocument,
	TranscriptionLine,
	TranscriptionPage,
} from '@apatosaurus/tei-transcription';

import {
	deserializeAlignmentColumns,
	type SerializedAlignmentColumn,
} from '$lib/collation/alignment-snapshot';
import type { CollationDocument } from '$lib/collation/collation-document';
import { variationUnitId } from '$lib/collation/collation-unit-id';
import { buildVariationUnitSpans } from '$lib/collation/collation-variation-units';
import { coerceTranscriptionDocument } from '$lib/transcription/content';
import { normalizeVerseIdentifier } from '$lib/transcription/verse-index';
import { canonicalJson } from '$lib/storage/canonical-json';

export interface ComparePart {
	key: string;
	label: string;
	left: unknown;
	right: unknown;
	differs: boolean;
}

export type CompareChoices = Record<string, 'left' | 'right'>;

type ApparatusUnit = NonNullable<CollationDocument['apparatus']>['units'][number];
type StemmaUnit = NonNullable<CollationDocument['stemma']>['units'][number];

type UnitColumn = Omit<SerializedAlignmentColumn, 'id' | 'index'>;

export interface CollationUnitPart {
	column: UnitColumn | null;
	columns?: UnitColumn[];
	declaration?: { firstColumnId: string; lastColumnId: string };
	apparatus: ApparatusUnit | null;
	stemma: StemmaUnit | null;
}

export type ComparableCollation = Pick<
	CollationDocument,
	'alignment' | 'apparatus' | 'stemma' | 'settings'
>;

interface Section {
	key: string;
	label: string;
	value: unknown;
}

const BEFORE_FIRST_VERSE = '';

function mergeOrder(left: { key: string }[], right: { key: string }[]): string[] {
	const order = left.map(section => section.key);
	let insertAt = 0;
	for (const section of right) {
		const existing = order.indexOf(section.key);
		if (existing >= 0) {
			insertAt = existing + 1;
		} else {
			order.splice(insertAt, 0, section.key);
			insertAt += 1;
		}
	}
	return order;
}

function compareSections(left: Section[], right: Section[]): ComparePart[] {
	const leftByKey = new Map(left.map(section => [section.key, section]));
	const rightByKey = new Map(right.map(section => [section.key, section]));
	return mergeOrder(left, right).map(key => {
		const leftSection = leftByKey.get(key);
		const rightSection = rightByKey.get(key);
		return {
			key,
			label: (leftSection ?? rightSection)!.label,
			left: leftSection?.value ?? null,
			right: rightSection?.value ?? null,
			differs:
				!leftSection ||
				!rightSection ||
				canonicalJson(leftSection.value) !== canonicalJson(rightSection.value),
		};
	});
}

type TranscriptionEvent =
	| { type: 'page'; page: Omit<TranscriptionPage, 'columns'> }
	| { type: 'column'; column: Omit<TranscriptionColumn, 'lines'> }
	| { type: 'line'; line: Omit<TranscriptionLine, 'items'> }
	| { type: 'item'; item: LineItem };

function walkTranscription(
	content: unknown,
	visit: (key: string, event: TranscriptionEvent) => void
): TranscriptionDocument | null {
	const document = content == null ? null : coerceTranscriptionDocument(content);
	if (!document) return null;
	const state = { book: '', chapter: '', verse: '' };
	const currentKey = () =>
		state.book || state.chapter || state.verse
			? normalizeVerseIdentifier(state)
			: BEFORE_FIRST_VERSE;
	for (const { columns, ...page } of document.pages) {
		visit(currentKey(), { type: 'page', page });
		for (const { lines, ...column } of columns) {
			visit(currentKey(), { type: 'column', column });
			for (const { items, ...line } of lines) {
				visit(currentKey(), { type: 'line', line });
				for (const item of items) {
					if (item.type === 'milestone') {
						state.book = item.attrs.book || state.book;
						if (item.kind !== 'book')
							state.chapter = item.attrs.chapter || state.chapter;
						if (item.kind === 'verse') state.verse = item.attrs.verse || state.verse;
					}
					visit(currentKey(), { type: 'item', item });
				}
			}
		}
	}
	return document;
}

function transcriptionSections(content: unknown): Section[] {
	const verses = new Map<string, LineItem[][]>();
	let fragment: LineItem[] | null = null;
	let fragmentKey = BEFORE_FIRST_VERSE;
	walkTranscription(content, (key, event) => {
		if (event.type !== 'item') {
			fragment = null;
			return;
		}
		if (!fragment || key !== fragmentKey) {
			fragment = [];
			fragmentKey = key;
			verses.set(key, [...(verses.get(key) ?? []), fragment]);
		}
		fragment.push(event.item);
	});
	return [...verses].map(([key, lines]) => ({
		key,
		label: key === BEFORE_FIRST_VERSE ? 'Before the first verse' : key,
		value: lines,
	}));
}

function transcriptionSegments(content: unknown) {
	const segments = new Map<string, TranscriptionEvent[]>();
	const document = walkTranscription(content, (key, event) => {
		segments.set(key, [...(segments.get(key) ?? []), event]);
	});
	return { document, segments };
}

function buildPages(events: TranscriptionEvent[]): TranscriptionPage[] {
	const pages: TranscriptionPage[] = [];
	let page: TranscriptionPage | undefined;
	let column: TranscriptionColumn | undefined;
	let line: TranscriptionLine | undefined;
	const fallback = {
		page: { type: 'page', id: 'page-1' } as Omit<TranscriptionPage, 'columns'>,
		column: { type: 'column', number: 1 } as Omit<TranscriptionColumn, 'lines'>,
		line: { type: 'line', number: 1 } as Omit<TranscriptionLine, 'items'>,
	};
	const openPage = (meta: Omit<TranscriptionPage, 'columns'>) => {
		page = { ...meta, columns: [] };
		pages.push(page);
		column = line = undefined;
		return page;
	};
	const openColumn = (meta: Omit<TranscriptionColumn, 'lines'>) => {
		column = { ...meta, lines: [] };
		(page ?? openPage(fallback.page)).columns.push(column);
		line = undefined;
		return column;
	};
	const openLine = (meta: Omit<TranscriptionLine, 'items'>) => {
		line = { ...meta, items: [] };
		(column ?? openColumn(fallback.column)).lines.push(line);
		return line;
	};
	for (const event of events) {
		if (event.type === 'page') {
			fallback.page = event.page;
			if (page?.id !== event.page.id) openPage(event.page);
		} else if (event.type === 'column') {
			fallback.column = event.column;
			if (column?.number !== event.column.number) openColumn(event.column);
		} else if (event.type === 'line') {
			fallback.line = event.line;
			openLine(event.line);
		} else {
			(line ?? openLine(fallback.line)).items.push(event.item);
		}
	}
	return pages;
}

export function mergeTranscriptions(
	left: unknown,
	right: unknown,
	choices: CompareChoices
): TranscriptionDocument {
	const differs = new Set(
		compareTranscriptions(left, right)
			.filter(part => part.differs)
			.map(part => part.key)
	);
	const mine = transcriptionSegments(left);
	const theirs = transcriptionSegments(right);
	const keys = mergeOrder(
		[...mine.segments.keys()].map(key => ({ key })),
		[...theirs.segments.keys()].map(key => ({ key }))
	);
	const events = keys.flatMap(key => {
		const side = differs.has(key) && choices[key] === 'right' ? theirs : mine;
		return side.segments.get(key) ?? [];
	});
	const base = mine.document ?? theirs.document;
	return {
		...(base ?? { type: 'transcriptionDocument' as const }),
		pages: buildPages(events),
	};
}

export function compareTranscriptions(left: unknown, right: unknown): ComparePart[] {
	return compareSections(transcriptionSections(left), transcriptionSections(right));
}

function cellText(cell: SerializedAlignmentColumn['cells'][number][1]): string {
	if (cell.isOmission) return 'om.';
	if (cell.isLacuna) return 'lac.';
	return cell.text ?? '';
}

function unitLabel(unit: CollationUnitPart): string {
	const readings = unit.apparatus?.readings ?? [];
	const lemmaId = unit.apparatus?.decisions.lemmaReadingId;
	const lemma = readings.find(reading => reading.id === lemmaId) ?? readings[0];
	const text = lemma ? lemma.text : unit.column?.cells.map(([, cell]) => cell.text).find(Boolean);
	return text?.trim() || 'Variation unit';
}

function collationSections(document: ComparableCollation | null): Section[] {
	if (!document) return [];
	const serializedColumns = document.alignment?.columns ?? [];
	const columns = new Map(
		serializedColumns.map(({ id, index: _, ...column }) => [variationUnitId(id), column])
	);
	const apparatus = new Map(document.apparatus?.units.map(unit => [unit.unitId, unit]) ?? []);
	const stemma = new Map(document.stemma?.units.map(unit => [unit.unitId, unit]) ?? []);
	const spans = buildVariationUnitSpans(
		deserializeAlignmentColumns(serializedColumns),
		document.alignment?.declaredUnits
	);
	const variantUnitIds = spans.map(span => span.unitId);
	const unitIds = [...new Set([...variantUnitIds, ...apparatus.keys(), ...stemma.keys()])];
	return [
		...unitIds.map(unitId => {
			const span = spans.find(span => span.unitId === unitId);
			const declaration = document.alignment?.declaredUnits?.find(
				unit => variationUnitId(unit.firstColumnId, unit.lastColumnId) === span?.unitId
			);
			const spanColumns = span
				? serializedColumns
						.slice(span.startIndex, span.endIndex + 1)
						.map(({ id: _, index: _index, ...column }) => column)
				: [];
			const value: CollationUnitPart = {
				...(declaration ? { declaration } : {}),
				...(spanColumns.length > 1 ? { columns: spanColumns } : {}),
				column: spanColumns[0] ?? columns.get(unitId) ?? null,
				apparatus: apparatus.get(unitId) ?? null,
				stemma: stemma.get(unitId) ?? null,
			};
			return { key: unitId, label: unitLabel(value), value };
		}),
		{ key: 'settings', label: 'Collation settings', value: document.settings },
	];
}

export function compareCollations(
	left: ComparableCollation | null,
	right: ComparableCollation | null
): ComparePart[] {
	return compareSections(collationSections(left), collationSections(right));
}

function spliceByKey<T>(target: T[], source: T[], keyOf: (item: T) => string, key: string): T[] {
	const replacement = source.find(item => keyOf(item) === key);
	const at = target.findIndex(item => keyOf(item) === key);
	if (at >= 0) {
		return replacement
			? [...target.slice(0, at), replacement, ...target.slice(at + 1)]
			: [...target.slice(0, at), ...target.slice(at + 1)];
	}
	if (!replacement) return target;
	const anchor = source
		.slice(0, source.indexOf(replacement))
		.map(keyOf)
		.findLast(candidate => target.some(item => keyOf(item) === candidate));
	const insertAt =
		anchor === undefined ? 0 : target.findIndex(item => keyOf(item) === anchor) + 1;
	return [...target.slice(0, insertAt), replacement, ...target.slice(insertAt)];
}

export function mergeCollations(
	left: CollationDocument,
	right: CollationDocument,
	choices: CompareChoices
): CollationDocument {
	const chosen = compareCollations(left, right).filter(
		part => part.differs && choices[part.key] === 'right'
	);
	const merged = structuredClone(left);
	for (const { key } of chosen) {
		if (key === 'settings') {
			merged.settings = structuredClone(right.settings);
			continue;
		}
		if (merged.alignment || right.alignment) {
			const alignment = merged.alignment ?? { ...right.alignment!, columns: [] };
			const rightSpan = buildVariationUnitSpans(
				deserializeAlignmentColumns(right.alignment?.columns ?? []),
				right.alignment?.declaredUnits
			).find(span => span.unitId === key);
			const declared = (alignment.declaredUnits ?? []).filter(
				unit => variationUnitId(unit.firstColumnId, unit.lastColumnId) !== key
			);
			const rightDeclaration = right.alignment?.declaredUnits?.find(
				unit => variationUnitId(unit.firstColumnId, unit.lastColumnId) === rightSpan?.unitId
			);
			if (rightDeclaration) declared.push(structuredClone(rightDeclaration));
			const columnIds =
				rightSpan?.columnIds ??
				[...alignment.columns, ...(right.alignment?.columns ?? [])]
					.filter(column => variationUnitId(column.id) === key)
					.map(column => column.id)
					.slice(0, 1);
			const columns = columnIds.reduce(
				(columns, id) =>
					spliceByKey(columns, right.alignment?.columns ?? [], column => column.id, id),
				alignment.columns
			);

			merged.alignment = {
				...alignment,
				...(declared.length || alignment.declaredUnits ? { declaredUnits: declared } : {}),
				columns: columns.map((column, index) => ({ ...structuredClone(column), index })),
			};
		}
		if (merged.apparatus || right.apparatus) {
			const apparatus = merged.apparatus ?? { ...right.apparatus!, units: [] };
			merged.apparatus = {
				...apparatus,
				units: structuredClone(
					spliceByKey(
						apparatus.units,
						right.apparatus?.units ?? [],
						unit => unit.unitId,
						key
					)
				),
			};
		}
		if (merged.stemma || right.stemma) {
			const stemma = merged.stemma ?? { ...right.stemma!, units: [] };
			merged.stemma = {
				...stemma,
				units: structuredClone(
					spliceByKey(stemma.units, right.stemma?.units ?? [], unit => unit.unitId, key)
				),
			};
		}
	}
	return merged;
}

function itemText(item: LineItem): string {
	if (item.type === 'text') return item.text;
	if (item.type === 'boundary') return ' ';
	if (item.type === 'gap') return '[…]';
	return '';
}

export function formatTranscriptionPart(value: unknown): string {
	const lines = (value ?? []) as LineItem[][];
	return lines.map(line => line.map(itemText).join('').trim()).join('\n');
}

export function formatCollationPart(value: unknown): string {
	if (!value || typeof value !== 'object') return '';
	if (!('column' in value)) return JSON.stringify(value, null, 2);
	const { column, apparatus, stemma } = value as CollationUnitPart;
	const readings = apparatus?.readings ?? [];
	const decisions = apparatus?.decisions;
	const labelOf = (id: string) => readings.find(reading => reading.id === id)?.label ?? id;
	const witnessesByText = new Map<string, number>();
	if (!readings.length) {
		for (const [, cell] of column?.cells ?? []) {
			const text = cellText(cell);
			witnessesByText.set(text, (witnessesByText.get(text) ?? 0) + 1);
		}
	}
	const cellLines = [...witnessesByText].map(([text, count]) => `${text}  (${count} wit.)`);
	const lines = readings.map(reading => {
		const text = reading.isOmission ? 'om.' : reading.isLacuna ? 'lac.' : reading.text;
		const marks = [
			reading.id === decisions?.lemmaReadingId ? 'lemma' : '',
			reading.readingType ?? '',
			reading.certainty ?? '',
			`${reading.witnessIds.length} wit.`,
		].filter(Boolean);
		return `${reading.label}  ${text ?? ''}  (${marks.join(', ')})`;
	});
	lines.push(...cellLines);
	for (const arc of stemma?.arcs ?? []) {
		lines.push(`${labelOf(arc.priorReadingId)} → ${labelOf(arc.posteriorReadingId)}`);
	}
	if (stemma?.connectivity !== undefined) lines.push(`Connectivity: ${stemma.connectivity}`);
	return lines.join('\n');
}
