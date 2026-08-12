import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncTargetRecord } from '$lib/client/store';
import type { BackupItemState, ProjectBackupSummary } from './sync-manager';

const mocks = vi.hoisted(() => ({
	deriveProjectBackupSummary: vi.fn(),
	listSyncTargets: vi.fn(),
}));

vi.mock('$lib/client/db/client', () => ({
	deriveProjectBackupSummary: mocks.deriveProjectBackupSummary,
}));

vi.mock('$lib/client/store', () => ({
	listSyncTargets: mocks.listSyncTargets,
}));

import { loadProjectBackupOverviews } from './project-backup-overview';

describe('project backup overview', () => {
	beforeEach(() => {
		mocks.deriveProjectBackupSummary.mockReset();
		mocks.listSyncTargets.mockReset();
	});

	it('selects an enabled target before the first target and constructs its sync context', async () => {
		const disabled = target({ targetId: 'target-disabled', enabled: false });
		const enabled = target({ targetId: 'target-enabled', enabled: true });
		const summary = backupSummary();
		mocks.listSyncTargets.mockResolvedValue([disabled, enabled]);
		mocks.deriveProjectBackupSummary.mockResolvedValue(summary);

		const result = await loadProjectBackupOverviews(['project-1']);

		expect(result['project-1']).toEqual({
			projectId: 'project-1',
			status: 'backed-up',
			targets: [disabled, enabled],
			selectedTarget: enabled,
			context: {
				projectId: 'project-1',
				connectionId: 'target-enabled',
				cloudFolderId: '.',
				cloudFolderPath: '',
			},
			summary,
			error: null,
		});
		expect(mocks.deriveProjectBackupSummary).toHaveBeenCalledWith({
			projectId: 'project-1',
			connectionId: 'target-enabled',
			cloudFolderId: '.',
			cloudFolderPath: '',
		});
	});

	it('selects the first target when none are enabled', async () => {
		const first = target({ targetId: 'target-first', enabled: false });
		const second = target({ targetId: 'target-second', enabled: false });
		mocks.listSyncTargets.mockResolvedValue([first, second]);
		mocks.deriveProjectBackupSummary.mockResolvedValue(backupSummary());

		const result = await loadProjectBackupOverviews(['project-1']);

		expect(result['project-1'].selectedTarget).toBe(first);
		expect(result['project-1'].context?.connectionId).toBe('target-first');
	});

	it('returns only local-only, blocked, pending, and backed-up semantic states from local data', async () => {
		const blockingItem = backupItem({ status: 'uncommitted-local-changes' });
		const pendingItem = backupItem({ itemId: 'pending', status: 'committed-pending-backup' });
		const tombstone = backupItem({
			itemType: 'tombstone',
			itemId: 'tombstone',
			status: 'committed-pending-backup',
		});
		mocks.listSyncTargets.mockResolvedValue([
			target({ projectId: 'blocked' }),
			target({ projectId: 'pending' }),
			target({ projectId: 'tombstone-pending' }),
			target({ projectId: 'backed-up' }),
		]);
		mocks.deriveProjectBackupSummary.mockImplementation(async context => {
			if (context.projectId === 'blocked') {
				return backupSummary({ projectId: 'blocked', blockingItems: [blockingItem] });
			}
			if (context.projectId === 'pending') {
				return backupSummary({ projectId: 'pending', pendingItems: [pendingItem] });
			}
			if (context.projectId === 'tombstone-pending') {
				return backupSummary({ projectId: 'tombstone-pending', tombstones: [tombstone] });
			}
			return backupSummary({ projectId: 'backed-up' });
		});

		const result = await loadProjectBackupOverviews([
			'local-only',
			'blocked',
			'pending',
			'tombstone-pending',
			'backed-up',
		]);

		expect(
			Object.fromEntries(
				Object.entries(result).map(([id, overview]) => [id, overview.status])
			)
		).toEqual({
			'local-only': 'local-only',
			blocked: 'blocked',
			pending: 'pending',
			'tombstone-pending': 'pending',
			'backed-up': 'backed-up',
		});
	});

	it('isolates summary failures by project and reads the target file once for a bulk load', async () => {
		mocks.listSyncTargets.mockResolvedValue([
			target({ projectId: 'available', targetId: 'target-available' }),
			target({ projectId: 'unavailable', targetId: 'target-unavailable' }),
		]);
		mocks.deriveProjectBackupSummary.mockImplementation(async context => {
			if (context.projectId === 'unavailable') throw new Error('local summary failed');
			return backupSummary({ projectId: context.projectId });
		});

		const result = await loadProjectBackupOverviews(['available', 'unavailable', 'local-only']);

		expect(result.available.status).toBe('backed-up');
		expect(result.unavailable).toMatchObject({
			projectId: 'unavailable',
			status: 'unavailable',
			selectedTarget: { targetId: 'target-unavailable' },
			summary: null,
		});
		expect(result.unavailable.error).toEqual(new Error('local summary failed'));
		expect(result['local-only'].status).toBe('local-only');
		expect(mocks.listSyncTargets).toHaveBeenCalledOnce();
		expect(mocks.listSyncTargets).toHaveBeenCalledWith();
	});

	it('returns unavailable results when the shared local target file cannot be read', async () => {
		const error = new Error('sync targets are corrupt');
		mocks.listSyncTargets.mockRejectedValue(error);

		const result = await loadProjectBackupOverviews(['project-1', 'project-2']);

		expect(result).toEqual({
			'project-1': {
				projectId: 'project-1',
				status: 'unavailable',
				targets: [],
				selectedTarget: null,
				context: null,
				summary: null,
				error,
			},
			'project-2': {
				projectId: 'project-2',
				status: 'unavailable',
				targets: [],
				selectedTarget: null,
				context: null,
				summary: null,
				error,
			},
		});
		expect(mocks.deriveProjectBackupSummary).not.toHaveBeenCalled();
	});
});

function target(overrides: Partial<SyncTargetRecord> = {}): SyncTargetRecord {
	return {
		targetId: 'target-1',
		projectId: 'project-1',
		handleRef: 'target-1',
		folderDisplayPath: 'Apatosaurus/Project',
		enabled: true,
		connectedAt: '2026-08-01T00:00:00.000Z',
		updatedAt: '2026-08-01T00:00:00.000Z',
		lastSyncedAt: null,
		...overrides,
	};
}

function backupSummary(overrides: Partial<ProjectBackupSummary> = {}): ProjectBackupSummary {
	return {
		projectId: 'project-1',
		connectionId: 'target-1',
		cloudFolderId: 'root',
		projectManifestState: {
			itemType: 'project-manifest',
			itemId: 'project-1',
			path: 'project.json',
			status: 'unknown',
		},
		transcriptions: [],
		collations: [],
		tombstones: [],
		remoteManifestState: 'not-checked',
		blockingItems: [],
		pendingItems: [],
		lastFullySyncedAt: null,
		...overrides,
	};
}

function backupItem(overrides: Partial<BackupItemState> = {}): BackupItemState {
	return {
		itemType: 'project-transcription',
		itemId: 'transcription-1',
		path: 'transcriptions/transcription-1.json',
		status: 'backed-up',
		...overrides,
	};
}
