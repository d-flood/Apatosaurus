import type { LineItem } from '@apatosaurus/tei-transcription';
import type { StoredTranscriptionDocument } from '$lib/transcription/content';
import { alignmentCellFromTokens } from './alignment-cell';
import { NON_ATTESTATION_LABEL } from './collation-apparatus';
import type { AlignmentColumn } from './alignment-snapshot';
import { buildCollationDocument, type ImportNote } from './collation-document';
import {
	applyDecisions,
	withAmbiguousAttestation,
	type UnitDecisions,
} from './collation-decisions';
import { buildReadingProposal } from './collation-reading-proposal';
import { variationUnitId } from './collation-unit-id';
import { buildVariationUnitSpans } from './collation-variation-units';
import { extractWitnessTokensForVerse, type PreparedWitness } from './collation-runner';
import { deriveCollationInput } from './regularization';
import type {
	ClassifiedReading,
	ManualWitnessDefinition,
	ManualWitnessOverride,
	ReadingArc,
	WitnessConfig,
} from './collation-types';

import { resolveReadingTypeVocabulary, type ReadingTypeDefinition } from './reading-types';

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

export function classicEditorialVocabulary(
	source: ClassicCollationExport,
	existingTypes: ReadingTypeDefinition[] = [],
	existingTags: Array<{ id: string; label: string }> = []
) {
	const readingTypes = [...existingTypes];
	const readingTags = [...existingTags];
	const types = new Map<string, string | null>([
		['-', null],
		['', null],
		['om', 'omission'],
		['lac', null],
		['def', 'deficient'],
		['orth', 'orthographic'],
		['err', 'nonsense'],
		['ns', 'orthographic'],
	]);
	const conflicts = new Map<string, string>();
	const named: Record<string, [string, string]> = {
		insi: ['Insignificant', 'i'],
		subr: ['Subreading', 's'],
		corr: ['Correction', ''],
		emm: ['Emendation', ''],
		ilc: ['Lectionary adaptation', ''],
	};
	const normalize = (label: string) => label.trim().toLowerCase();
	for (const verse of source.verses)
		for (const unit of verse.units)
			for (const reading of unit.readings) {
				if (
					reading.type === 'ns' &&
					!readingTags.some(tag => normalize(tag.label) === 'nomen sacrum')
				)
					readingTags.push({ id: crypto.randomUUID(), label: 'Nomen sacrum' });
				if (types.has(reading.type)) continue;
				const [label, desiredSuffix] = Object.hasOwn(named, reading.type)
					? named[reading.type]
					: [reading.type, ''];
				const vocabulary = resolveReadingTypeVocabulary(readingTypes);
				let type = vocabulary.find(type => normalize(type.label) === normalize(label));
				if (!type) {
					const conflict =
						desiredSuffix && vocabulary.some(type => type.suffix === desiredSuffix);
					if (conflict)
						conflicts.set(
							reading.type,
							`Classic type ${label} imported without suffix ${desiredSuffix}, which is already in use.`
						);
					type = {
						id: crypto.randomUUID(),
						label,
						description: '',
						selectable: true,
						suffix: conflict ? '' : desiredSuffix,
					};
					readingTypes.push(type);
				}
				types.set(reading.type, type.id);
			}
	return { readingTypes, readingTags, types, conflicts };
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
	existing: ManualWitnessDefinition[],
	transcriptionSigla: string[] = []
): ManualWitnessDefinition[] {
	const witnesses = [...existing];
	for (const siglum of source.witnesses) {
		if (siglum !== baseSiglum && !witnesses.some(witness => witness.siglum === siglum))
			witnesses.push({
				id: crypto.randomUUID(),
				siglum,
				// A full entry would join every collation holding that transcription; the imported collations override it to full.
				treatment: transcriptionSigla.includes(siglum) ? 'fragmentary' : 'full',
				includeInCbgm: true,
			});
	}
	return witnesses;
}

export function buildClassicCollationDocument(input: {
	verse: ClassicVerse;
	witness: PreparedWitness;
	manualWitnesses: ManualWitnessDefinition[];
	sigla: string[];
	projectId: string;
	projectName: string;
	collationId: string;
	editorialVocabulary?: ReturnType<typeof classicEditorialVocabulary>;
}) {
	const { verse, witness, manualWitnesses } = input;
	const editorial =
		input.editorialVocabulary ?? classicEditorialVocabulary({ verses: [verse], witnesses: [] });
	const vocabulary = resolveReadingTypeVocabulary(editorial.readingTypes);
	const importNotes: ImportNote[] = [];
	const note = (unitId: string, detail: string) =>
		importNotes.push({ id: crypto.randomUUID(), unitId, detail });
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
	const readingArcs = new Map<string, ReadingArc[]>();
	const classifiedReadings = new Map<string, ClassifiedReading[]>();
	const importedUnits: Array<{
		unit: ClassicUnit;
		span: (typeof spans)[number];
		ids: Map<string, string>;
	}> = [];
	for (const [index, unit] of verse.units.entries()) {
		const declaration = declaredUnits[index];
		const span = spans.find(
			span =>
				span.unitId === variationUnitId(declaration.firstColumnId, declaration.lastColumnId)
		)!;
		const proposal = buildReadingProposal({
			columns: columns.slice(span.startIndex, span.endIndex + 1),
			spanColumnIds: span.columnIds,
			sourceWitnessIds: [base.witnessId],
			baseWitnessId: base.witnessId,
		});
		const baseReading = proposal.readings[0];
		if (!baseReading) throw new Error(`Cannot build the base reading in ${verse.id}.`);
		let decisions: UnitDecisions = {
			authoredReadings: [],
			manualTestimony: {},
			readingType: {},
			readingTags: {},
			subreadingOf: {},
			preserveReadings: true,
		};
		const parentLabels = new Map<string, string>();
		for (const arc of unit.arcs) {
			const posterior = unit.readings.find(
				reading => reading.label === arc.to.replace(/^#/, '')
			);
			const typeId = posterior && editorial.types.get(posterior.type);
			if (vocabulary.find(type => type.id === typeId)?.suffix)
				parentLabels.set(arc.to.replace(/^#/, ''), arc.from.replace(/^#/, ''));
		}
		const mainLabel = (label: string) => {
			const seen = new Set<string>();
			while (parentLabels.has(label) && !seen.has(label)) {
				seen.add(label);
				label = parentLabels.get(label)!;
			}
			return label;
		};
		const ordered = [...unit.readings].sort((a, b) => {
			const aMain = mainLabel(a.label),
				bMain = mainLabel(b.label);
			const aLetters = aMain.match(/^[a-z]+/)?.[0] ?? aMain;
			const bLetters = bMain.match(/^[a-z]+/)?.[0] ?? bMain;
			return (
				aLetters.length - bLetters.length ||
				aMain.localeCompare(bMain, 'en', { numeric: true }) ||
				a.label.localeCompare(b.label, 'en', { numeric: true })
			);
		});
		const matchingBase = ordered.filter(
			reading => reading.type !== 'lac' && reading.text === classicBaseText(verse, unit)
		);
		const classicBase =
			matchingBase.find(reading => reading.witnesses.includes(base.siglum)) ??
			matchingBase[0];
		const ids = new Map<string, string>();
		for (const [readingIndex, reading] of ordered.entries()) {
			if (reading.type === 'lac') {
				for (const siglum of reading.witnesses) {
					const manual = manualWitnesses.find(witness => witness.siglum === siglum);
					if (manual) decisions.manualTestimony![manual.id] = { kind: 'nonAttestation' };
				}
				continue;
			}
			const matchesBase = reading === classicBase;
			const readingId = matchesBase
				? baseReading.id
				: `classic-reading:${span.unitId}:${readingIndex}`;
			ids.set(reading.label, readingId);
			if (matchesBase) baseReading.order = readingIndex;
			else
				decisions.authoredReadings!.push({
					id: readingId,
					text: reading.type === 'om' ? null : reading.text,
					isOmission: reading.type === 'om',
					order: readingIndex,
					parentReadingId: null,
					readingType: null,
				});
			decisions.readingType![readingId] = editorial.types.get(reading.type) ?? null;
			if (reading.type === 'ns')
				decisions.readingTags![readingId] = [
					editorial.readingTags.find(
						tag => tag.label.trim().toLowerCase() === 'nomen sacrum'
					)!.id,
				];
			for (const siglum of reading.witnesses) {
				if (siglum === base.siglum) continue;
				const manual = manualWitnesses.find(witness => witness.siglum === siglum);
				if (!manual) throw new Error(`Missing manual witness ${siglum}.`);
				decisions.manualTestimony![manual.id] = { kind: 'reading', readingId };
			}
		}
		for (const type of new Set(unit.readings.map(reading => reading.type))) {
			const conflict = editorial.conflicts.get(type);
			if (conflict) note(span.unitId, conflict);
		}
		const resolve = (name: string) => ids.get(name.replace(/^#/, ''));
		const arcs: ReadingArc[] = [];
		for (const arc of unit.arcs) {
			const from = resolve(arc.from),
				to = resolve(arc.to);
			if (!from || !to) {
				note(span.unitId, `Classic arc ${arc.from} → ${arc.to} names an unknown reading.`);
				continue;
			}
			const typeId = decisions.readingType![to];
			if (vocabulary.find(type => type.id === typeId)?.suffix)
				decisions.subreadingOf![to] = from;
			else
				arcs.push({
					id: crypto.randomUUID(),
					priorReadingId: from,
					posteriorReadingId: to,
				});
		}
		const firstMain = ordered.find(reading => {
			const id = ids.get(reading.label);
			return id && !decisions.subreadingOf![id];
		});
		const lemmaId = firstMain && ids.get(firstMain.label);
		if (lemmaId && lemmaId !== baseReading.id) decisions.lemmaReadingId = lemmaId;
		if (unit.connectivity !== null && unit.connectivity !== 10)
			decisions.connectivity = unit.connectivity;
		for (const detail of unit.witnessDetails.filter(detail => detail.type === 'ambiguous')) {
			const targetReadingIds = detail.targets.map(
				target => resolve(target) ?? `unknown:${target}`
			);
			const witnessIds = detail.witnesses.map(
				siglum =>
					manualWitnesses.find(witness => witness.siglum === siglum)?.id ??
					(siglum === base.siglum ? base.witnessId : `unknown:${siglum}`)
			);
			const result = withAmbiguousAttestation(proposal.readings, decisions, {
				witnessIds,
				targetReadingIds,
			});
			if (result.ok) decisions = result.decisions;
			else
				note(
					span.unitId,
					`Classic ambiguous attestation ${detail.label || detail.witnesses.join(', ')} could not be imported: ${result.error}.`
				);
		}
		const view = applyDecisions(proposal.readings, decisions, {
			baseWitnessId: base.witnessId,
			vocabulary,
			manualWitnesses,
		});
		for (const reading of ordered) {
			if (reading.label.startsWith('zw-')) continue;
			const label =
				reading.type === 'lac'
					? NON_ATTESTATION_LABEL
					: view.readings.find(candidate => candidate.id === ids.get(reading.label))
							?.label;
			if (label !== reading.label)
				note(
					span.unitId,
					`Classic reading \`${reading.label}\` is now \`${label ?? 'unavailable'}\``
				);
		}
		classifiedReadings.set(span.unitId, proposal.readings);
		readingArcs.set(span.unitId, arcs);
		unitDecisions.set(span.unitId, decisions);
		importedUnits.push({ unit, span, ids });
	}
	for (const enclosing of importedUnits) {
		const inner = importedUnits.filter(
			candidate =>
				candidate !== enclosing &&
				candidate.span.startIndex >= enclosing.span.startIndex &&
				candidate.span.endIndex <= enclosing.span.endIndex
		);
		if (!inner.length) continue;
		const decisions = unitDecisions.get(enclosing.span.unitId)!;
		for (const reading of enclosing.unit.readings) {
			const readingId = enclosing.ids.get(reading.label);
			if (
				readingId &&
				reading.witnesses.some(siglum =>
					inner.some(
						candidate =>
							!candidate.unit.readings.some(reading =>
								reading.witnesses.includes(siglum)
							) &&
							!candidate.unit.witnessDetails.some(detail =>
								detail.witnesses.includes(siglum)
							)
					)
				)
			)
				(decisions.spanningReadingIds ??= []).push(readingId);
		}
	}
	for (const target of importedUnits) {
		const decisions = unitDecisions.get(target.span.unitId)!;
		for (const source of importedUnits) {
			if (
				source === target ||
				source.span.endIndex < target.span.startIndex ||
				source.span.startIndex > target.span.endIndex ||
				(source.span.startIndex >= target.span.startIndex &&
					source.span.endIndex <= target.span.endIndex)
			)
				continue;
			const spanning = unitDecisions.get(source.span.unitId)!.spanningReadingIds ?? [];
			for (const reading of source.unit.readings) {
				if (!spanning.includes(source.ids.get(reading.label)!)) continue;
				for (const siglum of reading.witnesses) {
					const recorded = target.unit.readings.find(reading =>
						reading.witnesses.includes(siglum)
					);
					const readingId = recorded && target.ids.get(recorded.label);
					if (!readingId) continue;
					const witnessId =
						siglum === base.siglum
							? base.witnessId
							: manualWitnesses.find(witness => witness.siglum === siglum)!.id;
					if (
						decisions.ambiguousAttestations?.some(attestation =>
							attestation.witnessIds.includes(witnessId)
						)
					)
						continue;
					(decisions.overlapResolutions ??= {})[witnessId] = {
						kind: 'reading',
						readingId,
					};
				}
			}
		}
	}
	return buildCollationDocument({
		collationId: input.collationId,
		projectId: input.projectId,
		projectName: input.projectName,
		phase: 'review',
		furthestPhase: 'review',
		segment: { id: crypto.randomUUID(), name: verse.id, members: [verse.id] },
		witnesses: [base],
		manualWitnessOverrides: manualWitnesses.flatMap((witness): ManualWitnessOverride[] => {
			if (witness.siglum === base.siglum)
				return [{ manualWitnessId: witness.id, isExcluded: true, treatment: 'inherit' }];
			if (witness.treatment === 'full' || !input.sigla.includes(witness.siglum)) return [];
			return [{ manualWitnessId: witness.id, isExcluded: false, treatment: 'full' }];
		}),
		rules: [],
		...settings,
		alignmentColumns: columns,
		declaredUnits,
		witnessOrder: [base.witnessId],
		classifiedReadings,
		importNotes,
		unitDecisions,
		readingArcs,
		alignmentDisplayMode: 'original',
		alignmentLayout: 'grid',
	});
}
