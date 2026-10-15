import type { CoherenceSettings } from '@apatosaurus/open-cbgm-wasm';

export type SubstemmaRow = { witness: string; ancestors: string[]; completedAt: string };

export type CbgmWorkerRequest =
	| { type: 'prepare'; inputTei: string; settings: CoherenceSettings }
	| { type: 'open'; cache: Uint8Array; settings: CoherenceSettings }
	| { type: 'compute-witness'; siglum: string }
	| { type: 'optimize-substemma'; siglum: string }
	| { type: 'assemble'; rows: Map<string, Uint8Array> }
	| { type: 'write-substemmata'; cache: Uint8Array; rows: SubstemmaRow[] };

export type CbgmWorkerResponse = { ok: true; result: unknown } | { ok: false; error: string };
