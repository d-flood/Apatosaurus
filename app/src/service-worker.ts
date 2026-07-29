/// <reference types="@sveltejs/kit" />
import { base, build, files, prerendered, version } from '$service-worker';
import {
	cacheName,
	cacheTierForUrl,
	cachesToRetain,
	classifyRequest,
	partitionPrecache,
	shouldWarm,
	WARM_CACHE_MESSAGE,
	WARM_PROGRESS_MESSAGE,
	type CacheTier,
	type PrecacheManifest,
	type WarmConditions,
	type WarmProgress,
} from '$lib/client/offline-cache-policy';

const manifest: PrecacheManifest = { base, build, files, prerendered, version };
const tiers = partitionPrecache(manifest);
const SHELL_URL = `${base}/`;
const WARM_CONCURRENCY = 4;
const warmTasks = new Map<CacheTier, Promise<void>>();

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', event => {
	event.waitUntil(
		(async () => {
			const shellCache = await caches.open(cacheName('shell', version));
			await Promise.all(
				tiers.shell.map(async url => {
					const response = await fetch(url);
					await shellCache.put(url, response);
				})
			);
		})()
	);
});

self.addEventListener('message', event => {
	if (event.data?.type === 'SKIP_WAITING') {
		void self.skipWaiting();
		return;
	}
	if (event.data?.type !== WARM_CACHE_MESSAGE) return;

	const conditions = event.data.conditions as WarmConditions;
	let task = warmTasks.get(conditions.tier);
	if (!task) {
		task = warmTier(conditions).finally(() => warmTasks.delete(conditions.tier));
		warmTasks.set(conditions.tier, task);
	}
	event.waitUntil(task);
});

async function warmTier(conditions: WarmConditions): Promise<void> {
	const urls = tiers[conditions.tier];
	if (!shouldWarm(conditions)) {
		await broadcastWarmProgress({
			tier: conditions.tier,
			state: 'skipped',
			completed: 0,
			total: urls.length,
			bytesCached: null,
			reason: skippedReason(conditions),
		});
		return;
	}

	const cache = await caches.open(cacheName(conditions.tier, version));
	const pending: string[] = [];
	let completed = 0;
	for (const url of urls) {
		if (await matchTierCache(conditions.tier, url)) completed += 1;
		else pending.push(url);
	}

	await broadcastWarmProgress({
		tier: conditions.tier,
		state: 'warming',
		completed,
		total: urls.length,
		bytesCached: null,
	});

	let failures = 0;
	let nextIndex = 0;
	const workers = Array.from({ length: Math.min(WARM_CONCURRENCY, pending.length) }, async () => {
		while (nextIndex < pending.length) {
			const url = pending[nextIndex++];
			try {
				const response = await fetch(url);
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				await cache.put(url, response);
				completed += 1;
				await broadcastWarmProgress({
					tier: conditions.tier,
					state: 'warming',
					completed,
					total: urls.length,
					bytesCached: null,
				});
			} catch (error) {
				failures += 1;
				console.warn('[Service Worker] Failed to warm', url, error);
			}
		}
	});
	await Promise.all(workers);

	await broadcastWarmProgress({
		tier: conditions.tier,
		state: failures === 0 ? 'ready' : completed === 0 ? 'failed' : 'partial',
		completed,
		total: urls.length,
		bytesCached: null,
		...(failures > 0 ? { reason: 'network-error' as const } : {}),
	});
}

async function broadcastWarmProgress(progress: WarmProgress): Promise<void> {
	const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	for (const client of clients) client.postMessage({ type: WARM_PROGRESS_MESSAGE, progress });
}

function skippedReason(conditions: WarmConditions): WarmProgress['reason'] {
	if (conditions.saveData) return 'save-data';
	if (conditions.effectiveType === 'slow-2g' || conditions.effectiveType === '2g') {
		return 'slow-network';
	}
	return 'quota';
}

self.addEventListener('activate', event => {
	event.waitUntil(
		(async () => {
			const cacheNames = await caches.keys();
			const retained = new Set(cachesToRetain(cacheNames, version));
			await Promise.all(
				cacheNames.filter(name => !retained.has(name)).map(name => caches.delete(name))
			);
		})()
	);
	self.clients.claim();
});

async function handleNavigation(event: FetchEvent): Promise<Response> {
	const cache = await caches.open(cacheName('shell', version));
	const cachedResponse = await cache.match(SHELL_URL);

	try {
		const networkResponse = await fetch(event.request);
		event.waitUntil(
			fetch(SHELL_URL)
				.then(response => cache.put(SHELL_URL, response))
				.catch(error => {
					console.warn('[Service Worker] Failed to revalidate shell', error);
				})
		);
		return networkResponse;
	} catch (cause) {
		if (cachedResponse) return cachedResponse;
		throw new Error('[Service Worker] Cached shell is unavailable.', { cause });
	}
}

async function handleAssetRequest(request: Request, url: URL): Promise<Response> {
	const tier = cacheTierForUrl(url, manifest);
	if (tier === null) return fetch(request);

	const cache = await caches.open(cacheName(tier, version));
	const cachedResponse = await matchTierCache(tier, request);

	const networkUpdate = fetch(request)
		.then(response => {
			if (response.ok) {
				cache.put(request, response.clone());
			}
			return response;
		})
		.catch(() => null);

	if (cachedResponse) {
		return cachedResponse;
	}

	const networkResponse = await networkUpdate;
	if (networkResponse) {
		return networkResponse;
	}

	return new Response('Offline', {
		status: 503,
		statusText: 'Service Unavailable',
		headers: { 'Content-Type': 'text/plain' },
	});
}

async function matchTierCache(
	tier: CacheTier,
	request: RequestInfo
): Promise<Response | undefined> {
	if (tier !== 'corpus') {
		return caches.match(request, { cacheName: cacheName(tier, version) });
	}

	for (const name of (await caches.keys()).filter(name => /^apato-corpus-/.test(name))) {
		const response = await caches.match(request, { cacheName: name });
		if (response) return response;
	}
	return undefined;
}

self.addEventListener('fetch', event => {
	const { request } = event;
	const url = new URL(request.url);

	if (request.method !== 'GET') return;

	const disposition = classifyRequest(url, self.location.origin, request.destination, manifest);
	if (disposition === 'navigation') event.respondWith(handleNavigation(event));
	if (disposition === 'asset') event.respondWith(handleAssetRequest(request, url));
});
