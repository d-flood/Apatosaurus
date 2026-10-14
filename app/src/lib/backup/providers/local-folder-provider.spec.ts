import { describe, expect, it } from 'vitest';

import { domException, FakeDirectoryHandle } from './fake-file-system-access.spec-support';
import { LocalFolderStorageProvider, LOCAL_FOLDER_ROOT_FOLDER_ID } from './local-folder-provider';
import { ensureLocationMarker, readLocationMarker } from '../location-marker';
import { describeProviderContract } from './provider-contract.spec-support';

describeProviderContract('local folder', () => {
	const root = new FakeDirectoryHandle('root');
	return {
		provider: new LocalFolderStorageProvider(root as unknown as FileSystemDirectoryHandle),
		rootFolderId: LOCAL_FOLDER_ROOT_FOLDER_ID,
		expireAuth: () => {
			root.failWith = domException('NotAllowedError');
		},
	};
});

describe('local folder storage provider', () => {
	it('lists only the files that changed since a listing', async () => {
		const provider = new LocalFolderStorageProvider(
			new FakeDirectoryHandle('root') as unknown as FileSystemDirectoryHandle
		);
		const folderId = await provider.createFolder('project');
		const kept = await provider.createFile(folderId, 'kept.json', 'kept');
		const edited = await provider.createFile(folderId, 'nested/edited.json', 'before');
		const removed = await provider.createFile(folderId, 'removed.json', 'removed');
		const { cursor } = await provider.listFiles(folderId, { recursive: true });
		await provider.updateFile(edited.id, 'after', edited.revision);
		await provider.deleteFile(removed.id);
		await provider.createFile(folderId, 'added.json', 'added');

		const changes = await provider.listFiles(folderId, { cursor });

		expect(changes.entries.map(entry => [entry.path, entry.isDeleted ?? false]).sort()).toEqual(
			[
				['project/added.json', false],
				['project/nested/edited.json', false],
				['project/removed.json', true],
			]
		);
		expect(changes.entries.some(entry => entry.path === kept.path)).toBe(false);
		expect((await provider.listFiles(folderId, { cursor: changes.cursor })).entries).toEqual(
			[]
		);
	});

	it('writes a location marker once at the folder root and reuses it', async () => {
		const root = new FakeDirectoryHandle('root');
		const provider = new LocalFolderStorageProvider(
			root as unknown as FileSystemDirectoryHandle
		);
		await provider.createFolder('existing-project');
		await expect(readLocationMarker(provider, LOCAL_FOLDER_ROOT_FOLDER_ID)).resolves.toBeNull();

		const first = await ensureLocationMarker(
			provider,
			LOCAL_FOLDER_ROOT_FOLDER_ID,
			'location-1',
			'2026-10-03T12:00:00.000Z'
		);
		const second = await ensureLocationMarker(
			provider,
			LOCAL_FOLDER_ROOT_FOLDER_ID,
			'location-2',
			'2026-10-03T13:00:00.000Z'
		);

		expect(first.created).toBe(true);
		expect(second).toEqual({ marker: first.marker, created: false });
		expect(JSON.parse(await provider.downloadFile('apatosaurus-location.json'))).toEqual({
			format: 'apatosaurus.location',
			version: 1,
			id: 'location-1',
			created_at: '2026-10-03T12:00:00.000Z',
		});
		const listing = await provider.listFiles(LOCAL_FOLDER_ROOT_FOLDER_ID);
		expect(listing.entries.map(entry => entry.path)).toEqual([
			'apatosaurus-location.json',
			'existing-project',
		]);
	});

	it('creates nested folders and lists files recursively with path IDs', async () => {
		const root = new FakeDirectoryHandle('root');
		const provider = new LocalFolderStorageProvider(
			root as unknown as FileSystemDirectoryHandle
		);
		const projectFolderId = await provider.createFolder('Project');

		await provider.createFile(projectFolderId, 'project.json', '{"id":"project"}');
		await provider.createFile(projectFolderId, 'transcriptions/a.json', 'A');
		await provider.createFile(projectFolderId, 'transcriptions/b.json', 'B');

		const listing = await provider.listFiles(projectFolderId, { recursive: true });

		expect(listing).toMatchObject({ hasMore: false });
		expect(listing.entries.map(entry => entry.path)).toEqual([
			'Project/project.json',
			'Project/transcriptions',
			'Project/transcriptions/a.json',
			'Project/transcriptions/b.json',
		]);
		expect(
			listing.entries.find(entry => entry.path.endsWith('project.json'))?.revision
		).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	it('writes, reads, updates, and deletes files with expected-revision checks', async () => {
		const root = new FakeDirectoryHandle('root');
		const provider = new LocalFolderStorageProvider(
			root as unknown as FileSystemDirectoryHandle
		);
		const folderId = await provider.createFolder('Project');
		const created = await provider.createFile(folderId, 'project.json', 'v1');

		await expect(provider.updateFile(created.id, 'v2', 'sha256:stale')).rejects.toMatchObject({
			code: 'conflict',
		});
		expect(await provider.downloadFile(created.id)).toBe('v1');

		const updated = await provider.updateFile(created.id, 'v2', created.revision);
		expect(updated.revision).not.toBe(created.revision);
		expect(await provider.downloadFile(created.id)).toBe('v2');

		await expect(provider.deleteFile(created.id, created.revision)).rejects.toMatchObject({
			code: 'conflict',
		});
		await provider.deleteFile(created.id, updated.revision);
		await expect(provider.downloadFile(created.id)).rejects.toMatchObject({
			code: 'not-found',
		});
	});

	it('requires reconnection when persistent handle access is denied', async () => {
		const root = new FakeDirectoryHandle('root');
		const provider = new LocalFolderStorageProvider(
			root as unknown as FileSystemDirectoryHandle
		);
		root.failWith = domException('NotAllowedError');

		await expect(provider.createFolder('Project')).rejects.toMatchObject({
			code: 'reauthorization-required',
		});
	});

	it('requires reconnection when persistent handle access is blocked by security policy', async () => {
		const root = new FakeDirectoryHandle('root');
		const provider = new LocalFolderStorageProvider(
			root as unknown as FileSystemDirectoryHandle
		);
		root.failWith = domException('SecurityError');

		await expect(provider.listFiles('.')).rejects.toMatchObject({
			code: 'reauthorization-required',
		});
	});
});
