import { describe, expect, it } from 'vitest';

import { editingNotice, type PresenceRecord } from './editing-notice';

const NOW = Date.parse('2026-10-03T12:00:00.000Z');
const self = { deviceId: 'device-self', accountId: 'account-self' };

function presence(minutesAgo: number, overrides: Partial<PresenceRecord> = {}): PresenceRecord {
	return {
		deviceId: 'device-other',
		deviceName: 'MacBook',
		author: 'Anna',
		accountId: 'account-anna',
		documentId: 'doc-1',
		editedAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
		...overrides,
	};
}

describe('editing notice', () => {
	it('shows a teammate edit from 4 minutes ago', () => {
		expect(editingNotice([presence(4)], self, NOW)).toBe(
			'Anna has been editing this · 4 min ago'
		);
	});

	it('hides an edit from 6 minutes ago', () => {
		expect(editingNotice([presence(6)], self, NOW)).toBeNull();
	});

	it('names the device when the same account edited elsewhere', () => {
		expect(editingNotice([presence(3, { accountId: 'account-self' })], self, NOW)).toBe(
			'You edited this on MacBook · 3 min ago'
		);
	});

	it("ignores this device's own presence", () => {
		expect(editingNotice([presence(1, { deviceId: 'device-self' })], self, NOW)).toBeNull();
	});
});
