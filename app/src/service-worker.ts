/// <reference types="@sveltejs/kit" />
import { base, build, files, version } from '$service-worker';

const CACHE_NAME = `apatopwa-${version}`;
const OFFLINE_URL = `${base}/offline`;
const APP_SHELL = [`${base}/`, OFFLINE_URL, `${base}/manifest.json`];
const PRECACHE_URLS = Array.from(new Set([...APP_SHELL, ...build]));
const STATIC_EXTENSIONS = [
	'.js',
	'.css',
	'.woff',
	'.woff2',
	'.ttf',
	'.otf',
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.svg',
	'.webp',
	'.ico',
	'.json',
	'.wasm',
];

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			await Promise.all(
				PRECACHE_URLS.map(async (url) => {
					try {
						await cache.add(url);
					} catch (error) {
						console.warn('[Service Worker] Failed to precache', url, error);
					}
				})
			);
		})()
	);
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const cacheNames = await caches.keys();
			await Promise.all(
				cacheNames
					.filter((name) => name !== CACHE_NAME)
					.map((name) => caches.delete(name))
			);
		})()
	);
	self.clients.claim();
});

function isSameOriginAsset(url: URL): boolean {
	if (url.origin !== self.location.origin) {
		return false;
	}

	if (url.pathname.startsWith('/_app/')) {
		return true;
	}

	if (files.includes(url.pathname)) {
		return true;
	}

	return STATIC_EXTENSIONS.some((ext) => url.pathname.endsWith(ext));
}

async function handleNavigation(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE_NAME);

	try {
		const networkResponse = await fetch(request);
		if (networkResponse.ok) {
			await cache.put(request, networkResponse.clone());
		}
		return networkResponse;
	} catch {
		const cachedResponse = await cache.match(request);
		if (cachedResponse) {
			return cachedResponse;
		}

		const offlineResponse = await cache.match(OFFLINE_URL);
		if (offlineResponse) {
			return offlineResponse;
		}

		return new Response('Offline', {
			status: 503,
			statusText: 'Service Unavailable',
			headers: { 'Content-Type': 'text/plain' },
		});
	}
}

async function handleAssetRequest(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE_NAME);
	const cachedResponse = await cache.match(request);

	const networkUpdate = fetch(request)
		.then((response) => {
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

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	if (request.method !== 'GET') {
		return;
	}

	if (url.origin !== self.location.origin) {
		return;
	}

	if (url.pathname.startsWith('/@vite') || url.pathname.startsWith('/@fs/')) {
		return;
	}

	if (
		request.destination === 'worker' ||
		request.destination === 'sharedworker' ||
		request.destination === 'serviceworker'
	) {
		return;
	}

	if (request.mode === 'navigate') {
		event.respondWith(handleNavigation(request));
		return;
	}

	if (isSameOriginAsset(url)) {
		event.respondWith(handleAssetRequest(request));
	}
});
