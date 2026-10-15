import {
	createCbgmEngine,
	type CbgmEngine,
	type CoherenceSettings,
} from '@apatosaurus/open-cbgm-wasm';
import wasmUrl from '@apatosaurus/open-cbgm-wasm/open-cbgm.wasm?url';
import { flushSync } from 'svelte';
import { beforeAll, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import inputTei from '../../../../packages/open-cbgm-wasm/vendor/open-cbgm-standalone/lib/open-cbgm/examples/3_john_collation.xml?raw';
import { listProjects } from '$lib/db/client';
import { ensureLocalDbRuntime } from '$lib/db/runtime';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import AboutPage from '../../routes/about/+page.svelte';
import { cbgmCheckpoints } from './cbgm-checkpoints';
import {
	CbgmScheduler,
	type CbgmCompletion,
	type CbgmComputationRequest,
	type CbgmWorkerPort,
} from './cbgm-scheduler.svelte';
import type { CbgmWorkerRequest } from './cbgm-worker-types';

const settings: CoherenceSettings = {
	minExtantUnits: null,
	minExtantProportion: null,
	excludedWitnesses: [],
	classicRules: false,
	mergeSplitReadings: false,
	droppedReadingTypes: [],
	includedCorrectors: [],
};

function coherence(analysisId: string): CbgmComputationRequest {
	return {
		analysisId,
		projectId: '3-john',
		phase: 'coherence',
		inputTei,
		settings,
		notifyOs: false,
	};
}

function globalStemma(analysisId: string, cache: Uint8Array): CbgmComputationRequest {
	return {
		analysisId,
		projectId: '3-john',
		phase: 'global-stemma',
		cache,
		settings,
		notifyOs: true,
	};
}

type BeforeReply = (request: CbgmWorkerRequest) => Promise<void> | void;

function witnessOf(request: CbgmWorkerRequest): string | null {
	return request.type === 'compute-witness' || request.type === 'optimize-substemma'
		? request.siglum
		: null;
}

class TestWorker implements CbgmWorkerPort {
	onmessage: CbgmWorkerPort['onmessage'] = null;
	onerror: CbgmWorkerPort['onerror'] = null;
	readonly sent: CbgmWorkerRequest[] = [];
	readonly #worker = new Worker(new URL('./cbgm.worker.ts', import.meta.url), {
		type: 'module',
	});

	constructor(beforeReply: BeforeReply) {
		this.#worker.onmessage = async event => {
			await beforeReply(this.sent[this.sent.length - 1]);
			this.onmessage?.(event);
		};
		this.#worker.onerror = event => this.onerror?.(event);
	}

	postMessage(message: CbgmWorkerRequest): void {
		this.sent.push(message);
		this.#worker.postMessage(message);
	}

	terminate(): void {
		this.#worker.terminate();
	}
}

function workerPool(beforeReply: BeforeReply = () => {}) {
	const workers: TestWorker[] = [];
	return {
		workers,
		createWorker: () => {
			const worker = new TestWorker(beforeReply);
			workers.push(worker);
			return worker;
		},
		witnesses: () =>
			workers.flatMap(worker => worker.sent.map(witnessOf).filter(siglum => siglum !== null)),
		closeTab: () => workers.forEach(worker => worker.terminate()),
	};
}

function nextCompletion(scheduler: CbgmScheduler): Promise<CbgmCompletion> {
	return new Promise((resolve, reject) => {
		scheduler.onComplete(async result => resolve(result));
		scheduler.onFailure(async failure => reject(new Error(failure.message)));
	});
}

async function compute(scheduler: CbgmScheduler, request: CbgmComputationRequest) {
	const completion = nextCompletion(scheduler);
	scheduler.enqueue(request);
	return completion;
}

async function sha256(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function checkpointedWitnesses(store: MemoryStoreBackend, request: CbgmComputationRequest) {
	return [...(await cbgmCheckpoints(store).loadResults(request)).keys()];
}

describe('CBGM computation scheduler', () => {
	let engine: CbgmEngine;
	let witnesses: string[];
	let serial: { cache: string; substemmata: Map<string, string[]>; stemmaCache: Uint8Array };

	async function analyse(poolSize: number) {
		const scheduler = new CbgmScheduler({ poolSize, store: new MemoryStoreBackend() });
		await scheduler.start();
		const { cache } = await compute(scheduler, coherence('analysis'));
		const stemma = await compute(scheduler, globalStemma('analysis', cache));
		return {
			cache: await sha256(cache),
			substemmata: engine.readSubstemmata(stemma.cache),
			stemmaCache: stemma.cache,
		};
	}

	async function interruptAndResume(
		request: CbgmComputationRequest,
		completedBeforeClose: number
	) {
		const store = new MemoryStoreBackend();
		let replies = 0;
		const closing = workerPool(async sent => {
			if (witnessOf(sent) === null || replies++ < completedBeforeClose) return;
			closing.closeTab();
			await new Promise(() => {});
		});
		const interrupted = new CbgmScheduler({
			poolSize: 4,
			store,
			createWorker: closing.createWorker,
		});
		await interrupted.start();
		interrupted.enqueue(request);
		await expect
			.poll(() => interrupted.progress?.done, { timeout: 60_000 })
			.toBe(completedBeforeClose);
		const checkpointed = await checkpointedWitnesses(store, request);

		const resuming = workerPool();
		const resumed = new CbgmScheduler({
			poolSize: 4,
			store,
			createWorker: resuming.createWorker,
		});
		const completion = nextCompletion(resumed);
		await resumed.start();
		const result = await completion;
		await expect.poll(() => resumed.progress?.state).toBe('done');
		return {
			result,
			checkpointed,
			recomputed: resuming.witnesses(),
			leftover: await cbgmCheckpoints(store).list(),
		};
	}

	beforeAll(async () => {
		engine = await createCbgmEngine({ locateFile: () => wasmUrl });
		witnesses = engine.prepare(inputTei, settings).witnesses;
		serial = await analyse(1);
	}, 180_000);

	it('computes the substemmata native open-cbgm finds with a pool of 1', () => {
		expect(serial.substemmata.size).toBe(witnesses.length);
		expect(serial.substemmata.get('5')).toEqual(['623', '2344']);
		expect(serial.substemmata.get('A')).toEqual([]);
	});

	it('produces the same cache and substemmata with a pool of 4', async () => {
		const parallel = await analyse(4);

		expect(parallel.cache).toBe(serial.cache);
		expect(parallel.substemmata).toEqual(serial.substemmata);
	}, 120_000);

	it('resumes a pool of 4 closed mid-run from checkpoints with the same results', async () => {
		const coherenceRun = await interruptAndResume(coherence('analysis'), 20);
		expect(coherenceRun.checkpointed).toHaveLength(20);
		expect(coherenceRun.recomputed).toHaveLength(witnesses.length - 20);
		expect(new Set([...coherenceRun.checkpointed, ...coherenceRun.recomputed]).size).toBe(
			witnesses.length
		);
		expect(await sha256(coherenceRun.result.cache)).toBe(serial.cache);
		expect(coherenceRun.leftover).toEqual([]);

		const stemmaRun = await interruptAndResume(
			globalStemma('analysis', coherenceRun.result.cache),
			30
		);
		expect(stemmaRun.checkpointed).toHaveLength(30);
		expect(stemmaRun.recomputed).toHaveLength(witnesses.length - 30);
		expect(engine.readSubstemmata(stemmaRun.result.cache)).toEqual(serial.substemmata);
		expect(stemmaRun.result).toMatchObject({ projectId: '3-john', notifyOs: true });
		expect(stemmaRun.leftover).toEqual([]);
	}, 180_000);

	it('runs a second request only after the first is done, in order across a restart', async () => {
		const store = new MemoryStoreBackend();
		const stalled = workerPool(sent => (witnessOf(sent) ? new Promise(() => {}) : undefined));
		const first = new CbgmScheduler({ poolSize: 1, store, createWorker: stalled.createWorker });
		await first.start();
		first.enqueue(globalStemma('first', serial.stemmaCache));
		first.enqueue(globalStemma('second', serial.stemmaCache));

		await expect.poll(() => first.progress?.state, { timeout: 30_000 }).toBe('running');
		await expect
			.poll(() => first.queue)
			.toEqual([{ analysisId: 'second', phase: 'global-stemma' }]);
		expect(first.progress?.analysisId).toBe('first');
		stalled.closeTab();

		const resumed = new CbgmScheduler({ poolSize: 2, store });
		const completed: string[] = [];
		let queueWhileFirstPersisted: unknown = null;
		resumed.onComplete(async result => {
			completed.push(result.analysisId);
			if (result.analysisId === 'first') queueWhileFirstPersisted = resumed.queue;
		});
		await resumed.start();

		await expect.poll(() => completed, { timeout: 60_000 }).toEqual(['first', 'second']);
		expect(queueWhileFirstPersisted).toEqual([
			{ analysisId: 'second', phase: 'global-stemma' },
		]);
	}, 120_000);

	it('keeps local reads and navigation working while a worker is held, and never updates an unmounted route', async () => {
		let release = () => {};
		const held = new Promise<void>(resolve => (release = resolve));
		let holding = false;
		const pool = workerPool(sent => {
			if (!witnessOf(sent) || holding) return;
			holding = true;
			return held;
		});
		const scheduler = new CbgmScheduler({
			poolSize: 2,
			store: new MemoryStoreBackend(),
			createWorker: pool.createWorker,
		});
		const completion = nextCompletion(scheduler);
		await scheduler.start();
		scheduler.enqueue(globalStemma('held', serial.stemmaCache));
		await expect.poll(() => holding, { timeout: 30_000 }).toBe(true);

		const seen: (number | undefined)[] = [];
		const leaveRoute = $effect.root(() => {
			$effect(() => {
				seen.push(scheduler.progress?.done);
			});
		});
		flushSync();

		await ensureLocalDbRuntime();
		await expect(listProjects()).resolves.toEqual(expect.any(Array));
		const route = render(AboutPage);
		await expect
			.element(route.getByRole('heading', { level: 1, name: 'Apatosaurus' }))
			.toBeVisible();
		expect(scheduler.progress?.state).toBe('running');

		route.unmount();
		leaveRoute();
		const updatesBeforeRelease = seen.length;
		release();

		const result = await completion;
		expect(engine.readSubstemmata(result.cache)).toEqual(serial.substemmata);
		await expect.poll(() => scheduler.progress?.state).toBe('done');
		expect(seen).toHaveLength(updatesBeforeRelease);
	}, 120_000);

	it('resumes only once started, and clears checkpoints only after the completion handler resolves', async () => {
		const store = new MemoryStoreBackend();
		let replies = 0;
		const closing = workerPool(async sent => {
			if (witnessOf(sent) === null || replies++ < 10) return;
			closing.closeTab();
			await new Promise(() => {});
		});
		const interrupted = new CbgmScheduler({
			poolSize: 2,
			store,
			createWorker: closing.createWorker,
		});
		await interrupted.start();
		const pending = globalStemma('pending', serial.stemmaCache);
		interrupted.enqueue(pending);
		await expect.poll(() => interrupted.progress?.done, { timeout: 30_000 }).toBe(10);

		const resuming = workerPool();
		const resumed = new CbgmScheduler({
			poolSize: 2,
			store,
			createWorker: resuming.createWorker,
		});
		await Promise.resolve();
		expect(resuming.workers).toHaveLength(0);
		expect(resumed.progress).toBeNull();

		let persist = () => {};
		const persisted = new Promise<void>(resolve => (persist = resolve));
		const received: CbgmCompletion[] = [];
		resumed.onComplete(async result => {
			received.push(result);
			await persisted;
		});
		await resumed.start();

		await expect.poll(() => received, { timeout: 60_000 }).toHaveLength(1);
		expect(engine.readSubstemmata(received[0].cache)).toEqual(serial.substemmata);
		expect(await checkpointedWitnesses(store, pending)).toHaveLength(witnesses.length);
		expect(resumed.progress?.state).toBe('writing');

		persist();
		await expect.poll(() => resumed.progress?.state).toBe('done');
		expect(await cbgmCheckpoints(store).list()).toEqual([]);
	}, 120_000);
});
