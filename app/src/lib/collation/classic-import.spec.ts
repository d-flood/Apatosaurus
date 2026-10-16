import { readFileSync, readdirSync } from 'node:fs';
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
import { resolveReadingTypeVocabulary, type ReadingTypeDefinition } from './reading-types';
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
			sigla: source.witnesses,
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
			const input = buildApparatusTeiExportInput(document, { manualWitnesses });
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
		const input = buildApparatusTeiExportInput(documents[0], { manualWitnesses });
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
	return buildApparatusTeiExportInput(result.documents[index], {
		readingTypes: result.editorialVocabulary.readingTypes,
		readingTags: result.editorialVocabulary.readingTags,
		manualWitnesses: result.manualWitnesses,
	});
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
		const input = buildApparatusTeiExportInput(rebuilt, {
			readingTypes: result.editorialVocabulary.readingTypes,
			manualWitnesses: result.manualWitnesses,
		});
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

describe('classic overlap inference', () => {
	it('imports a long omission as overlap in both inner units, without inferring outside testimony', () => {
		const result = build('long-omission');
		const input = exportInput(result);
		const units = [...input.units.values()];
		const witnessId = result.manualWitnesses[0].id;
		expect(result.documents[0].apparatus!.units[0].decisions.spanningReadingIds).toHaveLength(
			1
		);
		expect(units.map(unit => unit.view.overlappedWitnessIds)).toEqual([
			[],
			[witnessId],
			[witnessId],
			[],
		]);
		expect(units.every(unit => unit.view.unrecordedManualWitnessIds.length === 0)).toBe(true);
		expect(exportApparatusTei(input).match(/type="overlap"/g)).toHaveLength(2);
		for (const unit of result.documents[0].apparatus!.units)
			expect(unit.decisions.unconfirmedWitnessIds ?? []).toEqual([]);
	});

	it('keeps explicit inner readings and infers spanning for absence from any inner unit', () => {
		const result = build('recorded-overlap');
		const input = exportInput(result);
		const units = [...input.units.values()];
		const id = (siglum: string) =>
			result.manualWitnesses.find(witness => witness.siglum === siglum)!.id;
		expect(result.documents[0].apparatus!.units[0].decisions.spanningReadingIds).toHaveLength(
			2
		);
		const alpha = units[1].view.readings.find(reading => reading.text === 'alpha')!;
		expect(alpha.manualWitnessIds).toEqual([id('D')]);
		expect(units[1].view.overlappedWitnessIds).toEqual([id('B')]);
		expect(units[2].view.overlappedWitnessIds).toEqual([id('B'), id('D')]);
		for (const [index, unit] of units.entries()) {
			if (index === 0) continue;
			const omission = unit.view.readings.find(reading => reading.isOmission)!;
			expect(omission.manualWitnessIds).toEqual([id('C')]);
			expect(
				result.documents[0].apparatus!.units[index].decisions.overlapResolutions
			).toEqual({
				[id('C')]: { kind: 'reading', readingId: omission.id },
				...(index === 1 ? { [id('D')]: { kind: 'reading', readingId: alpha.id } } : {}),
			});
			expect(unit.view.unrecordedManualWitnessIds).toEqual([]);
		}
		expect(() => exportApparatusTei(input)).not.toThrow();
	});

	it('preserves recorded crossing testimony and leaves an absent crossing witness unresolved', () => {
		const result = build('crossing');
		const input = exportInput(result);
		const witnessId = result.manualWitnesses[0].id;
		const crossing = [...input.units.values()][2];
		expect(crossing.view.unresolvedOverlapWitnessIds).toEqual([]);
		expect(
			crossing.view.readings.find(reading => reading.text === 'delta')?.manualWitnessIds
		).toEqual([witnessId]);
		expect(exportApparatusTei(input)).toContain('type="overlap"');
		const document = result.documents[0];
		const decisions = document.apparatus!.units[2].decisions;
		delete decisions.manualTestimony![witnessId];
		delete decisions.overlapResolutions![witnessId];
		const unresolved = exportInput(result);
		expect([...unresolved.units.values()][2].view.unresolvedOverlapWitnessIds).toEqual([
			witnessId,
		]);
		expect(() => exportApparatusTei(unresolved)).toThrow('unresolved attestations');
	});

	it('keeps explicit inner lacunae and ambiguous attestations beside an inferred overlap', () => {
		const result = build('recorded-nonreadings');
		const id = (siglum: string) =>
			result.manualWitnesses.find(witness => witness.siglum === siglum)!.id;
		for (const unit of [...exportInput(result).units.values()].slice(1)) {
			expect(unit.view.overlappedWitnessIds).toEqual([id('B')]);
			expect(unit.view.nonAttestingManualWitnessIds).toEqual([id('C')]);
			expect(unit.view.ambiguousAttestations[0].witnessIds).toEqual([id('D')]);
		}
	});
});

const classicFixtures = readdirSync(new URL('./__fixtures__/classic/', import.meta.url))
	.filter(name => name.endsWith('.xml'))
	.map(name => name.slice(0, -4));

it.each(classicFixtures)('round-trips all editorial testimony and metadata in %s', name => {
	const result = build(name);
	const vocabulary = resolveReadingTypeVocabulary(result.editorialVocabulary.readingTypes);
	const expectedNotes: Record<string, string[]> = {
		absent: ['Classic ambiguous attestation zw could not be imported: target-emptied.'],
		core: ['Classic reading `c` is now `zz`'],
		labels: [
			'Classic arc a → missing names an unknown reading.',
			'Classic ambiguous attestation zw-a/missing could not be imported: target-not-found.',
			'Classic reading `d` is now `b`',
		],
	};
	expect(
		result.documents.flatMap(document => document.importNotes?.map(note => note.detail) ?? [])
	).toEqual(expectedNotes[name] ?? []);
	for (const [verseIndex, document] of result.documents.entries()) {
		const originalInput = exportInput(result, verseIndex);
		const unrecorded = new Set(
			[...originalInput.units.values()].flatMap(unit => unit.view.unrecordedManualWitnessIds)
		);
		if (unrecorded.size) {
			expect(() => exportApparatusTei(originalInput)).toThrow('nothing recorded');
			document.setup.manualWitnessOverrides = [...unrecorded].map(manualWitnessId => ({
				manualWitnessId,
				isExcluded: false,
				treatment: 'fragmentary',
			}));
		}
		const input = exportInput(result, verseIndex);
		const xml = new DOMParser().parseFromString(exportApparatusTei(input), 'application/xml');
		const refs = (value: string | null) => value?.trim().split(/\s+/).filter(Boolean) ?? [];
		const witnesses = new Map(
			Array.from(xml.getElementsByTagName('witness')).map(node => [
				`#${node.getAttribute('xml:id')}`,
				node.getAttribute('n'),
			])
		);
		const tags = new Map(
			Array.from(xml.getElementsByTagName('interp')).map(node => [
				`#${node.getAttribute('xml:id')}`,
				node.textContent,
			])
		);
		const apps = Array.from(xml.getElementsByTagName('app'));
		const sourceUnits = [...result.source.verses[verseIndex].units].sort(
			(a, b) => a.from - b.from || b.to - a.to
		);
		expect(apps).toHaveLength(sourceUnits.length);
		for (const [unitIndex, source] of sourceUnits.entries()) {
			const segment = input.segments.filter(segment => segment.kind === 'unit')[unitIndex];
			const app = apps.find(
				app =>
					app.getElementsByTagName('label')[0]?.textContent ===
					`${input.segmentName}/${segment.ordinal}`
			)!;
			expect(segment.span.columnIds[0]).toMatch(new RegExp(`^classic:${source.from}:`));
			expect(segment.span.columnIds.at(-1)).toMatch(new RegExp(`^classic:${source.to}:`));
			const notes =
				document.importNotes
					?.filter(note => note.unitId === segment.span.unitId)
					.map(note => note.detail) ?? [];
			const renamed = (label: string) => {
				const note = notes.find(note =>
					note.startsWith(`Classic reading \`${label}\` is now `)
				);
				return note?.match(/is now `([^`]+)`/)?.[1] ?? label;
			};
			const validAmbiguities = source.witnessDetails.filter(
				detail =>
					detail.type === 'ambiguous' &&
					!notes.some(note =>
						note.startsWith(
							`Classic ambiguous attestation ${detail.label || detail.witnesses.join(', ')} could not be imported:`
						)
					) &&
					detail.targets.every(target =>
						source.readings.some(reading => reading.label === target.replace(/^#/, ''))
					)
			);
			const ambiguousWitnesses = new Set(
				validAmbiguities.flatMap(detail => detail.witnesses)
			);
			const expectedReadings = source.readings
				.map(reading => {
					const type = result.editorialVocabulary.types.get(reading.type) ?? null;
					return {
						label: renamed(reading.label),
						text: reading.type === 'om' || reading.type === 'lac' ? '' : reading.text,
						type: reading.type === 'lac' ? 'lac' : reading.type === 'om' ? 'om' : type,
						witnesses: reading.witnesses
							.filter(witness => !ambiguousWitnesses.has(witness))
							.sort(),
						tags: reading.type === 'ns' ? ['Nomen sacrum'] : [],
					};
				})
				.sort((a, b) => a.label.localeCompare(b.label));
			const readings = Array.from(app.getElementsByTagName('rdg'));
			expect(
				readings
					.map(reading => ({
						label: reading.getAttribute('n'),
						text: reading.textContent?.trim() ?? '',
						type:
							reading.getAttribute('type') === 'split'
								? reading.getAttribute('subtype')
								: reading.getAttribute('type'),
						witnesses: refs(reading.getAttribute('wit'))
							.map(ref => witnesses.get(ref))
							.sort(),
						tags: refs(reading.getAttribute('ana')).map(ref => tags.get(ref)),
					}))
					.sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''))
			).toEqual(expectedReadings);
			const labelById = new Map(
				readings.map(reading => [
					`#${reading.getAttribute('xml:id')}`,
					reading.getAttribute('n'),
				])
			);
			expect(
				Array.from(app.getElementsByTagName('witDetail'))
					.filter(detail => detail.getAttribute('type') === 'ambiguous')
					.map(detail => ({
						witnesses: refs(detail.getAttribute('wit'))
							.map(ref => witnesses.get(ref))
							.sort(),
						targets: refs(detail.getAttribute('target'))
							.map(ref => labelById.get(ref))
							.sort(),
					}))
			).toEqual(
				validAmbiguities.map(detail => ({
					witnesses: [...detail.witnesses].sort(),
					targets: detail.targets.map(target => renamed(target.replace(/^#/, ''))).sort(),
				}))
			);
			const view = input.units.get(segment.span.unitId)!.view;
			const mainArcs: string[][] = [];
			for (const arc of source.arcs) {
				const prior = arc.from.replace(/^#/, ''),
					posterior = arc.to.replace(/^#/, '');
				const reading = source.readings.find(reading => reading.label === posterior);
				if (!reading || !source.readings.some(reading => reading.label === prior)) {
					expect(notes).toContain(
						`Classic arc ${arc.from} → ${arc.to} names an unknown reading.`
					);
					continue;
				}
				const type = result.editorialVocabulary.types.get(reading.type);
				if (vocabulary.find(definition => definition.id === type)?.suffix) {
					const imported = view.readings.find(
						reading => reading.label === renamed(posterior)
					)!;
					expect(
						view.readings.find(reading => reading.id === imported.parentReadingId)
							?.label
					).toBe(renamed(prior));
				} else mainArcs.push([renamed(prior), renamed(posterior)]);
			}
			const nodeLabels = new Map(
				Array.from(app.getElementsByTagName('node')).map(node => [
					`#${node.getAttribute('xml:id')}`,
					node.getAttribute('n'),
				])
			);
			expect(
				Array.from(app.getElementsByTagName('arc')).map(arc => [
					nodeLabels.get(arc.getAttribute('from')!),
					nodeLabels.get(arc.getAttribute('to')!),
				])
			).toEqual(mainArcs);
			expect(app.getElementsByTagName('numeric')[0]?.getAttribute('value') ?? '10').toBe(
				String(source.connectivity ?? 10)
			);
			for (const detail of Array.from(app.getElementsByTagName('witDetail')).filter(
				detail => detail.getAttribute('type') === 'overlap'
			)) {
				for (const ref of refs(detail.getAttribute('target'))) {
					const target = Array.from(xml.getElementsByTagName('rdg')).find(
						reading => `#${reading.getAttribute('xml:id')}` === ref
					);
					expect(target).toBeDefined();
					for (const witness of refs(detail.getAttribute('wit')))
						expect(refs(target!.getAttribute('wit'))).toContain(witness);
				}
			}
		}
	}
});
