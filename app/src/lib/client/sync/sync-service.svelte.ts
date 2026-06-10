import type { SyncUiState } from './sync-manager';

class SyncService {
	lastSyncTime = $state<string | null>(null);
	ready = $state(false);
	syncStatus = $state<'idle' | 'active' | 'paused' | 'error'>('idle');
	connected = $state(false);
	uiState = $state<SyncUiState>('saved locally');

	async initLocalDB(_dbName: string): Promise<void> {
		this.ready = true;
		this.syncStatus = 'paused';
		this.connected = false;
		this.lastSyncTime = null;
		this.uiState = 'saved locally';
	}

	async startSync(_dbName: string, _email: string): Promise<void> {
		await this.initLocalDB('local');
	}

	stopSync(): void {
		this.ready = false;
		this.connected = false;
		this.syncStatus = 'idle';
		this.uiState = 'saved locally';
	}

	isRunning(): boolean {
		return this.ready;
	}

	async updateSyncTimestamp(): Promise<void> {
		this.lastSyncTime = new Date().toISOString();
	}

	async loadLastSyncTime(): Promise<void> {
		return;
	}

	setUiState(uiState: SyncUiState): void {
		this.uiState = uiState;
	}

	markRemoteUpdateAvailable(): void {
		this.setUiState('remote update available');
	}

	markConflict(): void {
		this.setUiState('conflict requires resolution');
	}

	markSynced(): void {
		this.setUiState('synced');
		this.connected = true;
		this.syncStatus = 'active';
		this.lastSyncTime = new Date().toISOString();
	}
}

export const syncService = new SyncService();
