import {
	createCbgmAnalysisWithFiles,
	createTranscriptionWithFiles,
	createLocalDbTestHarness,
	type LocalDbTestHarness,
} from '$lib/testing/local-db-harness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProject } from '$lib/db/repositories/projects';
import { completeCoherence, listAnalyses } from '$lib/db/repositories/cbgm-analyses';
import { joinStorePath, projectFolder } from '$lib/storage/layout';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import { readFileBytes, writeFileBytesAtomic } from '$lib/storage/opfs-store';
import {
	listProjectPlacements,
	listRemovedProjects,
	upsertProjectPlacements,
	type PlacedProject,
} from '$lib/storage/project-locations';
import { deleteProjectLocally, removeProjectsFromDevice } from './project-removal';

let harness: LocalDbTestHarness;
let storeOptions: { backend: MemoryStoreBackend };

beforeEach(() => {
	harness = createLocalDbTestHarness();
	storeOptions = { backend: new MemoryStoreBackend() };
});

afterEach(async () => {
	await harness.destroy();
});

describe('remove from this device', () => {
	it('is refused while an upload is pending', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Unsynced' }, storeOptions);
		await createTranscriptionWithFiles(
			harness.db,
			{
				id: 'tx-1',
				projectId: 'project-1',
				projectTranscriptionId: 'pt-1',
				title: 'Witness',
				siglum: '01',
				document: { type: 'transcriptionDocument', pages: [] },
				transcriber: 'Editor',
				repository: 'Library',
				settlement: 'City',
				language: 'grc',
			},
			storeOptions
		);
		const { storage_slug } = await harness.db
			.selectFrom('projects')
			.select('storage_slug')
			.executeTakeFirstOrThrow();
		const cachePath = joinStorePath(projectFolder(storage_slug), 'cbgm/x.sqlite');
		const cache = Uint8Array.from({ length: 1024 }, (_, index) => index % 256);
		await writeFileBytesAtomic(cachePath, cache, storeOptions);
		const placement: PlacedProject = {
			projectId: 'project-1',
			locationId: 'location-1',
			folderName: 'unsynced',
			needsLocationChoice: false,
		};
		await upsertProjectPlacements([placement], storeOptions);
		const filesBefore = [...storeOptions.backend.files.keys()].sort();

		const result = await removeProjectsFromDevice(harness.db, [placement], storeOptions);

		expect(result).toEqual({ ok: false, pendingProjectIds: ['project-1'] });
		expect(
			await harness.db
				.selectFrom('projects')
				.select('id')
				.where('id', '=', 'project-1')
				.execute()
		).toHaveLength(1);
		expect(await listProjectPlacements(storeOptions)).toEqual([placement]);
		expect(await listRemovedProjects(storeOptions)).toEqual([]);
		expect([...storeOptions.backend.files.keys()].sort()).toEqual(filesBefore);
		expect(await readFileBytes(cachePath, storeOptions)).toEqual(cache);
	});
});

describe('delete a project', () => {
	it('removes its analyses with it', async () => {
		await createProject(
			harness.db,
			{ id: 'project-1', storageSlug: 'romans', name: 'Romans' },
			storeOptions
		);
		await createCbgmAnalysisWithFiles(harness.db, 'project-1', {}, storeOptions);
		await completeCoherence(
			harness.db,
			'project-1',
			'analysis-1',
			Uint8Array.from({ length: 1024 }, (_, index) => index % 256),
			storeOptions
		);
		expect(
			[...storeOptions.backend.files.keys()].filter(path => path.includes('/romans/cbgm/'))
		).toHaveLength(3);

		await deleteProjectLocally(harness.db, 'project-1', storeOptions);

		expect(
			[...storeOptions.backend.files.keys()].filter(path => path.includes('/romans/'))
		).toEqual([]);
		expect(await listAnalyses(harness.db, 'project-1')).toEqual([]);
	});
});
