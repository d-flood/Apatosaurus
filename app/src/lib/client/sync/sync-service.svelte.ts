import { ensureDjazzkitRuntime } from '$lib/client/djazzkit-runtime';

class SyncService {
	lastSyncTime = $state<string | null>(null);
	ready = $state(false);
	syncStatus = $state<'idle' | 'active' | 'paused' | 'error'>('idle');
	connected = $state(false);

	async initLocalDB(_dbName: string): Promise<void> {
		await ensureDjazzkitRuntime();
		this.ready = true;
		this.syncStatus = 'paused';
		this.connected = false;
		this.lastSyncTime = null;
	}

	async startSync(_dbName: string, _email: string): Promise<void> {
		await this.initLocalDB('local');
	}

	stopSync(): void {
		this.ready = false;
		this.connected = false;
		this.syncStatus = 'idle';
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
}

export const syncService = new SyncService();
