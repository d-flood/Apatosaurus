import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProject } from '$lib/db/repositories/projects';
import { createTranscription } from '$lib/db/repositories/transcriptions';
import { ensureManifestSource, listManifestSources } from '$lib/db/repositories/iiif';
import { cacheManifest } from '$lib/db/repositories/iiif-manifest-cache';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '$lib/testing/local-db-harness';

import { buildExternalImageManifest } from './externalImageManifest';
import { restoreCachedManifest } from './manifestCache';

let harness: LocalDbTestHarness;

beforeEach(async () => {
	harness = createLocalDbTestHarness();
	await createProject(
		harness.db,
		{ id: 'project-1', storageSlug: 'project-1', name: 'Project' },
		{ backend: new MemoryStoreBackend() }
	);
	await createTranscription(harness.db, {
		id: 'tx-1',
		projectId: 'project-1',
		title: 'Romans',
		siglum: 'R',
		transcriber: '',
		repository: '',
		settlement: '',
		language: 'grc',
	});
});

afterEach(async () => {
	await harness.destroy();
});

async function restore(fetchManifestJson: (url: string) => Promise<Record<string, any>>) {
	const [source] = await listManifestSources(harness.db, 'tx-1');
	expect(source.manifestJson).toBeNull();
	await restoreCachedManifest(source, {
		fetchManifestJson,
		cacheManifest: input => cacheManifest(harness.db, input),
	});
	return (await listManifestSources(harness.db, 'tx-1'))[0];
}

describe('IIIF workspace manifest cache', () => {
	it('re-fetches a manifest whose cache entry is missing', async () => {
		const manifestUrl = 'https://example.org/iiif/manifest.json';
		const manifestJson = { id: manifestUrl, type: 'Manifest', items: [] };
		await ensureManifestSource(harness.db, {
			transcriptionId: 'tx-1',
			manifestUrl,
			manifestJson,
		});
		harness.sqlite.prepare('DELETE FROM iiif_manifest_cache').run();
		const fetchManifestJson = vi.fn(async () => manifestJson);

		const restored = await restore(fetchManifestJson);

		expect(fetchManifestJson).toHaveBeenCalledWith(manifestUrl);
		expect(restored.manifestJson).toEqual(manifestJson);
	});

	it('rebuilds a synthetic manifest from its stored canvases without fetching', async () => {
		const manifestUrl = 'urn:apatopwa:iiif:external-images:0a1b2c3d';
		const canvasId = `${manifestUrl}/canvas/1`;
		const manifestJson = buildExternalImageManifest({
			manifestUrl,
			images: [
				{
					url: 'https://images.example.org/1.jpg',
					width: 1200,
					height: 1600,
					label: '1',
					canvasId,
					annotationPageId: `${canvasId}/page/1`,
					annotationId: `${canvasId}/painting/1`,
				},
			],
		});
		await ensureManifestSource(harness.db, {
			transcriptionId: 'tx-1',
			manifestUrl,
			label: 'External images (1)',
			manifestJson,
		});
		harness.sqlite.prepare('DELETE FROM iiif_manifest_cache').run();
		const fetchManifestJson = vi.fn();

		const restored = await restore(fetchManifestJson);

		expect(fetchManifestJson).not.toHaveBeenCalled();
		expect(restored.manifestJson).toEqual(manifestJson);
	});
});
