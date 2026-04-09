import { describe, expect, it } from 'vitest';

import { buildLinkedManifest } from './manifestBuilder';
import type { ManifestSourceSummary, PageCanvasLink } from './types';

function createManifestSource(id: string, canvasId: string, label: string): ManifestSourceSummary {
	return {
		id,
		transcriptionId: 'tx-1',
		manifestUrl: `https://example.org/${id}/manifest`,
		label,
		sourceKind: 'app',
		defaultCanvasId: canvasId,
		defaultImageServiceUrl: null,
		manifestJson: {
			'@context': 'http://iiif.io/api/presentation/3/context.json',
			id: `https://example.org/${id}/manifest`,
			type: 'Manifest',
			items: [
				{
					id: canvasId,
					type: 'Canvas',
					width: 100,
					height: 200,
					items: [
						{
							id: `${canvasId}/page/1`,
							type: 'AnnotationPage',
							items: [
								{
									id: `${canvasId}/painting/1`,
									type: 'Annotation',
									motivation: 'painting',
									target: canvasId,
									body: {
										id: `https://example.org/${id}/full/full/0/default.jpg`,
										type: 'Image',
									},
								},
							],
						},
					],
				},
			],
		},
		metadata: {},
		createdAt: '2026-03-24T00:00:00.000Z',
		updatedAt: '2026-03-24T00:00:00.000Z',
	};
}

function createLink(
	manifestSourceId: string,
	pageId: string,
	pageOrder: number,
	canvasId: string,
	canvasOrder = 1,
	canvasLabel = `Canvas ${pageOrder}`
): PageCanvasLink {
	return {
		id: `${manifestSourceId}-${pageId}`,
		transcriptionId: 'tx-1',
		pageId,
		pageNameSnapshot: `Page ${pageOrder}`,
		pageOrder,
		manifestSourceId,
		manifestUrlSnapshot: `https://example.org/${manifestSourceId}/manifest`,
		canvasId,
		canvasOrder,
		canvasLabel,
		imageServiceUrl: null,
		thumbnailUrl: null,
		linkRole: 'primary',
		createdAt: '2026-03-24T00:00:00.000Z',
		updatedAt: '2026-03-24T00:00:00.000Z',
	};
}

describe('buildLinkedManifest', () => {
	it('adds composite source metadata and synthetic canvas ids', () => {
		const manifest = buildLinkedManifest({
			transcriptionId: 'tx-1',
			transcriptionTitle: 'Test transcription',
			manifestSources: [
				createManifestSource('source-a', 'https://example.org/shared-canvas', 'Manifest A'),
				createManifestSource('source-b', 'https://example.org/shared-canvas', 'Manifest B'),
			],
			pageLinks: [
				createLink('source-a', 'page-1', 1, 'https://example.org/shared-canvas'),
				createLink('source-b', 'page-2', 2, 'https://example.org/shared-canvas'),
			],
		});

		expect(manifest).not.toBeNull();
		expect(manifest?.items).toHaveLength(2);

		const [firstCanvas, secondCanvas] = manifest!.items;
		expect(firstCanvas.id).not.toBe(secondCanvas.id);
		expect(firstCanvas.apatopwaSource).toEqual({
			manifestSourceId: 'source-a',
			sourceCanvasId: 'https://example.org/shared-canvas',
			pageId: 'page-1',
			pageOrder: 1,
		});
		expect(secondCanvas.apatopwaSource).toEqual({
			manifestSourceId: 'source-b',
			sourceCanvasId: 'https://example.org/shared-canvas',
			pageId: 'page-2',
			pageOrder: 2,
		});
		expect(firstCanvas.items[0].id).toBe(`${firstCanvas.id}/page/1`);
		expect(firstCanvas.items[0].items[0].target).toBe(firstCanvas.id);
	});

	it('groups multiple linked images for a page into one choice canvas', () => {
		const manifest = buildLinkedManifest({
			transcriptionId: 'tx-1',
			transcriptionTitle: 'Test transcription',
			manifestSources: [
				createManifestSource('source-a', 'https://example.org/canvas/a', 'Manifest A'),
				createManifestSource('source-b', 'https://example.org/canvas/b', 'Manifest B'),
				createManifestSource('source-c', 'https://example.org/canvas/c', 'Manifest C'),
			],
			pageLinks: [
				createLink('source-a', 'page-1', 1, 'https://example.org/canvas/a', 1, 'Color'),
				createLink('source-b', 'page-1', 1, 'https://example.org/canvas/b', 2, 'Infrared'),
				createLink(
					'source-c',
					'page-2',
					2,
					'https://example.org/canvas/c',
					1,
					'Page 2 image'
				),
			],
		});

		expect(manifest).not.toBeNull();
		expect(manifest?.items).toHaveLength(2);

		const [choiceCanvas, singleCanvas] = manifest!.items;
		expect(choiceCanvas.label).toEqual({ none: ['Page 1'] });
		expect(choiceCanvas.apatopwaSource).toEqual({
			manifestSourceId: 'source-a',
			sourceCanvasId: 'https://example.org/canvas/a',
			pageId: 'page-1',
			pageOrder: 1,
		});
		expect(choiceCanvas.items[0].items[0].body).toMatchObject({
			type: 'Choice',
			items: [
				{
					id: 'https://example.org/source-a/full/full/0/default.jpg',
					label: { none: ['Color'] },
					apatopwaSource: {
						manifestSourceId: 'source-a',
						sourceCanvasId: 'https://example.org/canvas/a',
						pageId: 'page-1',
						pageOrder: 1,
					},
				},
				{
					id: 'https://example.org/source-b/full/full/0/default.jpg',
					label: { none: ['Infrared'] },
					apatopwaSource: {
						manifestSourceId: 'source-b',
						sourceCanvasId: 'https://example.org/canvas/b',
						pageId: 'page-1',
						pageOrder: 1,
					},
				},
			],
		});
		expect(choiceCanvas.metadata).toEqual([
			{ label: { none: ['Page'] }, value: { none: ['Page 1'] } },
			{ label: { none: ['Source manifest'] }, value: { none: ['Manifest A', 'Manifest B'] } },
		]);
		expect(singleCanvas.label).toEqual({ none: ['Page 2:Page 2 image'] });
	});
});
