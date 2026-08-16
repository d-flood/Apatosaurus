import { DOMParser } from '@xmldom/xmldom';
import type { Document as XmlDocument } from '@xmldom/xmldom';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	exportApparatusTei,
	getApparatusExportRefusals,
	type ApparatusTeiExportInput,
	type ApparatusTeiUnit,
} from './collation-tei';
import { collationState, type WitnessConfig } from './collation-state.svelte';
import { variationUnitId } from './collation-unit-id';
import type { AlignmentCell, AlignmentSnapshot } from './alignment-snapshot';
import type { WitnessSourceToken } from './collation-types';
import { validateTeiP5 } from '../../../../../test-support/validate-tei-p5';

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
		sourceVersion: 'v1',
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
		const unitId = variationUnitId(segment.span.columnIds[0]);
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
	collationState.setReadingSource(1, alpha.id, { kind: 'unclear' });
	collationState.setReadingSource(1, omission.id, { kind: 'derived', from: alpha.id });
}

function parse(xml: string): XmlDocument {
	const document = new DOMParser().parseFromString(xml, 'application/xml');
	expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
	return document;
}

function hasWitness(element: Element, witnessId: string): boolean {
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
	}, 30_000);

	it('serializes flat subreadings, omission, non-attestation, and local-stemma decisions', () => {
		const document = parse(exportApparatusTei(exportInput()));
		const readings = Array.from(document.getElementsByTagName('rdg'));
		const lemma = document.getElementsByTagName('lem')[0]!;
		const graph = document.getElementsByTagName('graph')[0]!;

		expect(document.getElementsByTagName('rdgGrp')).toHaveLength(0);
		expect(readings.map(reading => reading.getAttribute('n'))).toEqual(['a', 'a1', 'b', 'zz']);
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
		expect(graph.getElementsByTagName('node').item(0)?.getAttribute('n')).not.toBe('a1');
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
		const unitId = variationUnitId(unit.span.columnIds[0]);
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
	}, 30_000);

	it('adds basetext to the lemma only when the base text actually attests it', () => {
		const readings = collationState.peekReadingsForUnit(1);
		const beta = readings.find(reading => reading.text === 'beta')!;
		collationState.setReadingParent(1, beta.id, null);
		collationState.setLemmaReading(1, beta.id);
		collationState.setReadingSource(1, beta.id, { kind: 'unclear' });

		const lemmaWitnesses = parse(exportApparatusTei(exportInput()))
			.getElementsByTagName('lem')[0]!
			.getAttribute('wit');
		expect(lemmaWitnesses).toContain('#wit-B');
		expect(lemmaWitnesses).not.toContain('#basetext');
	});

	it('does not serialize a proposed reading type as an editorial claim', () => {
		const input = exportInput();
		const unit = input.segments.find(segment => segment.kind === 'unit')!;
		const unitId = variationUnitId(unit.span.columnIds[0]);
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

	it('refuses undecided sources, untranscribed witnesses, and missing lemma decisions by unit', () => {
		const undecided = exportInput();
		const unit = undecided.segments.find(segment => segment.kind === 'unit')!;
		const unitId = variationUnitId(unit.span.columnIds[0]);
		const undecidedUnit = undecided.units.get(unitId)!;
		undecidedUnit.stemma.nodes[0]!.sourceDecision = { kind: 'undecided' };

		expect(getApparatusExportRefusals(undecided)).toEqual(
			expect.arrayContaining([expect.objectContaining({ kind: 'undecided-source', unitId })])
		);
		expect(() => exportApparatusTei(undecided)).toThrow('unit 4 has undecided sources');

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
		const incompleteUnitId = variationUnitId(incompleteUnit.span.columnIds[0]);
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
});
