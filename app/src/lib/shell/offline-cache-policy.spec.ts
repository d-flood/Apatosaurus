import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAssetRequest } from './offline-cache-assets';

import {
	CORPUS_APPROXIMATE_BYTES,
	cachesToRetain,
	classifyRequest,
	hasCorpusStorageHeadroom,
	partitionPrecache,
	shouldWarm,
	shouldRevalidateAsset,
	type PrecacheManifest,
} from './offline-cache-policy';

const manifest: PrecacheManifest = {
	base: '',
	version: '2026-07-29',
	build: [
		'/_app/immutable/chunks/runtime.hash.js',
		'/_app/immutable/entry/start.hash.js',
		'/_app/immutable/entry/app.hash.js',
		'/_app/immutable/nodes/0.hash.js',
		'/_app/immutable/nodes/1.hash.js',
		'/_app/immutable/nodes/2.hash.js',
		'/_app/immutable/assets/0.hash.css',
		'/_app/immutable/assets/editor.hash.css',
	],
	files: ['/manifest.json', '/favicon.ico', '/fonts/app.woff2', '/igntp/reference.xml'],
	prerendered: [],
};

describe('offline cache policy', () => {
	it('partitions a realistic manifest exhaustively into disjoint cache tiers', () => {
		const tiers = partitionPrecache(manifest);

		expect(tiers).toEqual({
			shell: [
				'/',
				'/manifest.json',
				'/_app/immutable/entry/start.hash.js',
				'/_app/immutable/entry/app.hash.js',
				'/_app/immutable/nodes/0.hash.js',
				'/_app/immutable/nodes/1.hash.js',
				'/_app/immutable/assets/0.hash.css',
			],
			routes: [
				'/_app/immutable/chunks/runtime.hash.js',
				'/_app/immutable/nodes/2.hash.js',
				'/_app/immutable/assets/editor.hash.css',
			],
			corpus: ['/favicon.ico', '/fonts/app.woff2', '/igntp/reference.xml'],
		});

		const partitioned = Object.values(tiers).flat();
		const expected = ['/', ...manifest.build, ...manifest.files, ...manifest.prerendered];
		expect(new Set(partitioned)).toEqual(new Set(expected));
		expect(partitioned).toHaveLength(new Set(partitioned).size);
	});

	it('classifies navigation, same-origin assets, and bypassed requests', () => {
		const origin = 'https://apatosaurus.test';

		expect(
			classifyRequest(new URL('/projects/one', origin), origin, 'document', manifest)
		).toBe('navigation');
		expect(
			classifyRequest(
				new URL('/_app/immutable/nodes/2.hash.js', origin),
				origin,
				'script',
				manifest
			)
		).toBe('asset');
		expect(classifyRequest(new URL('/fonts/app.woff2', origin), origin, 'font', manifest)).toBe(
			'asset'
		);
		expect(classifyRequest(new URL('/@vite/client', origin), origin, 'script', manifest)).toBe(
			'bypass'
		);
		expect(classifyRequest(new URL('/@fs/source.ts', origin), origin, 'script', manifest)).toBe(
			'bypass'
		);
		expect(classifyRequest(new URL('/worker.js', origin), origin, 'worker', manifest)).toBe(
			'bypass'
		);
		expect(
			classifyRequest(new URL('https://images.test/page.jpg'), origin, 'image', manifest)
		).toBe('bypass');
	});

	it('puts DB dependencies in shell and all other workers in routes', () => {
		const shellWorkers = [
			'/_app/immutable/workers/db.worker-hash.js',
			'/_app/immutable/workers/chunks/db-hash.js',
			'/_app/immutable/workers/assets/wa-sqlite-hash.wasm',
		];
		const routes = [
			'/_app/immutable/workers/collation.worker-hash.js',
			'/_app/immutable/workers/cbgm-query.worker-hash.js',
			'/_app/immutable/workers/assets/open-cbgm-hash.wasm',
		];
		const tiers = partitionPrecache({
			...manifest,
			build: [...manifest.build, ...shellWorkers, ...routes],
			shellWorkers,
		});
		expect(tiers.shell).toEqual([...partitionPrecache(manifest).shell, ...shellWorkers]);
		expect(tiers.routes).toEqual([...partitionPrecache(manifest).routes, ...routes]);
	});

	it.each(['worker', 'sharedworker'])(
		'serves precached %s scripts only on origin',
		destination => {
			const origin = 'https://apatosaurus.test';
			const pathname = '/_app/immutable/workers/db.worker-hash.js';
			const workerManifest = { ...manifest, build: [...manifest.build, pathname] };
			expect(
				classifyRequest(new URL(pathname, origin), origin, destination, workerManifest)
			).toBe('asset');
			expect(
				classifyRequest(
					new URL(pathname, 'https://other.test'),
					origin,
					destination,
					workerManifest
				)
			).toBe('bypass');
			expect(
				classifyRequest(new URL('/unknown.js', origin), origin, destination, workerManifest)
			).toBe('bypass');
			expect(
				classifyRequest(new URL(pathname, origin), origin, 'serviceworker', workerManifest)
			).toBe('bypass');
		}
	);

	it('revalidates mutable files but never immutable assets or worker scripts', () => {
		const origin = 'https://apatosaurus.test';
		for (const pathname of [
			'/_app/immutable/chunks/runtime.hash.js',
			'/base/_app/immutable/workers/assets/wa-sqlite-hash.wasm',
		]) {
			expect(shouldRevalidateAsset(new URL(pathname, origin), 'script')).toBe(false);
		}
		for (const destination of ['worker', 'sharedworker']) {
			expect(shouldRevalidateAsset(new URL('/worker.js', origin), destination)).toBe(false);
		}
		expect(shouldRevalidateAsset(new URL('/manifest.json', origin), 'manifest')).toBe(true);
	});

	it('retains current caches, the previous app version, and corpus caches across versions', () => {
		expect(
			cachesToRetain(
				[
					'apato-shell-2026-07-27',
					'apato-routes-2026-07-27',
					'apato-shell-2026-07-28',
					'apato-routes-2026-07-28',
					'apato-corpus-2026-07-28',
					'apato-routes-2026-07-29',
					'apato-shell-2026-07-29',
					'apato-corpus-2026-07-27',
					'unrelated-cache',
				],
				'2026-07-29'
			)
		).toEqual([
			'apato-shell-2026-07-28',
			'apato-routes-2026-07-28',
			'apato-corpus-2026-07-28',
			'apato-routes-2026-07-29',
			'apato-shell-2026-07-29',
			'apato-corpus-2026-07-27',
		]);
	});

	it('declines an optional warm when the user has enabled data saving', () => {
		expect(
			shouldWarm({
				saveData: true,
				effectiveType: '4g',
				estimate: { usage: 100, quota: 1_000 },
				tier: 'routes',
			})
		).toBe(false);
	});

	it.each(['slow-2g', '2g'])('declines an optional warm on a %s connection', effectiveType => {
		expect(
			shouldWarm({
				saveData: false,
				effectiveType,
				estimate: { usage: 100, quota: 1_000 },
				tier: 'routes',
			})
		).toBe(false);
	});

	it('declines an optional warm without storage headroom', () => {
		expect(
			shouldWarm({
				saveData: false,
				effectiveType: '4g',
				estimate: { usage: 800, quota: 1_000 },
				tier: 'routes',
			})
		).toBe(false);
	});

	it('permits an optional warm on an ordinary connection with storage headroom', () => {
		expect(
			shouldWarm({
				saveData: false,
				effectiveType: '4g',
				estimate: { usage: 100, quota: 1_000 },
				tier: 'routes',
			})
		).toBe(true);
	});

	it('never declines the shell warm', () => {
		expect(
			shouldWarm({
				saveData: true,
				effectiveType: 'slow-2g',
				estimate: { usage: 1_000, quota: 1_000 },
				tier: 'shell',
			})
		).toBe(true);
	});

	it('refuses a corpus download when the approximate payload cannot fit', () => {
		expect(
			hasCorpusStorageHeadroom({
				usage: 60 * 1024 * 1024,
				quota: 100 * 1024 * 1024,
			})
		).toBe(false);
		expect(CORPUS_APPROXIMATE_BYTES).toBe(44 * 1024 * 1024);
	});

	it('permits a corpus download when enough storage is available or the estimate is unavailable', () => {
		expect(
			hasCorpusStorageHeadroom({
				usage: 10 * 1024 * 1024,
				quota: 100 * 1024 * 1024,
			})
		).toBe(true);
		expect(hasCorpusStorageHeadroom({ usage: null, quota: null })).toBe(true);
	});
});

describe('service worker asset requests', () => {
	const put = vi.fn();
	const match = vi.fn();
	const networkFetch = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('caches', { open: vi.fn(async () => ({ put })), match });
		vi.stubGlobal('fetch', networkFetch);
	});

	afterEach(() => vi.unstubAllGlobals());

	async function requestAsset(pathname: string, destination = 'script') {
		const request = new Request(`https://apatosaurus.test${pathname}`);
		Object.defineProperty(request, 'destination', { value: destination });
		return handleAssetRequest(request, new URL(request.url), {
			...manifest,
			build: [...manifest.build, '/_app/immutable/workers/db.worker-hash.js'],
		});
	}

	it.each([
		['/_app/immutable/chunks/runtime.hash.js', 'script'],
		['/_app/immutable/workers/db.worker-hash.js', 'worker'],
		['/_app/immutable/workers/db.worker-hash.js', 'sharedworker'],
	])('answers cached %s without a background fetch (%s)', async (pathname, destination) => {
		const cached = new Response('cached');
		match.mockResolvedValue(cached);
		expect(await requestAsset(pathname, destination)).toBe(cached);
		expect(networkFetch).not.toHaveBeenCalled();
		expect(put).not.toHaveBeenCalled();
	});

	it.each([
		['/_app/immutable/chunks/runtime.hash.js', 'script'],
		['/_app/immutable/workers/db.worker-hash.js', 'worker'],
	])('fetches and stores missing %s', async (pathname, destination) => {
		match.mockResolvedValue(undefined);
		networkFetch.mockResolvedValue(new Response('network'));
		expect(await (await requestAsset(pathname, destination))?.text()).toBe('network');
		expect(networkFetch).toHaveBeenCalledOnce();
		expect(put).toHaveBeenCalledOnce();
	});

	it('refetches and replaces a cached error response for an immutable worker', async () => {
		match.mockResolvedValue(new Response('missing', { status: 404 }));
		networkFetch.mockResolvedValue(new Response('network'));
		const response = await requestAsset('/_app/immutable/workers/db.worker-hash.js', 'worker');
		expect(await response.text()).toBe('network');
		expect(networkFetch).toHaveBeenCalledOnce();
		expect(put).toHaveBeenCalledOnce();
	});

	it('keeps background revalidation for mutable files', async () => {
		const cached = new Response('cached');
		match.mockResolvedValue(cached);
		networkFetch.mockResolvedValue(new Response('network'));
		expect(await requestAsset('/manifest.json')).toBe(cached);
		expect(networkFetch).toHaveBeenCalledOnce();
		expect(put).toHaveBeenCalledOnce();
	});
});
