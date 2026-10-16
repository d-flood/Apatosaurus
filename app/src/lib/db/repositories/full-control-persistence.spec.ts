import { expect, it } from 'vitest';
import fixture from '$lib/storage/formats/fixtures/collation-v16.expected.json';
import { parseCollationDocument } from '$lib/collation/collation-document';
import { MockCloudStorageProvider } from '$lib/backup/providers/mock-provider';
import { backupProject } from '$lib/backup/sync-manager';
import { ensureLocationMarker } from '$lib/backup/location-marker';
import { discoverLocationProjects } from '$lib/backup/location-discovery';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import { collationPrimaryFile, projectManifestFile } from '$lib/storage/layout';
import { readTextFile } from '$lib/storage/opfs-store';
import {
	COLLATION_FORMAT,
	PROJECT_MANIFEST_FORMAT,
	readCanonicalDocument,
	type CollationPayload,
	type ProjectManifestPayload,
} from '$lib/storage/formats';
import {
	createCollationWithFiles,
	createTranscriptionWithFiles,
	createLocalDbTestHarness,
} from '$lib/testing/local-db-harness';
import { createProject, getProject, updateProjectMetadata } from './projects';
import {
	loadCollationWithWorkingFile,
	saveWorkingCollationArtifact,
	saveWorkingCollationMetadata,
} from './collation-files';
import { rebuildIndexFromStore } from './index-rebuild';

it('keeps every full-control field through save, load, two-store sync and index rebuild', async () => {
	const source = createLocalDbTestHarness();
	const destination = createLocalDbTestHarness();
	const rebuilt = createLocalDbTestHarness();
	const sourceOptions = { backend: new MemoryStoreBackend() };
	const destinationOptions = { backend: new MemoryStoreBackend() };
	const document = parseCollationDocument(fixture.document)!;
	const settings = {
		manualWitnesses: [
			{ id: 'father', siglum: 'Father', treatment: 'fragmentary', includeInCbgm: false },
			{ id: 'version', siglum: 'Version', treatment: 'full', includeInCbgm: true },
		],
		readingTags: [
			{ id: 'ns', label: 'Nomen sacrum' },
			{ id: 'abbreviation', label: 'Abbreviation' },
		],
	};
	try {
		expect(document).toEqual(fixture.document);
		await createProject(source.db, { id: 'project-1', name: 'Project' }, sourceOptions);
		await createTranscriptionWithFiles(
			source.db,
			{
				id: 'tx-1',
				projectId: 'project-1',
				title: 'A',
				siglum: 'A',
				document: { type: 'transcriptionDocument', pages: [] },
				transcriber: 'Editor',
				repository: 'Library',
				settlement: 'City',
				language: 'grc',
			},
			sourceOptions
		);
		await createCollationWithFiles(
			source.db,
			{
				id: 'col-1',
				projectId: 'project-1',
				title: 'John 1:1',
				verseIdentifier: 'John 1:1',
				segment: document.setup.segment,
			},
			sourceOptions
		);
		const provider = new MockCloudStorageProvider();
		await ensureLocationMarker(
			provider,
			provider.rootFolderId,
			'full-control-location',
			'2026-10-01T00:00:00.000Z'
		);
		const cloudFolderId = await provider.createFolder('Project');
		const context = {
			projectId: 'project-1',
			connectionId: 'source',
			cloudFolderId,
			cloudFolderPath: 'Project',
		};
		const destinationContext = { ...context, connectionId: 'destination' };

		await updateProjectMetadata(
			source.db,
			{ projectId: 'project-1', collationSettings: settings },
			sourceOptions
		);
		await saveWorkingCollationArtifact(
			source.db,
			{
				collationId: 'col-1',
				artifactType: 'collation_document_v1',
				payload: JSON.stringify(document),
			},
			sourceOptions
		);
		const project = (await getProject(source.db, 'project-1'))!;
		const primary = await readCanonicalDocument<CollationPayload>(
			COLLATION_FORMAT,
			await readTextFile(collationPrimaryFile(project.storageSlug, 'col-1'), sourceOptions)
		);
		expect(primary.ok).toBe(true);
		if (!primary.ok) throw new Error('Saved collation did not validate.');
		expect(primary.payload.document).toEqual(document);
		const manifest = await readCanonicalDocument<ProjectManifestPayload>(
			PROJECT_MANIFEST_FORMAT,
			await readTextFile(projectManifestFile(project.storageSlug), sourceOptions)
		);
		expect(manifest.ok).toBe(true);
		if (!manifest.ok) throw new Error('Saved project did not validate.');
		expect(manifest.payload.collation_settings).toEqual(settings);

		const assertLoaded = async (store: typeof source, options: typeof sourceOptions) => {
			const loaded = await loadCollationWithWorkingFile(store.db, 'col-1', options);
			expect(loaded?.artifact).toBeDefined();
			expect(JSON.parse(loaded!.artifact!.payload)).toEqual(document);
			expect((await getProject(store.db, 'project-1'))?.collationSettings).toEqual(settings);
		};
		await assertLoaded(source, sourceOptions);
		const pushed = await backupProject(source.db, provider, context, {
			storeOptions: sourceOptions,
		});
		expect(pushed.uiState).toBe('synced');
		expect(pushed.uploadedPaths).toEqual(
			expect.arrayContaining(['collations/col-1.json', 'project.json'])
		);
		await assertLoaded(source, sourceOptions);
		const discovery = await discoverLocationProjects(
			destination.db,
			provider,
			provider.rootFolderId,
			{ storeOptions: destinationOptions }
		);
		expect(discovery.projects).toEqual([
			{ projectId: 'project-1', folderName: 'Project', imported: true },
		]);
		await assertLoaded(destination, destinationOptions);
		expect(
			(
				await backupProject(destination.db, provider, destinationContext, {
					storeOptions: destinationOptions,
				})
			).uiState
		).toBe('synced');
		await saveWorkingCollationMetadata(
			source.db,
			{ id: 'col-1', notes: 'Review continues on another device' },
			sourceOptions
		);
		expect(
			(await backupProject(source.db, provider, context, { storeOptions: sourceOptions }))
				.uiState
		).toBe('synced');
		const pulled = await backupProject(destination.db, provider, destinationContext, {
			storeOptions: destinationOptions,
		});
		expect(pulled.uiState).toBe('synced');
		expect(pulled.downloadedPaths).toContain('collations/col-1.json');
		await assertLoaded(destination, destinationOptions);
		const report = await rebuildIndexFromStore(rebuilt.db, destinationOptions);
		expect(report.quarantinedFiles).toEqual([]);
		expect(report.projectsRestored).toBe(1);
		expect(report.collationsRestored).toBe(1);
		await assertLoaded(rebuilt, destinationOptions);
	} finally {
		await source.destroy();
		await destination.destroy();
		await rebuilt.destroy();
	}
});
