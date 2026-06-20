import { describe, expect, it } from 'vitest';

import { CloudProviderError, isCloudProviderError } from './provider';
import { MockCloudStorageProvider } from './mock-provider';

describe('mock cloud storage provider', () => {
	it('creates folders and returns deterministic paginated recursive listings', async () => {
		const provider = new MockCloudStorageProvider({
			pageSize: 2,
			now: () => '2026-06-10T12:00:00.000Z',
		});
		const folderId = await provider.createFolder('Project');
		await provider.createFile(folderId, 'project.json', '{"id":"project"}');
		await provider.createFile(folderId, 'transcriptions/a.json', 'A');
		await provider.createFile(folderId, 'transcriptions/b.json', 'B');

		const firstPage = await provider.listFiles(folderId, { recursive: true });
		const secondPage = await provider.listFiles(folderId, {
			recursive: true,
			cursor: firstPage.cursor,
		});

		expect(firstPage).toMatchObject({ hasMore: true, cursor: '2' });
		expect([...firstPage.entries, ...secondPage.entries].map(entry => entry.path)).toEqual([
			'Project/project.json',
			'Project/transcriptions',
			'Project/transcriptions/a.json',
			'Project/transcriptions/b.json',
		]);
		expect(secondPage.hasMore).toBe(false);
	});

	it('increments revisions and reports expected-revision conflicts', async () => {
		const provider = new MockCloudStorageProvider();
		const folderId = await provider.createFolder('Project');
		const created = await provider.createFile(folderId, 'project.json', 'v1');

		await expect(provider.updateFile(created.id, 'v2', 'rev-stale')).rejects.toMatchObject({
			code: 'conflict',
		});
		const updated = await provider.updateFile(created.id, 'v2', created.revision);

		expect(updated.revision).toBe('rev-2');
		expect(await provider.downloadFile(created.id)).toBe('v2');
		await expect(provider.deleteFile(created.id, created.revision)).rejects.toMatchObject({
			code: 'conflict',
		});
		await provider.deleteFile(created.id, updated.revision);
		await expect(provider.downloadFile(created.id)).rejects.toMatchObject({
			code: 'not-found',
		});
	});

	it('injects typed provider failures for deterministic sync tests', async () => {
		const provider = new MockCloudStorageProvider();
		const folderId = await provider.createFolder('Project');
		provider.failNext('rate-limited', 'list-files');

		let rateLimitError: unknown;
		try {
			await provider.listFiles(folderId);
		} catch (error) {
			rateLimitError = error;
		}
		provider.failNext('provider-unavailable', 'download-file');

		expect(rateLimitError).toBeInstanceOf(CloudProviderError);
		expect(isCloudProviderError(rateLimitError, 'rate-limited')).toBe(true);
		await expect(provider.downloadFile('missing-file')).rejects.toMatchObject({
			code: 'provider-unavailable',
		});
		expect(await provider.listFiles(folderId)).toEqual({ entries: [], hasMore: false });
	});

	it('surfaces permission and reauthorization failures through typed errors', async () => {
		const provider = new MockCloudStorageProvider();
		provider.failNext('permission-denied', 'create-folder');
		await expect(provider.createFolder('Project')).rejects.toMatchObject({
			code: 'permission-denied',
		});

		provider.failNext('reauthorization-required', 'exchange-code');
		await expect(provider.exchangeCode('code', 'verifier')).rejects.toMatchObject({
			code: 'reauthorization-required',
		});
	});
});
