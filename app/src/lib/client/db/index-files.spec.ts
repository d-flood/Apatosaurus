import { describe, expect, it } from 'vitest';

import {
	FakeDirectoryHandle,
	type FakeFileHandle,
} from '$lib/client/sync/providers/fake-file-system-access.spec-support';

import { cleanupStaleIndexFiles } from './index-files';

describe('cleanupStaleIndexFiles', () => {
	it('removes legacy and old versioned index files after a successful rebuild', async () => {
		const root = new FakeDirectoryHandle('');
		await root.getFileHandle('apatosaurus-index-v0.db', { create: true });
		await root.getFileHandle('apatosaurus-local-v1.db', { create: true });
		await root.getFileHandle('user-file.txt', { create: true });
		const indexDirectory = await nestedDirectory(root, 'apatosaurus/v1/index');
		await indexDirectory.getFileHandle('apatosaurus-index-v1.db', { create: true });
		await indexDirectory.getFileHandle('apatosaurus-index-v1.db-wal', { create: true });
		await indexDirectory.getFileHandle('apatosaurus-index-v0.db', { create: true });
		await indexDirectory.getFileHandle('apatosaurus-index-v0.db-wal', { create: true });
		await indexDirectory.getFileHandle('notes.txt', { create: true });

		const report = await cleanupStaleIndexFiles(root as unknown as FileSystemDirectoryHandle);

		expect(report.failedPaths).toEqual([]);
		expect(report.removedPaths.sort()).toEqual([
			'apatosaurus-index-v0.db',
			'apatosaurus-local-v1.db',
			'apatosaurus/v1/index/apatosaurus-index-v0.db',
			'apatosaurus/v1/index/apatosaurus-index-v0.db-wal',
		]);
		expect(await entryNames(root)).toEqual(['apatosaurus', 'user-file.txt']);
		expect(await entryNames(indexDirectory)).toEqual([
			'apatosaurus-index-v1.db',
			'apatosaurus-index-v1.db-wal',
			'notes.txt',
		]);
	});
});

async function nestedDirectory(root: FakeDirectoryHandle, path: string): Promise<FakeDirectoryHandle> {
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
