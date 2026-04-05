import { describe, expect, it } from 'vitest';

import {
	buildExternalImageManifest,
	buildSyntheticManifestUrl,
	createExternalImageImportMetadata,
	getExternalImageLabel,
	parseExternalImageUrls,
} from './externalImageManifest';

describe('externalImageManifest', () => {
	it('parses newline-delimited image URLs', () => {
		expect(
			parseExternalImageUrls('\nhttps://example.org/1.jpg\r\n\n https://example.org/2.png \n')
		).toEqual(['https://example.org/1.jpg', 'https://example.org/2.png']);
	});

	it('builds a stable synthetic manifest URL and metadata', () => {
		const urls = ['https://example.org/1.jpg', 'https://example.org/2.png'];
		expect(buildSyntheticManifestUrl(urls)).toBe(buildSyntheticManifestUrl(urls));
		expect(createExternalImageImportMetadata(urls)).toMatchObject({
			inputKind: 'external-image-list',
			synthetic: true,
			imageCount: 2,
			imageUrls: urls,
		});
	});

	it('derives labels from filenames and falls back gracefully', () => {
		expect(getExternalImageLabel('https://example.org/images/Folio%201r.jpeg', 0)).toBe(
			'Folio 1r'
		);
		expect(getExternalImageLabel('not-a-url', 1)).toBe('Image 2');
	});

	it('builds a presentation 3 manifest for raw image URLs', () => {
		const manifest = buildExternalImageManifest({
			manifestUrl: 'urn:apatopwa:test',
			images: [
				{
					url: 'https://example.org/1.jpg',
					width: 1200,
					height: 800,
					label: 'Image 1',
					canvasId: 'urn:apatopwa:test/canvas/1',
					annotationPageId: 'urn:apatopwa:test/canvas/1/page/1',
					annotationId: 'urn:apatopwa:test/canvas/1/painting/1',
				},
			],
		});

		expect(manifest).toMatchObject({
			id: 'urn:apatopwa:test',
			type: 'Manifest',
			label: { none: ['External images (1)'] },
			items: [
				{
					id: 'urn:apatopwa:test/canvas/1',
					type: 'Canvas',
					width: 1200,
					height: 800,
					items: [
						{
							items: [
								{
									body: {
										id: 'https://example.org/1.jpg',
										type: 'Image',
										format: 'image/jpeg',
									},
								},
							],
						},
					],
				},
			],
		});
	});
});
