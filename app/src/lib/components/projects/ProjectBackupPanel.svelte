<script lang="ts">
	import { onMount } from 'svelte';
	import FolderOpen from 'phosphor-svelte/lib/FolderOpen';
	import WarningCircle from 'phosphor-svelte/lib/WarningCircle';
	import {
		backupProject,
		deriveProjectBackupSummary,
		exportProjectZip,
		forkProject,
		getLatestProjectCommitTimestamp,
		subscribeLocalDbInvalidations,
	} from '$lib/client/db/client';
	import {
		getInstallCapabilityReport,
		initializeInstallPromptTracking,
		promptForPwaInstall,
		type InstallCapabilityReport,
	} from '$lib/client/capabilities';
	import {
		connectProjectSyncFolder,
		disconnectProjectSyncFolder,
		isLocalFolderProviderSupported,
		listProjectSyncTargets,
		reconnectProjectSyncFolder,
	} from '$lib/client/sync/local-folder-connections';
	import { LOCAL_FOLDER_ROOT_FOLDER_ID } from '$lib/client/sync/providers/local-folder-provider';
	import { downloadZipArchive } from '$lib/client/download-blob';
	import {
		getProjectBackupMetadata,
		recordProjectZipExport,
		updateSyncTargetLastSyncedAt,
		type SyncTargetRecord,
	} from '$lib/client/store';
	import {
		deriveProjectBackupHealthState,
		shouldShowInstallNudge,
	} from '$lib/client/sync/project-backup-health-state';
	import { projectBackupCapabilityMessage } from '$lib/client/sync/project-zip-export';
	import { syncService } from '$lib/client/sync/sync-service.svelte';
	import type {
		BackupItemState,
		ProjectBackupResult,
		ProjectBackupSummary,
		SyncProjectContext,
	} from '$lib/client/sync/sync-manager';

	interface Props {
		projectId: string;
		onForked?: (projectId: string) => void | Promise<void>;
		onRemoved?: () => void | Promise<void>;
	}

	let { projectId, onForked }: Props = $props();

	let targets = $state.raw<SyncTargetRecord[]>([]);
	let summary = $state<ProjectBackupSummary | null>(null);
	let lastResult = $state<ProjectBackupResult | null>(null);
	let isLoading = $state(false);
	let isConnecting = $state(false);
	let isDisconnecting = $state(false);
	let isSyncing = $state(false);
	let isExporting = $state(false);
	let isForking = $state(false);
	let includeDraftsInExport = $state(false);
	let lastExportedAt = $state<string | null>(null);
	let lastCommittedAt = $state<string | null>(null);
	let installReport = $state<InstallCapabilityReport>({
		isInstalled: false,
		installSupported: false,
	});
	let dismissedInstallMilestone = $state<string | null>(readDismissedInstallMilestone());
	let error = $state<string | null>(null);
	let loadRunId = 0;

	let selectedTarget = $derived(targets.find(target => target.enabled) ?? targets[0] ?? null);
	let folderSupported = $derived(isLocalFolderProviderSupported());
	let backupCapability = $derived(projectBackupCapabilityMessage(folderSupported));
	let backupHealth = $derived(
		deriveProjectBackupHealthState({
			lastCommittedAt,
			lastSyncedAt: selectedTarget?.lastSyncedAt ?? summary?.lastFullySyncedAt ?? null,
			lastExportedAt,
			hasEnabledSyncTarget: Boolean(selectedTarget?.enabled),
			localFolderSupported: folderSupported,
		})
	);
	let installMilestone = $derived(`${projectId}:${lastCommittedAt ?? 'no-commits'}`);
	let showInstallNudge = $derived(
		shouldShowInstallNudge({
			hasData: Boolean(lastCommittedAt),
			installSupported: installReport.installSupported,
			isInstalled: installReport.isInstalled,
			currentMilestone: installMilestone,
			dismissedMilestone: dismissedInstallMilestone,
		})
	);
	let statusLabel = $derived.by(() => {
		if (!selectedTarget) return 'No sync folder connected';
		if (syncService.reconnectProjectIds.includes(projectId)) return 'Reconnect folder';
		if (lastResult?.uiState === 'conflict requires resolution') return 'Conflict requires resolution';
		if (lastResult?.providerError === 'reauthorization-required') return 'Reconnect folder';
		if (!summary) return 'Sync status unknown';
		if (summary.blockingItems.length > 0) return 'Commit local changes before sync';
		if (summary.pendingItems.length > 0 || summary.tombstones.length > 0) return 'Sync pending';
		return 'Synced';
	});
	let allItems = $derived.by(() =>
		summary ? [...summary.transcriptions, ...summary.collations] : []
	);
	let conflictItems = $derived.by(() =>
		lastResult?.conflictCopyId
			? [`Conflict copy created: ${lastResult.conflictCopyId}`]
			: []
	);

	onMount(() => {
		installReport = getInstallCapabilityReport();
		const stopInstallTracking = initializeInstallPromptTracking(() => {
			installReport = getInstallCapabilityReport();
		});
		const unsubscribe = subscribeLocalDbInvalidations(event => {
			if (
				event.domain === 'projects' ||
				event.domain === 'transcriptions' ||
				event.domain === 'collations' ||
				event.domain === 'sync-targets' ||
				event.domain === 'all'
			) {
				void loadSyncState(projectId);
			}
		});
		return () => {
			unsubscribe();
			stopInstallTracking();
		};
	});

	$effect(() => {
		if (projectId) void loadSyncState(projectId);
	});

	async function loadSyncState(nextProjectId: string) {
		if (!nextProjectId) return;
		const runId = ++loadRunId;
		isLoading = true;
		error = null;
		try {
			const [nextTargets, metadata, latestCommit] = await Promise.all([
				listProjectSyncTargets(nextProjectId),
				getProjectBackupMetadata(nextProjectId),
				getLatestProjectCommitTimestamp(nextProjectId),
			]);
			if (runId !== loadRunId) return;
			targets = nextTargets;
			lastExportedAt = metadata.lastExportedAt;
			lastCommittedAt = latestCommit;
			const target = nextTargets.find(candidate => candidate.enabled) ?? nextTargets[0] ?? null;
			summary = target ? await deriveProjectBackupSummary(syncContext(target)) : null;
		} catch (err) {
			if (runId !== loadRunId) return;
			error = err instanceof Error ? err.message : 'Failed to load folder sync status.';
			summary = null;
		} finally {
			if (runId === loadRunId) isLoading = false;
		}
	}

	async function connectFolder() {
		if (!projectId || isConnecting) return;
		isConnecting = true;
		error = null;
		try {
			await connectProjectSyncFolder(projectId);
			await loadSyncState(projectId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to connect sync folder.';
		} finally {
			isConnecting = false;
		}
	}

	async function reconnectFolder() {
		const target = selectedTarget;
		if (!target || isConnecting) return;
		isConnecting = true;
		error = null;
		try {
			await reconnectProjectSyncFolder(target.targetId);
			await loadSyncState(projectId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to reconnect sync folder.';
		} finally {
			isConnecting = false;
		}
	}

	async function disconnectFolder() {
		const target = selectedTarget;
		if (!target || isDisconnecting) return;
		if (!window.confirm(`Disconnect sync folder ${target.folderDisplayPath}?`)) return;
		isDisconnecting = true;
		error = null;
		try {
			await disconnectProjectSyncFolder(target.targetId);
			lastResult = null;
			await loadSyncState(projectId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to disconnect sync folder.';
		} finally {
			isDisconnecting = false;
		}
	}

	async function runSync() {
		const target = selectedTarget;
		if (!target || isSyncing) return;
		isSyncing = true;
		error = null;
		try {
			lastResult = await backupProject(syncContext(target));
			if (lastResult.uiState === 'synced') {
				await updateSyncTargetLastSyncedAt(target.targetId, new Date().toISOString());
			}
			await loadSyncState(projectId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to sync project folder.';
		} finally {
			isSyncing = false;
		}
	}

	async function runForkProject() {
		if (!projectId || isForking) return;
		isForking = true;
		error = null;
		try {
			const result = await forkProject({ sourceProjectId: projectId });
			await onForked?.(result.projectId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fork project.';
		} finally {
			isForking = false;
		}
	}

	async function runZipExport() {
		if (!projectId || isExporting) return;
		isExporting = true;
		error = null;
		try {
			const result = await exportProjectZip(projectId, includeDraftsInExport);
			downloadZipArchive(result.fileName, result.bytes);
			await recordProjectZipExport(projectId, result.exportedAt);
			lastExportedAt = result.exportedAt;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to export project zip.';
		} finally {
			isExporting = false;
		}
	}

	async function installApp() {
		await promptForPwaInstall();
		installReport = getInstallCapabilityReport();
	}

	function dismissInstallNudge() {
		dismissedInstallMilestone = installMilestone;
		try {
			globalThis.localStorage?.setItem(
				'apatosaurus:install-nudge-dismissed-milestone',
				installMilestone
			);
		} catch {
			// If localStorage is unavailable, the nudge can return next load.
		}
	}

	function readDismissedInstallMilestone(): string | null {
		try {
			return globalThis.localStorage?.getItem('apatosaurus:install-nudge-dismissed-milestone') ?? null;
		} catch {
			return null;
		}
	}

	function syncContext(target: SyncTargetRecord): SyncProjectContext {
		return {
			projectId,
			connectionId: target.targetId,
			cloudFolderId: LOCAL_FOLDER_ROOT_FOLDER_ID,
			cloudFolderPath: '',
		};
	}

	function formatDate(value: string | null | undefined): string {
		if (!value) return 'Never';
		return new Date(value).toLocaleString();
	}

	function itemKey(item: BackupItemState): string {
		return `${item.itemType}:${item.itemId}`;
	}

	function itemLabel(item: BackupItemState): string {
		if (item.itemType === 'project-transcription') return 'Transcription';
		if (item.itemType === 'collation') return 'Collation';
		return item.itemType;
	}

	function statusLabelForItem(item: BackupItemState): string {
		if (item.status === 'backed-up') return 'Synced';
		if (item.status === 'committed-pending-backup') return 'Pending sync';
		if (item.status === 'uncommitted-local-changes') return 'Commit before sync';
		if (item.status === 'never-committed') return 'Commit before sync';
		if (item.status === 'remote-update-available') return 'Remote update available';
		if (item.status === 'diverged') return 'Conflict';
		return 'Unknown';
	}

	function itemBadgeClass(item: BackupItemState): string {
		if (item.status === 'backed-up') return 'badge-success';
		if (item.status === 'committed-pending-backup') return 'badge-info';
		if (item.status === 'diverged') return 'badge-error';
		if (item.status === 'uncommitted-local-changes' || item.status === 'never-committed') {
			return 'badge-warning';
		}
		return 'badge-ghost';
	}
</script>

<section class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<div class="mb-3 flex items-center justify-between gap-3">
		<div>
			<h2 class="font-serif text-lg font-semibold">Folder Sync</h2>
			<p class="text-sm text-base-content/50">Mirrors committed project files to a folder you choose.</p>
		</div>
		{#if isLoading}
			<span class="loading loading-spinner loading-sm text-base-content/40"></span>
		{:else}
			<FolderOpen size={22} class="text-base-content/40" />
		{/if}
	</div>

	{#if error}
		<div class="alert alert-error mb-3 text-sm">{error}</div>
	{/if}

	{#if !folderSupported}
		<div class="alert alert-warning mb-3 text-sm">
			<WarningCircle size={18} />
			<span>{backupCapability.message}</span>
		</div>
	{/if}

	<div class="grid gap-3 md:grid-cols-3">
		<div class="rounded-box bg-base-200/60 p-3">
			<div class="text-xs uppercase tracking-wide text-base-content/40">Last committed</div>
			<div class="mt-1 text-sm font-medium">{formatDate(backupHealth.lastCommittedAt)}</div>
		</div>
		<div class="rounded-box bg-base-200/60 p-3">
			<div class="text-xs uppercase tracking-wide text-base-content/40">Sync folder</div>
			<div class="mt-1 text-sm font-medium">{selectedTarget?.folderDisplayPath ?? 'Not connected'}</div>
		</div>
		<div class="rounded-box bg-base-200/60 p-3">
			<div class="text-xs uppercase tracking-wide text-base-content/40">Status</div>
			<div class="mt-1 text-sm font-medium">{statusLabel}</div>
		</div>
		<div class="rounded-box bg-base-200/60 p-3">
			<div class="text-xs uppercase tracking-wide text-base-content/40">Last synced</div>
			<div class="mt-1 text-sm font-medium">{formatDate(backupHealth.lastSyncedAt)}</div>
		</div>
		<div class="rounded-box bg-base-200/60 p-3">
			<div class="text-xs uppercase tracking-wide text-base-content/40">Last exported</div>
			<div class="mt-1 text-sm font-medium">{formatDate(backupHealth.lastExportedAt)}</div>
		</div>
	</div>

	{#if backupHealth.showBrowserOnlyPrompt}
		<div class="alert alert-warning mt-3 text-sm">
			<WarningCircle size={18} />
			<div>
				<div class="font-medium">Your committed data exists only in this browser.</div>
				<div class="text-xs opacity-80">
					{backupHealth.primaryAction === 'connect-folder'
						? 'Connect a sync folder for continuous backup, or export a zip now.'
						: 'Folder sync is unavailable here. Export a project zip for backup.'}
				</div>
			</div>
			{#if backupHealth.primaryAction === 'connect-folder'}
				<button type="button" class="btn btn-warning btn-sm" disabled={isConnecting} onclick={connectFolder}>
					Connect folder
				</button>
			{:else}
				<button type="button" class="btn btn-warning btn-sm" disabled={isExporting} onclick={runZipExport}>
					Export zip
				</button>
			{/if}
		</div>
	{/if}

	{#if showInstallNudge}
		<div class="alert alert-info mt-3 text-sm">
			<div>
				<div class="font-medium">Install Apatosaurus for safer local work.</div>
				<div class="text-xs opacity-80">
					Installed apps retain storage and folder permissions more reliably in Chromium.
				</div>
			</div>
			<button type="button" class="btn btn-info btn-sm" onclick={installApp}>Install app</button>
			<button type="button" class="btn btn-ghost btn-sm" onclick={dismissInstallNudge}>Dismiss</button>
		</div>
	{/if}

	<div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
		{#if selectedTarget}
			<button type="button" class="btn btn-primary btn-sm" disabled={isSyncing} onclick={runSync}>
				{#if isSyncing}<span class="loading loading-spinner loading-xs"></span>{/if}
				Sync now
			</button>
			<button type="button" class="btn btn-outline btn-sm" disabled={isConnecting} onclick={reconnectFolder}>
				{#if isConnecting}<span class="loading loading-spinner loading-xs"></span>{/if}
				Reconnect folder
			</button>
			<button type="button" class="btn btn-outline btn-sm" disabled={isDisconnecting} onclick={disconnectFolder}>
				{#if isDisconnecting}<span class="loading loading-spinner loading-xs"></span>{/if}
				Disconnect
			</button>
		{:else}
			<button
				type="button"
				class="btn btn-primary btn-sm"
				disabled={!folderSupported || isConnecting}
				onclick={connectFolder}
			>
				{#if isConnecting}<span class="loading loading-spinner loading-xs"></span>{/if}
				Connect sync folder
			</button>
		{/if}
		<button type="button" class="btn btn-outline btn-sm" disabled={isForking || isSyncing} onclick={runForkProject}>
			{#if isForking}<span class="loading loading-spinner loading-xs"></span>{/if}
			Fork project
		</button>
	</div>

	<div class="mt-4 rounded-box border border-base-300/60 bg-base-200/40 p-3">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<div class="text-sm font-medium">Zip export</div>
				<div class="text-xs text-base-content/60">
					Downloads committed project files for backup in any browser.
				</div>
			</div>
			<div class="flex flex-col gap-2 sm:items-end">
				<label class="label cursor-pointer justify-start gap-2 py-0 text-xs">
					<input type="checkbox" class="checkbox checkbox-xs" bind:checked={includeDraftsInExport} />
					<span>Include local drafts</span>
				</label>
				<button type="button" class="btn btn-outline btn-sm" disabled={isExporting} onclick={runZipExport}>
					{#if isExporting}<span class="loading loading-spinner loading-xs"></span>{/if}
					Export project zip
				</button>
			</div>
		</div>
	</div>

	{#if lastResult}
		<div class="mt-3 rounded-box border border-base-300/60 bg-base-200/40 p-3 text-sm">
			<div class="font-medium">Last sync result: {lastResult.uiState}</div>
			<div class="mt-1 text-xs text-base-content/60">
				Uploaded {lastResult.uploadedPaths.length}, downloaded {lastResult.downloadedPaths.length}, deleted {lastResult.deletedPaths.length}.
			</div>
		</div>
	{/if}

	{#if conflictItems.length > 0}
		<div class="mt-3 rounded-box border border-error/30 bg-error/10 p-3 text-sm">
			<div class="font-medium text-error">Conflicts</div>
			<ul class="mt-2 space-y-1 text-xs">
				{#each conflictItems as conflict}
					<li>{conflict}</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if lastResult?.quarantines.length}
		<div class="mt-3 rounded-box border border-warning/30 bg-warning/10 p-3 text-sm">
			<div class="font-medium text-warning-content">Quarantined remote files</div>
			<ul class="mt-2 space-y-1 text-xs text-base-content/70">
				{#each lastResult.quarantines as quarantine (`${quarantine.path}:${quarantine.code}`)}
					<li>{quarantine.path}: {quarantine.message}</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if selectedTarget && summary && allItems.length > 0}
		<div class="mt-3 rounded-box border border-base-300/60 bg-base-100 p-3">
			<div class="mb-2 flex items-center justify-between gap-2">
				<div class="text-sm font-medium">Project files</div>
				<div class="text-xs text-base-content/50">Committed state only</div>
			</div>
			<ul class="divide-y divide-base-300/60">
				{#each allItems as item (itemKey(item))}
					<li class="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
						<div class="min-w-0">
							<div class="truncate text-sm font-medium">{itemLabel(item)} {item.itemId}</div>
							<div class="text-xs text-base-content/50">{item.path}</div>
						</div>
						<span class={`badge badge-outline ${itemBadgeClass(item)}`}>{statusLabelForItem(item)}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>
