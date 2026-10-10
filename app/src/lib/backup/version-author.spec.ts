import { describe, expect, it } from 'vitest';

import { saveAppSettings } from '$lib/storage/app-settings';
import { MemoryStoreBackend } from '$lib/storage/memory-store-backend.spec-support';
import {
	upsertProjectLocation,
	upsertProjectPlacements,
	upsertStorageAccount,
} from '$lib/storage/project-locations';
import { effectiveAuthorName } from './version-author';

describe('effective version author', () => {
	it('prefers the location account display name, then the app-set name, then null', async () => {
		const options = { backend: new MemoryStoreBackend() };
		await expect(effectiveAuthorName('browser-only', options)).resolves.toBeNull();

		await saveAppSettings({ authorName: '  Ada Scribe ' }, options);
		await upsertStorageAccount(
			{
				id: 'dropbox:dbid:1',
				provider: 'dropbox',
				displayName: 'Lab Dropbox Ada',
				email: 'ada@example.org',
				grantedScopes: [],
				signedIn: true,
			},
			options
		);
		await upsertProjectLocation(
			{
				id: 'dropbox-personal',
				accountId: 'dropbox:dbid:1',
				kind: 'personal',
				rootFolderId: '/Apatosaurus',
				displayPath: 'Dropbox/Apatosaurus',
			},
			options
		);
		await upsertProjectLocation(
			{
				id: 'folder',
				accountId: null,
				kind: 'device',
				rootFolderId: '.',
				displayPath: 'Folder',
			},
			options
		);
		await upsertProjectPlacements(
			[
				{
					projectId: 'in-dropbox',
					locationId: 'dropbox-personal',
					folderName: 'in-dropbox',
					needsLocationChoice: false,
				},
				{
					projectId: 'in-folder',
					locationId: 'folder',
					folderName: 'in-folder',
					needsLocationChoice: false,
				},
			],
			options
		);

		await expect(effectiveAuthorName('in-dropbox', options)).resolves.toBe('Lab Dropbox Ada');
		await expect(effectiveAuthorName('in-folder', options)).resolves.toBe('Ada Scribe');
		await expect(effectiveAuthorName('browser-only', options)).resolves.toBe('Ada Scribe');
	});
});
