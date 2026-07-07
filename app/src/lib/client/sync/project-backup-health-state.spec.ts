import { describe, expect, it } from 'vitest';

import {
	deriveProjectBackupHealthState,
	shouldShowInstallNudge,
} from './project-backup-health-state';

describe('project backup health state', () => {
	it('covers fresh, synced, exported-only, and browser-only project states', () => {
		expect(
			deriveProjectBackupHealthState({
				lastCommittedAt: null,
				lastSyncedAt: null,
				lastExportedAt: null,
				hasEnabledSyncTarget: false,
				localFolderSupported: true,
			})
		).toMatchObject({ status: 'fresh', showBrowserOnlyPrompt: false });

		expect(
			deriveProjectBackupHealthState({
				lastCommittedAt: '2026-07-07T10:00:00.000Z',
				lastSyncedAt: '2026-07-07T10:05:00.000Z',
				lastExportedAt: null,
				hasEnabledSyncTarget: true,
				localFolderSupported: true,
			})
		).toMatchObject({ status: 'protected-by-sync', showBrowserOnlyPrompt: false });

		expect(
			deriveProjectBackupHealthState({
				lastCommittedAt: '2026-07-07T10:00:00.000Z',
				lastSyncedAt: null,
				lastExportedAt: '2026-07-07T10:10:00.000Z',
				hasEnabledSyncTarget: false,
				localFolderSupported: false,
			})
		).toMatchObject({ status: 'protected-by-export', showBrowserOnlyPrompt: false });

		expect(
			deriveProjectBackupHealthState({
				lastCommittedAt: '2026-07-07T10:00:00.000Z',
				lastSyncedAt: null,
				lastExportedAt: null,
				hasEnabledSyncTarget: false,
				localFolderSupported: true,
			})
		).toMatchObject({
				status: 'browser-only',
				showBrowserOnlyPrompt: true,
				primaryAction: 'connect-folder',
			});
	});

	it('uses export as the browser-only action when folder sync is unsupported', () => {
		expect(
			deriveProjectBackupHealthState({
				lastCommittedAt: '2026-07-07T10:00:00.000Z',
				lastSyncedAt: null,
				lastExportedAt: null,
				hasEnabledSyncTarget: false,
				localFolderSupported: false,
			}).primaryAction
		).toBe('export');
	});

	it('shows install nudge once per data milestone when install is supported', () => {
		expect(
			shouldShowInstallNudge({
				hasData: true,
				installSupported: true,
				isInstalled: false,
				currentMilestone: 'commits:1',
				dismissedMilestone: null,
			})
		).toBe(true);
		expect(
			shouldShowInstallNudge({
				hasData: true,
				installSupported: true,
				isInstalled: false,
				currentMilestone: 'commits:1',
				dismissedMilestone: 'commits:1',
			})
		).toBe(false);
		expect(
			shouldShowInstallNudge({
				hasData: true,
				installSupported: true,
				isInstalled: true,
				currentMilestone: 'commits:2',
				dismissedMilestone: null,
			})
		).toBe(false);
	});
});
