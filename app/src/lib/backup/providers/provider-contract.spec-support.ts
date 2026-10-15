import { afterEach, describe, expect, it } from 'vitest';

import type { CloudStorageProvider } from './provider';

export interface ProviderContractSubject {
	provider: CloudStorageProvider;
	rootFolderId: string;
	expireAuth: () => void;
	verify?: () => void;
	trashed?: (name: string) => boolean;
}

export function describeProviderContract(
	name: string,
	createSubject: () => ProviderContractSubject | Promise<ProviderContractSubject>
): void {
	describe(`${name} provider contract`, () => {
		let subject: ProviderContractSubject | undefined;
		const create = async () => (subject = await createSubject());
		afterEach(() => {
			subject?.verify?.();
			subject = undefined;
		});

		it('raises conflict for a stale expected revision', async () => {
			const { provider, rootFolderId } = await create();
			const folderId = await provider.createFolder('Project', rootFolderId);
			const created = await provider.createFile(folderId, 'project.json', 'v1');
			const updated = await provider.updateFile(created.id, 'v2', created.revision);

			await expect(
				provider.updateFile(created.id, 'v3', created.revision)
			).rejects.toMatchObject({ code: 'conflict' });
			await expect(provider.deleteFile(created.id, created.revision)).rejects.toMatchObject({
				code: 'conflict',
			});
			await expect(provider.createFile(folderId, 'project.json', 'v4')).rejects.toMatchObject(
				{
					code: 'conflict',
				}
			);
			expect(await provider.downloadFile(created.id)).toBe('v2');

			await provider.deleteFile(created.id, updated.revision);
			await expect(provider.downloadFile(created.id)).rejects.toMatchObject({
				code: 'not-found',
			});
		});

		it('creates, updates and downloads binary files byte for byte', async () => {
			const { provider, rootFolderId } = await create();
			const folderId = await provider.createFolder('Project', rootFolderId);
			const small = Uint8Array.from({ length: 512 }, (_, index) => index % 256);
			const large = Uint8Array.from(
				{ length: 6 * 1024 * 1024 + 1 },
				(_, index) => Math.imul(index, 2654435761) >>> 24
			);

			const created = await provider.createFile(folderId, 'cbgm/a.sqlite', small);
			expect(created.size).toBe(small.byteLength);
			expectSameBytes(await provider.downloadFileBytes(created.id), small);
			const grown = await provider.updateFile(created.id, large, created.revision);
			expect(grown.size).toBe(large.byteLength);
			expectSameBytes(await provider.downloadFileBytes(created.id), large);

			const createdLarge = await provider.createFile(folderId, 'cbgm/b.sqlite', large);
			expectSameBytes(await provider.downloadFileBytes(createdLarge.id), large);
			await provider.updateFile(createdLarge.id, small, createdLarge.revision);
			expectSameBytes(await provider.downloadFileBytes(createdLarge.id), small);
		});

		it('moves deleted files to the provider trash where one exists', async () => {
			const { provider, rootFolderId, trashed } = await create();
			const folderId = await provider.createFolder('Project', rootFolderId);
			const created = await provider.createFile(folderId, 'project.json', 'v1');

			await provider.deleteFile(created.id, created.revision);

			await expect(provider.downloadFile(created.id)).rejects.toMatchObject({
				code: 'not-found',
			});
			if (trashed) expect(trashed('project.json')).toBe(true);
		});

		it('raises reauthorization-required once auth has expired', async () => {
			const { provider, rootFolderId, expireAuth } = await create();
			await provider.createFolder('Project', rootFolderId);
			expireAuth();

			await expect(provider.listFiles(rootFolderId)).rejects.toMatchObject({
				code: 'reauthorization-required',
			});
		});

		it('resumes listing from cursors without gaps', async () => {
			const { provider, rootFolderId } = await create();
			const folderId = await provider.createFolder('Project', rootFolderId);
			const files = ['project.json', 'a.json', 'b.json', 'nested/c.json', 'nested/d.json'];
			for (const file of files) await provider.createFile(folderId, file, file);

			const paths: string[] = [];
			let cursor: string | undefined;
			do {
				const page = await provider.listFiles(folderId, { recursive: true, cursor });
				paths.push(...page.entries.map(entry => entry.path));
				cursor = page.hasMore ? page.cursor : undefined;
			} while (cursor);

			expect(paths.toSorted()).toEqual(
				[...files.map(file => `Project/${file}`), 'Project/nested'].toSorted()
			);
		});
	});
}

function expectSameBytes(actual: Uint8Array, expected: Uint8Array): void {
	expect(actual.byteLength).toBe(expected.byteLength);
	expect(actual.findIndex((byte, index) => byte !== expected[index])).toBe(-1);
}
