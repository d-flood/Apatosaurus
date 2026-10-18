import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { CbgmEngine, CoherenceSettings } from '../src/index';

export const inputTei = readFileSync(
	new URL(
		'../vendor/open-cbgm-standalone/lib/open-cbgm/examples/3_john_collation.xml',
		import.meta.url
	),
	'utf8'
);

export const defaults: CoherenceSettings = {
	minExtantUnits: null,
	minExtantProportion: null,
	excludedWitnesses: [],
	classicRules: false,
	mergeSplitReadings: false,
	droppedReadingTypes: [],
	trivialReadingTypes: [],
	includedCorrectors: [],
};

export const runs = [
	{ fixture: 'default', settings: defaults },
	{ fixture: 'classic', settings: { ...defaults, classicRules: true } },
	{
		fixture: 'dropped-ambiguous-merge-splits',
		settings: { ...defaults, droppedReadingTypes: ['ambiguous'], mergeSplitReadings: true },
	},
	{
		fixture: 'trivial-defective-orthographic',
		settings: { ...defaults, trivialReadingTypes: ['defective', 'orthographic'] },
	},
];

export const unfiltered = { excludedWitnesses: [], minExtantProportion: null };

export function readFixture(fixture: string, name: string) {
	return readFileSync(new URL(`fixtures/${fixture}/${name}`, import.meta.url));
}

export function readJsonFixture(fixture: string, name: string) {
	return JSON.parse(readFixture(fixture, name).toString('utf8'));
}

export function expectedTable(fixture: string, name: string) {
	const table = readJsonFixture(fixture, name);
	return { ...table, rows: table.rows.map((row: object) => ({ ...row, undecided: 0 })) };
}

export function computeCache(engine: CbgmEngine, settings: CoherenceSettings) {
	const { witnesses } = engine.prepare(inputTei, settings);
	return engine.assemble(
		new Map(witnesses.map(siglum => [siglum, engine.computeWitness(siglum)]))
	);
}

export function sha256(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

export function comparisonDigest(blobs: Uint8Array[], cost: number) {
	const hash = createHash('sha256');
	for (const blob of blobs) {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(blob.length);
		hash.update(length).update(blob);
	}
	const costBytes = Buffer.alloc(8);
	costBytes.writeDoubleBE(cost);
	return hash.update(costBytes).digest('hex').slice(0, 16);
}

export function queryCache<T>(cache: Uint8Array, query: (rows: (sql: string) => unknown[][]) => T) {
	const dir = mkdtempSync(join(tmpdir(), 'open-cbgm-'));
	const path = join(dir, 'cache.db');
	writeFileSync(path, cache);
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		return query(sql =>
			db
				.prepare(sql)
				.all()
				.map(row => Object.values(row))
		);
	} finally {
		db.close();
		rmSync(dir, { recursive: true });
	}
}

export function dumpTables(cache: Uint8Array) {
	return queryCache(cache, rows => ({
		READINGS: rows('SELECT ROW_ID, VARIATION_UNIT, READING FROM READINGS ORDER BY ROW_ID'),
		READING_RELATIONS: rows(
			'SELECT ROW_ID, VARIATION_UNIT, PRIOR, POSTERIOR, WEIGHT FROM READING_RELATIONS ORDER BY ROW_ID'
		),
		READING_SUPPORT: rows(
			'SELECT ROW_ID, VARIATION_UNIT, WITNESS, READING FROM READING_SUPPORT ORDER BY ROW_ID'
		),
		VARIATION_UNITS: rows(
			'SELECT ROW_ID, VARIATION_UNIT, LABEL, CONNECTIVITY FROM VARIATION_UNITS ORDER BY ROW_ID'
		),
		WITNESSES: rows('SELECT ROW_ID, WITNESS FROM WITNESSES ORDER BY ROW_ID'),
		GENEALOGICAL_COMPARISONS: rows(
			`SELECT ROW_ID, PRIMARY_WIT, SECONDARY_WIT, EXTANT, AGREEMENTS, PRIOR, POSTERIOR, NOREL, UNCLEAR,
				EXPLAINED, COST FROM GENEALOGICAL_COMPARISONS ORDER BY ROW_ID`
		).map(([rowId, primary, secondary, ...rest]) => [
			rowId,
			primary,
			secondary,
			comparisonDigest(rest.slice(0, 7) as Uint8Array[], rest[7] as number),
		]),
	}));
}

export function shuffled<T>(items: T[]) {
	const result = [...items];
	let seed = 20260101;
	for (let i = result.length - 1; i > 0; i--) {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		const j = seed % (i + 1);
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}
