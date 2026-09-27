import { describe, expect, it } from 'vitest';

import {
	CORPUS_APPROXIMATE_BYTES,
	cachesToRetain,
	classifyRequest,
	hasCorpusStorageHeadroom,
	partitionPrecache,
	shouldWarm,
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
