import type { ProjectPlacement } from '$lib/storage/project-locations';
import type { CloudProviderErrorCode } from './providers/provider';
import type { SyncUiState } from './sync-manager';

export type SyncStatus =
	| { state: 'synced' }
	| {
			state: 'saved-on-device';
			reason: 'offline' | 'uploading' | 'browser-only' | 'signed-out';
	  }
	| { state: 'needs-attention'; reason: 'conflict-copy' | 'reconnect' | 'moved' | 'deleted' };

export type SyncStatusState = SyncStatus['state'];

export interface SyncStatusInput {
	hasLocation: boolean;
	signedOut?: boolean;
	moved?: boolean;
	deleted?: boolean;
	online: boolean;
	uiState?: SyncUiState;
	providerError?: CloudProviderErrorCode;
	hasConflictCopies?: boolean;
}

const providerErrorStatus: Record<CloudProviderErrorCode, SyncStatus> = {
	'reauthorization-required': { state: 'needs-attention', reason: 'reconnect' },
	'permission-denied': { state: 'needs-attention', reason: 'reconnect' },
	'provider-unavailable': { state: 'saved-on-device', reason: 'offline' },
	'rate-limited': { state: 'saved-on-device', reason: 'uploading' },
	conflict: { state: 'saved-on-device', reason: 'uploading' },
	'not-found': { state: 'saved-on-device', reason: 'uploading' },
	unknown: { state: 'saved-on-device', reason: 'uploading' },
};

const uiStateStatus: Record<SyncUiState, SyncStatus> = {
	synced: { state: 'synced' },
	'saved locally': { state: 'saved-on-device', reason: 'uploading' },
	'sync pending': { state: 'saved-on-device', reason: 'uploading' },
	'remote update available': { state: 'saved-on-device', reason: 'uploading' },
	'conflict requires resolution': { state: 'needs-attention', reason: 'conflict-copy' },
};

export function syncStatusFor(input: SyncStatusInput): SyncStatus {
	if (input.hasConflictCopies) return { state: 'needs-attention', reason: 'conflict-copy' };
	if (input.moved) return { state: 'needs-attention', reason: 'moved' };
	if (input.deleted) return { state: 'needs-attention', reason: 'deleted' };
	if (input.signedOut) return { state: 'saved-on-device', reason: 'signed-out' };
	const fromError = input.providerError ? providerErrorStatus[input.providerError] : null;
	const fromUiState = input.uiState
		? uiStateStatus[input.uiState]
		: ({ state: 'saved-on-device', reason: 'uploading' } as const);
	if (fromUiState.state === 'needs-attention') return fromUiState;
	if (fromError?.state === 'needs-attention') return fromError;
	if (!input.hasLocation) return { state: 'saved-on-device', reason: 'browser-only' };
	if (!input.online) return { state: 'saved-on-device', reason: 'offline' };
	return fromError ?? fromUiState;
}

const severity: Record<SyncStatusState, number> = {
	synced: 0,
	'saved-on-device': 1,
	'needs-attention': 2,
};

export function worstSyncStatus(statuses: readonly SyncStatus[]): SyncStatus {
	return statuses.reduce<SyncStatus>(
		(worst, status) => (severity[status.state] > severity[worst.state] ? status : worst),
		{ state: 'synced' }
	);
}

export function isNotBackedUp(placement: ProjectPlacement | undefined): boolean {
	return !placement?.locationId && !placement?.moved && !placement?.deleted;
}

const syncStatusLabels: Record<SyncStatusState, string> = {
	synced: 'Synced',
	'saved-on-device': 'Saved on this device',
	'needs-attention': 'Needs attention',
};

export function syncStatusLabel(status: SyncStatus): string {
	return status.state === 'saved-on-device' && status.reason === 'browser-only'
		? 'Not backed up'
		: syncStatusLabels[status.state];
}

const reasonLabels = {
	offline: 'Offline',
	uploading: 'Uploading changes',
	'browser-only': 'Only in this browser',
	'signed-out': 'Signed out',
	'conflict-copy': 'Conflict copy to review',
	reconnect: 'Reconnect storage',
	moved: 'Project moved',
	deleted: 'Project deleted',
} as const;

export function syncStatusReason(status: SyncStatus): string {
	return status.state === 'synced' ? 'All changes synced' : reasonLabels[status.reason];
}
