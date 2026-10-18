import type { CbgmEngine, CoherenceSettings, ReadingRelation } from '@apatosaurus/open-cbgm-wasm';

import type { CbgmAnalysisSettings } from '$lib/storage/formats';

const UPSTREAM_TABLES = [
	'READINGS',
	'READING_RELATIONS',
	'READING_SUPPORT',
	'VARIATION_UNITS',
	'GENEALOGICAL_COMPARISONS',
	'WITNESSES',
];

export function nativeCommands(settings: CbgmAnalysisSettings): string {
	const populate = [
		'populate_db',
		...(settings.min_extant_units === null ? [] : ['-t', String(settings.min_extant_units)]),
		...settings.trivial_reading_types.flatMap(type => ['-z', type]),
		...settings.dropped_reading_types.flatMap(type => ['-Z', type]),
		...(settings.merge_split_readings ? ['--merge-splits'] : []),
		...(settings.classic_rules ? ['--classic'] : []),
		'input.xml',
		'cache.db',
	];
	const stemma = [
		'print_global_stemma',
		...settings.excluded_witnesses.flatMap(siglum => ['-e', siglum]),
		...(settings.min_extant_proportion === null
			? []
			: ['-p', String(settings.min_extant_proportion)]),
		'cache.db',
	];
	return [
		populate.map(shellWord).join(' '),
		stemma.map(shellWord).join(' '),
		'# Import cache.db into the analysis in Apatosaurus, and optionally global/global-stemma.dot.',
		'',
	].join('\n');
}

export function nativeCacheMismatch(
	engine: CbgmEngine,
	inputTei: string,
	settings: CoherenceSettings,
	cache: Uint8Array
): string | null {
	const expected = engine.prepare(inputTei, settings);
	let tables: string[];
	try {
		engine.open(cache, { excludedWitnesses: [], minExtantProportion: null });
		tables = engine.tables();
	} catch (error) {
		return `The file is not an open-cbgm database: ${error instanceof Error ? error.message : String(error)}`;
	}
	const missing = UPSTREAM_TABLES.find(table => !tables.includes(table));
	if (missing) return `The database has no ${missing} table.`;
	return (
		listMismatch('witness', expected.witnesses, engine.witnesses()) ??
		listMismatch(
			'variation unit',
			expected.units,
			engine.units().map(unit => unit.id)
		) ??
		relationMismatch(expected.relations, engine.relations())
	);
}

function relationMismatch(expected: ReadingRelation[], actual: ReadingRelation[]): string | null {
	const index = expected.findIndex(
		(relation, position) => !sameRelation(relation, actual[position])
	);
	const unit = index === -1 ? actual[expected.length]?.unit : expected[index].unit;
	return unit === undefined
		? null
		: `The database's local stemma of variation unit ${unit} differs from the frozen inputs and settings.`;
}

function sameRelation(left: ReadingRelation, right: ReadingRelation | undefined): boolean {
	return (
		left.unit === right?.unit &&
		left.prior === right.prior &&
		left.posterior === right.posterior &&
		left.weight === right.weight
	);
}

function listMismatch(kind: string, expected: string[], actual: string[]): string | null {
	const index = expected.findIndex((value, position) => actual[position] !== value);
	if (index === -1) {
		return actual.length > expected.length
			? `The database has ${kind} ${actual[expected.length]}, which the frozen inputs don't.`
			: null;
	}
	if (!actual.includes(expected[index])) return `The database has no ${kind} ${expected[index]}.`;
	if (!expected.includes(actual[index])) {
		return `The database has ${kind} ${actual[index]}, which the frozen inputs don't.`;
	}
	return `The database orders ${kind} ${actual[index]} differently from the frozen inputs.`;
}

function shellWord(word: string): string {
	return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}
