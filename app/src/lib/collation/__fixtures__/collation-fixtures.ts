import { readdirSync, readFileSync } from 'node:fs';
import { expect } from 'vitest';

import { mergeColumnsIn } from '../alignment-edits';
import {
	deserializeAlignmentColumns,
	type AlignmentCell,
	type AlignmentColumn,
} from '../alignment-snapshot';
import {
	buildClassicBaseTranscription,
	buildClassicCollationDocument,
	classicEditorialVocabulary,
	classicManualWitnesses,
	parseClassicCollationExport,
} from '../classic-import';
import type { CollationVocabulary } from '../collation-apparatus-tei';
import { buildCollationDocument, type CollationDocument } from '../collation-document';
import { prepareWitnessesFromDocument } from '../collation-runner';
import type { UnitDecisions } from '../collation-decisions';
import { buildReadingProposal } from '../collation-reading-proposal';
import { collationState, type WitnessConfig } from '../collation-state.svelte';
import type {
	ClassifiedReading,
	ManualWitnessDefinition,
	ReadingArc,
	RegularizationRule,
	WitnessSourceToken,
} from '../collation-types';
import { buildVariationUnitSpans } from '../collation-variation-units';

export interface Fixture {
	name: string;
	document: CollationDocument;
	vocab: CollationVocabulary;
}

const classicDir = new URL('./classic/', import.meta.url);

export function classicFixtures(): Fixture[] {
	return readdirSync(classicDir)
		.filter(file => file.endsWith('.xml'))
		.flatMap(file => {
			const source = parseClassicCollationExport(
				readFileSync(new URL(file, classicDir), 'utf8')
			);
			const editorial = classicEditorialVocabulary(source);
			const transcription = buildClassicBaseTranscription(source);
			const manualWitnesses = classicManualWitnesses(source, 'A', []);
			const vocab = {
				readingTypes: editorial.readingTypes,
				readingTags: editorial.readingTags,
				manualWitnesses,
			};
			return source.verses.map(verse => {
				const witness = prepareWitnessesFromDocument({
					document: transcription,
					verseIdentifier: verse.id,
					transcriptionId: 'base',
					siglum: 'A',
					source: {
						kind: 'current',
						transcriptionId: 'base',
						capturedAt: '',
						contentHash: '',
					},
				})[0];
				const document = buildClassicCollationDocument({
					verse,
					witness,
					manualWitnesses,
					sigla: source.witnesses,
					editorialVocabulary: editorial,
					projectId: 'project',
					projectName: 'Project',
					collationId: verse.id,
				});
				return { name: `${file} ${verse.id}`, document, vocab };
			});
		});
}

export function text(value: string, hasUnclear = false): AlignmentCell {
	return {
		text: value,
		regularizedText: value,
		alignmentValue: value,
		sourceTokenIds: [],
		kind: 'text',
		gap: null,
		isOmission: false,
		isLacuna: false,
		isRegularized: false,
		ruleIds: [],
		regularizationTypes: [],
		originalSegments: [{ text: value, hasUnclear, isPunctuation: false, isSupplied: false }],
	};
}

export function gap(): AlignmentCell {
	return {
		...text('⊘'),
		regularizedText: null,
		alignmentValue: '__gap__:none:none:none',
		kind: 'gap',
		gap: { source: 'gap', reason: '', unit: '', extent: '' },
		isLacuna: true,
		originalSegments: undefined,
	};
}

export function witness(siglum: string, options: Partial<WitnessConfig> = {}): WitnessConfig {
	return {
		witnessId: `w:${siglum}`,
		siglum,
		transcriptionId: `${siglum}-transcription`,
		content: '',
		tokens: [],
		treatment: 'inherit',
		isBaseText: false,
		isExcluded: false,
		overridesDefault: false,
		...options,
	};
}

/** Subreading, ambiguous and overlapped testimony, a lacuna and a corrector hand. */
export async function stateFixture(): Promise<Fixture> {
	collationState.reset();
	const witnesses = [
		witness('A', { isBaseText: true }),
		witness('B'),
		witness('C'),
		witness('E'),
		witness('F'),
		witness('G'),
		witness('B c', { transcriptionId: 'B-transcription', kind: 'corrector', handId: 'c' }),
	];
	const variant: Record<string, AlignmentCell> = {
		'w:A': text('alpha'),
		'w:B': text('beta'),
		'w:C': gap(),
		'w:E': text('beta'),
		'w:F': text('alfa'),
		'w:G': text('beta'),
		'w:B c': text('alpha'),
	};
	const ids = witnesses.map(entry => entry.witnessId);
	collationState.setWitnesses(witnesses);
	collationState.setAlignmentSnapshot({
		witnessOrder: ids,
		columns: [
			{
				id: 'one',
				index: 0,
				merged: false,
				cells: ids.map(id => [id, id === 'w:G' ? text('uno') : text('one')]),
			},
			{ id: 'variant', index: 1, merged: false, cells: ids.map(id => [id, variant[id]]) },
			{ id: 'two', index: 2, merged: false, cells: ids.map(id => [id, text('two')]) },
		],
	});
	expect(collationState.declareUnit(['one', 'variant'])).toBe(true);
	const outer = 'unit:one..variant';
	const unit = 'unit:variant';
	const reading = (unitId: string, predicate: (text: string | null) => boolean) =>
		collationState.peekReadingsForUnit(unitId).find(entry => predicate(entry.text))!;
	const long = reading(outer, value => value?.startsWith('uno') ?? false);
	expect(collationState.setReadingSpanning(outer, long.id, true)).toBe(true);
	const alpha = reading(unit, value => value === 'alpha');
	const alfa = reading(unit, value => value === 'alfa');
	const beta = reading(unit, value => value === 'beta');
	expect(collationState.setReadingParent(unit, alfa.id, alpha.id, 'orthographic')).toEqual({
		ok: true,
	});
	expect(collationState.recordAmbiguousAttestation(unit, ['w:E'], [beta.id, alpha.id]).ok).toBe(
		true
	);
	collationState.setReadingSource(unit, beta.id, { kind: 'derived', from: alpha.id });
	collationState.setReadingCertainty(unit, beta.id, 'medium');
	collationState.setReadingType(unit, beta.id, 'apparent');
	collationState.setReadingNote(unit, beta.id, 'Reading & note');
	await collationState.addReadingTag(unit, beta.id, 'Nomen sacrum');
	expect(collationState.setConnectivity(unit, 4)).toEqual({ ok: true });
	for (const entry of collationState.peekReadingsForUnit(outer))
		if (entry.id !== collationState.peekUnitView(outer).lemmaReadingId)
			collationState.setReadingSource(outer, entry.id, { kind: 'unclear' });

	const document = buildCollationDocument({
		collationId: 'state',
		projectId: null,
		projectName: 'Project',
		phase: collationState.phase,
		furthestPhase: collationState.furthestPhase,
		segment: { id: 'state', name: 'John 1:1', members: ['John 1:1'] },
		witnesses: collationState.witnesses,
		rules: collationState.rules,
		ignoreWordBreaks: collationState.ignoreWordBreaks,
		lowercase: collationState.lowercase,
		ignoreTokenWhitespace: collationState.ignoreTokenWhitespace,
		ignorePunctuation: collationState.ignorePunctuation,
		suppliedTextMode: collationState.suppliedTextMode,
		segmentation: collationState.segmentation,
		alignmentColumns: collationState.alignmentColumns,
		declaredUnits: collationState.declaredUnits,
		witnessOrder: collationState.witnessOrder,
		classifiedReadings: collationState.classifiedReadings,
		unitDecisions: collationState.unitDecisions,
		readingArcs: collationState.readingArcs,
		alignmentDisplayMode: collationState.alignmentDisplayMode,
		alignmentLayout: collationState.alignmentLayout,
	});
	return {
		name: 'collation state',
		document,
		vocab: { readingTags: collationState.getReadingTags() },
	};
}

function regularized(original: string, reg: string, ruleId: string, type: 'none' | 'ns') {
	return {
		...text(original),
		regularizedText: reg,
		alignmentValue: reg,
		isRegularized: true,
		ruleIds: [ruleId],
		regularizationTypes: [type],
	};
}

function omission(): AlignmentCell {
	return {
		...text(''),
		text: null,
		regularizedText: null,
		alignmentValue: null,
		kind: 'omission',
		isOmission: true,
		originalSegments: undefined,
	};
}

function untranscribed(): AlignmentCell {
	return {
		...gap(),
		alignmentValue: '__untranscribed__:none:none:none',
		kind: 'untranscribed',
		gap: { source: 'untranscribed', reason: 'not yet', unit: 'word', extent: '1' },
	};
}

function sourceTokens(index: number): WitnessSourceToken[] {
	const segment = (
		value: string,
		flags: Partial<WitnessSourceToken['segments'][number]> = {}
	) => ({
		text: value,
		hasUnclear: false,
		isPunctuation: false,
		isSupplied: false,
		...flags,
	});
	return [
		{ kind: 'text', original: 'και', segments: [segment('και')], gap: null },
		{
			kind: 'text',
			original: 'λογος·',
			segments: [
				segment('λο'),
				segment('γ', { hasUnclear: true, isSupplied: index % 2 === 0 }),
				segment('ος'),
				segment('·', { isPunctuation: true }),
			],
			gap: null,
		},
		{
			kind: 'gap',
			original: '⊘',
			segments: [],
			gap: { source: 'gap', reason: 'lacuna', unit: 'char', extent: String(index) },
		},
		{
			kind: 'untranscribed',
			original: '⊘',
			segments: [segment(' θεος ', { isSupplied: true })],
			gap: { source: 'supplied', reason: '', unit: '', extent: '' },
		},
		{ kind: 'text', original: 'differs\tfrom segments', segments: [segment('x')], gap: null },
	];
}

/** 100 witnesses, every decision kind, merged and split columns, unfinished and orphaned state. */
export function generatedFixture(): Fixture {
	const manualWitnesses: ManualWitnessDefinition[] = [
		{ id: 'manual:Ψ', siglum: 'Ψ', treatment: 'full', includeInCbgm: true },
		{ id: 'manual:L1', siglum: 'L1', treatment: 'fragmentary', includeInCbgm: false },
		{ id: 'manual:Or', siglum: 'Or', treatment: 'inherit', includeInCbgm: true },
	];
	const rules: RegularizationRule[] = [
		{
			id: 'rule:accents',
			pattern: 'ὶ$',
			replacement: 'ι',
			scope: 'project',
			description: 'Drop <accents> & "breathings"',
			enabled: true,
			type: 'none',
		},
		{
			id: 'rule ns_θς',
			pattern: '^θς$',
			replacement: 'θεος',
			scope: 'verse',
			description: '',
			enabled: false,
			type: 'ns',
		},
	];
	const witnesses: WitnessConfig[] = Array.from({ length: 100 }, (_, index) => {
		const corrector = index % 10 === 9;
		const tokens = sourceTokens(index);
		return witness(corrector ? `${index - 1} C1` : String(index), {
			witnessId: corrector ? `w:${index - 1}::C1` : `w:${index}`,
			transcriptionId: `tx-${corrector ? index - 1 : index}`,
			...(corrector ? { kind: 'corrector', handId: 'C1' } : { kind: 'firsthand' }),
			...(index % 3 === 0 ? {} : { handId: corrector ? 'C1' : 'firsthand' }),
			source:
				index % 2 === 0
					? { kind: 'version', transcriptionId: `tx-${index}`, versionId: `v-${index}` }
					: {
							kind: 'current',
							transcriptionId: `tx-${index}`,
							capturedAt: '2026-11-01T00:00:00.000Z',
							contentHash: `sha256:${index.toString(16).padStart(64, '0')}`,
						},
			content: tokens.map(token => token.original).join(' '),
			tokens,
			...(index % 4 === 0
				? {
						fullContent: 'και λογος',
						fullTokens: tokens.slice(0, 2),
						fragmentaryTokens: [],
					}
				: {}),
			...(index % 5 === 0 ? { fragmentaryContent: '' } : {}),
			treatment: (['inherit', 'full', 'fragmentary'] as const)[index % 3],
			isBaseText: index === 0,
			isExcluded: index === 98,
			overridesDefault: index % 7 === 0,
		});
	});
	const ids = witnesses.map(entry => entry.witnessId);
	const cell = (index: number): AlignmentCell => {
		if (index === 0) return text('λογος');
		switch (index % 9) {
			case 1:
				return regularized('θς', 'θεος', 'rule ns_θς', 'ns');
			case 2:
				return gap();
			case 3:
				return untranscribed();
			case 4:
				return omission();
			case 5:
				return text('θεος', true);
			case 6:
				return { ...text('λογοϲ'), originalSegments: undefined, sourceTokenIds: ['ghost'] };
			default:
				return { ...text('λογος'), sourceTokenIds: [`${ids[index]}::source::1`] };
		}
	};
	const column = (id: string, index: number, value: (witnessIndex: number) => AlignmentCell) => ({
		id,
		index,
		merged: false,
		cells: ids.map(
			(witnessId, witnessIndex) => [witnessId, value(witnessIndex)] as [string, AlignmentCell]
		),
	});
	let columns: AlignmentColumn[] = deserializeAlignmentColumns([
		column('one', 0, index =>
			index % 4 === 1 ? regularized('καὶ', 'και', 'rule:accents', 'none') : text('και')
		),
		column('variant', 1, cell),
		column('m1', 2, index => (index % 2 ? text('ἐν') : text('εν'))),
		column('m2', 3, index => (index % 3 ? text('ἀρχῇ') : omission())),
		column('weird\u0001id', 4, index => (index % 2 ? text('ην') : text('ην', true))),
		column('two', 5, () => ({ ...text(''), regularizedText: '', alignmentValue: '' })),
	]);
	columns = mergeColumnsIn(columns, ['m1', 'm2'], {
		rules,
		witnessOrder: ids,
		witnessIds: ids,
		baseWitnessId: ids[0],
	});
	const merged = columns.find(entry => entry.merged)!;
	const declaredUnits = [
		{ firstColumnId: 'one', lastColumnId: 'variant' },
		{ firstColumnId: merged.id, lastColumnId: merged.id },
	];
	const spans = buildVariationUnitSpans(columns, declaredUnits);
	const readingsOf = (unitId: string) => {
		const span = spans.find(entry => entry.unitId === unitId)!;
		return buildReadingProposal({
			columns: columns.slice(span.startIndex, span.endIndex + 1),
			spanColumnIds: span.columnIds,
			sourceWitnessIds: ids.filter((_, index) => index !== 98),
			baseWitnessId: ids[0],
		}).readings;
	};
	const variantUnit = 'unit:variant';
	const outerUnit = 'unit:one..variant';
	const mergedUnit = `unit:${merged.id}`;
	const weirdUnit = 'unit:weird\u0001id';
	const variant = readingsOf(variantUnit);
	const find = (readings: ClassifiedReading[], value: string | null) =>
		readings.find(reading => reading.text === value)!;
	const [lemma, theos, sigma] = [
		find(variant, 'λογος'),
		find(variant, 'θς'),
		find(variant, 'λογοϲ'),
	];
	const om = variant.find(reading => reading.isOmission)!;
	const outer = readingsOf(outerUnit);
	const mergedReadings = readingsOf(mergedUnit);

	const unitDecisions = new Map<string, UnitDecisions>([
		[
			variantUnit,
			{
				lemmaReadingId: lemma.id,
				subreadingOf: { [sigma.id]: lemma.id, [theos.id]: null },
				readingType: { [sigma.id]: 'orthographic', [theos.id]: null, [om.id]: 'omission' },
				readingTags: { [theos.id]: ['tag:ns', 'tag:\u0002odd'] },
				readingNotes: {
					[theos.id]: 'Nomen sacrum\nwritten θς',
					'gone\u0001x': 'Orphaned note',
				},
				certainty: { [theos.id]: 'medium', [om.id]: 0.25, [sigma.id]: null },
				sourceDecision: {
					[theos.id]: { kind: 'unclear' },
					[om.id]: { kind: 'undecided' },
					'gone\u0001y': { kind: 'unclear' },
				},
				spanningReadingIds: [outer[1].id],
				overlapResolutions: {
					[ids[10]]: { kind: 'overlapped' },
					[ids[11]]: { kind: 'reading', readingId: theos.id },
				},
				manualTestimony: {
					'manual:Ψ': { kind: 'reading', readingId: theos.id },
					'manual:L1': { kind: 'nonAttestation' },
					'manual:Or': { kind: 'uncited' },
				},
				authoredReadings: [
					{
						id: 'authored:1',
						text: 'λογου',
						isOmission: false,
						order: 9,
						parentReadingId: null,
						readingType: null,
					},
				],
				ambiguousAttestations: [
					{
						id: 'ambiguous:1',
						witnessIds: [ids[13]],
						targetReadingIds: [lemma.id, sigma.id],
					},
				],
				unconfirmedWitnessIds: [ids[20], ids[21]],
				unresolvedAttestations: [
					{ witnessId: ids[22], candidateReadingIds: [lemma.id, theos.id] },
				],
				connectivity: 4,
			},
		],
		[outerUnit, { connectivity: 'absolute', readingTags: {} }],
		[
			mergedUnit,
			{
				preserveReadings: true,
				lemmaReadingId: 'gone-lemma',
				subreadingOf: { 'gone\u0001z': mergedReadings[0].id },
			},
		],
		[
			'unit:orphaned',
			{
				lemmaReadingId: 'orphan:a',
				readingType: { 'orphan:b': 'nonsense' },
				ambiguousAttestations: [
					{
						id: 'ambiguous:2',
						witnessIds: [ids[30]],
						targetReadingIds: ['orphan:a', 'orphan:b'],
					},
				],
			},
		],
		[weirdUnit, {}],
	]);
	const readingArcs = new Map<string, ReadingArc[]>([
		[variantUnit, [{ id: 'arc:1', priorReadingId: lemma.id, posteriorReadingId: theos.id }]],
		[
			'unit:orphaned',
			[{ id: 'arc:orphan', priorReadingId: 'orphan:a', posteriorReadingId: 'orphan:b' }],
		],
		['unit:no-decisions', []],
	]);
	const document = buildCollationDocument({
		importNotes: [
			{ id: 'note:1', unitId: variantUnit, detail: 'Bell\u0007 & <note>\r\n  kept' },
			{ id: 'note:2', unitId: null, detail: 'Whole collation' },
		],
		collationId: 'generated',
		projectId: 'project',
		projectName: null,
		phase: 'readings',
		furthestPhase: 'stemma',
		segment: { id: 'segment', name: 'Romans 1:1', members: ['Romans 1:1', 'Romans 1:2'] },
		witnesses,
		manualWitnessOverrides: [
			{ manualWitnessId: 'manual:L1', isExcluded: true, treatment: 'full' },
		],
		rules,
		ignoreWordBreaks: true,
		lowercase: true,
		ignoreTokenWhitespace: false,
		ignorePunctuation: true,
		suppliedTextMode: 'gap',
		segmentation: false,
		alignmentColumns: columns,
		declaredUnits,
		witnessOrder: [...ids].reverse(),
		classifiedReadings: new Map([[mergedUnit, mergedReadings]]),
		unitDecisions,
		readingArcs,
		alignmentDisplayMode: 'original',
		alignmentLayout: 'variation-units',
	});
	return {
		name: 'generated 100 witnesses',
		document,
		vocab: {
			manualWitnesses,
			readingTags: [
				{ id: 'tag:ns', label: 'Nomen sacrum' },
				{ id: 'tag:\u0002odd', label: 'Odd' },
			],
		},
	};
}

function stateLoadWitness(witnessId: string, content: string, isBaseText = false): WitnessConfig {
	return witness(witnessId, {
		witnessId,
		transcriptionId: `${witnessId}-tx`,
		source: { kind: 'version', transcriptionId: `${witnessId}-tx`, versionId: 'cp-initial' },
		content,
		tokens: content
			.split(/\s+/)
			.filter(Boolean)
			.map(token => ({
				kind: 'text' as const,
				original: token,
				segments: [
					{ text: token, hasUnclear: false, isPunctuation: false, isSupplied: false },
				],
				gap: null,
			})),
		isBaseText,
	});
}

/** The documents the collation-state load spec persists, from setup through readings. */
export function stateLoadFixtures(): Fixture[] {
	const seed = (
		phase: 'setup' | 'alignment' | 'readings',
		alignmentColumns: AlignmentColumn[],
		unitDecisions: Map<string, UnitDecisions>
	) =>
		buildCollationDocument({
			collationId: 'col-1',
			projectId: 'proj-1',
			projectName: 'Project 1',
			phase,
			furthestPhase: phase,
			segment: { id: 'segment-1', name: 'Romans 1:1', members: ['Romans 1:1'] },
			witnesses: [stateLoadWitness('A', 'alpha', true), stateLoadWitness('B', 'beta')],
			rules: [],
			ignoreWordBreaks: false,
			lowercase: false,
			ignoreTokenWhitespace: true,
			ignorePunctuation: false,
			suppliedTextMode: 'clear',
			segmentation: true,
			alignmentColumns,
			witnessOrder: ['A', 'B'],
			classifiedReadings: new Map(),
			unitDecisions,
			readingArcs: new Map(),
			alignmentDisplayMode: 'regularized',
			alignmentLayout: 'variation-units',
		});
	const columns = () =>
		deserializeAlignmentColumns([
			{
				id: 'col-1',
				index: 0,
				merged: false,
				cells: [
					['A', { ...text('alpha'), originalSegments: undefined }],
					['B', { ...text('beta'), originalSegments: undefined }],
				],
			},
		]);
	const beta = 'col-1::beta::original';
	return [
		{ name: 'state load: setup', document: seed('setup', [], new Map()), vocab: {} },
		{
			name: 'state load: subreading decision',
			document: seed(
				'readings',
				columns(),
				new Map([['unit:col-1', { subreadingOf: { [beta]: 'col-1::alpha::original' } }]])
			),
			vocab: {},
		},
		{
			name: 'state load: reading type',
			document: seed(
				'readings',
				columns(),
				new Map([
					[
						'unit:col-1',
						{
							readingType: { [beta]: 'itacism' },
							certainty: { [beta]: 'low' as const },
						},
					],
				])
			),
			vocab: {
				readingTypes: [
					{
						id: 'itacism',
						label: 'Itacism',
						description: '',
						selectable: true,
						suffix: 'i',
					},
				],
			},
		},
	];
}
