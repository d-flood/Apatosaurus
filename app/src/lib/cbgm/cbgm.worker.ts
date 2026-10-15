import { createCbgmEngine, type CbgmEngine } from '@apatosaurus/open-cbgm-wasm';
import wasmUrl from '@apatosaurus/open-cbgm-wasm/open-cbgm.wasm?url';

import type { CbgmWorkerRequest, CbgmWorkerResponse } from './cbgm-worker-types';

const engine = createCbgmEngine({ locateFile: () => wasmUrl });

self.onmessage = async (event: MessageEvent<CbgmWorkerRequest>) => {
	try {
		const result = handle(await engine, event.data);
		emit(
			{ ok: true, result },
			result instanceof Uint8Array ? [result.buffer as ArrayBuffer] : []
		);
	} catch (error) {
		emit({ ok: false, error: error instanceof Error ? error.message : String(error) });
	}
};

function handle(engine: CbgmEngine, request: CbgmWorkerRequest) {
	switch (request.type) {
		case 'prepare':
			return engine.prepare(request.inputTei, request.settings).witnesses;
		case 'open':
			engine.open(request.cache, request.settings);
			return engine.witnesses();
		case 'compute-witness':
			return engine.computeWitness(request.siglum);
		case 'optimize-substemma':
			return engine.optimizeSubstemma(request.siglum) ?? [];
		case 'assemble':
			return engine.assemble(request.rows);
		case 'write-substemmata':
			return engine.writeSubstemmata(request.cache, request.rows);
	}
}

function emit(response: CbgmWorkerResponse, transfer: Transferable[] = []): void {
	self.postMessage(response, { transfer });
}
