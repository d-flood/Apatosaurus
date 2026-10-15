import type { CoherenceSettings } from '@apatosaurus/open-cbgm-wasm';

import type { StoreBackend } from '$lib/storage/opfs-store';
import {
	cbgmCheckpoints,
	type CbgmCheckpoints,
	type CbgmQueueEntry,
	type WitnessResult,
} from './cbgm-checkpoints';
import type { CbgmWorkerRequest, CbgmWorkerResponse, SubstemmaRow } from './cbgm-worker-types';

export type ComputationPhase = 'coherence' | 'global-stemma';

const PHASES: ComputationPhase[] = ['coherence', 'global-stemma'];
export type ComputationState = 'queued' | 'running' | 'paused' | 'writing' | 'done' | 'failed';

export type CbgmComputationRequest =
	| {
			analysisId: string;
			projectId: string;
			phase: 'coherence';
			inputTei: string;
			settings: CoherenceSettings;
			notifyOs: boolean;
	  }
	| {
			analysisId: string;
			projectId: string;
			phase: 'global-stemma';
			cache: Uint8Array;
			settings: CoherenceSettings;
			notifyOs: boolean;
	  };

export type CbgmComputationProgress = {
	analysisId: string;
	phase: ComputationPhase;
	state: ComputationState;
	done: number;
	total: number;
	currentWitnesses: string[];
	failure: string | null;
};

export type CbgmCompletion = {
	analysisId: string;
	projectId: string;
	phase: ComputationPhase;
	cache: Uint8Array;
	notifyOs: boolean;
};

export type CbgmFailure = {
	analysisId: string;
	projectId: string;
	phase: ComputationPhase;
	message: string;
};

export interface CbgmWorkerPort {
	onmessage: ((event: MessageEvent<CbgmWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	postMessage(message: CbgmWorkerRequest): void;
	terminate(): void;
}

export type CbgmSchedulerOptions = {
	poolSize?: number;
	store?: StoreBackend;
	createWorker?: () => CbgmWorkerPort;
};

export class CbgmScheduler {
	#progress = $state.raw<CbgmComputationProgress | null>(null);
	#queue = $state.raw<CbgmQueueEntry[]>([]);
	#active: { entry: CbgmQueueEntry; run: Run; finished: Promise<void> } | null = null;
	#started = false;
	#starting: Promise<void> | null = null;
	#operations: Promise<unknown> = Promise.resolve();
	#lastOrder = 0;
	#completionHandler: ((result: CbgmCompletion) => Promise<void>) | null = null;
	#failureHandler: ((failure: CbgmFailure) => Promise<void>) | null = null;
	#wakeLock: Promise<WakeLockSentinel | null> | null = null;
	readonly #checkpoints: CbgmCheckpoints;
	readonly #poolSize: number | undefined;
	readonly #createWorker: () => CbgmWorkerPort;

	constructor(options: CbgmSchedulerOptions = {}) {
		this.#checkpoints = cbgmCheckpoints(options.store);
		this.#poolSize = options.poolSize;
		this.#createWorker =
			options.createWorker ??
			(() => new Worker(new URL('./cbgm.worker.ts', import.meta.url), { type: 'module' }));
	}

	get progress(): CbgmComputationProgress | null {
		return this.#progress;
	}

	get queue(): readonly { analysisId: string; phase: ComputationPhase }[] {
		return this.#queue.map(({ request }) => ({
			analysisId: request.analysisId,
			phase: request.phase,
		}));
	}

	onComplete(handler: (result: CbgmCompletion) => Promise<void>): void {
		this.#completionHandler = handler;
	}

	onFailure(handler: (failure: CbgmFailure) => Promise<void>): void {
		this.#failureHandler = handler;
	}

	start(): Promise<void> {
		this.#starting ??= this.#serially(async () => {
			const resumed = (await this.#checkpoints.list()).filter(
				entry => !this.#isKnown(entry.request)
			);
			this.#lastOrder = Math.max(this.#lastOrder, ...resumed.map(entry => entry.order));
			this.#queue = [...this.#queue, ...resumed].sort(
				(left, right) => left.order - right.order
			);
			this.#started = true;
			document.addEventListener('visibilitychange', () => void this.#syncWakeLock());
			this.#pump();
		});
		return this.#starting;
	}

	enqueue(request: CbgmComputationRequest): void {
		void this.#serially(async () => {
			if (this.#isKnown(request)) return;
			this.#lastOrder = Math.max(Date.now(), this.#lastOrder + 1);
			const entry = { request, order: this.#lastOrder };
			await this.#checkpoints.save(entry);
			this.#queue = [...this.#queue, entry];
			this.#pump();
		}).catch(error => this.#reportFailure(request, error));
	}

	cancel(analysisId: string): Promise<void> {
		return this.#serially(async () => {
			this.#queue = this.#queue.filter(entry => entry.request.analysisId !== analysisId);
			if (this.#active?.entry.request.analysisId === analysisId) {
				this.#active.run.cancel();
				await this.#active.finished;
			}
			for (const phase of PHASES) await this.#checkpoints.clear({ analysisId, phase });
			if (this.#progress?.analysisId === analysisId) this.#progress = null;
		});
	}

	#isKnown({ analysisId, phase }: CbgmComputationRequest): boolean {
		return [this.#active?.entry, ...this.#queue].some(
			entry => entry?.request.analysisId === analysisId && entry.request.phase === phase
		);
	}

	#serially<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#operations.then(operation);
		this.#operations = result.catch(() => undefined);
		return result;
	}

	#pump(): void {
		if (!this.#started || this.#active) return;
		const [entry, ...waiting] = this.#queue;
		if (entry) {
			this.#queue = waiting;
			const run = new Run();
			const finished = this.#run(entry, run).finally(() => {
				this.#active = null;
				this.#pump();
			});
			this.#active = { entry, run, finished };
		}
		void this.#syncWakeLock();
	}

	async #run({ request }: CbgmQueueEntry, run: Run): Promise<void> {
		const { analysisId, projectId, phase, notifyOs } = request;
		this.#progress = {
			analysisId,
			phase,
			state: 'queued',
			done: 0,
			total: 0,
			currentWitnesses: [],
			failure: null,
		};
		const update = (patch: Partial<CbgmComputationProgress>) => {
			if (!run.cancelled && this.#progress) this.#progress = { ...this.#progress, ...patch };
		};
		try {
			const results = await this.#checkpoints.loadResults(request);
			if (results.size) update({ state: 'paused', done: results.size });
			const cache = await this.#compute(request, results, run, update);
			if (!this.#completionHandler)
				throw new Error('No CBGM completion handler is registered.');
			await this.#completionHandler({ analysisId, projectId, phase, cache, notifyOs });
			if (run.cancelled) return;
			await this.#checkpoints.clear(request);
			update({ state: 'done' });
		} catch (error) {
			if (run.cancelled) return;
			const message = error instanceof Error ? error.message : String(error);
			update({ state: 'failed', currentWitnesses: [], failure: message });
			await this.#reportFailure(request, error);
		} finally {
			run.stop();
		}
	}

	async #compute(
		request: CbgmComputationRequest,
		results: Map<string, WitnessResult>,
		run: Run,
		update: (patch: Partial<CbgmComputationProgress>) => void
	): Promise<Uint8Array> {
		const size = this.#poolSize ?? Math.max(1, (navigator.hardwareConcurrency || 1) - 1);
		const workers = Array.from({ length: size }, () => run.add(this.#createWorker()));
		const load: CbgmWorkerRequest =
			request.phase === 'coherence'
				? { type: 'prepare', inputTei: request.inputTei, settings: request.settings }
				: { type: 'open', cache: request.cache, settings: request.settings };
		const loaded = workers.map(worker => worker.request<string[]>(load));
		const witnesses = await Promise.race(loaded);
		const remaining = witnesses.filter(siglum => !results.has(siglum));
		const current = new Set<string>();
		update({ state: 'running', total: witnesses.length, done: results.size });

		const work = async (worker: WorkerClient, ready: Promise<string[]>) => {
			await ready;
			for (let siglum = remaining.shift(); siglum !== undefined; siglum = remaining.shift()) {
				current.add(siglum);
				update({ currentWitnesses: [...current] });
				const result: WitnessResult =
					request.phase === 'coherence'
						? await worker.request<Uint8Array>({ type: 'compute-witness', siglum })
						: {
								witness: siglum,
								ancestors: await worker.request<string[]>({
									type: 'optimize-substemma',
									siglum,
								}),
								completedAt: new Date().toISOString(),
							};
				await this.#checkpoints.saveResult(request, siglum, result);
				results.set(siglum, result);
				current.delete(siglum);
				update({ done: results.size, currentWitnesses: [...current] });
			}
		};
		let failure: unknown = null;
		await Promise.all(
			workers.map((worker, index) =>
				work(worker, loaded[index]).catch(error => {
					failure ??= error;
					run.stop();
				})
			)
		);
		if (failure) throw failure;

		update({ state: 'writing' });
		return workers[0].request<Uint8Array>(
			request.phase === 'coherence'
				? {
						type: 'assemble',
						rows: new Map(
							witnesses.map(siglum => [siglum, results.get(siglum) as Uint8Array])
						),
					}
				: {
						type: 'write-substemmata',
						cache: request.cache,
						rows: witnesses.map(siglum => results.get(siglum) as SubstemmaRow),
					}
		);
	}

	async #reportFailure(request: CbgmComputationRequest, error: unknown): Promise<void> {
		const message = error instanceof Error ? error.message : String(error);
		try {
			await this.#failureHandler?.({
				analysisId: request.analysisId,
				projectId: request.projectId,
				phase: request.phase,
				message,
			});
		} catch (handlerError) {
			console.error('[cbgm] failure handler failed', handlerError);
		}
	}

	async #syncWakeLock(): Promise<void> {
		const wanted = this.#active !== null && document.visibilityState === 'visible';
		if (wanted && !this.#wakeLock && 'wakeLock' in navigator) {
			this.#wakeLock = navigator.wakeLock.request('screen').catch(() => null);
		} else if (!wanted && this.#wakeLock) {
			const wakeLock = this.#wakeLock;
			this.#wakeLock = null;
			await (await wakeLock)?.release();
		}
	}
}

class Run {
	cancelled = false;
	#workers: WorkerClient[] = [];

	add(port: CbgmWorkerPort): WorkerClient {
		const worker = new WorkerClient(port);
		this.#workers.push(worker);
		if (this.cancelled) worker.stop();
		return worker;
	}

	cancel(): void {
		this.cancelled = true;
		this.stop();
	}

	stop(): void {
		for (const worker of this.#workers) worker.stop();
	}
}

class WorkerClient {
	#port: CbgmWorkerPort;
	#pending: { resolve: (value: unknown) => void; reject: (error: Error) => void } | null = null;
	#stopped = false;

	constructor(port: CbgmWorkerPort) {
		this.#port = port;
		port.onmessage = ({ data }) => {
			if (data.ok) this.#take()?.resolve(data.result);
			else this.#take()?.reject(new Error(data.error));
		};
		port.onerror = event => {
			this.#take()?.reject(new Error(event.message || 'CBGM worker failed.'));
		};
	}

	request<T>(message: CbgmWorkerRequest): Promise<T> {
		if (this.#stopped) return Promise.reject(new Error('CBGM worker stopped.'));
		return new Promise<T>((resolve, reject) => {
			this.#pending = { resolve: resolve as (value: unknown) => void, reject };
			this.#port.postMessage(message);
		});
	}

	stop(): void {
		if (this.#stopped) return;
		this.#stopped = true;
		this.#port.terminate();
		this.#take()?.reject(new Error('CBGM worker stopped.'));
	}

	#take() {
		const pending = this.#pending;
		this.#pending = null;
		return pending;
	}
}

export const cbgmScheduler = new CbgmScheduler();
