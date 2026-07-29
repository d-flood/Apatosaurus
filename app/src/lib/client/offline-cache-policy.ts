export type CacheTier = 'shell' | 'routes' | 'corpus';

export interface PrecacheManifest {
	build: string[];
	files: string[];
	prerendered: string[];
	base: string;
	version: string;
}

export type RequestDisposition = 'navigation' | 'asset' | 'bypass';

export type WarmState = 'idle' | 'warming' | 'ready' | 'partial' | 'skipped' | 'failed';

export interface WarmProgress {
	tier: CacheTier;
	state: WarmState;
	completed: number;
	total: number;
	bytesCached: number | null;
	reason?: 'save-data' | 'slow-network' | 'quota' | 'network-error';
}

export interface WarmConditions {
	saveData: boolean;
	effectiveType: string | null;
	estimate: { usage: number | null; quota: number | null };
	tier: CacheTier;
}

export const WARM_CACHE_MESSAGE = 'OFFLINE_CACHE_WARM';
export const WARM_PROGRESS_MESSAGE = 'OFFLINE_CACHE_PROGRESS';
export const CORPUS_APPROXIMATE_BYTES = 44 * 1024 * 1024;

const CACHE_PREFIX = 'apato';
const CACHE_TIERS: CacheTier[] = ['shell', 'routes', 'corpus'];

export function partitionPrecache(manifest: PrecacheManifest): Record<CacheTier, string[]> {
	const shellUrl = `${manifest.base}/`;
	const manifestUrl = `${manifest.base}/manifest.json`;
	const shellBuild = manifest.build.filter(isShellBuildEntry);
	const shell = unique([
		shellUrl,
		...(manifest.files.includes(manifestUrl) ? [manifestUrl] : []),
		...manifest.prerendered,
		...shellBuild,
	]);
	const shellEntries = new Set(shell);

	return {
		shell,
		routes: unique(manifest.build.filter(entry => !shellEntries.has(entry))),
		corpus: unique(manifest.files.filter(entry => !shellEntries.has(entry))),
	};
}

export function classifyRequest(
	url: URL,
	origin: string,
	destination: string,
	manifest: PrecacheManifest
): RequestDisposition {
	if (
		url.origin !== origin ||
		url.pathname.startsWith('/@vite') ||
		url.pathname.startsWith('/@fs/') ||
		destination === 'worker' ||
		destination === 'sharedworker' ||
		destination === 'serviceworker'
	) {
		return 'bypass';
	}

	if (destination === 'document') {
		return 'navigation';
	}

	return cacheTierForUrl(url, manifest) === null ? 'bypass' : 'asset';
}

export function cacheTierForUrl(url: URL, manifest: PrecacheManifest): CacheTier | null {
	const tiers = partitionPrecache(manifest);
	for (const tier of CACHE_TIERS) {
		if (tiers[tier].includes(url.pathname)) return tier;
	}
	return null;
}

export function cacheName(tier: CacheTier, version: string): string {
	return `${CACHE_PREFIX}-${tier}-${version}`;
}

export function cachesToRetain(existingCacheNames: string[], version: string): string[] {
	const currentNames = new Set(CACHE_TIERS.map(tier => cacheName(tier, version)));
	let previousVersion: string | null = null;

	for (const name of existingCacheNames) {
		const parsed = parseCacheName(name);
		if (parsed && parsed.tier !== 'corpus' && parsed.version !== version) {
			previousVersion = parsed.version;
		}
	}

	return existingCacheNames.filter(name => {
		if (currentNames.has(name)) return true;

		const parsed = parseCacheName(name);
		return (
			parsed?.tier === 'corpus' ||
			(parsed?.version === previousVersion &&
				(parsed.tier === 'shell' || parsed.tier === 'routes'))
		);
	});
}

export function shouldWarm(conditions: WarmConditions): boolean {
	if (conditions.tier === 'shell') return true;
	if (conditions.saveData) return false;
	if (conditions.effectiveType === 'slow-2g' || conditions.effectiveType === '2g') return false;
	if (conditions.tier === 'corpus' && !hasCorpusStorageHeadroom(conditions.estimate))
		return false;

	const { usage, quota } = conditions.estimate;
	return usage === null || quota === null || quota <= 0 || usage / quota < 0.8;
}

export function hasCorpusStorageHeadroom(estimate: {
	usage: number | null;
	quota: number | null;
}): boolean {
	if (estimate.usage === null || estimate.quota === null || estimate.quota <= 0) return true;
	return estimate.quota - estimate.usage >= CORPUS_APPROXIMATE_BYTES;
}

function parseCacheName(name: string): { tier: CacheTier; version: string } | null {
	for (const tier of CACHE_TIERS) {
		const prefix = `${CACHE_PREFIX}-${tier}-`;
		if (name.startsWith(prefix) && name.length > prefix.length) {
			return { tier, version: name.slice(prefix.length) };
		}
	}
	return null;
}

function isShellBuildEntry(entry: string): boolean {
	return (
		/_app\/immutable\/entry\/(?:start|app)\.[^/]+\.js$/.test(entry) ||
		/_app\/immutable\/nodes\/[01]\.[^/]+\.js$/.test(entry) ||
		/_app\/immutable\/assets\/0\.[^/]+\.css$/.test(entry)
	);
}

function unique(entries: string[]): string[] {
	return Array.from(new Set(entries));
}
