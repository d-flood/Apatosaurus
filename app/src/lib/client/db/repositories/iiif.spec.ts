import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MemoryStoreBackend } from '$lib/client/store/memory-store-backend.spec-support';
import { createProject } from './projects';
import { createTranscription } from './transcriptions';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import {
	deleteManifestSource,
	ensureManifestSource,
	findLinkedPageForCanvas,
	getCanvasAnnotation,
	listManifestSources,
	listPageCanvasLinks,
	savePageCanvasLinks,
	upsertCanvasAnnotation,
	upsertPageCanvasLink,
} from './iiif';

let harness: LocalDbTestHarness;

beforeEach(async () => {
	harness = createLocalDbTestHarness();
	await createProject(
		harness.db,
		{ id: 'default-project', storageSlug: 'default-project', name: 'Default' },
		{ backend: new MemoryStoreBackend() }
	);
	await createTranscription(harness.db, {
		id: 'tx-1',
		title: 'Romans',
		siglum: 'R',
		transcriber: '',
		repository: '',
		settlement: '',
		language: 'la',
	});
});

afterEach(async () => {
	await harness.destroy();
});

describe('iiif repository', () => {
	it('upserts manifest sources by transcription and URL', async () => {
		await ensureManifestSource(harness.db, {
			transcriptionId: 'tx-1',
			manifestUrl: 'https://example.org/manifest.json',
			label: 'Initial',
			metadata: { source: 'test' },
		});
		const updated = await ensureManifestSource(harness.db, {
			transcriptionId: 'tx-1',
			manifestUrl: 'https://example.org/manifest.json',
			label: 'Updated',
			manifestJson: { id: 'manifest' },
		});

		const rows = await listManifestSources(harness.db, 'tx-1');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: updated.id,
			label: 'Updated',
			metadata: { source: 'test', manifestJson: { id: 'manifest' } },
		});
	});

	it('upserts and batch saves page canvas links with hard deletes through manifest cascade', async () => {
		const source = await ensureManifestSource(harness.db, {
			transcriptionId: 'tx-1',
			manifestUrl: 'https://example.org/manifest.json',
		});
		await upsertPageCanvasLink(harness.db, linkInput(source.id, 'page-1', 'canvas-old', 0));
		const updated = await upsertPageCanvasLink(
			harness.db,
			linkInput(source.id, 'page-1', 'canvas-new', 1)
		);
		await savePageCanvasLinks(harness.db, [linkInput(source.id, 'page-2', 'canvas-2', 2)]);

		expect(updated.canvasId).toBe('canvas-new');
		expect(
			await findLinkedPageForCanvas(harness.db, {
				transcriptionId: 'tx-1',
				manifestSourceId: source.id,
				canvasId: 'canvas-new',
			})
		).toMatchObject({ pageId: 'page-1' });
		expect(await listPageCanvasLinks(harness.db, 'tx-1')).toHaveLength(2);

		await deleteManifestSource(harness.db, {
			transcriptionId: 'tx-1',
			manifestSourceId: source.id,
		});
		expect(await listPageCanvasLinks(harness.db, 'tx-1')).toEqual([]);
	});

	it('upserts canvas annotations and returns header previews without loading full body text', async () => {
		const source = await ensureManifestSource(harness.db, {
			transcriptionId: 'tx-1',
			manifestUrl: 'https://example.org/manifest.json',
		});
		await upsertCanvasAnnotation(harness.db, {
			transcriptionId: 'tx-1',
			manifestSourceId: source.id,
			pageId: 'page-1',
			canvasId: 'canvas-1',
			anchor: { pageId: 'page-1' },
			annotation: {
				'@context': 'http://www.w3.org/ns/anno.jsonld',
				id: 'anno-1',
				type: 'Annotation',
				body: [
					{ type: 'TextualBody', value: 'A long annotation body', purpose: 'commenting' },
				],
				target: { source: 'canvas-1', selector: { type: 'SvgSelector' } },
			},
		});

		const full = await getCanvasAnnotation(harness.db, {
			transcriptionId: 'tx-1',
			manifestSourceId: source.id,
			annotationId: 'anno-1',
		});
		expect(full?.__fullBodyLoaded).toBe(true);
		expect(Array.isArray(full?.body) ? full.body[0]?.value : full?.body?.value).toBe(
			'A long annotation body'
		);
	});
});

function linkInput(manifestSourceId: string, pageId: string, canvasId: string, order: number) {
	return {
		transcriptionId: 'tx-1',
		pageId,
		pageNameSnapshot: pageId,
		pageOrder: order,
		manifestSourceId,
		manifestUrlSnapshot: 'https://example.org/manifest.json',
		canvasId,
		canvasOrder: order,
		canvasLabel: canvasId,
		imageServiceUrl: null,
		thumbnailUrl: null,
	};
}
