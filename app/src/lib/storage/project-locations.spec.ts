import { describe, expect, it } from 'vitest';

import { FakeDirectoryHandle } from '$lib/backup/providers/fake-file-system-access.spec-support';
import { LocalFolderStorageProvider } from '$lib/backup/providers/local-folder-provider';
import { MemoryStoreBackend } from './memory-store-backend.spec-support';
import { readTextFile } from './opfs-store';
import { groupProjectsByLocation } from '$lib/shell/project-location-groups';
import {
	bindPersonalLocation,
	listProjectPlacements,
	upgradeSyncTargetsToPlacements,
	upsertProjectPlacements,
} from './project-locations';
import { upsertSyncTarget } from './sync-targets';
import type { ProjectLocation, StorageAccount } from './project-locations';

describe('signing into a different account', () => {
	const accountA: StorageAccount = {
		id: 'dbid:account-a',
		provider: 'dropbox',
		displayName: 'Ada',
		email: 'ada@example.org',
		grantedScopes: [],
		signedIn: false,
	};
	const accountB: StorageAccount = { ...accountA, id: 'dbid:account-b', email: 'bo@example.org' };
	const locationA: ProjectLocation = {
		id: 'location-a',
		accountId: accountA.id,
		kind: 'personal',
		rootFolderId: '/Apatosaurus',
		displayPath: 'Dropbox/Apatosaurus',
	};
	const kept = {
		projectId: 'project-1',
		locationId: locationA.id,
		folderName: 'project-1',
		needsLocationChoice: false,
	};

	it('never binds kept projects to the new account', () => {
		const locationB = bindPersonalLocation(
			[locationA],
			accountB.id,
			'location-b',
			'/Apatosaurus',
			'Dropbox/Apatosaurus'
		);
		expect(locationB).toMatchObject({ id: 'location-b', accountId: accountB.id });
		const groups = groupProjectsByLocation(
			[{ id: 'project-1', name: 'Kept' } as never],
			[kept],
			[locationA, locationB],
			[accountA, { ...accountB, signedIn: true }]
		);
		expect(groups).toEqual([
			expect.objectContaining({
				id: locationA.id,
				owner: 'Signed out · ada@example.org',
				signedOut: true,
				projects: [expect.objectContaining({ id: 'project-1' })],
			}),
		]);
	});

	it("refuses a folder whose marker is another account's location", () => {
		expect(() =>
			bindPersonalLocation(
				[locationA],
				accountB.id,
				locationA.id,
				'/Apatosaurus',
				'Dropbox/Apatosaurus'
			)
		).toThrow(/another storage account/);
		expect(
			bindPersonalLocation(
				[locationA],
				accountA.id,
				locationA.id,
				'/Apatosaurus',
				'Dropbox/Apatosaurus'
			)
		).toEqual(locationA);
	});
});

describe('sync target upgrade', () => {
	it('makes folder-synced projects browser-only with a location choice and leaves the folder untouched', async () => {
		const storeOptions = { backend: new MemoryStoreBackend() };
		const oldFolder = new FakeDirectoryHandle('Old Project Folder');
		const folderProvider = new LocalFolderStorageProvider(
			oldFolder as unknown as FileSystemDirectoryHandle
		);
		await folderProvider.createFile('.', 'project.json', '{"id":"project-1"}');
		await folderProvider.createFile('.', 'transcriptions/pt-1.json', 'transcription');
		const before = await folderSnapshot(folderProvider);
		const handles = new Map<string, FakeDirectoryHandle>([['handle-1', oldFolder]]);
		await upsertSyncTarget(
			{
				targetId: 'target-1',
				projectId: 'project-1',
				handleRef: 'handle-1',
				folderDisplayPath: 'Old Project Folder',
			},
			storeOptions
		);
		await upsertProjectPlacements(
			[
				{
					projectId: 'project-2',
					locationId: 'location-1',
					folderName: 'project-2',
					needsLocationChoice: false,
				},
			],
			storeOptions
		);
		const deleteHandle = async (ref: string) => void handles.delete(ref);

		await expect(upgradeSyncTargetsToPlacements(deleteHandle, storeOptions)).resolves.toBe(
			true
		);

		expect(await listProjectPlacements(storeOptions)).toEqual(
			expect.arrayContaining([
				{
					projectId: 'project-1',
					locationId: null,
					folderName: null,
					needsLocationChoice: true,
				},
				{
					projectId: 'project-2',
					locationId: 'location-1',
					folderName: 'project-2',
					needsLocationChoice: false,
				},
			])
		);
		expect(handles.size).toBe(0);
		await expect(readTextFile('app/sync-targets.json', storeOptions)).rejects.toThrow();
		expect(await folderSnapshot(folderProvider)).toEqual(before);

		await expect(upgradeSyncTargetsToPlacements(deleteHandle, storeOptions)).resolves.toBe(
			false
		);
		expect(await listProjectPlacements(storeOptions)).toHaveLength(2);
	});
});

async function folderSnapshot(provider: LocalFolderStorageProvider) {
	const listing = await provider.listFiles('.', { recursive: true });
	return Promise.all(
		listing.entries.map(async entry => ({
			path: entry.path,
			content: entry.isFolder ? null : await provider.downloadFile(entry.id),
		}))
	);
}
