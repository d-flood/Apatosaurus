import { DOMParser } from '@xmldom/xmldom';
import type { Document as XmlDocument } from '@xmldom/xmldom';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	exportApparatusTei,
	exportCollationDocumentTei,
	getApparatusExportRefusals,
	type ApparatusTeiExportInput,
	type ApparatusTeiUnit,
} from './collation-tei';
import { buildCollationDocument } from './collation-document';
import { collationState, type WitnessConfig } from './collation-state.svelte';
import type { AlignmentCell, AlignmentSnapshot } from './alignment-snapshot';
import type { WitnessSourceToken } from './collation-types';
import { validateTeiP5 } from '../../../../test-support/validate-tei-p5';

function tokens(content: string): WitnessSourceToken[] {
	return content
		.split(/\s+/)
		.filter(Boolean)
		.map(text => ({
			kind: 'text' as const,
			original: text,
			segments: [{ text, hasUnclear: false, isPunctuation: false, isSupplied: false }],
			gap: null,
		}));
}

function witness(id: string, content: string, isBaseText = false): WitnessConfig {
	return {
		witnessId: id,
		siglum: id,
		transcriptionId: `${id}-transcription`,
		content,
		tokens: tokens(content),
		treatment: 'inherit',
		isBaseText,
		isExcluded: false,
		overridesDefault: false,
	};
}

function textCell(text: string): AlignmentCell {
	return {
		text,
		regularizedText: text,
		alignmentValue: text,
		sourceTokenIds: [],
		kind: 'text',
		gap: null,
		isOmission: false,
		isLacuna: false,
		isRegularized: false,
		ruleIds: [],
		regularizationTypes: [],
	};
}

function omissionCell(): AlignmentCell {
	return {
		...textCell(''),
		text: null,
		regularizedText: null,
		alignmentValue: null,
		kind: 'omission',
		isOmission: true,
	};
}

function gapCell(kind: 'gap' | 'untranscribed' = 'gap'): AlignmentCell {
	return {
		...textCell('⊘'),
		regularizedText: null,
		alignmentValue: `__${kind}__:none:none:none`,
		kind,
		gap: { source: kind, reason: '', unit: '', extent: '' },
		isLacuna: true,
	};
}

function snapshot(gapKind: 'gap' | 'untranscribed' = 'gap'): AlignmentSnapshot {
	return {
		witnessOrder: ['A', 'B', 'C', 'D'],
		columns: [
			{
				id: 'one',
				index: 0,
				merged: false,
				cells: [
					['A', textCell('one')],
					['B', textCell('one')],
					['C', gapCell(gapKind)],
					['D', textCell('one')],
				],
			},
			{
				id: 'variant',
				index: 1,
				merged: false,
				cells: [
					['A', textCell('alpha')],
					['B', textCell('beta')],
					['C', gapCell(gapKind)],
					['D', omissionCell()],
				],
			},
			{
				id: 'two',
				index: 2,
				merged: false,
				cells: [
					['A', textCell('two')],
					['B', textCell('two')],
					['C', gapCell(gapKind)],
					['D', textCell('two')],
				],
			},
		],
	};
}

function exportInput(): ApparatusTeiExportInput {
	const segments = collationState.getSegmentSequence();
	const units = new Map<string, ApparatusTeiUnit>();
	for (const segment of segments) {
		if (segment.kind !== 'unit') continue;
		const unitId = segment.span.unitId;
		units.set(unitId, {
			view: collationState.peekUnitView(segment.span.startIndex),
			nonAttestation: collationState.getNonAttestationForUnit(segment.span.startIndex),
			stemma: collationState.getLocalStemma(segment.span.startIndex),
			connectivity: collationState.getConnectivity(segment.span.startIndex),
			recordedReadingTypeIds: Object.keys(
				collationState.unitDecisions.get(unitId)?.readingType ?? {}
			),
		});
	}
	return {
		title: 'Test collation',
		segmentName: 'John 1:1',
		witnesses: collationState.witnesses,
		baseTextWitnessId: collationState.getBaseTextWitnessId(),
		segments,
		units,
		readingTags: collationState.getReadingTags(),
	};
}

function settleSources() {
	const readings = collationState.peekReadingsForUnit(1);
	const alpha = readings.find(reading => reading.text === 'alpha')!;
	const beta = readings.find(reading => reading.text === 'beta')!;
	const omission = readings.find(reading => reading.isOmission)!;
	collationState.setReadingType(1, beta.id, 'apparent');
	collationState.setReadingCertainty(1, beta.id, 'low');
	collationState.setReadingParent(1, beta.id, alpha.id);
	collationState.setReadingSource(1, omission.id, { kind: 'derived', from: alpha.id });
}

function parse(xml: string): XmlDocument {
	const document = new DOMParser().parseFromString(xml, 'application/xml');
	expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
	return document;
}

function hasWitness(element: Pick<Element, 'getAttribute'>, witnessId: string): boolean {
	return (element.getAttribute('wit') ?? '').split(/\s+/).includes(`#wit-${witnessId}`);
}

function reconstructWitness(document: XmlDocument, witnessId: string): string {
	const ab = document.getElementsByTagName('ab')[0]!;
	let text = '';
	for (let index = 0; index < ab.childNodes.length; index += 1) {
		const child = ab.childNodes.item(index);
		if (!child) continue;
		if (child.nodeType === 3) {
			text += child.nodeValue ?? '';
			continue;
		}
		if (child.nodeType !== 1 || (child as unknown as Element).tagName !== 'app') continue;
		const app = child as unknown as Element;
		const lemma = app.getElementsByTagName('lem')[0]!;
		const reading = hasWitness(lemma, witnessId)
			? lemma
			: Array.from(app.getElementsByTagName('rdg')).find(entry =>
					hasWitness(entry, witnessId)
				);
		text += reading?.textContent ?? '';
	}
	return text.replace(/\s+/g, ' ').trim();
}

describe('apparatus TEI exporter', () => {
	it('lists and cites manual witnesses on authored text and omission readings in valid P5', async () => {
		const textId = collationState.addAuthoredReading(1, 'versional text')!;
		const omissionId = collationState.addAuthoredReading(1, '', true)!;
		await collationState.attachManualWitness(1, textId, 'Father & version');
		await collationState.attachManualWitness(1, omissionId, 'Syriac');
		await collationState.attachManualWitness(
			1,
			collationState.peekReadingsForUnit(1)[0].id,
			'Latin'
		);
		const manual = collationState.getManualWitnesses();
		const input = exportInput();
		input.witnesses = [
			...input.witnesses,
			...manual.map(witness => ({
				witnessId: witness.id,
				siglum: witness.siglum,
				isExcluded: false,
			})),
		];
		const xml = exportApparatusTei(input);
		const parsed = parse(xml);
		expect(
			Array.from(parsed.getElementsByTagName('witness')).map(witness =>
				witness.getAttribute('n')
			)
		).toEqual(expect.arrayContaining(manual.map(witness => witness.siglum)));
		const readings = Array.from(parsed.getElementsByTagName('rdg'));
		expect(
			readings.find(reading => hasWitness(reading, manual[0].id))?.textContent?.trim()
		).toBe('versional text');
		expect(
			readings.find(reading => hasWitness(reading, manual[1].id))?.getAttribute('subtype')
		).toBe('om');
		expect(
			readings.find(reading => hasWitness(reading, manual[2].id))?.textContent?.trim()
		).toBe('alpha');
		expect(() => validateTeiP5(xml)).not.toThrow();
	}, 60_000);

	it('declares tags once and references them on main and subreadings in valid P5', async () => {
		const readings = collationState.peekReadingsForUnit(1);
		const alpha = readings.find(reading => reading.text === 'alpha')!;
		const beta = readings.find(reading => reading.text === 'beta')!;
		await collationState.addReadingTag(1, alpha.id, 'Nomen sacrum');
		await collationState.addReadingTag(1, alpha.id, 'Abbreviation & contraction');
		await collationState.addReadingTag(1, beta.id, 'nomen SACRUM');
		const input = exportInput();
		const xml = exportApparatusTei(input);
		const document = parse(xml);
		const tags = Array.from(document.getElementsByTagName('interp'));
		expect(tags.map(tag => tag.textContent)).toEqual([
			'Nomen sacrum',
			'Abbreviation & contraction',
		]);
		const [ns, abbreviation] = tags.map(tag => `#${tag.getAttribute('xml:id')}`);
		expect(document.getElementsByTagName('lem')[0]?.getAttribute('ana')).toBe(
			`${ns} ${abbreviation}`
		);
		const exported = Array.from(document.getElementsByTagName('rdg'));
		expect(
			exported.find(reading => reading.getAttribute('n') === 'a')?.getAttribute('ana')
		).toBe(`${ns} ${abbreviation}`);
		expect(
			exported.find(reading => reading.getAttribute('n') === 'av')?.getAttribute('ana')
		).toBe(ns);
		expect(() => validateTeiP5(xml)).not.toThrow();
	}, 60_000);

	beforeEach(() => {
		collationState.reset();
		collationState.setWitnesses([
			witness('A', 'one alpha two', true),
			witness('B', 'one beta two'),
			witness('C', ''),
			witness('D', 'one two'),
		]);
		collationState.setAlignmentSnapshot(snapshot());
		settleSources();
	});

	it('uses the shared segment sequence, reconstructs every attesting witness, and validates as TEI P5', () => {
		const input = exportInput();
		const xml = exportApparatusTei(input);
		const document = parse(xml);
		const app = document.getElementsByTagName('app')[0]!;
		const unit = input.segments.find(segment => segment.kind === 'unit')!;

		expect(app.getAttribute('from')).toBe(unit.label);
		expect(app.getAttribute('to')).toBe(unit.label);
		expect(reconstructWitness(document, 'A')).toBe('one alpha two');
		expect(reconstructWitness(document, 'B')).toBe('one beta two');
		expect(reconstructWitness(document, 'D')).toBe('one two');
		expect(() => validateTeiP5(xml)).not.toThrow();
	}, 60_000);

	it('serializes flat subreadings, omission, non-attestation, and local-stemma decisions', () => {
		const document = parse(exportApparatusTei(exportInput()));
		const readings = Array.from(document.getElementsByTagName('rdg'));
		const lemma = document.getElementsByTagName('lem')[0]!;
		const graph = document.getElementsByTagName('graph')[0]!;

		expect(document.getElementsByTagName('rdgGrp')).toHaveLength(0);
		expect(readings.map(reading => reading.getAttribute('n'))).toEqual(['a', 'av', 'b', 'zz']);
		expect(readings[1]?.getAttribute('type')).toBe('apparent');
		expect(readings[1]?.getAttribute('cert')).toBe('low');
		expect(readings[2]?.getAttribute('type')).toBe('om');
		expect(readings[2]?.textContent).toBe('');
		expect(readings[3]?.getAttribute('type')).toBe('lac');
		expect(readings[3]?.textContent).toBe('');
		expect(lemma.getAttribute('wit')).toContain('#wit-A');
		expect(lemma.getAttribute('wit')).toContain('#basetext');
		expect(
			Array.from(graph.getElementsByTagName('node')).map(node => node.getAttribute('n'))
		).toEqual(['a', 'b']);
		const alphaNodeId = Array.from(graph.getElementsByTagName('node'))
			.find(node => node.getAttribute('n') === 'a')
			?.getAttribute('xml:id');
		const arcs = Array.from(graph.getElementsByTagName('arc'));
		expect(arcs).toHaveLength(1);
		expect(arcs.every(arc => arc.getAttribute('to') !== `#${alphaNodeId}`)).toBe(true);
		expect(graph.getElementsByTagName('node').item(0)?.getAttribute('n')).not.toBe('av');
		expect(graph.getElementsByTagName('node').item(0)?.getAttribute('n')).not.toBe('zz');
	});

	it('serializes numeric connectivity and encodes explicit absolute by omitting its feature structure', () => {
		const numeric = exportApparatusTei(exportInput());
		const numericDocument = parse(numeric);
		const numericFeature = numericDocument.getElementsByTagName('f')[0]!;
		expect(numericFeature.getAttribute('name')).toBe('connectivity');
		expect(numericFeature.getElementsByTagName('numeric')[0]?.getAttribute('value')).toBe('10');
		expect(() => validateTeiP5(numeric)).not.toThrow();

		const absoluteInput = exportInput();
		const unit = absoluteInput.segments.find(segment => segment.kind === 'unit')!;
		const unitId = unit.span.unitId;
		absoluteInput.units.get(unitId)!.connectivity = 'absolute';
		const absolute = exportApparatusTei(absoluteInput);
		const absoluteDocument = parse(absolute);
		const note = absoluteDocument.getElementsByTagName('note')[0]!;
		expect(note.getElementsByTagName('fs')).toHaveLength(0);
		expect(note.getElementsByTagName('label')[0]?.textContent).toBe('John 1:1/1');
		expect(note.getElementsByTagName('graph')).toHaveLength(1);
		expect(reconstructWitness(absoluteDocument, 'A')).toBe('one alpha two');
		expect(reconstructWitness(absoluteDocument, 'B')).toBe('one beta two');
		expect(reconstructWitness(absoluteDocument, 'D')).toBe('one two');
		expect(() => validateTeiP5(absolute)).not.toThrow();
	}, 60_000);

	it('adds basetext to the lemma only when the base text actually attests it', () => {
		const readings = collationState.peekReadingsForUnit(1);
		const alpha = readings.find(reading => reading.text === 'alpha')!;
		const beta = readings.find(reading => reading.text === 'beta')!;
		collationState.setReadingParent(1, beta.id, null);
		collationState.setLemmaReading(1, beta.id);
		collationState.setReadingSource(1, alpha.id, { kind: 'unclear' });

		const lemmaWitnesses = parse(exportApparatusTei(exportInput()))
			.getElementsByTagName('lem')[0]!
			.getAttribute('wit');
		expect(lemmaWitnesses).toContain('#wit-B');
		expect(lemmaWitnesses).not.toContain('#basetext');
	});

	it('does not serialize a proposed reading type as an editorial claim', () => {
		const input = exportInput();
		const unit = input.segments.find(segment => segment.kind === 'unit')!;
		const unitId = unit.span.unitId;
		const exportedUnit = input.units.get(unitId)!;
		const beta = exportedUnit.view.readings.find(reading => reading.text === 'beta')!;
		exportedUnit.view.readings = exportedUnit.view.readings.map(reading =>
			reading.id === beta.id ? { ...reading, readingType: 'deficient' } : reading
		);
		exportedUnit.recordedReadingTypeIds = [];

		const document = parse(exportApparatusTei(input));
		expect(
			Array.from(document.getElementsByTagName('rdg'))
				.find(reading => reading.getAttribute('n') === beta.label)
				?.getAttribute('type')
		).toBeNull();
	});

	it('exports undecided sources without arcs while preserving derived arcs as valid TEI P5', () => {
		const readings = collationState.peekReadingsForUnit(1);
		const beta = readings.find(reading => reading.text === 'beta')!;
		collationState.setReadingParent(1, beta.id, null);
		collationState.setReadingSource(1, beta.id, { kind: 'undecided' });
		const input = exportInput();

		expect(getApparatusExportRefusals(input)).toEqual([]);
		const xml = exportApparatusTei(input);
		const document = parse(xml);
		const graph = document.getElementsByTagName('graph')[0]!;
		const nodes = Array.from(graph.getElementsByTagName('node'));
		const alphaNode = nodes.find(node => node.getAttribute('n') === 'a')!;
		const betaNode = nodes.find(node => node.getAttribute('n') === 'b')!;
		const omissionNode = nodes.find(node => node.getAttribute('n') === 'c')!;
		const arcs = Array.from(graph.getElementsByTagName('arc'));

		expect(nodes).toHaveLength(3);
		expect(betaNode).toBeDefined();
		expect(arcs).toHaveLength(1);
		expect(arcs[0]?.getAttribute('from')).toBe(`#${alphaNode.getAttribute('xml:id')}`);
		expect(arcs[0]?.getAttribute('to')).toBe(`#${omissionNode.getAttribute('xml:id')}`);
		expect(
			arcs.some(arc => arc.getAttribute('to') === `#${betaNode.getAttribute('xml:id')}`)
		).toBe(false);
		expect(xml).not.toContain('unclear');
		expect(() => validateTeiP5(xml)).not.toThrow();
	}, 60_000);

	it('refuses unresolved attestations once per unit until every witness is resolved', () => {
		const readings = collationState.getReadingsForUnit(1);
		const alpha = readings.find(reading => reading.text === 'alpha')!;
		const beta = readings.find(reading => reading.text === 'beta')!;
		const key = 'unit:variant';
		collationState.unitDecisions.set(key, {
			...collationState.unitDecisions.get(key),
			unconfirmedWitnessIds: ['A'],
			unresolvedAttestations: ['B', 'D'].map(witnessId => ({
				witnessId,
				candidateReadingIds: [alpha.id, beta.id],
			})),
		});
		expect(getApparatusExportRefusals(exportInput())).toEqual([
			{
				kind: 'unresolved-attestation',
				unitId: key,
				label: '4',
				witnessIds: ['B', 'D'],
			},
		]);
		expect(() => exportApparatusTei(exportInput())).toThrow(
			'has unresolved attestations (B, D)'
		);
		collationState.resolveAttestation(1, 'B', beta.id);
		expect(getApparatusExportRefusals(exportInput())).toHaveLength(1);
		collationState.resolveAttestation(1, 'D', alpha.id);
		expect(getApparatusExportRefusals(exportInput())).toEqual([]);
		expect(() => exportApparatusTei(exportInput())).not.toThrow();
	});

	it('refuses untranscribed witnesses and missing lemma decisions by unit', () => {
		collationState.reset();
		collationState.setWitnesses([
			witness('A', 'one alpha two', true),
			witness('B', 'one beta two'),
			witness('C', ''),
			witness('D', 'one two'),
		]);
		collationState.setAlignmentSnapshot(snapshot('untranscribed'));
		settleSources();
		const incomplete = exportInput();
		const incompleteUnit = incomplete.segments.find(segment => segment.kind === 'unit')!;
		const incompleteUnitId = incompleteUnit.span.unitId;
		const incompleteRefusals = getApparatusExportRefusals(incomplete);
		expect(incompleteRefusals).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: 'untranscribed-witness',
					unitId: incompleteUnitId,
					witnessIds: ['C'],
				}),
			])
		);

		const noLemma = exportInput();
		const noLemmaUnit = noLemma.units.get(incompleteUnitId)!;
		noLemmaUnit.view.lemmaReadingId = null;
		expect(getApparatusExportRefusals(noLemma)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: 'missing-lemma', unitId: incompleteUnitId }),
			])
		);
	});

	it('refuses an untranscribed witness in agreed text without calling it lacuna', () => {
		const agreementOnly = snapshot();
		agreementOnly.columns[0]!.cells[2] = ['C', gapCell('untranscribed')];
		collationState.setAlignmentSnapshot(agreementOnly);
		settleSources();
		const incomplete = exportInput();
		const refusal = getApparatusExportRefusals(incomplete).find(
			entry => entry.kind === 'untranscribed-witness' && entry.unitId === undefined
		);

		expect(refusal).toEqual(
			expect.objectContaining({
				kind: 'untranscribed-witness',
				witnessIds: ['C'],
			})
		);
		expect(() => exportApparatusTei(incomplete)).toThrow(
			`agreed text ${refusal?.label} has untranscribed witnesses`
		);
	});

	it('exports a unit whose lemma roots the stemma and whose other sources are settled', () => {
		const input = exportInput();
		const unitId = input.segments.find(segment => segment.kind === 'unit')!.span.unitId;
		const nodes = input.units.get(unitId)!.stemma.nodes;

		expect(nodes.find(node => node.isLemma)).toMatchObject({
			isRoot: true,
			sourceDecision: { kind: 'undecided' },
		});
		expect(getApparatusExportRefusals(input)).toEqual([]);
		expect(() => exportApparatusTei(input)).not.toThrow();
	});

	it('marks split members after the first as splits, moving a recorded type to subtype, and validates as TEI P5', () => {
		const base = snapshot();
		collationState.reset();
		collationState.setWitnesses([
			witness('A', 'one alpha two', true),
			witness('B', 'one beta two'),
			witness('C', 'one beta two'),
			witness('D', 'one two'),
		]);
		collationState.setAlignmentSnapshot({
			...base,
			columns: base.columns.map(column => ({
				...column,
				cells: column.cells.map(([witnessId, cell]) =>
					witnessId === 'C' ? [witnessId, column.cells[1][1]] : [witnessId, cell]
				),
			})),
		});
		const split = collationState.splitWitnessesIntoNewReading(1, ['C']);
		if (!split.ok) throw new Error(split.error);
		collationState.setReadingType(1, split.readingId, 'apparent');
		const readings = collationState.peekReadingsForUnit(1);
		const alpha = readings.find(reading => reading.text === 'alpha')!;
		for (const reading of readings) {
			if (reading.id !== alpha.id)
				collationState.setReadingSource(1, reading.id, { kind: 'derived', from: alpha.id });
		}

		const xml = exportApparatusTei(exportInput());
		const document = parse(xml);
		const exported = Array.from(document.getElementsByTagName('rdg'));
		const graph = document.getElementsByTagName('graph')[0]!;

		expect(
			exported.map(reading => [
				reading.getAttribute('n'),
				reading.getAttribute('type'),
				reading.getAttribute('subtype'),
			])
		).toEqual([
			['a', null, null],
			['b1', null, null],
			['b2', 'split', 'apparent'],
			['c', 'om', null],
		]);
		expect(
			Array.from(graph.getElementsByTagName('node')).map(node => node.getAttribute('n'))
		).toEqual(['a', 'b1', 'b2', 'c']);
		expect(() => validateTeiP5(xml)).not.toThrow();
	}, 60_000);

	it('writes an ambiguous attestation as a witDetail after the readings, pointing at its targets, and validates as TEI P5', () => {
		const base = snapshot();
		collationState.reset();
		collationState.setWitnesses([
			witness('A', 'one alpha two', true),
			witness('B', 'one beta two'),
			witness('C', 'one beta two'),
			witness('D', 'one two'),
		]);
		collationState.setAlignmentSnapshot({
			...base,
			columns: base.columns.map(column => ({
				...column,
				cells: column.cells.map(([witnessId, cell]) =>
					witnessId === 'C' ? [witnessId, column.cells[1][1]] : [witnessId, cell]
				),
			})),
		});
		const readings = collationState.peekReadingsForUnit(1);
		const alpha = readings.find(reading => reading.text === 'alpha')!;
		const beta = readings.find(reading => reading.text === 'beta')!;
		for (const reading of readings) {
			if (reading.id !== alpha.id)
				collationState.setReadingSource(1, reading.id, { kind: 'derived', from: alpha.id });
		}
		const recorded = collationState.recordAmbiguousAttestation(1, ['C'], [beta.id, alpha.id]);
		if (!recorded.ok) throw new Error(recorded.error);

		const xml = exportApparatusTei(exportInput());
		const document = parse(xml);
		const app = document.getElementsByTagName('app')[0]!;
		const children = Array.from(app.childNodes)
			.filter(node => node.nodeType === 1)
			.map(node => (node as unknown as Element).tagName);
		const detail = document.getElementsByTagName('witDetail')[0]!;

		expect(app.getAttribute('xml:id')).toBe('unit-variant');
		expect(
			Array.from(document.getElementsByTagName('rdg')).map(reading => [
				reading.getAttribute('n'),
				reading.getAttribute('xml:id'),
				reading.getAttribute('wit'),
			])
		).toEqual([
			['a', 'unit-variant-a', '#wit-A'],
			['b', 'unit-variant-b', '#wit-B'],
			['c', null, '#wit-D'],
		]);
		expect(children).toEqual(['lem', 'rdg', 'rdg', 'rdg', 'witDetail', 'note']);
		expect(detail.getAttribute('type')).toBe('ambiguous');
		expect(detail.getAttribute('n')).toBe('zw-a/b');
		expect(detail.getAttribute('target')).toBe('#unit-variant-a #unit-variant-b');
		expect(detail.getAttribute('wit')).toBe('#wit-C');
		expect(() => validateTeiP5(xml)).not.toThrow();
	}, 60_000);

	it('emits valid xml:id values for numeric and punctuation-heavy identifiers', () => {
		const input = exportInput();
		const document = parse(
			exportApparatusTei({
				...input,
				segmentName: '123:1?!',
				witnesses: input.witnesses.map(entry =>
					entry.witnessId === 'A' ? { ...entry, witnessId: '123?!' } : entry
				),
				baseTextWitnessId: '123?!',
			})
		);
		const ids = Array.from(document.getElementsByTagName('*'))
			.map(node => node.getAttribute('xml:id'))
			.filter((id): id is string => Boolean(id));

		expect(ids.length).toBeGreaterThan(0);
		expect(ids.every(id => /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id))).toBe(true);
	});

	it('exports a multi-column declared unit as valid TEI P5', () => {
		collationState.setWitnesses([witness('A', 'one two', true), witness('B', 'one two')]);
		collationState.setAlignmentSnapshot({
			witnessOrder: ['A', 'B'],
			columns: ['one', 'two'].map((text, index) => ({
				id: `declared-${index}`,
				index,
				merged: false,
				cells: [
					['A', textCell(text)],
					['B', textCell(text)],
				],
			})),
		});
		expect(collationState.declareUnit(['declared-0', 'declared-1'])).toBe(true);
		const xml = exportApparatusTei(exportInput());
		expect(xml).toContain('<app ');
		expect(xml).toContain('one two');
		expect((xml.match(/<app /g) ?? []).length).toBe(1);
		expect(() => validateTeiP5(xml)).not.toThrow();
	}, 30_000);

	it('serializes the same apparatus from the editor state and from the saved document', () => {
		collationState.segment = { id: 'segment-1', name: 'John 1:1', members: ['John 1:1'] };
		const document = buildCollationDocument({
			collationId: collationState.collationId,
			projectId: collationState.projectId,
			projectName: collationState.projectName,
			phase: collationState.phase,
			furthestPhase: collationState.furthestPhase,
			segment: collationState.segment,
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

		expect(exportCollationDocumentTei(document)).toBe(
			exportApparatusTei({ ...exportInput(), title: 'Apatosaurus Collation' })
		);
	});
});
