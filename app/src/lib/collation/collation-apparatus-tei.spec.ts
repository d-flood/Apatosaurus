import { DOMParser } from '@xmldom/xmldom';
import {
	createCbgmEngine,
	type CbgmEngine,
	type CoherenceSettings,
} from '@apatosaurus/open-cbgm-wasm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCbgmInput } from '$lib/cbgm/cbgm-input';
import {
	parseCollationPayloadTei,
	serializeCollationPayloadTei,
	type CollationPayload,
} from '$lib/storage/formats';
import { classicFixtures, stateFixture, type Fixture } from './__fixtures__/collation-fixtures';
import {
	compactSiglum,
	decodePersistentId,
	encodePersistentId,
	exportCollationDocumentTei,
	parseCollationApparatus,
	serializeCollationApparatus,
	type ApparatusLayer,
} from './collation-apparatus-tei';
import { buildApparatusTeiExportInput, getApparatusExportRefusals } from './collation-tei';
import { validateTeiP5, warmTeiP5Validator } from '../../../../test-support/validate-tei-p5';

beforeAll(() => warmTeiP5Validator(), 300_000);

vi.stubGlobal('DOMParser', DOMParser);

const cbgmDefaults: CoherenceSettings = {
	minExtantUnits: null,
	minExtantProportion: null,
	excludedWitnesses: [],
	classicRules: false,
	mergeSplitReadings: false,
	droppedReadingTypes: [],
	trivialReadingTypes: [],
	includedCorrectors: [],
};

let engine: CbgmEngine;

function expectCbgmAgreement(
	name: string,
	xml: string,
	document: Fixture['document'],
	vocab: Fixture['vocab']
) {
	const layer = parseCollationApparatus(xml);
	const mainOf = new Map(
		layer.units.flatMap(unit => {
			const labelOf = new Map(unit.readings.map(reading => [reading.id, reading.label]));
			return unit.readings
				.filter(reading => reading.parentReadingId !== null)
				.map(reading => [
					`${unit.id}/${reading.label}`,
					labelOf.get(reading.parentReadingId!)!,
				]);
		})
	);
	const main = (unit: string, label: string) => mainOf.get(`${unit}/${label}`) ?? label;
	const correctors = document.setup.witnesses
		.filter(entry => entry.kind === 'corrector')
		.map(entry => entry.siglum);
	const settings = { ...cbgmDefaults, includedCorrectors: correctors };
	const cbgmTei = buildCbgmInput([document], settings, vocab.manualWitnesses).tei!;
	expect(cbgmTei, name).not.toBeNull();

	const expected = cohere(cbgmTei, settings);
	const actual = cohere(xml, {
		...settings,
		droppedReadingTypes: ['lac', 'ambiguous', 'overlap'],
	});

	expect(actual.witnesses, name).toEqual(expected.witnesses);
	for (const [id, unit] of expected.units) {
		const written = actual.units.get(id);
		expect(written, `${name} ${id}`).toBeDefined();
		expect({
			label: written!.label,
			readings: written!.readings.filter(label => main(id, label) === label),
			connectivity: written!.connectivity,
			attestations: Object.fromEntries(
				Object.entries(written!.attestations).map(([siglum, label]) => [
					siglum,
					main(id, label),
				])
			),
		}).toEqual({
			label: unit.label,
			readings: unit.readings,
			connectivity: unit.connectivity,
			attestations: unit.attestations,
		});
	}
	expect(
		actual.relations
			.filter(relation => expected.units.has(relation.unit))
			.filter(relation => main(relation.unit, relation.posterior) === relation.posterior)
	).toEqual(expected.relations);
	for (const [id, unit] of actual.units)
		if (!expected.units.has(id))
			expect(
				unit.readings.filter(label => main(id, label) === label).length,
				`${name} ${id}`
			).toBeLessThan(2);
}

function collationPayload(document: Fixture['document']): CollationPayload {
	return {
		id: document.meta.collationId ?? 'col-1',
		project_id: document.meta.projectId ?? 'project-1',
		title: document.setup.segment.name,
		verse_identifier: document.setup.segment.name,
		status: 'complete',
		group_path: '',
		notes: '',
		sort_key: 0,
		document: document as CollationPayload['document'],
		based_on_checkpoint: { id: 'cp-1', content_hash: 'sha256:cp' },
		draft: { saved_at: '2026-07-04T12:00:00.000Z', author_name: null },
		created_at: '2026-07-04T00:00:00.000Z',
		updated_at: '2026-07-04T12:00:00.000Z',
	};
}

function cohere(tei: string, settings: CoherenceSettings) {
	const prepared = engine.prepare(tei, settings);
	engine.open(
		engine.assemble(
			new Map(prepared.witnesses.map(siglum => [siglum, engine.computeWitness(siglum)]))
		),
		{ excludedWitnesses: [], minExtantProportion: null }
	);
	const units = engine.units();
	return {
		witnesses: prepared.witnesses,
		relations: prepared.relations,
		units: new Map(
			units.map(unit => {
				const table = engine.findRelatives(prepared.witnesses[0], unit.id, []);
				const attestations: Record<string, string> = Object.fromEntries([
					[table.primary_wit, table.primary_rdg],
					...table.rows.map(row => [row.id, row.rdg]),
				]);
				return [
					unit.id,
					{ ...unit, connectivity: table.connectivity, attestations },
				] as const;
			})
		),
	};
}

function completed(fixture: Fixture): boolean {
	return (
		getApparatusExportRefusals(buildApparatusTeiExportInput(fixture.document, fixture.vocab))
			.length === 0
	);
}

function expectRoundTrip(fixture: Fixture, layer: ApparatusLayer) {
	const { document, vocab } = fixture;
	const input = buildApparatusTeiExportInput(document, vocab);
	expect(layer.witnesses).toEqual(
		input.witnesses
			.filter(entry => !entry.isExcluded)
			.map(entry => ({
				id: entry.witnessId,
				siglum: compactSiglum(entry.siglum),
				isManual: (vocab.manualWitnesses ?? []).some(
					manual => manual.id === entry.witnessId
				),
			}))
	);
	const manualIds = new Set(
		layer.witnesses.filter(entry => entry.isManual).map(entry => entry.id)
	);
	const unitsById = new Map(layer.units.map(unit => [unit.unitId, unit] as const));

	for (const saved of document.apparatus?.units ?? []) {
		const unit = unitsById.get(saved.unitId);
		expect(unit, `${fixture.name} ${saved.unitId}`).toBeDefined();
		const readingById = new Map(unit!.readings.map(reading => [reading.id, reading] as const));
		const decisions = saved.decisions;
		const overlapped = new Set(unit!.overlaps.map(overlap => overlap.witnessId));
		for (const stored of saved.readings.filter(reading => !reading.isLacuna)) {
			const parsed = readingById.get(stored.id);
			expect(parsed, `${fixture.name} ${stored.id}`).toBeDefined();
			expect({
				text: parsed!.text,
				isOmission: parsed!.isOmission,
				witnessIds: parsed!.witnessIds.filter(id => !manualIds.has(id)),
				parentReadingId: parsed!.parentReadingId,
			}).toEqual({
				text: stored.isOmission ? null : (stored.text?.trim() ?? ''),
				isOmission: stored.isOmission,
				witnessIds: [...new Set(stored.witnessIds)].filter(id => !overlapped.has(id)),
				parentReadingId:
					decisions.subreadingOf && stored.id in decisions.subreadingOf
						? decisions.subreadingOf[stored.id]
						: stored.parentReadingId,
			});
		}
		for (const authored of decisions.authoredReadings ?? [])
			expect(readingById.get(authored.id)).toMatchObject({
				text: authored.isOmission ? null : authored.text,
				isOmission: authored.isOmission,
			});
		if (decisions.lemmaReadingId) expect(unit!.lemmaReadingId).toBe(decisions.lemmaReadingId);
		for (const [id, type] of Object.entries(decisions.readingType ?? {}))
			if (!readingById.get(id)?.isOmission)
				expect(readingById.get(id)?.readingType, id).toBe(type);
		for (const [id, tags] of Object.entries(decisions.readingTags ?? {}))
			expect(readingById.get(id)?.readingTags).toEqual(tags);
		for (const [id, note] of Object.entries(decisions.readingNotes ?? {}))
			expect(readingById.get(id)?.note).toBe(note);
		for (const [id, certainty] of Object.entries(decisions.certainty ?? {}))
			expect(readingById.get(id)?.certainty).toBe(certainty);
		for (const [id, parent] of Object.entries(decisions.subreadingOf ?? {}))
			expect(readingById.get(id)?.parentReadingId).toBe(parent);
		expect(unit!.ambiguousAttestations).toEqual(decisions.ambiguousAttestations ?? []);
	}
	for (const saved of document.stemma?.units ?? []) {
		const unit = unitsById.get(saved.unitId)!;
		expect(new Set(unit.arcs.map(arc => JSON.stringify(arc)))).toEqual(
			new Set(
				saved.arcs.map(arc =>
					JSON.stringify({
						id: arc.id,
						priorReadingId: arc.priorReadingId,
						posteriorReadingId: arc.posteriorReadingId,
					})
				)
			)
		);
		expect(unit.connectivity).toBe(saved.connectivity ?? 10);
	}
	const vocabulary = new Map(
		[...(vocab.readingTypes ?? [])].map(type => [type.id, type] as const)
	);
	for (const type of layer.readingTypes) {
		const defined = vocabulary.get(type.id);
		if (defined) expect(type).toEqual(defined);
	}
	for (const tag of layer.readingTags) expect(vocab.readingTags).toContainEqual(tag);
}

describe('collation apparatus TEI', () => {
	beforeAll(async () => {
		engine = await createCbgmEngine();
	}, 120_000);

	it('encodes reading and witness ids reversibly into XML-safe values', () => {
		for (const id of ['col::λογος::00\u0001x\u0002y', 'unit:a..b', '7f3e', 'a b"<&>']) {
			const encoded = encodePersistentId(id);
			expect(encoded).toMatch(/^[\x21-\x7e]+$/);
			expect(encoded).not.toMatch(/["<>&]/);
			expect(decodePersistentId(encoded)).toBe(id);
		}
		expect(compactSiglum('01 C1')).toBe('01C1');
	});

	it('round-trips the apparatus and stemma of classic and collation-state fixtures deterministically', async () => {
		const fixtures = [...classicFixtures(), await stateFixture()];
		expect(fixtures.length).toBeGreaterThan(10);
		for (const fixture of fixtures) {
			const xml = serializeCollationApparatus(fixture.document, fixture.vocab);
			expect(serializeCollationApparatus(fixture.document, fixture.vocab)).toBe(xml);
			expect(xml.endsWith('</TEI>\n')).toBe(true);
			expect(xml).not.toContain('\r');
			for (const [, id] of xml.matchAll(/xml:id="([^"]*)"/g))
				expect(id).toMatch(/^[A-Za-z_][\w.-]*$/);
			expect(xml).toBe(xml.normalize('NFC'));
			expectRoundTrip(fixture, parseCollationApparatus(xml));
		}
	});

	it('is read by open-cbgm as written, agreeing with the CBGM input', async () => {
		const fixtures = [...classicFixtures(), await stateFixture()].filter(completed);
		expect(fixtures.map(fixture => fixture.name)).toContain('collation state');
		expect(fixtures.length).toBeGreaterThan(8);
		for (const fixture of fixtures) {
			expectCbgmAgreement(
				fixture.name,
				exportCollationDocumentTei(fixture.document, fixture.vocab),
				fixture.document,
				fixture.vocab
			);
		}
	});

	it('reads the canonical file as written in open-cbgm, agreeing with its parsed CBGM input', async () => {
		const fixtures = [...classicFixtures(), await stateFixture()].filter(completed);
		for (const fixture of fixtures) {
			const { xml } = await serializeCollationPayloadTei(
				collationPayload(fixture.document),
				fixture.vocab
			);
			const parsed = parseCollationPayloadTei(xml).document;
			expect(xml.slice(xml.indexOf('<standOff')), fixture.name).not.toContain('<app');
			expectCbgmAgreement(fixture.name, xml, parsed, fixture.vocab);
		}
	});

	it('validates as TEI P5 with tags, notes and every kind of testimony', async () => {
		const { document, vocab } = await stateFixture();
		await expect(
			validateTeiP5(serializeCollationApparatus(document, vocab, 'Verse note'))
		).resolves.toBeUndefined();
	}, 120_000);

	it('validates as TEI P5 with an imported reading-type taxonomy', async () => {
		const { document, vocab } = classicFixtures().find(fixture =>
			fixture.name.startsWith('editorial')
		)!;
		await expect(
			validateTeiP5(serializeCollationApparatus(document, vocab))
		).resolves.toBeUndefined();
	}, 120_000);

	it('writes overlapped testimony as a witDetail pointing at the spanning reading', async () => {
		const { document, vocab } = await stateFixture();
		const layer = parseCollationApparatus(serializeCollationApparatus(document, vocab));
		const outer = layer.units.find(unit => unit.unitId === 'unit:one..variant')!;
		const long = outer.readings.find(reading => reading.text?.startsWith('uno'))!;
		expect(layer.units.find(unit => unit.unitId === 'unit:variant')!.overlaps).toEqual([
			{ witnessId: 'w:G', targets: [{ unitId: outer.unitId, readingId: long.id }] },
		]);
	});

	it('writes corrector sigla without spaces in the apparatus and the CBGM input', async () => {
		const { document, vocab } = await stateFixture();
		const xml = serializeCollationApparatus(document, vocab);
		expect(xml).toContain('<witness n="Bc"');
		expect(xml).not.toMatch(/n="B c"/);
		const input = buildCbgmInput([document], { ...cbgmDefaults, includedCorrectors: ['Bc'] });
		expect(input.availableCorrectors).toEqual(['Bc']);
		expect(input.witnesses).toContain('Bc');
		expect(input.tei).toMatch(/wit="[^"]*\bBc\b/);
	});

	it('keeps reading ids when a relabel changes every label', async () => {
		const { document, vocab } = await stateFixture();
		const before = parseCollationApparatus(serializeCollationApparatus(document, vocab));
		const unit = document.apparatus!.units.find(entry => entry.unitId === 'unit:variant')!;
		const beta = before.units
			.find(entry => entry.unitId === 'unit:variant')!
			.readings.find(reading => reading.text === 'beta')!;
		unit.decisions.lemmaReadingId = beta.id;
		const after = parseCollationApparatus(serializeCollationApparatus(document, vocab));
		const relabelled = after.units
			.find(entry => entry.unitId === 'unit:variant')!
			.readings.find(reading => reading.id === beta.id)!;
		expect(relabelled.label).not.toBe(beta.label);
		expect(relabelled).toMatchObject({ note: 'Reading & note', certainty: 'medium' });
	});
});
