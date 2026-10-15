import type { CoherenceSettings, UndecidedReading } from '@apatosaurus/open-cbgm-wasm';

export type SubstemmaRow = { witness: string; ancestors: string[]; completedAt: string };

export type CbgmWorkerRequest =
	| { type: 'prepare'; inputTei: string; settings: CoherenceSettings }
	| { type: 'open'; cache: Uint8Array; settings: CoherenceSettings }
	| { type: 'compute-witness'; siglum: string }
	| { type: 'optimize-substemma'; siglum: string }
	| { type: 'assemble'; rows: Map<string, Uint8Array> }
	| { type: 'write-substemmata'; cache: Uint8Array; rows: SubstemmaRow[] };

export type CbgmWorkerResponse = { ok: true; result: unknown } | { ok: false; error: string };

export type CbgmQueryRequest =
	| {
			type: 'open';
			cache: Uint8Array;
			filter: { excludedWitnesses: string[]; minExtantProportion: number | null };
	  }
	| {
			type: 'compare-witnesses';
			primary: string;
			others: string[];
			undecided: UndecidedReading[];
	  }
	| {
			type: 'find-relatives';
			witness: string;
			unit: string;
			readings: string[];
			undecided: UndecidedReading[];
	  }
	| { type: 'optimize-substemmata'; witness: string; maxCost?: number };

export type CbgmQueryResponse = { id: number } & CbgmWorkerResponse;
