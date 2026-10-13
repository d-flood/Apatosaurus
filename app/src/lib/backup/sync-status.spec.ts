import { describe, expect, it } from 'vitest';
import type { CloudProviderErrorCode } from './providers/provider';
import type { SyncUiState } from './sync-manager';
import type { ProjectPlacement } from '$lib/storage/project-locations';
import {
	isNotBackedUp,
	syncStatusFor,
	syncStatusLabel,
	syncStatusReason,
	worstSyncStatus,
	type SyncStatus,
} from './sync-status';

const states = ['synced', 'saved-on-device', 'needs-attention'];

const expectedByUiState: Record<SyncUiState, SyncStatus> = {
	synced: { state: 'synced' },
	'saved locally': { state: 'saved-on-device', reason: 'uploading' },
	'sync pending': { state: 'saved-on-device', reason: 'uploading' },
	'remote update available': { state: 'saved-on-device', reason: 'uploading' },
	'conflict requires resolution': { state: 'needs-attention', reason: 'conflict-copy' },
};

const expectedByProviderError: Record<CloudProviderErrorCode, SyncStatus> = {
	'reauthorization-required': { state: 'needs-attention', reason: 'reconnect' },
	'permission-denied': { state: 'needs-attention', reason: 'reconnect' },
	'provider-unavailable': { state: 'saved-on-device', reason: 'offline' },
	'rate-limited': { state: 'saved-on-device', reason: 'uploading' },
	conflict: { state: 'saved-on-device', reason: 'uploading' },
	'not-found': { state: 'saved-on-device', reason: 'uploading' },
	unknown: { state: 'saved-on-device', reason: 'uploading' },
};

describe('syncStatusFor', () => {
	it.each(Object.entries(expectedByUiState))('maps sync state %s', (uiState, expected) => {
		expect(
			syncStatusFor({ hasLocation: true, online: true, uiState: uiState as SyncUiState })
		).toEqual(expected);
	});

	it.each(Object.entries(expectedByProviderError))(
		'maps provider error %s',
		(providerError, expected) => {
			expect(
				syncStatusFor({
					hasLocation: true,
					online: true,
					uiState: 'sync pending',
					providerError: providerError as CloudProviderErrorCode,
				})
			).toEqual(expected);
		}
	);

	it('maps every combination to exactly one of the three states', () => {
		for (const uiState of [undefined, ...Object.keys(expectedByUiState)] as const)
			for (const providerError of [undefined, ...Object.keys(expectedByProviderError)])
				for (const hasLocation of [true, false])
					for (const online of [true, false]) {
						const status = syncStatusFor({
							hasLocation,
							online,
							uiState: uiState as SyncUiState | undefined,
							providerError: providerError as CloudProviderErrorCode | undefined,
						});
						expect(states).toContain(status.state);
						expect(syncStatusLabel(status)).toBeTruthy();
						expect(syncStatusReason(status)).toBeTruthy();
					}
	});

	it('reports a moved browser-only copy as needing attention until acknowledged', () => {
		expect(syncStatusFor({ hasLocation: false, moved: true, online: false })).toEqual({
			state: 'needs-attention',
			reason: 'moved',
		});
	});

	it('treats a project not yet synced as uploading', () => {
		expect(syncStatusFor({ hasLocation: true, online: true })).toEqual({
			state: 'saved-on-device',
			reason: 'uploading',
		});
	});

	it('reports offline and browser-only as saved on this device', () => {
		expect(syncStatusFor({ hasLocation: true, online: false, uiState: 'synced' })).toEqual({
			state: 'saved-on-device',
			reason: 'offline',
		});
		expect(syncStatusFor({ hasLocation: false, online: true })).toEqual({
			state: 'saved-on-device',
			reason: 'browser-only',
		});
	});

	it('needs attention while any conflict copy exists, even once synced', () => {
		expect(
			syncStatusFor({
				hasLocation: true,
				online: true,
				uiState: 'synced',
				hasConflictCopies: true,
			})
		).toEqual({ state: 'needs-attention', reason: 'conflict-copy' });
	});

	it('keeps conflicts and reconnects as needs attention while offline', () => {
		expect(
			syncStatusFor({
				hasLocation: true,
				online: false,
				uiState: 'conflict requires resolution',
			})
		).toEqual({ state: 'needs-attention', reason: 'conflict-copy' });
		expect(
			syncStatusFor({
				hasLocation: true,
				online: false,
				uiState: 'sync pending',
				providerError: 'reauthorization-required',
			})
		).toEqual({ state: 'needs-attention', reason: 'reconnect' });
	});
});

describe('syncStatusLabel', () => {
	it('calls a browser-only project not backed up', () => {
		expect(syncStatusLabel({ state: 'saved-on-device', reason: 'browser-only' })).toBe(
			'Not backed up'
		);
	});

	it('keeps the state labels for projects in a location', () => {
		expect(syncStatusLabel({ state: 'synced' })).toBe('Synced');
		expect(syncStatusLabel({ state: 'saved-on-device', reason: 'uploading' })).toBe(
			'Saved on this device'
		);
		expect(syncStatusLabel({ state: 'saved-on-device', reason: 'offline' })).toBe(
			'Saved on this device'
		);
		expect(syncStatusLabel({ state: 'needs-attention', reason: 'reconnect' })).toBe(
			'Needs attention'
		);
	});
});

describe('isNotBackedUp', () => {
	const browserOnly: ProjectPlacement = {
		projectId: 'project-1',
		locationId: null,
		folderName: null,
		needsLocationChoice: false,
	};

	it('is true for a project with no placement', () => {
		expect(isNotBackedUp(undefined)).toBe(true);
	});

	it('is true for a browser-only placement, including an alpha project choosing a location', () => {
		expect(isNotBackedUp(browserOnly)).toBe(true);
		expect(isNotBackedUp({ ...browserOnly, needsLocationChoice: true })).toBe(true);
	});

	it('is false for a project in a location, a folder on this computer included', () => {
		expect(
			isNotBackedUp({ ...browserOnly, locationId: 'device-folder', folderName: 'project-1' })
		).toBe(false);
	});

	it('is false for a copy left behind by a move or deletion elsewhere', () => {
		expect(
			isNotBackedUp({
				...browserOnly,
				moved: {
					movedAt: '2026-10-03T12:00:00.000Z',
					movedBy: 'Ada',
					destinationLabel: 'Dropbox/Lab',
				},
			})
		).toBe(false);
		expect(
			isNotBackedUp({
				...browserOnly,
				deleted: { deletedAt: '2026-10-03T12:00:00.000Z', deletedBy: 'Ada' },
			})
		).toBe(false);
	});
});

describe('worstSyncStatus', () => {
	it('is synced for no projects', () => {
		expect(worstSyncStatus([])).toEqual({ state: 'synced' });
	});

	it('orders needs attention over saved on this device over synced', () => {
		const offline: SyncStatus = { state: 'saved-on-device', reason: 'offline' };
		const conflict: SyncStatus = { state: 'needs-attention', reason: 'conflict-copy' };
		expect(worstSyncStatus([{ state: 'synced' }, offline])).toEqual(offline);
		expect(worstSyncStatus([offline, conflict, { state: 'synced' }])).toEqual(conflict);
	});

	it('keeps the first of equally severe statuses', () => {
		expect(
			worstSyncStatus([
				{ state: 'saved-on-device', reason: 'offline' },
				{ state: 'saved-on-device', reason: 'browser-only' },
			])
		).toEqual({ state: 'saved-on-device', reason: 'offline' });
	});
});
