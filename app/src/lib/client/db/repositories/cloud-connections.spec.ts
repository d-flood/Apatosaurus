import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MemoryStoreBackend } from '$lib/client/store/memory-store-backend.spec-support';
import { createProject as createProjectRepository } from './projects';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import {
	disconnectCloudConnection,
	getCloudConnection,
	getCloudConnectionByProviderAccount,
	getCloudProjectFolder,
	listCloudProjectFolders,
	listCloudConnections,
	unlinkCloudProjectFolder,
	updateCloudProjectFolderSyncState,
	upsertCloudConnection,
	upsertCloudProjectFolder,
	wipeCloudConnections,
} from './cloud-connections';

let harness: LocalDbTestHarness;
let backend: MemoryStoreBackend;

beforeEach(() => {
	harness = createLocalDbTestHarness();
	backend = new MemoryStoreBackend();
});

afterEach(async () => {
	await harness.destroy();
});

function createProject(
	db: Parameters<typeof createProjectRepository>[0],
	input: Parameters<typeof createProjectRepository>[1]
) {
	return createProjectRepository(db, input, { backend });
}

describe('cloud connection metadata persistence', () => {
	it('stores and updates connection metadata in the local database', async () => {
		const connection = await upsertCloudConnection(harness.db, {
			id: 'conn-1',
			providerId: 'mock',
			providerAccountId: 'acct-1',
			accountEmail: ' editor@example.com ',
			scopes: ['files.content.write', 'files.content.read', 'files.content.read'],
			connectedAt: '2026-06-10T12:00:00.000Z',
		});
		const updated = await upsertCloudConnection(harness.db, {
			providerId: 'mock',
			providerAccountId: 'acct-1',
			accountEmail: ' updated@example.com ',
			scopes: ['files.content.write'],
			updatedAt: '2026-06-10T12:05:00.000Z',
		});

		expect(connection).toMatchObject({
			id: 'conn-1',
			providerId: 'mock',
			providerAccountId: 'acct-1',
			accountEmail: 'editor@example.com',
			scopes: ['files.content.read', 'files.content.write'],
		});
		expect(updated).toMatchObject({
			id: connection.id,
			accountEmail: 'updated@example.com',
			scopes: ['files.content.write'],
			updatedAt: '2026-06-10T12:05:00.000Z',
		});
		expect(
			await getCloudConnectionByProviderAccount(harness.db, 'mock', 'acct-1')
		).toMatchObject({
			id: connection.id,
		});
	});

	it('stores project backup folder bindings and sync state', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		await upsertCloudConnection(harness.db, {
			id: 'conn-1',
			providerId: 'mock',
			providerAccountId: 'acct-1',
			accountEmail: 'editor@example.com',
		});

		const folder = await upsertCloudProjectFolder(harness.db, {
			projectId: 'project-1',
			connectionId: 'conn-1',
			cloudFolderId: 'folder-1',
			cloudFolderPath: 'Apatosaurus/Projects/project-1',
		});

		expect(folder).toMatchObject({
			projectId: 'project-1',
			connectionId: 'conn-1',
			cloudFolderId: 'folder-1',
			syncCursor: '',
			lastFullySyncedAt: null,
		});
		await expect(listCloudProjectFolders(harness.db, 'project-1')).resolves.toHaveLength(1);

		await upsertCloudProjectFolder(harness.db, {
			projectId: 'project-1',
			connectionId: 'conn-1',
			cloudFolderId: 'folder-2',
			cloudFolderPath: 'Apatosaurus/Projects/project-1-renamed',
			syncCursor: 'cursor-1',
			lastFullySyncedAt: '2026-06-10T12:00:00.000Z',
		});
		await expect(
			getCloudProjectFolder(harness.db, 'project-1', 'conn-1')
		).resolves.toMatchObject({
			cloudFolderId: 'folder-2',
			cloudFolderPath: 'Apatosaurus/Projects/project-1-renamed',
			syncCursor: 'cursor-1',
			lastFullySyncedAt: '2026-06-10T12:00:00.000Z',
		});

		await updateCloudProjectFolderSyncState(harness.db, {
			projectId: 'project-1',
			connectionId: 'conn-1',
			syncCursor: 'cursor-2',
			lastFullySyncedAt: '2026-06-10T12:05:00.000Z',
		});
		await expect(
			getCloudProjectFolder(harness.db, 'project-1', 'conn-1')
		).resolves.toMatchObject({
			syncCursor: 'cursor-2',
			lastFullySyncedAt: '2026-06-10T12:05:00.000Z',
		});

		expect(await unlinkCloudProjectFolder(harness.db, 'project-1', 'conn-1')).toBe(true);
		await expect(getCloudProjectFolder(harness.db, 'project-1', 'conn-1')).resolves.toBeNull();
	});

	it('disconnects and wipes local connection metadata with dependent sync rows', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		await upsertCloudConnection(harness.db, {
			id: 'conn-1',
			providerId: 'mock',
			providerAccountId: 'acct-1',
			accountEmail: 'editor@example.com',
		});
		await harness.db
			.insertInto('cloud_project_folders')
			.values({
				project_id: 'project-1',
				connection_id: 'conn-1',
				cloud_folder_id: 'folder-1',
				cloud_folder_path: 'Project',
				sync_cursor: '',
				last_fully_synced_at: null,
			})
			.execute();

		expect(await disconnectCloudConnection(harness.db, 'conn-1')).toBe(true);
		expect(await getCloudConnection(harness.db, 'conn-1')).toBeNull();

		await upsertCloudConnection(harness.db, {
			id: 'conn-2',
			providerId: 'mock',
			providerAccountId: 'acct-2',
			accountEmail: 'other@example.com',
		});
		expect(await wipeCloudConnections(harness.db)).toBe(1);
		expect(await listCloudConnections(harness.db)).toEqual([]);
	});
});
