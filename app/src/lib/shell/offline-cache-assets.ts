import {
	cacheName,
	cacheTierForUrl,
	shouldRevalidateAsset,
	type CacheTier,
	type PrecacheManifest,
} from './offline-cache-policy';

export async function handleAssetRequest(
	request: Request,
	url: URL,
	manifest: PrecacheManifest
): Promise<Response> {
	const tier = cacheTierForUrl(url, manifest);
	if (tier === null) return fetch(request);

	const cache = await caches.open(cacheName(tier, manifest.version));
	const cached = await matchTierCache(tier, request, manifest.version);
	const cachedResponse = cached?.ok ? cached : undefined;
	if (cachedResponse && !shouldRevalidateAsset(url, request.destination)) return cachedResponse;

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

export async function matchTierCache(
	tier: CacheTier,
	request: RequestInfo,
	version: string
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
