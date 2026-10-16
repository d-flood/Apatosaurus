import type { LineItem } from '@apatosaurus/tei-transcription';
import type { StoredTranscriptionDocument } from '$lib/transcription/content';
import { alignmentCellFromTokens } from './alignment-cell';
import type { AlignmentColumn } from './alignment-snapshot';
import { buildCollationDocument } from './collation-document';
import type { UnitDecisions } from './collation-decisions';
import { buildReadingProposal } from './collation-reading-proposal';
import { buildVariationUnitSpans } from './collation-variation-units';
import { extractWitnessTokensForVerse, type PreparedWitness } from './collation-runner';
import { deriveCollationInput } from './regularization';
import type { ManualWitnessDefinition, WitnessConfig } from './collation-types';

export interface ClassicReading {
	label: string;
	type: string;
	text: string;
	witnesses: string[];
	varSeq: string;
}

export interface ClassicUnit {
	from: number;
	to: number;
	readings: ClassicReading[];
	witnessDetails: Array<{ label: string; witnesses: string[]; type: string; targets: string[] }>;
	connectivity: number | null;
	arcs: Array<{ from: string; to: string }>;
}

export interface ClassicVerse {
	id: string;
	baseWords: string[];
	units: ClassicUnit[];
}

export interface ClassicCollationExport {
	verses: ClassicVerse[];
	witnesses: string[];
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
const sigla = (text: string | null) => text?.trim().split(/\s+/).filter(Boolean) ?? [];
const elements = (node: Element | Document, name: string) =>
	Array.from(node.getElementsByTagNameNS('*', name));

export function classicBaseText(verse: ClassicVerse, unit: ClassicUnit): string {
	return verse.baseWords
		.filter((_, index) => {
			const position = (index + 1) * 2;
			return position >= unit.from && position <= unit.to;
		})
		.join(' ');
}

export function parseClassicCollationExport(xml: string): ClassicCollationExport {
	const document = new DOMParser().parseFromString(xml, 'application/xml');
	if (elements(document, 'parsererror').length || document.documentElement?.localName !== 'TEI')
		throw new Error('Choose a valid classic TEI collation export.');
	const witnesses = new Set(
		elements(document, 'witness').flatMap(node => sigla(node.getAttribute('n')))
	);
	const ids = new Set<string>();
	const verses = elements(document, 'ab').map(ab => {
		const id = ab.getAttribute('xml:id') ?? '';
		if (!id || ids.has(id)) throw new Error('Every verse needs a unique xml:id.');
		ids.add(id);
		const baseText = Array.from(ab.childNodes)
			.filter(node => node.nodeType === 3 || node.nodeType === 4)
			.map(node => node.textContent ?? '')
			.join('');
		const baseWords = sigla(baseText);
		const units = elements(ab, 'app').map(app => {
			const from = Number(app.getAttribute('from'));
			const to = Number(app.getAttribute('to'));
			if (
				!Number.isInteger(from) ||
				!Number.isInteger(to) ||
				from < 1 ||
				to < from ||
				to > baseWords.length * 2 + 1
			)
				throw new Error(`A unit in ${id} has positions outside its verse.`);
			const readings = elements(app, 'rdg').map(rdg => {
				const readingWitnesses = sigla(rdg.getAttribute('wit'));
				readingWitnesses.forEach(siglum => witnesses.add(siglum));
				return {
					label: rdg.getAttribute('n') ?? '',
					type: rdg.getAttribute('type') ?? '-',
					text: collapse(rdg.textContent ?? ''),
					witnesses: readingWitnesses,
					varSeq: rdg.getAttribute('varSeq') ?? '',
				};
			});
			const witnessDetails = elements(app, 'witDetail').map(detail => {
				const detailWitnesses = sigla(detail.getAttribute('wit'));
				detailWitnesses.forEach(siglum => witnesses.add(siglum));
				return {
					label: detail.getAttribute('n') ?? '',
					witnesses: detailWitnesses,
					type: detail.getAttribute('type') ?? '',
					targets: sigla(detail.getAttribute('target')),
				};
			});
			const numeric = elements(app, 'numeric')[0]?.getAttribute('value');
			return {
				from,
				to,
				readings,
				witnessDetails,
				connectivity: numeric && Number.isFinite(Number(numeric)) ? Number(numeric) : null,
				arcs: elements(app, 'arc').map(arc => ({
					from: arc.getAttribute('from') ?? '',
					to: arc.getAttribute('to') ?? '',
				})),
			};
		});
		return { id, baseWords, units };
	});
	if (!verses.length) throw new Error('The export contains no verses (<ab>).');
	return { verses, witnesses: [...witnesses] };
}

export function classicBaseSiglumCandidates(source: ClassicCollationExport): string[] {
	return source.witnesses.filter(siglum =>
		source.verses.every(verse =>
			verse.units.every(unit =>
				unit.readings.some(
					reading =>
						reading.type !== 'lac' &&
						reading.text === classicBaseText(verse, unit) &&
						reading.witnesses.includes(siglum)
				)
			)
		)
	);
}

export function buildClassicBaseTranscription(
	source: ClassicCollationExport
): StoredTranscriptionDocument {
	return {
		type: 'transcriptionDocument',
		pages: [
			{
				type: 'page',
				id: 'classic-base',
				columns: [
					{
						type: 'column',
						number: 1,
						lines: source.verses.map((verse, index) => ({
							number: index + 1,
							type: 'line',
							items: [
								{
									type: 'milestone',
									kind: 'verse',
									attrs: { book: verse.id, chapter: '', verse: '' },
								},
								...verse.baseWords
									.join(' ')
									.split(/([\p{P}]+)/u)
									.filter(Boolean)
									.map((text): LineItem => ({
										type: 'text',
										text,
										marks: [
											{ type: 'unconfirmed' },
											...(/^\p{P}+$/u.test(text)
												? [{ type: 'punctuation' as const }]
												: []),
										],
									})),
							],
						})),
					},
				],
			},
		],
	};
}

export function classicManualWitnesses(
	source: ClassicCollationExport,
	baseSiglum: string,
	existing: ManualWitnessDefinition[]
): ManualWitnessDefinition[] {
	const witnesses = [...existing];
	for (const siglum of source.witnesses) {
		if (siglum !== baseSiglum && !witnesses.some(witness => witness.siglum === siglum))
			witnesses.push({
				id: crypto.randomUUID(),
				siglum,
				treatment: 'full',
				includeInCbgm: true,
			});
	}
	return witnesses;
}

export function buildClassicCollationDocument(input: {
	verse: ClassicVerse;
	witness: PreparedWitness;
	manualWitnesses: ManualWitnessDefinition[];
	projectId: string;
	projectName: string;
	collationId: string;
}) {
	const { verse, witness, manualWitnesses } = input;
	const base: WitnessConfig = {
		...witness,
		witnessId: witness.id,
		transcriptionId: witness.transcriptionUid,
		treatment: 'full',
		isBaseText: true,
		isExcluded: false,
		overridesDefault: false,
	};
	const settings = {
		ignoreWordBreaks: false,
		lowercase: false,
		ignoreTokenWhitespace: true,
		ignorePunctuation: false,
		suppliedTextMode: 'clear' as const,
		segmentation: true,
	};
	const tokens = deriveCollationInput([base], settings, []).witnessInputs[0]?.tokens ?? [];
	const insertionPositions = new Set(
		verse.units.flatMap(unit => [unit.from, unit.to]).filter(position => position % 2)
	);
	const columns: AlignmentColumn[] = [];
	const columnsByPosition = new Map<number, string[]>();
	let tokenIndex = 0;
	for (let position = 1; position <= verse.baseWords.length * 2 + 1; position++) {
		const cells =
			position % 2
				? insertionPositions.has(position)
					? [alignmentCellFromTokens([])]
					: []
				: (() => {
						const wordSource = buildClassicBaseTranscription({
							verses: [
								{
									id: verse.id,
									baseWords: [verse.baseWords[position / 2 - 1]],
									units: [],
								},
							],
							witnesses: [],
						});
						const count = extractWitnessTokensForVerse(wordSource, verse.id).length;
						return tokens
							.slice(tokenIndex, (tokenIndex += count))
							.map(token => alignmentCellFromTokens([token]));
					})();
		columnsByPosition.set(
			position,
			cells.map(cell => {
				const id = `classic:${position}:${columns.length}`;
				columns.push({
					id,
					index: columns.length,
					cells: new Map([[base.witnessId, cell]]),
					merged: false,
				});
				return id;
			})
		);
	}
	const declaredUnits = verse.units.map(unit => ({
		firstColumnId: columnsByPosition.get(unit.from)![0],
		lastColumnId: columnsByPosition.get(unit.to)!.at(-1)!,
	}));
	const spans = buildVariationUnitSpans(columns, declaredUnits);
	const unitDecisions = new Map<string, UnitDecisions>();
	for (const [index, unit] of verse.units.entries()) {
		const declaration = declaredUnits[index];
		const span = spans.find(
			span =>
				span.columnIds[0] === declaration.firstColumnId &&
				span.columnIds.at(-1) === declaration.lastColumnId
		)!;
		const proposal = buildReadingProposal({
			columns: columns.slice(span.startIndex, span.endIndex + 1),
			spanColumnIds: span.columnIds,
			sourceWitnessIds: [base.witnessId],
			baseWitnessId: base.witnessId,
		});
		const baseReading = proposal.readings[0];
		if (!baseReading) throw new Error(`Cannot build the base reading in ${verse.id}.`);
		const decisions: UnitDecisions = { authoredReadings: [], manualTestimony: {} };
		for (const [readingIndex, reading] of unit.readings.entries()) {
			const matchesBase =
				reading.type !== 'lac' && reading.text === classicBaseText(verse, unit);
			const readingId = matchesBase
				? baseReading.id
				: `classic-reading:${span.unitId}:${readingIndex}`;
			if (reading.type !== 'lac' && !matchesBase)
				decisions.authoredReadings!.push({
					id: readingId,
					text: reading.type === 'om' ? null : reading.text,
					isOmission: reading.type === 'om',
					order: readingIndex + 1,
					parentReadingId: null,
					readingType: null,
				});
			if (reading.label === 'a' && reading.type !== 'lac' && !matchesBase)
				decisions.lemmaReadingId = readingId;
			for (const siglum of reading.witnesses) {
				if (siglum === base.siglum) continue;
				const manual = manualWitnesses.find(witness => witness.siglum === siglum);
				if (!manual) throw new Error(`Missing manual witness ${siglum}.`);
				decisions.manualTestimony![manual.id] =
					reading.type === 'lac'
						? { kind: 'nonAttestation' }
						: { kind: 'reading', readingId };
			}
		}
		unitDecisions.set(span.unitId, decisions);
	}
	return buildCollationDocument({
		collationId: input.collationId,
		projectId: input.projectId,
		projectName: input.projectName,
		phase: 'review',
		furthestPhase: 'review',
		segment: { id: crypto.randomUUID(), name: verse.id, members: [verse.id] },
		witnesses: [base],
		manualWitnessOverrides: manualWitnesses
			.filter(witness => witness.siglum === base.siglum)
			.map(witness => ({
				manualWitnessId: witness.id,
				isExcluded: true,
				treatment: 'inherit',
			})),
		rules: [],
		...settings,
		alignmentColumns: columns,
		declaredUnits,
		witnessOrder: [base.witnessId],
		classifiedReadings: new Map(),
		unitDecisions,
		readingArcs: new Map(),
		alignmentDisplayMode: 'original',
		alignmentLayout: 'grid',
	});
}
