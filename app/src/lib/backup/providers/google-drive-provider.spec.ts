import { describe, expect, it } from 'vitest';

import { FakeGoogleDriveApi } from './google-drive-fake.spec-support';
import { GoogleDriveStorageProvider } from './google-drive-provider';
import { describeProviderContract } from './provider-contract.spec-support';

describeProviderContract('Google Drive', async () => {
	const { api, provider } = await createProvider();
	return {
		provider,
		rootFolderId: provider.rootFolderId,
		expireAuth: () => api.revoke(),
		trashed: (name: string) => api.findByName(name)?.trashed ?? false,
	};
});

describeProviderContract('Google Drive shared drive', async () => {
	const { api, provider } = await createSharedDriveProvider();
	return {
		provider,
		rootFolderId: provider.rootFolderId,
		expireAuth: () => api.revoke(),
		trashed: (name: string) => api.findByName(name)?.trashed ?? false,
	};
});

describe('Google Drive storage provider', () => {
	it('finds or creates the personal folder in My Drive and resolves its Drive id', async () => {
		const api = new FakeGoogleDriveApi();
		const home = new GoogleDriveStorageProvider({
			driveRootId: 'root',
			tokens: api.tokens,
			fetch: api.fetch,
		});

		expect(await home.createFolder('Apatosaurus')).toBe('Apatosaurus');
		const driveId = await home.folderDriveId('Apatosaurus');
		const again = new GoogleDriveStorageProvider({
			driveRootId: 'root',
			tokens: api.tokens,
			fetch: api.fetch,
		});

		expect(await again.createFolder('Apatosaurus')).toBe('Apatosaurus');
		expect(await again.folderDriveId('Apatosaurus')).toBe(driveId);
		expect(api.findByName('Apatosaurus')?.id).toBe(driveId);
	});

	it('passes supportsAllDrives on every call', async () => {
		const { api, provider } = await createProvider();
		const folderId = await provider.createFolder('Project');
		const created = await provider.createFile(folderId, 'nested/a.json', 'v1');
		await provider.updateFile(created.id, 'v2', created.revision);
		await provider.downloadFile(created.id);
		let cursor: string | undefined;
		do {
			({ cursor } = await provider.listFiles(folderId, { recursive: true, cursor }));
		} while (!cursor?.startsWith('changes:'));
		await provider.listFiles(folderId, { recursive: true, cursor });
		await provider.deleteFile(created.id);

		expect(api.calls).toEqual(
			expect.arrayContaining([
				'GET /changes',
				'GET /changes/startPageToken',
				'POST /upload/files',
				'PATCH /upload/files/drive-5',
				'PATCH /files/drive-5',
			])
		);
		expect(api.missingSupportsAllDrives).toEqual([]);
	});

	it('checks the head revision immediately before updating', async () => {
		const { api, provider } = await createProvider();
		const created = await provider.createFile(provider.rootFolderId, 'project.json', 'v1');
		api.touch(api.findByName('project.json')!.id, 'theirs');

		await expect(
			provider.updateFile(created.id, 'mine', created.revision)
		).rejects.toMatchObject({ code: 'conflict' });
		expect(await provider.downloadFile(created.id)).toBe('theirs');
	});

	it('resumes from the changes cursor with changes under the folder only', async () => {
		const { api, provider } = await createProvider();
		const folderId = await provider.createFolder('Project');
		const kept = await provider.createFile(folderId, 'a.json', 'a1');
		const removed = await provider.createFile(folderId, 'nested/b.json', 'b1');
		await provider.createFile(provider.rootFolderId, 'elsewhere.json', 'x');
		let listing = await provider.listFiles(folderId, { recursive: true });
		while (listing.hasMore) {
			listing = await provider.listFiles(folderId, {
				recursive: true,
				cursor: listing.cursor,
			});
		}
		expect(listing.cursor).toMatch(/^changes:/);

		await provider.updateFile(kept.id, 'a2', kept.revision);
		await provider.deleteFile(removed.id, removed.revision);
		await provider.createFile(provider.rootFolderId, 'other.json', 'y');
		const fresh = new GoogleDriveStorageProvider({
			driveRootId: api.findByName('Apatosaurus')!.id,
			tokens: api.tokens,
			fetch: api.fetch,
		});
		await fresh.createFile(folderId, 'c.json', 'c1');

		const changed = [];
		let cursor = listing.cursor;
		let hasMore = true;
		while (hasMore) {
			const page = await provider.listFiles(folderId, { recursive: true, cursor });
			changed.push(...page.entries);
			({ cursor, hasMore } = page);
		}

		expect(changed.map(entry => [entry.path, entry.isDeleted ?? false])).toEqual([
			['Project/a.json', false],
			['Project/nested/b.json', true],
			['Project/c.json', false],
		]);
	});

	it('scopes the changes cursor to the shared drive', async () => {
		const { api, provider, sharedDriveId } = await createSharedDriveProvider();
		const folderId = await provider.createFolder('Project');
		const kept = await provider.createFile(folderId, 'a.json', 'a1');
		let listing = await provider.listFiles(folderId, { recursive: true });
		while (listing.hasMore) {
			listing = await provider.listFiles(folderId, {
				recursive: true,
				cursor: listing.cursor,
			});
		}

		const myDrive = new GoogleDriveStorageProvider({
			driveRootId: 'root',
			tokens: api.tokens,
			fetch: api.fetch,
		});
		await myDrive.createFile(myDrive.rootFolderId, 'personal.json', 'p');
		await provider.updateFile(kept.id, 'a2', kept.revision);
		await provider.createFile(folderId, 'b.json', 'b1');

		const changed = [];
		let cursor = listing.cursor;
		let hasMore = true;
		while (hasMore) {
			const page = await provider.listFiles(folderId, { recursive: true, cursor });
			changed.push(...page.entries);
			({ cursor, hasMore } = page);
		}

		expect(changed.map(entry => entry.path)).toEqual(['Project/a.json', 'Project/b.json']);
		expect(api.changeRequests.every(params => params.get('driveId') === sharedDriveId)).toBe(
			true
		);
	});

	it('describes a picked folder with its shared drive', async () => {
		const { api, sharedDriveId } = await createSharedDriveProvider();
		const myDrive = new GoogleDriveStorageProvider({
			driveRootId: 'root',
			tokens: api.tokens,
			fetch: api.fetch,
		});
		await myDrive.createFolder('Personal');

		expect(await myDrive.describeFolder(api.findByName('Team')!.id)).toEqual({
			name: 'Team',
			sharedDriveId,
		});
		expect(await myDrive.describeFolder(api.findByName('Personal')!.id)).toEqual({
			name: 'Personal',
		});
	});

	it('refreshes an expired access token once and retries', async () => {
		const { api, provider } = await createProvider();
		await provider.createFile(provider.rootFolderId, 'project.json', 'v1');
		api.expireAccessTokens();

		const listing = await provider.listFiles(provider.rootFolderId);

		expect(listing.entries.map(entry => entry.path)).toEqual(['project.json']);
		expect(api.calls.slice(-3)).toEqual([
			'GET /changes/startPageToken',
			'GET /changes/startPageToken',
			'GET /files',
		]);
	});

	it('maps rate limits and missing paths', async () => {
		const { api, provider } = await createProvider();
		api.failNext('GET /changes/startPageToken', 403, 'userRateLimitExceeded');

		await expect(provider.listFiles(provider.rootFolderId)).rejects.toMatchObject({
			code: 'rate-limited',
		});
		await expect(provider.listFiles('Missing')).rejects.toMatchObject({ code: 'not-found' });
		await expect(provider.downloadFile('Missing/a.json')).rejects.toMatchObject({
			code: 'not-found',
		});
	});
});

async function createProvider() {
	const api = new FakeGoogleDriveApi();
	const home = new GoogleDriveStorageProvider({
		driveRootId: 'root',
		tokens: api.tokens,
		fetch: api.fetch,
	});
	const driveRootId = await home.folderDriveId(await home.createFolder('Apatosaurus'));
	const provider = new GoogleDriveStorageProvider({
		driveRootId,
		tokens: api.tokens,
		fetch: api.fetch,
	});
	return { api, provider };
}

async function createSharedDriveProvider() {
	const api = new FakeGoogleDriveApi();
	const sharedDriveId = api.addSharedDrive('Lab');
	const lab = new GoogleDriveStorageProvider({
		driveRootId: sharedDriveId,
		sharedDriveId,
		tokens: api.tokens,
		fetch: api.fetch,
	});
	const driveRootId = await lab.folderDriveId(await lab.createFolder('Team'));
	const provider = new GoogleDriveStorageProvider({
		driveRootId,
		sharedDriveId,
		tokens: api.tokens,
		fetch: api.fetch,
	});
	return { api, provider, sharedDriveId };
}
