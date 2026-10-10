import { browser } from '$app/environment';
import {
	backupProject,
	deleteProject,
	listProjects,
	moveProject,
	subscribeLocalDbInvalidations,
} from '$lib/db/client';
import {
	listProjectLocations,
	listProjectPlacements,
	listStorageAccounts,
	upgradeSyncTargetsToPlacements,
	isPlacedProject,
	type PlacedProject,
} from '$lib/storage/project-locations';
import { deleteLocalFolderHandle } from './local-folder-handles';
import { placeDiscoveredProjects } from './location-connections';
import type { ProjectBackupResult, SyncUiState } from './sync-manager';
import { placementSyncContext } from './backup-status';
import { syncStatusFor, worstSyncStatus, type SyncStatus } from './sync-status';
import { OpenObjectSyncPoller } from '$lib/backup/sync-poller';

interface TargetPoller {
	target: PlacedProject;
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
	projectIds = $state<string[] | null>(null);
	syncedProjectIds = $state<string[]>([]);
	signedOutProjectIds = $state<string[]>([]);
	movedProjectIds = $state<string[]>([]);
	deletedProjectIds = $state<string[]>([]);
	projectResults = $state<Record<string, ProjectBackupResult>>({});
	projectSyncedAt = $state<Record<string, string>>({});
	private pollers = new Map<string, TargetPoller>();
	private runningSyncs = new Map<string, Promise<ProjectBackupResult>>();
	private movingProjectIds = new Set<string>();
	private unsubscribeInvalidations: (() => void) | null = null;
	private discoveryTimer: ReturnType<typeof setInterval> | null = null;
	private runningDiscovery: Promise<void> | null = null;
	private eventsAttached = false;
	private uploadTimer: ReturnType<typeof setTimeout> | null = null;

	async initLocalDB(_dbName: string): Promise<void> {
		this.ready = true;
		this.syncStatus = 'paused';
		this.connected = false;
		this.reconnectRequired = false;
		this.reconnectProjectIds = [];
		this.lastSyncTime = null;
		this.uiState = 'saved locally';
		this.projectResults = {};
		if (!browser) return;
		this.attachEvents();
		this.attachInvalidations();
		try {
			await upgradeSyncTargetsToPlacements(deleteLocalFolderHandle);
		} catch (error) {
			console.warn('[sync] sync target upgrade failed', error);
		}
		await Promise.all([this.reloadProjects(), this.reloadTargets()]);
		void this.discoverLocations();
		this.discoveryTimer ??= setInterval(
			() => void this.discoverLocations(),
			DISCOVERY_INTERVAL_MS
		);
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
		this.projectIds = null;
		this.syncedProjectIds = [];
		this.signedOutProjectIds = [];
		this.movedProjectIds = [];
		this.deletedProjectIds = [];
		this.projectResults = {};
		if (this.discoveryTimer) clearInterval(this.discoveryTimer);
		this.discoveryTimer = null;
		this.cancelScheduledUpload();
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

	projectStatus(projectId: string, online: boolean): SyncStatus {
		const result = this.projectResults[projectId];
		return syncStatusFor({
			hasLocation: this.syncedProjectIds.includes(projectId),
			signedOut: this.signedOutProjectIds.includes(projectId),
			moved: this.movedProjectIds.includes(projectId),
			deleted: this.deletedProjectIds.includes(projectId),
			online,
			uiState: result?.uiState,
			providerError: result?.providerError,
			hasConflictCopies: result?.hasConflictCopies,
		});
	}

	overallStatus(online: boolean): SyncStatus {
		const offline: SyncStatus[] = online
			? []
			: [{ state: 'saved-on-device', reason: 'offline' }];
		if (!this.projectIds)
			return worstSyncStatus([...offline, { state: 'saved-on-device', reason: 'uploading' }]);
		return worstSyncStatus([
			...offline,
			...this.projectIds.map(projectId => this.projectStatus(projectId, online)),
		]);
	}

	async moveProject(projectId: string, locationId: string): Promise<void> {
		this.movingProjectIds.add(projectId);
		this.pollers.get(projectId)?.poller.stop();
		this.pollers.delete(projectId);
		try {
			await this.runningSyncs.get(projectId);
			await moveProject(projectId, locationId);
		} finally {
			this.movingProjectIds.delete(projectId);
			await this.reloadTargets();
		}
	}

	async deleteProject(projectId: string): Promise<void> {
		this.movingProjectIds.add(projectId);
		this.pollers.get(projectId)?.poller.stop();
		this.pollers.delete(projectId);
		try {
			await this.runningSyncs.get(projectId);
			await deleteProject(projectId);
		} finally {
			this.movingProjectIds.delete(projectId);
			await this.reloadTargets();
		}
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
		const refresh = () => {
			void this.syncAllNow();
			void this.discoverLocations();
		};
		window.addEventListener('focus', refresh);
		window.addEventListener('online', refresh);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') refresh();
			else if (this.uploadTimer) {
				this.cancelScheduledUpload();
				void this.syncAllNow();
			}
		});
		this.eventsAttached = true;
	}

	private attachInvalidations(): void {
		if (this.unsubscribeInvalidations) return;
		this.unsubscribeInvalidations = subscribeLocalDbInvalidations(event => {
			if (event.domain === 'sync-targets' || event.domain === 'all') {
				if (event.domain === 'all') void this.reloadProjects();
				void this.reloadTargets();
				return;
			}
			if (
				event.domain === 'projects' ||
				event.domain === 'transcriptions' ||
				event.domain === 'collations'
			) {
				if (event.domain === 'projects') void this.reloadProjects();
				this.scheduleUpload();
			}
		});
	}

	private async reloadProjects(): Promise<void> {
		if (!this.ready || !browser) return;
		this.projectIds = (await listProjects()).map(project => project.id);
	}

	private async reloadTargets(): Promise<void> {
		if (!this.ready || !browser) return;
		const [placements, signedOutLocationIds] = await Promise.all([
			listProjectPlacements(),
			listSignedOutLocationIds(),
		]);
		this.movedProjectIds = placements
			.filter(placement => placement.moved)
			.map(placement => placement.projectId);
		this.deletedProjectIds = placements
			.filter(placement => placement.deleted)
			.map(placement => placement.projectId);
		const placed = placements.filter(isPlacedProject);
		const targets = placed.filter(
			target =>
				!signedOutLocationIds.has(target.locationId) &&
				!this.movingProjectIds.has(target.projectId)
		);
		this.signedOutProjectIds = placed
			.filter(target => signedOutLocationIds.has(target.locationId))
			.map(target => target.projectId);
		const activeIds = new Set(targets.map(target => target.projectId));
		for (const [projectId, entry] of this.pollers) {
			if (!activeIds.has(projectId)) {
				entry.poller.stop();
				this.pollers.delete(projectId);
			}
		}

		this.syncedProjectIds = targets.map(target => target.projectId);
		this.projectResults = Object.fromEntries(
			Object.entries(this.projectResults).filter(([projectId]) =>
				this.syncedProjectIds.includes(projectId)
			)
		);
		for (const target of targets) this.ensurePoller(target);
		this.connected = this.pollers.size > 0;
		this.syncStatus = this.connected ? 'active' : 'paused';
	}

	private discoverLocations(): Promise<void> {
		this.runningDiscovery ??= this.performDiscovery().finally(() => {
			this.runningDiscovery = null;
		});
		return this.runningDiscovery;
	}

	private async performDiscovery(): Promise<void> {
		if (!this.ready || !browser) return;
		const signedOut = await listSignedOutLocationIds();
		for (const location of await listProjectLocations()) {
			if (signedOut.has(location.id)) continue;
			try {
				await placeDiscoveredProjects(location.id);
			} catch (error) {
				console.warn('[sync] location discovery failed', error);
			}
		}
		await this.reloadTargets();
	}

	private ensurePoller(target: PlacedProject): void {
		const key = targetKey(target);
		const existing = this.pollers.get(target.projectId);
		if (existing?.key === key) {
			existing.target = target;
			existing.poller.resumeAfterReconnect();
			return;
		}

		existing?.poller.stop();
		const poller = new OpenObjectSyncPoller({
			poll: () => this.runTargetSync(target),
		});
		this.pollers.set(target.projectId, { target, poller, key });
		poller.start();
	}

	private scheduleUpload(): void {
		this.cancelScheduledUpload();
		this.uploadTimer = setTimeout(() => {
			this.uploadTimer = null;
			void this.syncAllNow();
		}, UPLOAD_IDLE_MS);
	}

	private cancelScheduledUpload(): void {
		if (this.uploadTimer) clearTimeout(this.uploadTimer);
		this.uploadTimer = null;
	}

	private async syncAllNow(): Promise<void> {
		if (!this.ready || !browser) return;
		if (this.pollers.size === 0) await this.reloadTargets();
		await Promise.all([...this.pollers.values()].map(entry => entry.poller.pollNow()));
	}

	private runTargetSync(target: PlacedProject): Promise<ProjectBackupResult> {
		const existing = this.runningSyncs.get(target.projectId);
		if (existing) return existing;
		const run = this.performTargetSync(target).finally(() => {
			this.runningSyncs.delete(target.projectId);
		});
		this.runningSyncs.set(target.projectId, run);
		return run;
	}

	private async performTargetSync(target: PlacedProject): Promise<ProjectBackupResult> {
		try {
			const result = await backupProject(placementSyncContext(target));
			this.applyResult(result, target);
			if (result.uiState === 'synced') {
				const syncedAt = new Date().toISOString();
				this.projectSyncedAt = { ...this.projectSyncedAt, [target.projectId]: syncedAt };
				this.lastSyncTime = syncedAt;
			}
			return result;
		} catch (error) {
			const result = failureResult(target, error);
			this.applyResult(result, target);
			return result;
		}
	}

	private applyResult(result: ProjectBackupResult, target: PlacedProject): void {
		this.uiState = result.uiState;
		this.projectResults = { ...this.projectResults, [target.projectId]: result };
		const reconnect =
			result.providerError === 'reauthorization-required' ||
			result.providerError === 'permission-denied';
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

const DISCOVERY_INTERVAL_MS = 30_000;
const UPLOAD_IDLE_MS = 5_000;

async function listSignedOutLocationIds(): Promise<Set<string>> {
	const [locations, accounts] = await Promise.all([
		listProjectLocations(),
		listStorageAccounts(),
	]);
	const signedIn = new Set(
		accounts.filter(account => account.signedIn).map(account => account.id)
	);
	return new Set(
		locations
			.filter(location => location.accountId !== null && !signedIn.has(location.accountId))
			.map(location => location.id)
	);
}

function targetKey(target: PlacedProject): string {
	return [target.projectId, target.locationId, target.folderName].join(':');
}

function failureResult(target: PlacedProject, error: unknown): ProjectBackupResult {
	const message = error instanceof Error ? error.message : String(error);
	return {
		uiState: 'sync pending',
		projectId: target.projectId,
		manifestUploaded: false,
		entityResults: [],
		providerError: isReconnectError(message)
			? 'reauthorization-required'
			: 'provider-unavailable',
		providerMessage: message,
		uploadedPaths: [],
		downloadedPaths: [],
		deletedPaths: [],
		quarantines: [],
	};
}

function isReconnectError(message: string): boolean {
	return /permission|reconnect|directory picker|location was not found/i.test(message);
}
