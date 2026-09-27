import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	checkStoragePersistence,
	formatStorageBytes,
	getInstallCapabilityReport,
	getStorageEstimate,
	initializeInstallPromptTracking,
	isStorageNearQuota,
	promptForPwaInstall,
	resetPersistenceRequestSessionForTests,
	shouldShowDurabilityWarning,
} from './capabilities';

describe('client capabilities', () => {
	afterEach(() => {
		resetPersistenceRequestSessionForTests();
		vi.restoreAllMocks();
	});

	it('checks persistence state without requesting persistence on startup', async () => {
		const persisted = vi.fn().mockResolvedValue(false);
		const persist = vi.fn().mockResolvedValue(true);
		stubStorage({ persisted, persist });

		await expect(checkStoragePersistence()).resolves.toEqual({
			status: 'denied',
			persisted: false,
			canRequest: true,
		});
		expect(persist).not.toHaveBeenCalled();
	});

	it('decides when the durability warning should recur', () => {
		expect(
			shouldShowDurabilityWarning({
				hasUserData: false,
				persistenceStatus: 'denied',
				dismissedMilestone: null,
				currentMilestone: 'projects:0',
			})
		).toBe(false);
		expect(
			shouldShowDurabilityWarning({
				hasUserData: true,
				persistenceStatus: 'granted',
				dismissedMilestone: null,
				currentMilestone: 'projects:1',
			})
		).toBe(false);
		expect(
			shouldShowDurabilityWarning({
				hasUserData: true,
				persistenceStatus: 'denied',
				dismissedMilestone: 'projects:1',
				currentMilestone: 'projects:1',
			})
		).toBe(false);
		expect(
			shouldShowDurabilityWarning({
				hasUserData: true,
				persistenceStatus: 'denied',
				dismissedMilestone: 'projects:1',
				currentMilestone: 'projects:2',
			})
		).toBe(true);
		expect(
			shouldShowDurabilityWarning({
				hasUserData: true,
				persistenceStatus: 'unsupported',
				dismissedMilestone: null,
				currentMilestone: 'projects:1',
			})
		).toBe(true);
	});

	it('reports storage estimates and warns near quota', async () => {
		stubStorage({ estimate: vi.fn().mockResolvedValue({ usage: 850, quota: 1_000 }) });

		await expect(getStorageEstimate()).resolves.toEqual({
			usage: 850,
			quota: 1_000,
			usageRatio: 0.85,
			isNearQuota: true,
		});
		expect(isStorageNearQuota(0.79)).toBe(false);
		expect(isStorageNearQuota(0.8)).toBe(true);
		expect(formatStorageBytes(1_536)).toBe('1.5 KB');
	});

	it('tracks beforeinstallprompt support and consumes the install prompt once', async () => {
		const listeners = new Map<string, EventListener>();
		vi.stubGlobal(
			'addEventListener',
			vi.fn((type: string, listener: EventListener) => {
				listeners.set(type, listener);
			})
		);
		vi.stubGlobal('removeEventListener', vi.fn());
		const cleanup = initializeInstallPromptTracking();
		const event = new Event('beforeinstallprompt') as Event & {
			prompt: () => Promise<void>;
			userChoice: Promise<{ outcome: 'accepted'; platform: string }>;
		};
		event.prompt = vi.fn().mockResolvedValue(undefined);
		event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });

		listeners.get('beforeinstallprompt')?.(event);

		expect(getInstallCapabilityReport()).toEqual({
			isInstalled: false,
			installSupported: true,
		});
		await expect(promptForPwaInstall()).resolves.toBe(true);
		expect(event.prompt).toHaveBeenCalledTimes(1);
		expect(getInstallCapabilityReport().installSupported).toBe(false);
		cleanup();
	});
});

function stubStorage(storage: Partial<StorageManager>): void {
	vi.stubGlobal('navigator', { storage });
}
