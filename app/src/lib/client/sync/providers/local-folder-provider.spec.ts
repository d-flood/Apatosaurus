import { describe, expect, it } from 'vitest';

import { domException, FakeDirectoryHandle } from './fake-file-system-access.spec-support';
import { LocalFolderStorageProvider } from './local-folder-provider';

describe('local folder storage provider', () => {
	it('creates nested folders and lists files recursively with path IDs', async () => {
		const root = new FakeDirectoryHandle('root');
		const provider = new LocalFolderStorageProvider(root as unknown as FileSystemDirectoryHandle);
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
		expect(listing.entries.find(entry => entry.path.endsWith('project.json'))?.revision).toMatch(
			/^sha256:[0-9a-f]{64}$/
		);
	});

	it('writes, reads, updates, and deletes files with expected-revision checks', async () => {
		const root = new FakeDirectoryHandle('root');
		const provider = new LocalFolderStorageProvider(root as unknown as FileSystemDirectoryHandle);
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
		await expect(provider.downloadFile(created.id)).rejects.toMatchObject({ code: 'not-found' });
	});

	it('throws permission errors when handle access is denied', async () => {
		const root = new FakeDirectoryHandle('root');
		const provider = new LocalFolderStorageProvider(root as unknown as FileSystemDirectoryHandle);
		root.failWith = domException('NotAllowedError');

		await expect(provider.createFolder('Project')).rejects.toMatchObject({
			code: 'permission-denied',
		});
	});

	it('rejects unsupported folder sharing', async () => {
		const root = new FakeDirectoryHandle('root');
		const provider = new LocalFolderStorageProvider(root as unknown as FileSystemDirectoryHandle);

		await expect(provider.shareFolder('.', 'reader@example.com', 'viewer')).rejects.toMatchObject({
			code: 'permission-denied',
		});
	});
});
