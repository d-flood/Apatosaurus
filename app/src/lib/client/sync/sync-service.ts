import { ensureDjazzkitRuntime } from '$lib/client/djazzkit-runtime';

class SyncService {
	lastSyncTime = $state<string | null>(null);
	ready = $state(false);
	syncStatus = $state<'idle' | 'active' | 'paused' | 'error'>('idle');
	connected = $state(false);

	async startSync(_dbName: string, _email: string): Promise<void> {
		await ensureDjazzkitRuntime();
		this.ready = true;
		this.connected = false;
		this.syncStatus = 'paused';
	}

	stopSync(): void {
		this.ready = false;
		this.connected = false;
		this.syncStatus = 'idle';
	}

	isRunning(): boolean {
		return this.ready;
	}
}

export const syncService = new SyncService();
