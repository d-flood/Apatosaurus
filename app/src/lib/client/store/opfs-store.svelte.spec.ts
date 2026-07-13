import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	createOpfsStoreBackend,
	listDirectory,
	readTextFile,
	type StoreBackend,
	writeTextFileAtomic,
} from './opfs-store';

const targetPath = 'projects/browser-atomic/project.json';

let root: FileSystemDirectoryHandle;
let backend: StoreBackend;

beforeEach(async () => {
	root = await navigator.storage.getDirectory();
	await root.removeEntry('apatosaurus', { recursive: true }).catch(ignoreMissingEntry);
	backend = await createOpfsStoreBackend(root);
});

afterEach(async () => {
	await root.removeEntry('apatosaurus', { recursive: true }).catch(ignoreMissingEntry);
});

describe('browser OPFS atomic replacement', () => {
	it('replaces an existing target through the real OPFS backend', async () => {
		await writeTextFileAtomic(targetPath, 'old', { backend, nonce: () => 'old' });
		await writeTextFileAtomic(targetPath, 'new', { backend, nonce: () => 'new' });

		expect(await readTextFile(targetPath, { backend })).toBe('new');
		expect(
			(await listDirectory('projects/browser-atomic', { backend })).map(entry => entry.name)
		).toEqual(['project.json']);
	});

	it('transactionally replaces an existing target when move is missing', async () => {
		await writeTextFileAtomic(targetPath, 'old', { backend, nonce: () => 'old' });
		const noMoveBackend = withoutMove(backend);

		await writeTextFileAtomic(targetPath, 'new', {
			backend: noMoveBackend,
			nonce: () => 'fallback',
		});

		expect(await readTextFile(targetPath, { backend })).toBe('new');
	});

	it('falls back when real OPFS move reports that it is unsupported', async () => {
		const unsupportedMoveBackend: StoreBackend = {
			...withoutMove(backend),
			moveFile: async () => {
				throw new DOMException('not supported', 'NotSupportedError');
			},
		};

		await writeTextFileAtomic(targetPath, 'new', {
			backend: unsupportedMoveBackend,
			nonce: () => 'unsupported',
		});

		expect(await readTextFile(targetPath, { backend })).toBe('new');
	});

	it('keeps the old target and verified temp recoverable when replacement is interrupted', async () => {
		await writeTextFileAtomic(targetPath, 'old', { backend, nonce: () => 'old' });
		const interruptedBackend: StoreBackend = {
			...withoutMove(backend),
			replaceTextFile: async (path, content) => {
				const handle = await getFileHandle(root, path);
				const writable = await handle.createWritable({ keepExistingData: false });
				await writable.write(content.slice(0, 1));
				await writable.abort();
				throw new Error('simulated interruption while replacing target');
			},
		};

		await expect(
			writeTextFileAtomic(targetPath, 'new', {
				backend: interruptedBackend,
				nonce: () => 'recoverable',
			})
		).rejects.toThrow('simulated interruption');

		expect(await readTextFile(targetPath, { backend })).toBe('old');
		expect(await readTextFile(`${targetPath}.tmp-recoverable`, { backend })).toBe('new');

		await writeTextFileAtomic(targetPath, 'new', {
			backend: withoutMove(backend),
			nonce: () => 'retry',
		});
		expect(await readTextFile(targetPath, { backend })).toBe('new');
	});
});

function withoutMove(value: StoreBackend): StoreBackend {
	return {
		readTextFile: value.readTextFile.bind(value),
		writeTextFile: value.writeTextFile.bind(value),
		replaceTextFile: value.replaceTextFile?.bind(value),
		deleteFile: value.deleteFile.bind(value),
		deleteDirectory: value.deleteDirectory?.bind(value),
		listDirectory: value.listDirectory.bind(value),
		ensureDirectory: value.ensureDirectory.bind(value),
	};
}

async function getFileHandle(
	rootHandle: FileSystemDirectoryHandle,
	path: string
): Promise<FileSystemFileHandle> {
	const parts = path.split('/');
	const fileName = parts.pop();
	if (!fileName) throw new Error('File name is required.');
	let directory = rootHandle;
	for (const part of parts)
		directory = await directory.getDirectoryHandle(part, { create: true });
	return directory.getFileHandle(fileName, { create: true });
}

function ignoreMissingEntry(error: unknown): void {
	if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
}
