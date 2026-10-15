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
	expl: number;
	cost: string;
};

export type CompareWitnessesTable = {
	primary_wit: string;
	primary_extant: number;
	rows: CompareWitnessesRow[];
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
	compareWitnesses(primary: string, others: string[]): CompareWitnessesTable;
}

export type CbgmEngineOptions = {
	wasmBinary?: Uint8Array;
	locateFile?: (name: string) => string;
};

function unwrap<T>(result: T | Error): T {
	if (result instanceof Error) throw result;
	return result;
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
		compareWitnesses: (primary, others) =>
			JSON.parse(unwrap(module.compareWitnesses(primary, others))),
	};
}
