import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProject } from './projects';
import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import {
	disconnectCloudConnection,
	getCloudConnection,
	getCloudConnectionByProviderAccount,
	listCloudConnections,
	refreshCloudConnectionCredentials,
	updateCloudConnectionCredentials,
	upsertCloudConnection,
	wipeCloudConnections,
} from './cloud-connections';

let harness: LocalDbTestHarness;

beforeEach(() => {
	harness = createLocalDbTestHarness();
});

afterEach(async () => {
	await harness.destroy();
});

describe('cloud connection credential persistence', () => {
	it('stores and updates cloud credentials in the local database', async () => {
		const connection = await upsertCloudConnection(harness.db, {
			id: 'conn-1',
			providerId: 'mock',
			providerAccountId: 'acct-1',
			accountEmail: ' editor@example.com ',
			scopes: ['files.content.write', 'files.content.read', 'files.content.read'],
			credentials: {
				accessToken: 'access-1',
				refreshToken: 'refresh-1',
				expiresAt: 1_800,
			},
			connectedAt: '2026-06-10T12:00:00.000Z',
		});
		const updated = await updateCloudConnectionCredentials(harness.db, {
			connectionId: connection.id,
			credentials: { accessToken: 'access-2', expiresAt: 3_600 },
			updatedAt: '2026-06-10T12:05:00.000Z',
		});

		expect(connection).toMatchObject({
			id: 'conn-1',
			providerId: 'mock',
			providerAccountId: 'acct-1',
			accountEmail: 'editor@example.com',
			scopes: ['files.content.read', 'files.content.write'],
			credentials: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 1_800 },
		});
		expect(updated).toMatchObject({
			credentials: { accessToken: 'access-2', expiresAt: 3_600 },
			updatedAt: '2026-06-10T12:05:00.000Z',
		});
		expect(updated.credentials.refreshToken).toBeUndefined();
		expect(await getCloudConnectionByProviderAccount(harness.db, 'mock', 'acct-1')).toMatchObject({
			id: connection.id,
		});
	});

	it('refreshes access tokens while preserving or rotating refresh tokens', async () => {
		await upsertCloudConnection(harness.db, {
			id: 'conn-1',
			providerId: 'mock',
			providerAccountId: 'acct-1',
			accountEmail: 'editor@example.com',
			credentials: {
				accessToken: 'access-1',
				refreshToken: 'refresh-1',
				expiresAt: 1_800,
			},
		});

		const preserved = await refreshCloudConnectionCredentials(harness.db, {
			connectionId: 'conn-1',
			credentials: { accessToken: 'access-2', expiresAt: 3_600 },
		});
		const rotated = await refreshCloudConnectionCredentials(harness.db, {
			connectionId: 'conn-1',
			credentials: { accessToken: 'access-3', refreshToken: 'refresh-2', expiresAt: 7_200 },
		});

		expect(preserved.credentials).toEqual({
			accessToken: 'access-2',
			refreshToken: 'refresh-1',
			expiresAt: 3_600,
		});
		expect(rotated.credentials).toEqual({
			accessToken: 'access-3',
			refreshToken: 'refresh-2',
			expiresAt: 7_200,
		});
	});

	it('disconnects and wipes local credentials with dependent sync rows', async () => {
		await createProject(harness.db, { id: 'project-1', name: 'Project' });
		await upsertCloudConnection(harness.db, {
			id: 'conn-1',
			providerId: 'mock',
			providerAccountId: 'acct-1',
			accountEmail: 'editor@example.com',
			credentials: { accessToken: 'access-1', refreshToken: 'refresh-1' },
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
			credentials: { accessToken: 'access-2', refreshToken: 'refresh-2' },
		});
		expect(await wipeCloudConnections(harness.db)).toBe(1);
		expect(await listCloudConnections(harness.db)).toEqual([]);
	});
});
