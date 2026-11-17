import { DOMParser } from '@xmldom/xmldom';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { COLLATION_FIXTURE } from '$lib/storage/formats/payload-fixtures';
import {
	classicFixtures,
	generatedFixture,
	stateFixture,
	stateLoadFixtures,
	type Fixture,
} from './__fixtures__/collation-fixtures';
import { parseCollationApparatus } from './collation-apparatus-tei';
import { parseCollationTei, serializeCollationTei } from './collation-document-tei';
import { buildApparatusTeiExportInput } from './collation-tei';
import { validateTeiP5, warmTeiP5Validator } from '../../../../test-support/validate-tei-p5';

beforeAll(() => warmTeiP5Validator(), 300_000);

vi.stubGlobal('DOMParser', DOMParser);

async function expectRoundTrip({ name, document, vocab }: Fixture) {
	const saved = await serializeCollationTei(document, vocab);
	const parsed = parseCollationTei(saved.xml);
	expect(parsed, name).toEqual(document);
	expect((await serializeCollationTei(parsed, vocab)).xml, name).toBe(saved.xml);
	expect(saved.xml, name).not.toMatch(/[[{]"/);
	for (const [, id] of saved.xml.matchAll(/xml:id="([^"]*)"/g))
		expect(id).toMatch(/^[A-Za-z_][\w.-]*$/);
	return saved;
}

describe('collation TEI', () => {
	it('round-trips the classic-import fixtures', async () => {
		const fixtures = classicFixtures();
		expect(fixtures.length).toBeGreaterThan(10);
		for (const fixture of fixtures) await expectRoundTrip(fixture);
	});

	it('round-trips the collation-state fixtures', async () => {
		await expectRoundTrip(await stateFixture());
		for (const fixture of stateLoadFixtures()) await expectRoundTrip(fixture);
		const { flow: _, ...document } = COLLATION_FIXTURE.document;
		await expectRoundTrip({ name: 'empty payload fixture', document, vocab: {} });
	});

	it('round-trips a generated 100-witness collation with every decision kind', async () => {
		const fixture = generatedFixture();
		const { document } = fixture;
		expect(document.setup.witnesses).toHaveLength(100);
		expect(document.alignment!.columns.some(column => column.splitInto?.length)).toBe(true);
		const unit = document.apparatus!.units.find(entry => entry.unitId === 'unit:variant')!;
		expect(Object.keys(unit.decisions).sort()).toEqual(
			[
				'ambiguousAttestations',
				'authoredReadings',
				'certainty',
				'lemmaReadingId',
				'manualTestimony',
				'overlapResolutions',
				'readingNotes',
				'readingTags',
				'readingType',
				'sourceDecision',
				'spanningReadingIds',
				'subreadingOf',
				'unconfirmedWitnessIds',
				'unresolvedAttestations',
			].sort()
		);
		expect(document.apparatus!.units.map(entry => entry.unitId)).toContain('unit:orphaned');
		const { xml } = await expectRoundTrip(fixture);
		expect(xml).toContain('<f name="type"><symbol value="nomenSacrum"/></f>');
		expect(xml).toContain('<g type="char" n="U+0007"/>');
		expect(xml).toMatch(/<seg [^>]*ana="#rule-rule_3a.accents"[^>]*><choice><orig>/);
		expect(parseCollationApparatus(xml).units.length).toBeGreaterThan(0);
	});

	it('keeps decisions on NFD reading ids attached after a round-trip', async () => {
		const { document, vocab } = await stateFixture();
		const json = JSON.stringify(document);
		const nfd = JSON.parse(json.replaceAll('beta', 'a\u0301'));
		const parsed = parseCollationTei((await serializeCollationTei(nfd, vocab)).xml);
		expect(parsed).toEqual(JSON.parse(json.replaceAll('beta', '\u00e1')));
		const readings = [...buildApparatusTeiExportInput(parsed, vocab).units.values()].flatMap(
			unit => unit.view.readings
		);
		expect(readings.find(reading => reading.text === '\u00e1')).toMatchObject({
			note: 'Reading & note',
			readingType: 'apparent',
			readingTags: [expect.any(String)],
		});
	});

	it('validates as TEI P5 with both layers', async () => {
		const { document, vocab } = generatedFixture();
		const { xml } = await serializeCollationTei(document, vocab, {
			notes: 'Verse note',
			changes: [
				{ type: 'created', when: '2026-11-01T00:00:00.000Z' },
				{ type: 'saved', when: '2026-11-02T00:00:00.000Z', author: 'Editor' },
			],
		});
		await expect(validateTeiP5(xml)).resolves.toBeUndefined();
	}, 120_000);

	it('writes no workflow block and reads a legacy one only as view state', async () => {
		const { document, vocab } = await stateFixture();
		const current = await serializeCollationTei(document, vocab);
		expect(current.xml).not.toContain('type="workflow"');
		const legacyXml = current.xml.replace(
			'</standOff>',
			'<fs type="workflow"><f name="phase"><string>readings</string></f>' +
				'<f name="furthestPhase"><string>stemma</string></f>' +
				'<f name="alignmentDisplayMode"><string>original</string></f>' +
				'<f name="alignmentLayout"><string>variation-units</string></f></fs></standOff>'
		);
		const legacy = parseCollationTei(legacyXml);
		expect(legacy.flow).toEqual({
			phase: 'readings',
			alignmentDisplayMode: 'original',
			alignmentLayout: 'variation-units',
		});
		const { flow: _, ...content } = legacy;
		expect(content).toEqual(parseCollationTei(current.xml));
		const resaved = await serializeCollationTei(legacy, vocab);
		expect(resaved.xml).toBe(current.xml);
		expect(resaved.contentHash).toBe(current.contentHash);
	});

	it('keeps the content hash when only save metadata or a Version note changes', async () => {
		const { document, vocab } = await stateFixture();
		const saved = (when: string, note?: string) =>
			serializeCollationTei(document, vocab, {
				changes: [
					{ type: 'saved', when, author: 'Editor' },
					{ type: 'version', when: '2026-11-01T00:00:00.000Z', note },
				],
			});
		const first = await saved('2026-11-02T00:00:00.000Z', 'First note');
		const later = await saved('2026-11-03T00:00:00.000Z', 'Edited note');
		expect(later.fileHash).not.toBe(first.fileHash);
		expect(later.contentHash).toBe(first.contentHash);
		expect(later.contentHash).toBe((await serializeCollationTei(document, vocab)).contentHash);
		document.settings.lowercase = !document.settings.lowercase;
		const edited = await saved('2026-11-02T00:00:00.000Z', 'First note');
		expect(edited.contentHash).not.toBe(first.contentHash);
	});
});
