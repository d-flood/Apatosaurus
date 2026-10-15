import { createCbgmEngine, type CbgmEngine } from '@apatosaurus/open-cbgm-wasm';
import wasmUrl from '@apatosaurus/open-cbgm-wasm/open-cbgm.wasm?url';

import type { CbgmQueryRequest, CbgmQueryResponse } from './cbgm-worker-types';

const engine = createCbgmEngine({ locateFile: () => wasmUrl });

self.onmessage = async (event: MessageEvent<{ id: number; request: CbgmQueryRequest }>) => {
	const { id, request } = event.data;
	try {
		emit({ id, ok: true, result: handle(await engine, request) });
	} catch (error) {
		emit({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
	}
};

function handle(engine: CbgmEngine, request: CbgmQueryRequest) {
	switch (request.type) {
		case 'open':
			engine.open(request.cache, request.filter);
			return { witnesses: engine.witnesses(), units: engine.units() };
		case 'compare-witnesses':
			return engine.compareWitnesses(request.primary, request.others, request.undecided);
		case 'find-relatives':
			return engine.findRelatives(
				request.witness,
				request.unit,
				request.readings,
				request.undecided
			);
		case 'optimize-substemmata':
			return engine.optimizeSubstemmata(request.witness, request.maxCost);
	}
}

function emit(response: CbgmQueryResponse): void {
	self.postMessage(response);
}
