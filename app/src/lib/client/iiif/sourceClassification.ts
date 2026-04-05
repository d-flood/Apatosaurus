import { isExternalImageManifestSource } from './externalImageManifest';
import { isIntfManifestSource } from './intfManifest';
import type { IiifSourceCategory, ManifestSourceSummary } from './types';

export function getManifestSourceCategory(
	source: ManifestSourceSummary | null | undefined
): IiifSourceCategory {
	if (!source) return 'iiif';
	if (isExternalImageManifestSource(source)) return 'urls';
	if (isIntfManifestSource(source)) return 'intf';
	if (source.manifestUrl.startsWith('urn:apatopwa:iiif:external-images:')) return 'urls';
	if (source.manifestUrl.startsWith('urn:apatopwa:iiif:intf:')) return 'intf';
	return 'iiif';
}

export function getManifestSourceCategoryLabel(category: IiifSourceCategory): string {
	switch (category) {
		case 'intf':
			return 'INTF';
		case 'urls':
			return 'URLs';
		default:
			return 'IIIF';
	}
}
