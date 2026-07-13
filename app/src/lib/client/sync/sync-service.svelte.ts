import { browser } from '$app/environment';
import {
	backupEligibleProjectEntities,
	emitLocalDbInvalidation,
	subscribeLocalDbInvalidations,
} from '$lib/client/db/client';
import {
	listSyncTargets,
	updateSyncTargetLastSyncedAt,
	type SyncTargetRecord,
} from '$lib/client/store';
import { LOCAL_FOLDER_ROOT_FOLDER_ID } from './providers/local-folder-provider';
import {
	OpenObjectSyncPoller,
	type ProjectBackupResult,
	type SyncProjectContext,
	type SyncUiState,
} from './sync-manager';

interface TargetPoller {
	target: SyncTargetRecord;
	poller: OpenObjectSyncPoller;
	key: string;
}

class SyncService {
	lastSyncTime = $state<string | null>(null);
	ready = $state(false);
	syncStatus = $state<'idle' | 'active' | 'paused' | 'error'>('idle');
	connected = $state(false);
	reconnectRequired = $state(false);
	reconnectProjectIds = $state<string[]>([]);
	uiState = $state<SyncUiState>('saved locally');
	private pollers = new Map<string, TargetPoller>();
	private runningSyncs = new Map<string, Promise<ProjectBackupResult>>();
	private unsubscribeInvalidations: (() => void) | null = null;
	private eventsAttached = false;

	async initLocalDB(_dbName: string): Promise<void> {
		this.ready = true;
		this.syncStatus = 'paused';
		this.connected = false;
		this.reconnectRequired = false;
		this.reconnectProjectIds = [];
		this.lastSyncTime = null;
		this.uiState = 'saved locally';
		if (!browser) return;
		this.attachEvents();
		this.attachInvalidations();
		await this.reloadTargets();
	}

	async startSync(_dbName: string, _email: string): Promise<void> {
		await this.initLocalDB('local');
	}

	stopSync(): void {
		this.ready = false;
		this.connected = false;
		this.reconnectRequired = false;
		this.reconnectProjectIds = [];
		this.syncStatus = 'idle';
		this.uiState = 'saved locally';
		for (const entry of this.pollers.values()) entry.poller.stop();
		this.pollers.clear();
		this.runningSyncs.clear();
		this.unsubscribeInvalidations?.();
		this.unsubscribeInvalidations = null;
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

	private attachEvents(): void {
		if (this.eventsAttached || typeof window === 'undefined') return;
		window.addEventListener('focus', () => void this.syncAllNow());
		window.addEventListener('online', () => void this.syncAllNow());
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') void this.syncAllNow();
		});
		this.eventsAttached = true;
	}

	private attachInvalidations(): void {
		if (this.unsubscribeInvalidations) return;
		this.unsubscribeInvalidations = subscribeLocalDbInvalidations(event => {
			if (event.domain === 'sync-targets' || event.domain === 'all') {
				void this.reloadTargets();
				return;
			}
			if (event.domain === 'projects' || event.domain === 'transcriptions' || event.domain === 'collations') {
				void this.syncAllNow();
			}
		});
	}

	private async reloadTargets(): Promise<void> {
		if (!this.ready || !browser) return;
		const targets = (await listSyncTargets()).filter(target => target.enabled);
		const activeIds = new Set(targets.map(target => target.targetId));
		for (const [targetId, entry] of this.pollers) {
			if (!activeIds.has(targetId)) {
				entry.poller.stop();
				this.pollers.delete(targetId);
			}
		}

		for (const target of targets) this.ensurePoller(target);
		this.connected = this.pollers.size > 0;
		this.syncStatus = this.connected ? 'active' : 'paused';
	}

	private ensurePoller(target: SyncTargetRecord): void {
		const key = targetKey(target);
		const existing = this.pollers.get(target.targetId);
		if (existing?.key === key) {
			existing.target = target;
			existing.poller.resumeAfterReconnect();
			return;
		}

		existing?.poller.stop();
		const poller = new OpenObjectSyncPoller({
			poll: () => this.runTargetSync(target),
		});
		this.pollers.set(target.targetId, { target, poller, key });
		poller.start();
	}

	private async syncAllNow(): Promise<void> {
		if (!this.ready || !browser) return;
		if (this.pollers.size === 0) await this.reloadTargets();
		await Promise.all([...this.pollers.values()].map(entry => entry.poller.pollNow()));
	}

	private runTargetSync(target: SyncTargetRecord): Promise<ProjectBackupResult> {
		const existing = this.runningSyncs.get(target.targetId);
		if (existing) return existing;
		const run = this.performTargetSync(target).finally(() => {
			this.runningSyncs.delete(target.targetId);
		});
		this.runningSyncs.set(target.targetId, run);
		return run;
	}

	private async performTargetSync(target: SyncTargetRecord): Promise<ProjectBackupResult> {
		try {
			const result = await backupEligibleProjectEntities(syncContext(target));
			this.applyResult(result, target);
			if (result.uiState === 'synced') {
				const syncedAt = new Date().toISOString();
				await updateSyncTargetLastSyncedAt(target.targetId, syncedAt);
				emitLocalDbInvalidation('sync-targets');
				this.lastSyncTime = syncedAt;
			}
			return result;
		} catch (error) {
			const result = failureResult(target, error);
			this.applyResult(result, target);
			return result;
		}
	}

	private applyResult(result: ProjectBackupResult, target: SyncTargetRecord): void {
		this.uiState = result.uiState;
		const reconnect = result.providerError === 'reauthorization-required';
		this.reconnectProjectIds = reconnect
			? [...new Set([...this.reconnectProjectIds, target.projectId])]
			: this.reconnectProjectIds.filter(projectId => projectId !== target.projectId);
		this.reconnectRequired = this.reconnectProjectIds.length > 0;
		this.connected = this.pollers.size > 0 && !this.reconnectRequired;
		this.syncStatus = reconnect ? 'paused' : result.providerError ? 'error' : 'active';
		if (result.uiState === 'synced') this.lastSyncTime = new Date().toISOString();
	}
}

export const syncService = new SyncService();

function syncContext(target: SyncTargetRecord): SyncProjectContext {
	return {
		projectId: target.projectId,
		connectionId: target.targetId,
		cloudFolderId: LOCAL_FOLDER_ROOT_FOLDER_ID,
		cloudFolderPath: '',
	};
}

function targetKey(target: SyncTargetRecord): string {
	return [target.projectId, target.handleRef, target.folderDisplayPath, String(target.enabled)].join(':');
}

function failureResult(target: SyncTargetRecord, error: unknown): ProjectBackupResult {
	const message = error instanceof Error ? error.message : String(error);
	return {
		uiState: 'sync pending',
		projectId: target.projectId,
		manifestUploaded: false,
		entityResults: [],
		skippedItems: [],
		providerError: isReconnectError(message) ? 'reauthorization-required' : 'provider-unavailable',
		providerMessage: message,
		uploadedPaths: [],
		downloadedPaths: [],
		deletedPaths: [],
		quarantines: [],
	};
}

function isReconnectError(message: string): boolean {
	return /permission|reconnect|directory picker|folder target was not found/i.test(message);
}
