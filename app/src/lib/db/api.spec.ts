import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/backup/provider-factory', () => ({ createProviderForLocation: async () => ({}) }));
vi.mock('$lib/backup/version-author', () => ({ effectiveAuthorName: async () => null }));
vi.mock('$lib/backup/sync-manager', async importOriginal => ({
	...(await importOriginal<typeof import('$lib/backup/sync-manager')>()),
	backupProject: async () => ({
		uiState: 'synced',
		uploadedPaths: [],
		downloadedPaths: ['cbgm/analysis-1.json'],
		deletedPaths: [],
		quarantines: [],
	}),
}));
vi.mock('$lib/backup/location-discovery', () => ({
	discoverLocationProjects: async () => ({
		locationId: 'location-1',
		projects: [{ projectId: 'project-1', folderName: 'romans', imported: true }],
	}),
}));

import { dbApi, type DbApiContext } from './api';

function apiContext() {
	const invalidated: string[] = [];
	const context: DbApiContext = {
		db: {} as DbApiContext['db'],
		invalidate: (...domains) => invalidated.push(...domains),
		warn: () => undefined,
		exclusive: work => work(),
	};
	return { context, invalidated };
}

describe('database api invalidation', () => {
	it('invalidates analyses when a sync downloads files', async () => {
		const { context, invalidated } = apiContext();

		await dbApi.backupProject(context, {
			connectionId: 'location-1',
			projectId: 'project-1',
			cloudFolderId: 'folder-1',
		});

		expect(invalidated).toContain('cbgm-analyses');
	});

	it('invalidates analyses when discovery imports a project', async () => {
		const { context, invalidated } = apiContext();

		await dbApi.discoverLocationProjects(context, 'location-1');

		expect(invalidated).toContain('cbgm-analyses');
	});
});
