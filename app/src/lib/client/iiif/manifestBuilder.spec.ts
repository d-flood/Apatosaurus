import { describe, expect, it } from 'vitest';

import { buildLinkedManifest } from './manifestBuilder';
import type { ManifestSourceSummary, PageCanvasLink } from './types';

const manifestSources: ManifestSourceSummary[] = [
	{
		id: 'source-1',
		transcriptionId: 'tx-1',
		manifestUrl: 'https://example.org/manifest',
		label: 'Example manifest',
		sourceKind: 'external',
		defaultCanvasId: null,
		defaultImageServiceUrl: null,
		manifestJson: {
			'@context': 'http://iiif.io/api/presentation/3/context.json',
			id: 'https://example.org/manifest',
			type: 'Manifest',
			label: { none: ['Example manifest'] },
			items: [
				{
					id: 'https://example.org/canvas/1',
					type: 'Canvas',
					label: { none: ['Image one'] },
					width: 100,
					height: 200,
					items: [],
				},
			],
		},
		metadata: {},
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	},
];

const pageLinks: PageCanvasLink[] = [
	{
		id: 'link-1',
		transcriptionId: 'tx-1',
		pageId: 'page-1',
		pageNameSnapshot: 'Folio 1r',
		pageOrder: 1,
		manifestSourceId: 'source-1',
		manifestUrlSnapshot: 'https://example.org/manifest',
		canvasId: 'https://example.org/canvas/1',
		canvasOrder: 1,
		canvasLabel: 'Image one',
		imageServiceUrl: null,
		thumbnailUrl: null,
		linkRole: 'primary',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	},
];

describe('buildLinkedManifest', () => {
	it('labels linked canvases with page and image labels', () => {
		const manifest = buildLinkedManifest({
			transcriptionId: 'tx-1',
			transcriptionTitle: 'Transcript',
			manifestSources,
			pageLinks,
		});

		expect(manifest?.items[0]?.label).toEqual({ none: ['Folio 1r:Image one'] });
	});

	it('skips links whose source manifests are unavailable', () => {
		const manifest = buildLinkedManifest({
			transcriptionId: 'tx-1',
			transcriptionTitle: 'Transcript',
			manifestSources: [
				{
					...manifestSources[0],
					manifestJson: null,
				},
			],
			pageLinks,
		});

		expect(manifest).toBeNull();
	});
});
