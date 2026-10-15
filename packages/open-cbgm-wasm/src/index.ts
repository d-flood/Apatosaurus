import createOpenCbgmModule from '../dist/open-cbgm.js';

export type CoherenceSettings = {
	minExtantUnits: number | null;
	minExtantProportion: number | null;
	excludedWitnesses: string[];
	classicRules: boolean;
	mergeSplitReadings: boolean;
	droppedReadingTypes: string[];
	includedCorrectors: string[];
};

export type UndecidedReading = { unit: string; reading: string };

export type CompareWitnessesRow = {
	id: string;
	dir: number;
	nr: string;
	pass: number;
	eq: number;
	perc: number;
	prior: number;
	posterior: number;
	norel: number;
	uncl: number;
	undecided: number;
	expl: number;
	cost: string;
};

export type CompareWitnessesTable = {
	primary_wit: string;
	primary_extant: number;
	rows: CompareWitnessesRow[];
};

export type FindRelativesRow = CompareWitnessesRow & { rdg: string };

export type FindRelativesTable = {
	primary_wit: string;
	primary_extant: number;
	label: string;
	connectivity: number;
	primary_rdg: string;
	rows: FindRelativesRow[];
};

export type OptimizeSubstemmataTable = {
	primary_wit: string;
	primary_extant: number;
	rows: { ancestors: string[]; cost: number; agreements: number }[];
};

export interface CbgmEngine {
	prepare(
		inputTei: string,
		settings: CoherenceSettings
	): { witnesses: string[]; units: string[] };
	computeWitness(siglum: string): Uint8Array;
	assemble(rowsBySiglum: Map<string, Uint8Array>): Uint8Array;
	open(
		cache: Uint8Array,
		filter: { excludedWitnesses: string[]; minExtantProportion: number | null }
	): void;
	witnesses(): string[];
	units(): { id: string; label: string; readings: string[] }[];
	tables(): string[];
	compareWitnesses(
		primary: string,
		others: string[],
		undecided?: UndecidedReading[]
	): CompareWitnessesTable;
	findRelatives(
		witness: string,
		unit: string,
		readings: string[],
		undecided?: UndecidedReading[]
	): FindRelativesTable;
	optimizeSubstemmata(
		witness: string,
		maxCost?: number
	): OptimizeSubstemmataTable | { kind: 'no-potential-ancestors' } | { kind: 'no-data' };
	textualFlow(
		unit: string,
		kind: 'flow' | 'attestations' | 'variants',
		opts: { connectivityLimit?: number; strengths: boolean }
	): string;
	optimizeSubstemma(witness: string): string[] | null;
	writeSubstemmata(
		cache: Uint8Array,
		rows: { witness: string; ancestors: string[]; completedAt: string }[]
	): Uint8Array;
	readSubstemmata(cache: Uint8Array): Map<string, string[]>;
	globalStemma(
		substemmata: Map<string, string[]>,
		opts: { strengths: boolean; lengths: boolean }
	): string;
}

export type CbgmEngineOptions = {
	wasmBinary?: Uint8Array;
	locateFile?: (name: string) => string;
};

function unwrap<T>(result: T | Error): T {
	if (result instanceof Error) throw result;
	return result;
}

function splitUndecided(result: { table: string; undecided: Record<string, number> }) {
	const table = JSON.parse(result.table);
	for (const row of table.rows) {
		row.undecided = result.undecided[row.id];
		row.uncl -= row.undecided;
	}
	return table;
}

export async function createCbgmEngine(options: CbgmEngineOptions = {}): Promise<CbgmEngine> {
	const module = await createOpenCbgmModule({ ...options });
	return {
		prepare: (inputTei, settings) =>
			unwrap(
				module.prepare(
					inputTei,
					settings.minExtantUnits ?? 0,
					settings.droppedReadingTypes,
					settings.mergeSplitReadings,
					settings.classicRules
				)
			),
		computeWitness: siglum => unwrap(module.computeWitness(siglum)),
		assemble: rowsBySiglum => unwrap(module.assemble(rowsBySiglum)),
		open: (cache, filter) => {
			unwrap(module.open(cache, filter.excludedWitnesses, filter.minExtantProportion ?? 0));
		},
		witnesses: () => unwrap(module.witnesses()),
		units: () => unwrap(module.units()),
		tables: () => unwrap(module.tables()),
		compareWitnesses: (primary, others, undecided = []) =>
			splitUndecided(unwrap(module.compareWitnesses(primary, others, undecided))),
		findRelatives: (witness, unit, readings, undecided = []) =>
			splitUndecided(unwrap(module.findRelatives(witness, unit, readings, undecided))),
		optimizeSubstemmata: (witness, maxCost) =>
			JSON.parse(unwrap(module.optimizeSubstemmata(witness, maxCost ?? 0))),
		textualFlow: (unit, kind, opts) =>
			unwrap(module.textualFlow(unit, kind, opts.connectivityLimit, opts.strengths)),
		optimizeSubstemma: witness => unwrap(module.optimizeSubstemma(witness)),
		writeSubstemmata: (cache, rows) =>
			unwrap(
				module.writeSubstemmata(
					cache,
					rows.map(row => [row.witness, JSON.stringify(row.ancestors), row.completedAt])
				)
			),
		readSubstemmata: cache =>
			new Map(
				unwrap(module.readSubstemmata(cache)).map(([witness, ancestors]: string[]) => [
					witness,
					JSON.parse(ancestors),
				])
			),
		globalStemma: (substemmata, opts) =>
			unwrap(module.globalStemma(substemmata, opts.lengths, opts.strengths)),
	};
}
