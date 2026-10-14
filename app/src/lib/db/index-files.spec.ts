import { describe, expect, it } from 'vitest';

import {
	FakeDirectoryHandle,
	type FakeFileHandle,
} from '$lib/backup/providers/fake-file-system-access.spec-support';

import { cleanupStaleIndexFiles, removeCurrentIndexFiles } from './index-files';

describe('cleanupStaleIndexFiles', () => {
	it('removes legacy and old versioned index files after a successful rebuild', async () => {
		const root = new FakeDirectoryHandle('');
		await root.getFileHandle('apatosaurus-index-v3.db', { create: true });
		await root.getFileHandle('apatosaurus-local-v1.db', { create: true });
		await root.getFileHandle('user-file.txt', { create: true });
		const indexDirectory = await nestedDirectory(root, 'apatosaurus/v1/index');
		await indexDirectory.getFileHandle('apatosaurus-index-v5.db', { create: true });
		await indexDirectory.getFileHandle('apatosaurus-index-v5.db-wal', { create: true });
		await indexDirectory.getFileHandle('apatosaurus-index-v3.db', { create: true });
		await indexDirectory.getFileHandle('apatosaurus-index-v3.db-wal', { create: true });
		await indexDirectory.getFileHandle('notes.txt', { create: true });

		const report = await cleanupStaleIndexFiles(root as unknown as FileSystemDirectoryHandle);

		expect(report.failedPaths).toEqual([]);
		expect(report.removedPaths.sort()).toEqual([
			'apatosaurus-index-v3.db',
			'apatosaurus-local-v1.db',
			'apatosaurus/v1/index/apatosaurus-index-v3.db',
			'apatosaurus/v1/index/apatosaurus-index-v3.db-wal',
		]);
		expect(await entryNames(root)).toEqual(['apatosaurus', 'user-file.txt']);
		expect(await entryNames(indexDirectory)).toEqual([
			'apatosaurus-index-v5.db',
			'apatosaurus-index-v5.db-wal',
			'notes.txt',
		]);
	});
});

describe('removeCurrentIndexFiles', () => {
	it('removes only the current nested index database and companions', async () => {
		const root = new FakeDirectoryHandle('');
		await root.getFileHandle('apatosaurus-index-v5.db', { create: true });
		const indexDirectory = await nestedDirectory(root, 'apatosaurus/v1/index');
		await indexDirectory.getFileHandle('apatosaurus-index-v5.db', { create: true });
		await indexDirectory.getFileHandle('apatosaurus-index-v5.db-wal', { create: true });
		await indexDirectory.getFileHandle('apatosaurus-index-v5.db-shm', { create: true });
		await indexDirectory.getFileHandle('apatosaurus-index-v3.db', { create: true });
		await indexDirectory.getFileHandle('notes.txt', { create: true });

		const report = await removeCurrentIndexFiles(root as unknown as FileSystemDirectoryHandle);

		expect(report.failedPaths).toEqual([]);
		expect(report.removedPaths.sort()).toEqual([
			'apatosaurus/v1/index/apatosaurus-index-v5.db',
			'apatosaurus/v1/index/apatosaurus-index-v5.db-shm',
			'apatosaurus/v1/index/apatosaurus-index-v5.db-wal',
		]);
		expect(await entryNames(root)).toEqual(['apatosaurus', 'apatosaurus-index-v5.db']);
		expect(await entryNames(indexDirectory)).toEqual(['apatosaurus-index-v3.db', 'notes.txt']);
	});
});

async function nestedDirectory(
	root: FakeDirectoryHandle,
	path: string
): Promise<FakeDirectoryHandle> {
	let current = root;
	for (const segment of path.split('/').filter(Boolean)) {
		current = await current.getDirectoryHandle(segment, { create: true });
	}
	return current;
}

async function entryNames(directory: FakeDirectoryHandle): Promise<string[]> {
	const names: string[] = [];
	for await (const [name] of directory.entries() as AsyncIterableIterator<
		[string, FakeDirectoryHandle | FakeFileHandle]
	>) {
		names.push(name);
	}
	return names.sort();
}
