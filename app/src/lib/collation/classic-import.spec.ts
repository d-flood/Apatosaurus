import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	buildClassicBaseTranscription,
	buildClassicCollationDocument,
	classicBaseSiglumCandidates,
	classicManualWitnesses,
	parseClassicCollationExport,
} from './classic-import';
import { prepareWitnessesFromDocument } from './collation-runner';
import { buildApparatusTeiExportInput, exportApparatusTei } from './collation-tei';
import { deserializeAlignmentColumns } from './alignment-snapshot';

vi.stubGlobal('DOMParser', DOMParser);
afterEach(() => vi.restoreAllMocks());

const fixture = (name: string) =>
	readFileSync(new URL(`./__fixtures__/classic/${name}.xml`, import.meta.url), 'utf8');

function build(name: string, baseSiglum = 'A') {
	const source = parseClassicCollationExport(fixture(name));
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
			projectId: 'project',
			projectName: 'Project',
			collationId: verse.id,
		});
	});
	return { source, transcription, manualWitnesses, documents };
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
