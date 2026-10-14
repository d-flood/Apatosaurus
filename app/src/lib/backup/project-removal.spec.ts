import {
	createTranscriptionWithFiles,
	createLocalDbTestHarness,
	type LocalDbTestHarness,
} from '$lib/testing/local-db-harness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProject } from '$lib/db/repositories/projects';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import {
	listProjectPlacements,
	listRemovedProjects,
	upsertProjectPlacements,
	type PlacedProject,
} from '$lib/storage/project-locations';
import { removeProjectsFromDevice } from './project-removal';

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
	});
});
