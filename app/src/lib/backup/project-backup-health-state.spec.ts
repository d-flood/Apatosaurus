import { describe, expect, it } from 'vitest';

import {
	deriveProjectBackupHealthState,
	shouldShowInstallNudge,
} from './project-backup-health-state';

describe('project backup health state', () => {
	it('shows the nudge only for a browser-only project with content', () => {
		const prompt = (hasContent: boolean, hasLocation: boolean) =>
			deriveProjectBackupHealthState({ hasContent, hasLocation, localFolderSupported: true })
				.showBrowserOnlyPrompt;

		expect(prompt(true, false)).toBe(true);
		expect(prompt(false, false)).toBe(false);
		expect(prompt(true, true)).toBe(false);
		expect(prompt(false, true)).toBe(false);
	});

	it('uses export as the browser-only action when folder sync is unsupported', () => {
		const state = (localFolderSupported: boolean) =>
			deriveProjectBackupHealthState({
				hasContent: true,
				hasLocation: false,
				localFolderSupported,
			}).primaryAction;

		expect(state(true)).toBe('connect-folder');
		expect(state(false)).toBe('export');
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
