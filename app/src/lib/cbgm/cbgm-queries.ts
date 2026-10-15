import type {
	CbgmEngine,
	CompareWitnessesTable,
	FindRelativesTable,
} from '@apatosaurus/open-cbgm-wasm';

import type { CbgmAnalysisMetadata } from '$lib/storage/formats';
import type { CbgmQueryRequest, CbgmQueryResponse } from './cbgm-worker-types';

export type CbgmUnit = ReturnType<CbgmEngine['units']>[number];
export type OptimizeSubstemmataResult = ReturnType<CbgmEngine['optimizeSubstemmata']>;

export type CbgmQueries = {
	witnesses: string[];
	units: CbgmUnit[];
	compareWitnesses(primary: string, others: string[]): Promise<CompareWitnessesTable>;
	findRelatives(witness: string, unit: string, readings: string[]): Promise<FindRelativesTable>;
	optimizeSubstemmata(witness: string, maxCost?: number): Promise<OptimizeSubstemmataResult>;
	close(): void;
};

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export async function openCbgmQueries(
	analysis: CbgmAnalysisMetadata,
	cache: Uint8Array,
	worker: Worker = new Worker(new URL('./cbgm-query.worker.ts', import.meta.url), {
		type: 'module',
	})
): Promise<CbgmQueries> {
	const pending = new Map<number, Pending>();
	let nextId = 0;
	worker.onmessage = ({ data }: MessageEvent<CbgmQueryResponse>) => {
		const request = pending.get(data.id);
		pending.delete(data.id);
		if (data.ok) request?.resolve(data.result);
		else request?.reject(new Error(data.error));
	};
	worker.onerror = event => {
		for (const request of pending.values()) {
			request.reject(new Error(event.message || 'CBGM query worker failed.'));
		}
		pending.clear();
	};
	const request = <T>(message: CbgmQueryRequest) =>
		new Promise<T>((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve: resolve as Pending['resolve'], reject });
			worker.postMessage({ id, request: message });
		});

	const undecided = analysis.undecided_readings;
	let opened: Pick<CbgmQueries, 'witnesses' | 'units'>;
	try {
		opened = await request({
			type: 'open',
			cache,
			filter: {
				excludedWitnesses: analysis.settings.excluded_witnesses,
				minExtantProportion: analysis.settings.min_extant_proportion,
			},
		});
	} catch (error) {
		worker.terminate();
		throw error;
	}
	return {
		...opened,
		compareWitnesses: (primary, others) =>
			request({ type: 'compare-witnesses', primary, others, undecided }),
		findRelatives: (witness, unit, readings) =>
			request({ type: 'find-relatives', witness, unit, readings, undecided }),
		optimizeSubstemmata: (witness, maxCost) =>
			request({ type: 'optimize-substemmata', witness, maxCost }),
		close: () => worker.terminate(),
	};
}
