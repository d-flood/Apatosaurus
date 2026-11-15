import { buildSyntheticManifest, isSyntheticManifestUrl } from './syntheticManifest';
import type { ManifestSourceSummary } from './types';

export interface RestoreCachedManifestDeps {
	fetchManifestJson: (manifestUrl: string) => Promise<Record<string, any>>;
	cacheManifest: (input: {
		manifestUrl: string;
		manifestJson: Record<string, any>;
	}) => Promise<void>;
}

export async function restoreCachedManifest(
	source: ManifestSourceSummary,
	deps: RestoreCachedManifestDeps
): Promise<Record<string, any>> {
	if (source.manifestJson) return source.manifestJson;
	let manifestJson: Record<string, any>;
	if (isSyntheticManifestUrl(source.manifestUrl)) {
		if (source.syntheticCanvases.length === 0) {
			throw new Error('Saved synthetic source has no canvases to rebuild its manifest from.');
		}
		manifestJson = buildSyntheticManifest({
			manifestUrl: source.manifestUrl,
			label: source.label,
			canvases: source.syntheticCanvases,
		});
	} else {
		manifestJson = await deps.fetchManifestJson(source.manifestUrl);
	}
	await deps.cacheManifest({ manifestUrl: source.manifestUrl, manifestJson });
	return manifestJson;
}
