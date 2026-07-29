import { dev } from '$app/environment';
import { getStorageEstimate } from '$lib/client/capabilities';
import { notificationCenter } from '$lib/client/notification-center.svelte';
import {
	WARM_CACHE_MESSAGE,
	WARM_PROGRESS_MESSAGE,
	type CacheTier,
	type WarmConditions,
	type WarmProgress,
} from '$lib/client/offline-cache-policy';

const UPDATE_NOTIFICATION_ID = 'service-worker-update';
const warmProgressByTier = new Map<CacheTier, WarmProgress>();
const warmProgressListeners = new Set<(progress: WarmProgress) => void>();
let isListeningForWarmProgress = false;

type NetworkInformation = {
	saveData?: boolean;
	effectiveType?: string;
};

function offerUpdate(worker: ServiceWorker): void {
	notificationCenter.upsert({
		id: UPDATE_NOTIFICATION_ID,
		title: 'App update available',
		message: 'Apply the update when you are ready. Your page will not reload automatically.',
		tone: 'neutral',
		persistent: true,
		actions: [
			{
				id: 'apply-update',
				label: 'Apply update',
				variant: 'primary',
				onSelect: () => worker.postMessage({ type: 'SKIP_WAITING' }),
			},
		],
	});
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
	if (dev) {
		return null;
	}

	if (!('serviceWorker' in navigator)) {
		console.warn('Service Worker not supported');
		return null;
	}

	try {
		ensureWarmProgressListener();
		const registration = await navigator.serviceWorker.register('/service-worker.js', {
			scope: '/',
		});

		console.log('Service Worker registered:', registration.scope);
		let hasControlledPage = navigator.serviceWorker.controller !== null;
		if (registration.waiting) offerUpdate(registration.waiting);

		navigator.serviceWorker.addEventListener('controllerchange', () => {
			notificationCenter.remove(UPDATE_NOTIFICATION_ID);
			if (hasControlledPage) scheduleCacheWarm(registration, 'routes');
			hasControlledPage = true;
		});

		registration.addEventListener('updatefound', () => {
			const newWorker = registration.installing;

			if (newWorker) {
				newWorker.addEventListener('statechange', () => {
					if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
						offerUpdate(newWorker);
					}
				});
			}
		});

		return registration;
	} catch (error) {
		console.error('Service Worker registration failed:', error);
		return null;
	}
}

export async function requestCacheWarmNow(tier: CacheTier): Promise<void> {
	if (!('serviceWorker' in navigator)) return;
	const registration = await navigator.serviceWorker.getRegistration();
	if (!registration) return;
	await requestCacheWarm(registration, tier);
}

export function scheduleCacheWarm(
	registration: ServiceWorkerRegistration,
	tier: CacheTier
): () => void {
	const run = () => void requestCacheWarm(registration, tier);
	const idleWindow = window as unknown as {
		requestIdleCallback?: (callback: () => void, options: { timeout: number }) => number;
		cancelIdleCallback?: (id: number) => void;
	};
	if (idleWindow.requestIdleCallback) {
		const idleId = idleWindow.requestIdleCallback(run, { timeout: 5_000 });
		return () => idleWindow.cancelIdleCallback?.(idleId);
	}

	const timeoutId = globalThis.setTimeout(run, 0);
	return () => globalThis.clearTimeout(timeoutId);
}

export async function requestCacheWarm(
	registration: ServiceWorkerRegistration,
	tier: CacheTier
): Promise<void> {
	const estimate = await getStorageEstimate();
	const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
	const conditions: WarmConditions = {
		tier,
		saveData: connection?.saveData === true,
		effectiveType: connection?.effectiveType ?? null,
		estimate: { usage: estimate.usage, quota: estimate.quota },
	};
	const readyRegistration = registration.active
		? registration
		: await navigator.serviceWorker.ready;
	const worker = navigator.serviceWorker.controller ?? readyRegistration.active;
	worker?.postMessage({ type: WARM_CACHE_MESSAGE, conditions });
}

export function onCacheWarmProgress(listener: (progress: WarmProgress) => void): () => void {
	if (!('serviceWorker' in navigator)) return () => {};
	ensureWarmProgressListener();
	warmProgressListeners.add(listener);
	for (const progress of warmProgressByTier.values()) listener(progress);
	return () => warmProgressListeners.delete(listener);
}

export async function getOfflineCacheSize(): Promise<number | null> {
	if (!('caches' in globalThis)) return null;
	const cacheNames = (await caches.keys()).filter(isOfflineCacheName);
	let total = 0;
	for (const name of cacheNames) {
		const cache = await caches.open(name);
		const responses = await cache.matchAll();
		for (const response of responses) total += (await response.clone().blob()).size;
	}
	return total;
}

export async function getCorpusCacheEntryCount(): Promise<number> {
	if (!('caches' in globalThis)) return 0;
	const corpusCacheNames = (await caches.keys()).filter(isCorpusCacheName);
	const urls = new Set<string>();
	for (const name of corpusCacheNames) {
		const cache = await caches.open(name);
		for (const request of await cache.keys()) urls.add(request.url);
	}
	return urls.size;
}

export async function releaseCorpusCache(): Promise<void> {
	if (!('caches' in globalThis)) return;
	const corpusCacheNames = (await caches.keys()).filter(isCorpusCacheName);
	await Promise.all(corpusCacheNames.map(name => caches.delete(name)));
}

export function unregisterServiceWorker(): Promise<boolean> {
	if (!('serviceWorker' in navigator)) {
		return Promise.resolve(false);
	}

	return navigator.serviceWorker.getRegistration().then(registration => {
		if (registration) {
			return registration.unregister();
		}
		return false;
	});
}

function ensureWarmProgressListener(): void {
	if (isListeningForWarmProgress) return;
	isListeningForWarmProgress = true;
	navigator.serviceWorker.addEventListener('message', event => {
		if (event.data?.type !== WARM_PROGRESS_MESSAGE) return;
		const progress = event.data.progress as WarmProgress;
		warmProgressByTier.set(progress.tier, progress);
		for (const listener of warmProgressListeners) listener(progress);
	});
}

function isOfflineCacheName(name: string): boolean {
	return /^apato-(shell|routes|corpus)-/.test(name);
}

function isCorpusCacheName(name: string): boolean {
	return /^apato-corpus-/.test(name);
}
