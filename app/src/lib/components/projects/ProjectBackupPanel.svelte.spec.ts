import { page } from '@vitest/browser/context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const mocks = vi.hoisted(() => ({
	getLatestProjectCommitTimestamp: vi.fn(),
	loadProjectBackupOverviews: vi.fn(),
	listProjectDocumentTitles: vi.fn(),
}));

vi.mock('$lib/client/db/client', () => ({
	backupProject: vi.fn(),
	exportProjectZip: vi.fn(),
	forkProject: vi.fn(),
	getLatestProjectCommitTimestamp: mocks.getLatestProjectCommitTimestamp,
	listProjectDocumentTitles: mocks.listProjectDocumentTitles,
	subscribeLocalDbInvalidations: vi.fn(() => vi.fn()),
}));

vi.mock('$lib/client/capabilities', () => ({
	getInstallCapabilityReport: vi.fn(() => ({ isInstalled: false, installSupported: false })),
	initializeInstallPromptTracking: vi.fn(() => vi.fn()),
	promptForPwaInstall: vi.fn(),
}));

vi.mock('$lib/client/sync/local-folder-connections', () => ({
	connectProjectSyncFolder: vi.fn(),
	disconnectProjectSyncFolder: vi.fn(),
	isLocalFolderProviderSupported: vi.fn(() => true),
	reconnectProjectSyncFolder: vi.fn(),
}));

vi.mock('$lib/client/sync/project-backup-overview', () => ({
	loadProjectBackupOverviews: mocks.loadProjectBackupOverviews,
}));

vi.mock('$lib/client/download-blob', () => ({ downloadZipArchive: vi.fn() }));

vi.mock('$lib/client/store', () => ({
	getProjectBackupMetadata: vi.fn(() => ({ lastExportedAt: null })),
	recordProjectZipExport: vi.fn(),
	updateSyncTargetLastSyncedAt: vi.fn(),
}));

vi.mock('$lib/client/sync/sync-service.svelte', () => ({
	syncService: { reconnectProjectIds: [] },
}));

vi.mock('$lib/client/sync/project-zip-export', () => ({
	projectBackupCapabilityMessage: vi.fn(() => ({ message: '' })),
}));

import ProjectBackupPanel from './ProjectBackupPanel.svelte';

describe('ProjectBackupPanel', () => {
	beforeEach(() => {
		mocks.getLatestProjectCommitTimestamp.mockResolvedValue('2026-07-18T12:00:00.000Z');
		mocks.listProjectDocumentTitles.mockResolvedValue([
			{
				entityType: 'project-transcription',
				entityId: 'project-transcription-1',
				title: 'Codex Vaticanus',
			},
			{ entityType: 'collation', entityId: 'collation-1', title: 'Romans 1:1 Collation' },
		]);
		const selectedTarget = {
			targetId: 'target-1',
			projectId: 'project-1',
			enabled: true,
			folderDisplayPath: 'Apatosaurus/Project',
			lastSyncedAt: null,
		};
		mocks.loadProjectBackupOverviews.mockResolvedValue({
			'project-1': {
				projectId: 'project-1',
				status: 'backed-up',
				targets: [selectedTarget],
				selectedTarget,
				context: {
					projectId: 'project-1',
					connectionId: 'target-1',
					cloudFolderId: '.',
					cloudFolderPath: '',
				},
				summary: {
					transcriptions: [
						{
							itemType: 'project-transcription',
							itemId: 'project-transcription-1',
							path: 'transcriptions/project-transcription-1.json',
							status: 'backed-up',
						},
						{
							itemType: 'project-transcription',
							itemId: 'orphaned-transcription',
							path: 'transcriptions/orphaned-transcription.json',
							status: 'backed-up',
						},
					],
					collations: [
						{
							itemType: 'collation',
							itemId: 'collation-1',
							path: 'collations/collation-1.json',
							status: 'backed-up',
						},
					],
					blockingItems: [],
					pendingItems: [],
					tombstones: [],
					lastFullySyncedAt: null,
				},
				error: null,
			},
		});
	});

	it('shows document titles above paths and keeps the raw fallback for unresolved files', async () => {
		render(ProjectBackupPanel, { projectId: 'project-1' });

		await expect.element(page.getByText('Codex Vaticanus')).toBeInTheDocument();
		await expect.element(page.getByText('Romans 1:1 Collation')).toBeInTheDocument();
		await expect
			.element(page.getByText('Transcription orphaned-transcription'))
			.toBeInTheDocument();
		await expect
			.element(page.getByText('transcriptions/project-transcription-1.json'))
			.toBeInTheDocument();
		await expect.element(page.getByText('collations/collation-1.json')).toBeInTheDocument();
		expect(mocks.loadProjectBackupOverviews).toHaveBeenCalledWith(['project-1']);
		expect(mocks.listProjectDocumentTitles).toHaveBeenCalledOnce();
		expect(mocks.listProjectDocumentTitles).toHaveBeenCalledWith('project-1');
	});
});
