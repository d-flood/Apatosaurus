import { describe, expect, it } from 'vitest';

import { FakeDropboxApi } from './dropbox-fake.spec-support';
import { DropboxStorageProvider } from './dropbox-provider';
import { describeProviderContract } from './provider-contract.spec-support';

describeProviderContract('Dropbox', async () => {
	const { api, provider } = await createProvider();
	return { provider, rootFolderId: provider.rootFolderId, expireAuth: () => api.revoke() };
});

describeProviderContract('Dropbox team space', async () => {
	const { api, provider } = await createProvider({ rootNamespaceId: '3235641' });
	return {
		provider,
		rootFolderId: provider.rootFolderId,
		expireAuth: () => api.revoke(),
		verify: () => expect(api.missingPathRoot).toEqual([]),
	};
});

describe('Dropbox storage provider', () => {
	it('refreshes an expired access token once and retries', async () => {
		const { api, provider } = await createProvider();
		await provider.createFile(provider.rootFolderId, 'project.json', 'v1');
		api.expireAccessTokens();

		const listing = await provider.listFiles(provider.rootFolderId);

		expect(listing.entries.map(entry => entry.path)).toEqual(['project.json']);
		expect(api.calls.slice(-2)).toEqual(['files/list_folder', 'files/list_folder']);
	});

	it('maps 429 to rate-limited', async () => {
		const { api, provider } = await createProvider();
		api.failNext('files/list_folder', 429);

		await expect(provider.listFiles(provider.rootFolderId)).rejects.toMatchObject({
			code: 'rate-limited',
		});
	});

	it('addresses files relative to the location root with display casing', async () => {
		const { provider } = await createProvider();
		const folderId = await provider.createFolder('Project');
		const created = await provider.createFile(folderId, 'transcriptions/PT-1.json', 'Ἀρχή');

		expect(created).toMatchObject({ id: 'Project/transcriptions/PT-1.json' });
		expect(await provider.createFolder('Project')).toBe(folderId);
		expect(await provider.downloadFile(created.id)).toBe('Ἀρχή');
		await expect(provider.listFiles('Missing')).rejects.toMatchObject({ code: 'not-found' });
	});
});

async function createProvider(options: { rootNamespaceId?: string } = {}) {
	const api = new FakeDropboxApi(options);
	const common = { ...options, tokens: api.tokens, fetch: api.fetch };
	await new DropboxStorageProvider({ ...common, rootPath: '' }).createFolder('Apatosaurus');
	const provider = new DropboxStorageProvider({ ...common, rootPath: '/Apatosaurus' });
	return { api, provider };
}
