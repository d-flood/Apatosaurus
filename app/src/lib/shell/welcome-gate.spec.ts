import { describe, expect, it } from 'vitest';

import { shouldShowWelcome } from './welcome-gate';

describe('welcome gate', () => {
	it('shows only with no accounts, no projects and no skip', () => {
		expect(shouldShowWelcome({ accountCount: 0, projectCount: 0, skipped: false })).toBe(true);
		expect(shouldShowWelcome({ accountCount: 1, projectCount: 0, skipped: false })).toBe(false);
		expect(shouldShowWelcome({ accountCount: 0, projectCount: 1, skipped: false })).toBe(false);
		expect(shouldShowWelcome({ accountCount: 0, projectCount: 0, skipped: true })).toBe(false);
		expect(shouldShowWelcome({ accountCount: 2, projectCount: 3, skipped: true })).toBe(false);
	});
});
