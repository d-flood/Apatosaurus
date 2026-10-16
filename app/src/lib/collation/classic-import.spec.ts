import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	buildClassicBaseTranscription,
	buildClassicCollationDocument,
	classicBaseSiglumCandidates,
	classicManualWitnesses,
	classicEditorialVocabulary,
	parseClassicCollationExport,
} from './classic-import';
import { prepareWitnessesFromDocument } from './collation-runner';
import { buildApparatusTeiExportInput, exportApparatusTei } from './collation-tei';
import {
	hydrateCollationDocument,
	buildCollationDocument,
	type CollationDocumentSeed,
} from './collation-document';
import type { ReadingTypeDefinition } from './reading-types';
import { deserializeAlignmentColumns } from './alignment-snapshot';

vi.stubGlobal('DOMParser', DOMParser);
afterEach(() => vi.restoreAllMocks());

const fixture = (name: string) =>
	readFileSync(new URL(`./__fixtures__/classic/${name}.xml`, import.meta.url), 'utf8');

function build(
	name: string,
	baseSiglum = 'A',
	existingTypes: ReadingTypeDefinition[] = [],
	existingTags: Array<{ id: string; label: string }> = []
) {
	const source = parseClassicCollationExport(fixture(name));
	const editorialVocabulary = classicEditorialVocabulary(source, existingTypes, existingTags);
	const transcription = buildClassicBaseTranscription(source);
	const manualWitnesses = classicManualWitnesses(source, baseSiglum, []);
	const documents = source.verses.map(verse => {
		const witness = prepareWitnessesFromDocument({
			document: transcription,
			verseIdentifier: verse.id,
			transcriptionId: 'base',
			siglum: baseSiglum,
			source: { kind: 'current', transcriptionId: 'base', capturedAt: '', contentHash: '' },
		})[0];
		return buildClassicCollationDocument({
			verse,
			witness,
			manualWitnesses,
			editorialVocabulary,
			projectId: 'project',
			projectName: 'Project',
			collationId: verse.id,
		});
	});
	return { source, transcription, manualWitnesses, documents, editorialVocabulary };
}

function readingCitations(xml: string) {
	const document = new DOMParser().parseFromString(xml, 'application/xml');
	const witnesses = new Map(
		Array.from(document.getElementsByTagName('witness')).map(node => [
			`#${node.getAttribute('xml:id')}`,
			node.getAttribute('n'),
		])
	);
	return Array.from(document.getElementsByTagName('app')).map(app =>
		Array.from(app.childNodes)
			.filter(node => node.nodeType === 1 && node.nodeName === 'rdg')
			.map(node => {
				const element = node as unknown as Element;
				return {
					text:
						element.getAttribute('type') === 'om'
							? ''
							: (element.textContent ?? '').trim(),
					isLacuna: element.getAttribute('type') === 'lac',
					witnesses: (element.getAttribute('wit') ?? '')
						.split(/\s+/)
						.filter(Boolean)
						.map(id => witnesses.get(id))
						.sort(),
				};
			})
			.sort((a, b) => a.text.localeCompare(b.text))
	);
}

describe('classic collation import', () => {
	it('parses base words, positions, witnesses and the deferred classic metadata', () => {
		const source = parseClassicCollationExport(fixture('absent'));
		expect(source).toEqual({
			witnesses: ['A', 'B'],
			verses: [
				{
					id: 'Acts_1.2',
					baseWords: ['λογος', 'εστιν'],
					units: [
						{
							from: 2,
							to: 2,
							readings: [
								{
									label: 'a',
									type: '-',
									text: 'λογος',
									witnesses: ['A'],
									varSeq: '',
								},
								{
									label: 'b',
									type: '-',
									text: 'θεος',
									witnesses: ['B'],
									varSeq: '',
								},
							],
							witnessDetails: [
								{
									label: 'zw',
									witnesses: ['B'],
									type: 'ambiguous',
									targets: ['a', 'b'],
								},
							],
							connectivity: 3,
							arcs: [{ from: 'a', to: 'b' }],
						},
						{
							from: 4,
							to: 4,
							readings: [
								{
									label: 'a',
									type: '-',
									text: 'εστιν',
									witnesses: ['A'],
									varSeq: '',
								},
							],
							witnessDetails: [],
							connectivity: null,
							arcs: [],
						},
					],
				},
			],
		});
		expect(classicBaseSiglumCandidates(source)).toEqual(['A']);
	});

	it('parses all core fixture units and refuses empty or out-of-range exports before import', () => {
		const { source } = build('core');
		expect(
			source.verses.map(verse => [verse.id, verse.units.map(unit => [unit.from, unit.to])])
		).toEqual([
			[
				'Acts_1.1',
				[
					[2, 2],
					[3, 3],
					[4, 6],
					[4, 8],
					[6, 8],
				],
			],
			['Unnormalized.verse_2', [[2, 2]]],
		]);
		expect(classicBaseSiglumCandidates(source)).toEqual(['A']);
		expect(() => parseClassicCollationExport('<TEI/>')).toThrow('no verses');
		for (const positions of [
			'from="0" to="2"',
			'from="2" to="4"',
			'from="3" to="2"',
			'from="x" to="2"',
		])
			expect(() =>
				parseClassicCollationExport(
					`<TEI><ab xml:id="x">word<app ${positions}/></ab></TEI>`
				)
			).toThrow('outside');
	});

	it('round-trips each core unit’s reading text and witnesses through apparatus TEI', () => {
		const { source, documents, manualWitnesses } = build('core');
		for (const [index, document] of documents.entries()) {
			const verse = source.verses[index];
			const input = buildApparatusTeiExportInput(document, [], [], manualWitnesses);
			const expected = [...verse.units]
				.sort((a, b) => a.from - b.from || b.to - a.to)
				.map(unit =>
					unit.readings
						.map(reading => ({
							text: reading.text,
							isLacuna: reading.type === 'lac',
							witnesses: [...reading.witnesses].sort(),
						}))
						.sort((a, b) => a.text.localeCompare(b.text))
				);
			expect(readingCitations(exportApparatusTei(input))).toEqual(expected);
			expect(document.setup.segment).toMatchObject({ name: verse.id, members: [verse.id] });
			expect(document.flow).toMatchObject({ phase: 'review', furthestPhase: 'review' });
			expect(
				document.apparatus?.units.every(
					unit => !unit.decisions.unconfirmedWitnessIds?.length
				)
			).toBe(true);
		}
		expect(documents[0].importNotes?.map(note => note.detail)).toEqual([
			'Classic reading `c` is now `zz`',
		]);
		const columns = deserializeAlignmentColumns(documents[0].alignment!.columns);
		expect(columns.slice(0, 2).map(column => column.cells.values().next().value?.text)).toEqual(
			['τον', ',']
		);
		expect(columns[2].cells.values().next().value?.kind).toBe('omission');
		expect(documents[0].alignment!.declaredUnits?.[0]).toEqual({
			firstColumnId: columns[0].id,
			lastColumnId: columns[1].id,
		});
		expect(
			documents[0].apparatus?.units.find(unit => unit.decisions.lemmaReadingId)?.decisions
				.lemmaReadingId
		).toContain('classic-reading:');
	});

	it('leaves absent witnesses unrecorded and retains existing manual witness defaults', () => {
		const { source, documents, manualWitnesses } = build('absent');
		const input = buildApparatusTeiExportInput(documents[0], [], [], manualWitnesses);
		expect([...input.units.values()][1].view.unrecordedManualWitnessIds).toEqual([
			manualWitnesses[0].id,
		]);
		expect(() => exportApparatusTei(input)).toThrow('nothing recorded');
		const existing = {
			id: 'old-B',
			siglum: 'B',
			treatment: 'fragmentary' as const,
			includeInCbgm: false,
		};
		expect(classicManualWitnesses(source, 'A', [existing])).toEqual([existing]);
		const named = build('core', 'Edition');
		expect(named.manualWitnesses.map(witness => witness.siglum)).toEqual(['A', 'B', 'C']);
		expect(
			named.manualWitnesses.every(
				witness => witness.treatment === 'full' && witness.includeInCbgm
			)
		).toBe(true);
		for (const line of named.transcription.pages[0].columns[0].lines) {
			expect(line.items[0]).toMatchObject({
				type: 'milestone',
				kind: 'verse',
				attrs: { chapter: '', verse: '' },
			});
			expect(line.items[1]).toMatchObject({ type: 'text', marks: [{ type: 'unconfirmed' }] });
		}
	});
});

function exportInput(result: ReturnType<typeof build>, index = 0) {
	return buildApparatusTeiExportInput(
		result.documents[index],
		result.editorialVocabulary.readingTypes,
		result.editorialVocabulary.readingTags,
		result.manualWitnesses
	);
}

it('imports and exports every classic type, subreading, stemma arc, tag and ambiguous attestation', () => {
	const result = build('editorial');
	const input = exportInput(result);
	const unit = [...input.units.values()][0];
	const labelOf = (id: string) => unit.view.readings.find(reading => reading.id === id)!.label;
	const typeOf = (id: string | null) =>
		result.editorialVocabulary.readingTypes.find(type => type.id === id)?.label ?? id;
	expect(
		unit.view.readings.map(reading => ({
			label: reading.label,
			text: reading.text,
			type: typeOf(reading.readingType),
			parent: reading.parentReadingId && labelOf(reading.parentReadingId),
		}))
	).toEqual([
		{ label: 'a', text: 'alpha', type: null, parent: null },
		{ label: 'b', text: 'correction', type: 'Correction', parent: null },
		{ label: 'c', text: 'emendation', type: 'Emendation', parent: null },
		{ label: 'd', text: 'lectionary', type: 'Lectionary adaptation', parent: null },
		{ label: 'e', text: 'unknown', type: 'unusual', parent: null },
		{ label: 'f', text: null, type: 'omission', parent: null },
		{ label: 'g', text: 'untyped', type: null, parent: null },
		{ label: 'ad', text: 'deficient', type: 'deficient', parent: 'a' },
		{ label: 'af', text: 'error', type: 'nonsense', parent: 'a' },
		{ label: 'ai', text: 'insignificant', type: 'Insignificant', parent: 'a' },
		{ label: 'ao1', text: 'orthographic', type: 'orthographic', parent: 'a' },
		{ label: 'ao2', text: 'nomen', type: 'orthographic', parent: 'a' },
		{ label: 'as', text: 'subreading', type: 'Subreading', parent: 'a' },
	]);
	expect(
		result.documents[0].stemma!.units[0].arcs.map(arc => [
			labelOf(arc.priorReadingId),
			labelOf(arc.posteriorReadingId),
		])
	).toEqual([
		['a', 'b'],
		['b', 'c'],
		['c', 'd'],
		['d', 'e'],
		['e', 'f'],
		['f', 'g'],
	]);
	expect(unit.connectivity).toBe(3);
	expect(unit.view.ambiguousAttestations).toMatchObject([
		{
			witnessIds: [result.manualWitnesses.find(witness => witness.siglum === 'X')!.id],
			targetLabels: ['a', 'b'],
		},
	]);
	expect(unit.view.nonAttestingManualWitnessIds).toEqual([
		result.manualWitnesses.find(witness => witness.siglum === 'Z')!.id,
	]);
	expect(unit.view.readings.find(reading => reading.label === 'ao2')?.readingTags).toEqual([
		result.editorialVocabulary.readingTags[0].id,
	]);
	expect(result.documents[0].importNotes ?? []).toEqual([]);
	const xml = exportApparatusTei(input);
	expect(xml).toContain('<numeric value="3"/>');
	expect(xml).toContain('Nomen sacrum');
	expect(xml).toContain('type="ambiguous"');
	const exported = new DOMParser().parseFromString(xml, 'application/xml');
	const readings = Array.from(exported.getElementsByTagName('rdg'));
	expect(readings.map(reading => reading.getAttribute('n')).sort()).toEqual(
		[...result.source.verses[0].units[0].readings.map(reading => reading.label)].sort()
	);
	expect(Array.from(exported.getElementsByTagName('arc'))).toHaveLength(6);
	for (const reading of unit.view.readings) {
		const node = readings.find(node => node.getAttribute('n') === reading.label)!;
		expect(node.getAttribute('type') || null).toBe(
			reading.isOmission ? 'om' : reading.readingType
		);
	}
});

it('reproduces elevation and split labels and records exactly the unreproducible metadata', () => {
	const result = build('labels');
	const labels = result.documents.map((_, index) =>
		[...exportInput(result, index).units.values()][0].view.readings.map(
			reading => reading.label
		)
	);
	expect(labels).toEqual([
		['a', 'b'],
		['a', 'b'],
		['a1', 'a2', 'b'],
		['a1', 'a2', 'b'],
	]);
	expect(
		result.documents.map(document => document.importNotes?.map(note => note.detail) ?? [])
	).toEqual([
		[
			'Classic arc a → missing names an unknown reading.',
			'Classic ambiguous attestation zw-a/missing could not be imported: target-not-found.',
			'Classic reading `d` is now `b`',
		],
		[],
		[],
		[],
	]);
	expect(result.documents[0].stemma?.units[0]).not.toHaveProperty('connectivity');
	for (const [index, document] of result.documents.entries()) {
		const hydrated = hydrateCollationDocument(document);
		const rebuilt = buildCollationDocument({
			...hydrated,
			alignmentColumns: deserializeAlignmentColumns(hydrated.alignmentColumns),
			classifiedReadings: new Map(hydrated.classifiedReadings),
			unitDecisions: new Map(hydrated.unitDecisions),
			readingArcs: new Map(hydrated.readingArcs),
		} as CollationDocumentSeed);
		const input = buildApparatusTeiExportInput(
			rebuilt,
			result.editorialVocabulary.readingTypes,
			[],
			result.manualWitnesses
		);
		expect([...input.units.values()][0].view.readings.map(reading => reading.label)).toEqual(
			labels[index]
		);
		expect(rebuilt.importNotes ?? []).toEqual(document.importNotes ?? []);
		expect(exportApparatusTei(input)).toContain('<app');
	}
});

it('reuses project type and tag labels and records suffix collisions without taking the suffix', () => {
	const existing = [
		{ id: 'correction', label: ' correction ', description: '', selectable: true, suffix: '' },
		{ id: 'taken-i', label: 'Other', description: '', selectable: true, suffix: 'i' },
		{ id: 'taken-s', label: 'Another', description: '', selectable: true, suffix: 's' },
	];
	const tag = { id: 'ns', label: ' NOMEN SACRUM ' };
	const result = build('editorial', 'A', existing, [tag]);
	expect(result.editorialVocabulary.types.get('corr')).toBe('correction');
	expect(result.editorialVocabulary.readingTags).toEqual([tag]);
	expect(
		result.editorialVocabulary.readingTypes
			.filter(type => type.label === 'Insignificant' || type.label === 'Subreading')
			.map(type => type.suffix)
	).toEqual(['', '']);
	expect(result.documents[0].importNotes?.map(note => note.detail)).toEqual([
		'Classic type Insignificant imported without suffix i, which is already in use.',
		'Classic type Subreading imported without suffix s, which is already in use.',
		'Classic reading `ai` is now `h`',
		'Classic reading `as` is now `i`',
	]);
});

it('reproduces contiguous main letters beyond z independently of XML order', () => {
	const result = build('alphabet');
	const labels = [...exportInput(result).units.values()][0].view.readings.map(
		reading => reading.label
	);
	expect(labels).toEqual([...Array.from('abcdefghijklmnopqrstuvwxyz'), 'aa', 'ab']);
	expect(result.documents[0].importNotes ?? []).toEqual([]);
});
