import { describe, expect, it } from 'vitest';

import { shouldShowInstallNudge } from './project-backup-health-state';

describe('project backup health state', () => {
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
