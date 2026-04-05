import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
	buildIntfManifest,
	buildIntfManifestUrl,
	createIntfImportMetadata,
	parseIntfPageImages,
} from './intfManifest';

describe('intfManifest', () => {
	it('parses the sample INTF manuscript JSON', () => {
		const sample = readFileSync(
			new URL('../../components/iiif/example_intf.json', import.meta.url),
			'utf8'
		);
		const parsed = parseIntfPageImages(sample);

		expect(parsed.docId).toBe(10045);
		expect(parsed.primaryName).toBe('P45');
		expect(parsed.pageCount).toBeGreaterThan(10);
		expect(parsed.pageImages.length).toBeGreaterThan(50);
		expect(parsed.pageImages[0]).toMatchObject({
			pageId: 8,
			folio: '1r',
			imageUrl: 'https://ntmss.info/images/webfriendly/10045/T0004411-2.jpg',
		});
	});

	it('normalizes object and array image payloads', () => {
		const parsed = parseIntfPageImages(
			JSON.stringify({
				status: 'success',
				data: {
					manuscript: {
						docID: 42,
						primaryName: 'Test',
						pages: {
							page: [
								{
									pageID: 1,
									folio: '1r',
									sortOrder: '00001',
									images: {
										image: {
											webFriendlyURL: 'https://example.org/1r.jpg',
											thumbURL: 'https://example.org/1r-thumb.jpg',
											surrID: 10,
										},
									},
								},
								{
									pageID: 2,
									folio: '1v',
									shelfFolioNums: '001v',
									sortOrder: '00002',
									images: {
										image: [
											{ webFriendlyURL: 'https://example.org/1v-a.jpg', surrID: 10 },
											{ uri: 'https://example.org/1v-b.jpg', surrID: 20 },
										],
									},
								},
							],
						},
					},
				},
			})
		);

		expect(parsed.pageImages).toHaveLength(3);
		expect(parsed.pageImages[1]).toMatchObject({
			folio: '1v',
			shelfFolioNums: '001v',
			label: '1v (surr 10)',
		});
		expect(parsed.pageImages[2]).toMatchObject({
			imageUrl: 'https://example.org/1v-b.jpg',
			label: '1v (surr 20)',
		});
	});

	it('builds stable import metadata and manifest JSON', () => {
		const manifestUrl = buildIntfManifestUrl({
			docId: 10045,
			pageImages: [
				{
					pageId: 8,
					sortOrder: 8,
					surrId: 10,
					imageUrl: 'https://example.org/1r.jpg',
				},
			],
		});
		const metadata = createIntfImportMetadata({
			docId: 10045,
			primaryName: 'P45',
			pageCount: 64,
			imageCount: 65,
		});
		const manifest = buildIntfManifest({
			manifestUrl,
			label: 'P45 (INTF 10045)',
			images: [
				{
					pageId: 8,
					pageOrder: 1,
					folio: '1r',
					shelfFolioNums: '',
					sortOrder: 8,
					imageUrl: 'https://example.org/1r.jpg',
					thumbnailUrl: 'https://example.org/1r-thumb.jpg',
					viewUrl: 'https://example.org/view/1r',
					surrId: 10,
					canvasId: `${manifestUrl}/canvas/1`,
					annotationPageId: `${manifestUrl}/canvas/1/page/1`,
					annotationId: `${manifestUrl}/canvas/1/painting/1`,
					label: '1r',
					width: 1200,
					height: 800,
				},
			],
		});

		expect(manifestUrl).toBe(buildIntfManifestUrl({
			docId: 10045,
			pageImages: [
				{ pageId: 8, sortOrder: 8, surrId: 10, imageUrl: 'https://example.org/1r.jpg' },
			],
		}));
		expect(metadata).toMatchObject({
			inputKind: 'intf-manuscript-json',
			docId: 10045,
			pageCount: 64,
			imageCount: 65,
		});
		expect(manifest).toMatchObject({
			id: manifestUrl,
			type: 'Manifest',
			label: { none: ['P45 (INTF 10045)'] },
			items: [
				{
					id: `${manifestUrl}/canvas/1`,
					label: { none: ['1r'] },
					thumbnail: [{ id: 'https://example.org/1r-thumb.jpg' }],
				},
			],
		});
	});

	it('rejects malformed JSON and empty page lists', () => {
		expect(() => parseIntfPageImages('{')).toThrow('INTF input is not valid JSON.');
		expect(() =>
			parseIntfPageImages(
				JSON.stringify({ status: 'success', data: { manuscript: { pages: { page: [] } } } })
			)
		).toThrow('INTF manuscript JSON does not contain any pages.');
	});
});
