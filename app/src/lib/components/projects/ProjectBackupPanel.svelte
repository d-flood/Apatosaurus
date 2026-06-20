<script lang="ts">
	import { onMount } from 'svelte';
	import CloudArrowUp from 'phosphor-svelte/lib/CloudArrowUp';
	import LinkSimple from 'phosphor-svelte/lib/LinkSimple';
	import WarningCircle from 'phosphor-svelte/lib/WarningCircle';
	import {
		backupProjectEntity,
		backupEligibleProjectEntities,
		backupProject,
		compareProjectBackupManifest,
		deriveProjectBackupSummary,
		forkProject,
		listCloudConnections,
		listCloudProjectFolders,
		removeLocalProject,
		upsertCloudProjectFolder,
		verifyProjectBackupHealth,
	} from '$lib/client/db/client';
	import { subscribeLocalDbInvalidations } from '$lib/client/db/client';
	import type {
		CloudConnectionRecord,
		CloudProjectFolderRecord,
	} from '$lib/client/db/repositories/cloud-connections';
	import type {
		BackupItemState,
		ProjectManifestComparison,
		ProjectBackupResult,
		ProjectBackupSummary,
	} from '$lib/client/sync/sync-manager';
	import type { BackupHealthCheck, ProjectBackupHealth } from '$lib/client/sync/backup-health';

	interface Props {
		projectId: string;
		onForked?: (projectId: string) => void | Promise<void>;
		onRemoved?: () => void | Promise<void>;
	}

	let { projectId, onForked, onRemoved }: Props = $props();

	let connections = $state.raw<CloudConnectionRecord[]>([]);
	let folders = $state.raw<CloudProjectFolderRecord[]>([]);
	let summary = $state<ProjectBackupSummary | null>(null);
	let remoteComparison = $state<ProjectManifestComparison | null>(null);
	let backupHealth = $state<ProjectBackupHealth | null>(null);
	let selectedConnectionId = $state('');
	let isLoading = $state(false);
	let isCheckingRemote = $state(false);
	let isVerifyingHealth = $state(false);
	let isBinding = $state(false);
	let isBackingUp = $state(false);
	let isForking = $state(false);
	let isRemovingLocalCopy = $state(false);
	let backupMode = $state<'strict' | 'eligible' | null>(null);
	let backingUpItemKey = $state<string | null>(null);
	let error = $state<string | null>(null);
	let remoteCheckError = $state<string | null>(null);
	let lastRemoteCheckedAt = $state<string | null>(null);
	let lastHealthVerifiedAt = $state<string | null>(null);
	let lastResult = $state<ProjectBackupResult | null>(null);
	let loadRunId = 0;

	let selectedFolder = $derived(folders[0] ?? null);
	let selectedConnection = $derived(
		connections.find(connection => connection.id === selectedConnectionId) ?? connections[0] ?? null
	);
	let backupTargetLabel = $derived.by(() => {
		if (!selectedFolder) return 'Local only';
		const connection = connections.find(candidate => candidate.id === selectedFolder.connectionId);
		const provider = providerLabel(connection?.providerId ?? 'Cloud');
		return `${provider}: ${selectedFolder.cloudFolderPath}`;
	});
	let statusLabel = $derived.by(() => {
		if (!selectedFolder) return 'No backup target selected';
		if (remoteComparison?.state === 'remote-update-available') return 'Remote update available';
		if (remoteComparison?.state === 'diverged') return 'Conflict requires resolution';
		if (remoteComparison?.state === 'unavailable') return 'Provider unavailable';
		if (!summary) return 'Backup status unknown';
		if (summary.blockingItems.length > 0) return 'Commit changes before backup';
		if (summary.pendingItems.length > 0 || summary.tombstones.length > 0) return 'Backup pending';
		if (remoteComparison?.state === 'up-to-date') return 'Backed up';
		return 'Ready to back up';
	});
	let backedUpCount = $derived.by(() => {
		if (!summary) return 0;
		return [...summary.transcriptions, ...summary.collations].filter(
			item => item.status === 'backed-up'
		).length;
	});
	let entityCount = $derived.by(() => {
		if (!summary) return 0;
		return summary.transcriptions.length + summary.collations.length;
	});
	let canBackUpEverythingFirst = $derived.by(() => {
		if (!selectedFolder || !summary) return false;
		return (
			summary.blockingItems.length === 0 &&
			(summary.pendingItems.length > 0 || summary.tombstones.length > 0)
		);
	});

	onMount(() => {
		void loadBackupState(projectId);
		const unsubscribe = subscribeLocalDbInvalidations(event => {
			if (
				event.domain === 'cloud-connections' ||
				event.domain === 'cloud-project-folders' ||
				event.domain === 'projects' ||
				event.domain === 'transcriptions' ||
				event.domain === 'collations' ||
				event.domain === 'all'
			) {
				void loadBackupState(projectId);
			}
		});
		return unsubscribe;
	});

	$effect(() => {
		if (projectId) void loadBackupState(projectId);
	});

	async function loadBackupState(nextProjectId: string) {
		if (!nextProjectId) return;
		const runId = ++loadRunId;
		isLoading = true;
		error = null;
		try {
			const [nextConnections, nextFolders] = await Promise.all([
				listCloudConnections(),
				listCloudProjectFolders(nextProjectId),
			]);
			if (runId !== loadRunId) return;
			connections = nextConnections;
			folders = nextFolders;
			selectedConnectionId = nextFolders[0]?.connectionId ?? nextConnections[0]?.id ?? '';
			const folder = nextFolders[0] ?? null;
			if (folder) {
				backupHealth = null;
				lastHealthVerifiedAt = null;
				summary = await deriveProjectBackupSummary(
					{
						projectId: nextProjectId,
						connectionId: folder.connectionId,
						cloudFolderId: folder.cloudFolderId,
						cloudFolderPath: folder.cloudFolderPath,
					},
					folder
				);
				void checkRemoteManifest(nextProjectId, folder);
			} else {
				summary = null;
				remoteComparison = null;
				backupHealth = null;
				remoteCheckError = null;
				lastRemoteCheckedAt = null;
				lastHealthVerifiedAt = null;
			}
		} catch (err) {
			if (runId !== loadRunId) return;
			error = err instanceof Error ? err.message : 'Failed to load backup status.';
			summary = null;
			backupHealth = null;
		} finally {
			if (runId === loadRunId) isLoading = false;
		}
	}

	function syncContext(folder: CloudProjectFolderRecord) {
		return {
			projectId,
			connectionId: folder.connectionId,
			cloudFolderId: folder.cloudFolderId,
			cloudFolderPath: folder.cloudFolderPath,
		};
	}

	async function checkRemoteManifest(
		nextProjectId = projectId,
		folder: CloudProjectFolderRecord | null = selectedFolder
	) {
		if (!nextProjectId || !folder) return;
		isCheckingRemote = true;
		remoteCheckError = null;
		try {
			remoteComparison = await compareProjectBackupManifest({
				projectId: nextProjectId,
				connectionId: folder.connectionId,
				cloudFolderId: folder.cloudFolderId,
				cloudFolderPath: folder.cloudFolderPath,
			});
			lastRemoteCheckedAt = new Date().toISOString();
		} catch (err) {
			remoteComparison = null;
			remoteCheckError = err instanceof Error ? err.message : 'Failed to check remote backup.';
			lastRemoteCheckedAt = new Date().toISOString();
		} finally {
			isCheckingRemote = false;
		}
	}

	async function verifyBackupHealth() {
		const folder = selectedFolder;
		if (!projectId || !folder || isVerifyingHealth) return;
		isVerifyingHealth = true;
		error = null;
		try {
			backupHealth = await verifyProjectBackupHealth(syncContext(folder));
			lastHealthVerifiedAt = new Date().toISOString();
		} catch (err) {
			backupHealth = null;
			error = err instanceof Error ? err.message : 'Failed to verify backup health.';
			lastHealthVerifiedAt = new Date().toISOString();
		} finally {
			isVerifyingHealth = false;
		}
	}

	async function bindDefaultFolder() {
		if (!projectId || !selectedConnection) return;
		isBinding = true;
		error = null;
		try {
			const cloudFolderPath = defaultProjectFolderPath(projectId);
			await upsertCloudProjectFolder({
				projectId,
				connectionId: selectedConnection.id,
				cloudFolderId: cloudFolderPath,
				cloudFolderPath,
			});
			await loadBackupState(projectId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to select backup target.';
		} finally {
			isBinding = false;
		}
	}

	async function runBackup(strict: boolean, verifyAfter = false) {
		const folder = selectedFolder;
		if (!projectId || !folder || isBackingUp) return;
		isBackingUp = true;
		backupMode = strict ? 'strict' : 'eligible';
		error = null;
		lastResult = null;
		try {
			const context = syncContext(folder);
			lastResult = strict
				? await backupProject(context, folder)
				: await backupEligibleProjectEntities(context, folder);
			await loadBackupState(projectId);
			if (verifyAfter) await verifyBackupHealth();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to back up project.';
		} finally {
			isBackingUp = false;
			backupMode = null;
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

	async function runRemoveLocalCopy() {
		const folder = selectedFolder;
		if (!projectId || !folder || !backupHealth?.safeToRemove || isRemovingLocalCopy) return;
		const confirmed = window.confirm(
			`Remove the local copy of this project? The remote backup at ${backupTargetLabel} will not be deleted.`
		);
		if (!confirmed) return;
		isRemovingLocalCopy = true;
		error = null;
		try {
			await removeLocalProject({ projectId, connectionId: folder.connectionId });
			await onRemoved?.();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to remove local project copy.';
		} finally {
			isRemovingLocalCopy = false;
		}
	}

	async function runEntityBackup(item: BackupItemState) {
		const folder = selectedFolder;
		if (
			!projectId ||
			!folder ||
			isBackingUp ||
			isForking ||
			(item.itemType !== 'project-transcription' && item.itemType !== 'collation')
		) {
			return;
		}
		isBackingUp = true;
		backupMode = null;
		backingUpItemKey = itemKey(item);
		error = null;
		lastResult = null;
		try {
			const context = {
				projectId,
				connectionId: folder.connectionId,
				cloudFolderId: folder.cloudFolderId,
				cloudFolderPath: folder.cloudFolderPath,
			};
			lastResult = await backupProjectEntity(
				context,
				{ entityType: item.itemType, entityId: item.itemId },
				folder
			);
			await loadBackupState(projectId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to back up committed version.';
		} finally {
			isBackingUp = false;
			backingUpItemKey = null;
		}
	}

	function resultSummary(result: ProjectBackupResult): string {
		const uploadedCount = result.uploadedPaths.length;
		const skippedCount = result.skippedItems.length;
		if (result.manifestUploaded && skippedCount === 0 && result.quarantines.length === 0) {
			return `Project backup complete. Uploaded ${uploadedCount} file${uploadedCount === 1 ? '' : 's'}.`;
		}
		if (skippedCount > 0) {
			return `Backup incomplete. Uploaded ${uploadedCount} file${uploadedCount === 1 ? '' : 's'} and skipped ${skippedCount} item${skippedCount === 1 ? '' : 's'}.`;
		}
		if (result.providerMessage) return result.providerMessage;
		return `Backup status: ${result.uiState}.`;
	}

	function providerLabel(providerId: string): string {
		if (providerId === 'dropbox') return 'Dropbox';
		if (providerId === 'google-drive') return 'Google Drive';
		if (providerId === 'local-folder') return 'Local folder';
		if (providerId === 'mock') return 'Mock cloud';
		return providerId;
	}

	function defaultProjectFolderPath(id: string): string {
		return `Apatosaurus/Projects/${id}`;
	}

	function formatDate(value: string | null | undefined): string {
		if (!value) return 'Never';
		return new Date(value).toLocaleString();
	}

	function remoteStatusLabel(comparison: ProjectManifestComparison | null): string {
		if (!comparison) return 'Not checked';
		if (comparison.state === 'up-to-date') return 'Remote manifest is up to date';
		if (comparison.state === 'remote-update-available') return 'Remote update available';
		if (comparison.state === 'diverged') return 'Local and remote committed versions diverged';
		if (comparison.state === 'unavailable') return 'Remote manifest unavailable';
		return 'No remote manifest found';
	}

	function healthStatusLabel(health: ProjectBackupHealth | null): string {
		if (!health) return 'Not verified';
		if (health.status === 'local-only') return 'Local only';
		if (health.status === 'uncommitted-changes') return 'Uncommitted changes';
		if (health.status === 'committed-pending-backup') return 'Committed backup pending';
		if (health.status === 'backed-up-local-metadata') return 'Backed up in local metadata';
		if (health.status === 'restorable-now') return 'Restorable now';
		if (health.status === 'conflict') return 'Conflict';
		if (health.status === 'unknown-provider-state') return 'Unknown provider state';
		return 'Incomplete backup';
	}

	function checkBadgeClass(check: BackupHealthCheck): string {
		if (check.status === 'pass') return 'badge-success';
		if (check.status === 'warning') return 'badge-warning';
		if (check.status === 'fail') return 'badge-error';
		return 'badge-ghost';
	}

	function itemKey(item: BackupItemState): string {
		return `${item.itemType}:${item.itemId}`;
	}

	function itemLabel(item: BackupItemState): string {
		if (item.itemType === 'project-transcription') return 'Project transcription';
		if (item.itemType === 'collation') return 'Collation';
		if (item.itemType === 'project-manifest') return 'Project manifest';
		return 'Tombstone';
	}

	function statusLabelForItem(item: BackupItemState): string {
		if (item.status === 'committed-pending-backup') return 'Pending backup';
		if (item.status === 'uncommitted-local-changes') return 'Commit before backup';
		if (item.status === 'never-committed') return 'Commit before backup';
		if (item.status === 'remote-update-available') return 'Remote update available';
		if (item.status === 'diverged') return 'Resolve conflict';
		if (item.status === 'backed-up') return 'Backed up';
		return 'Unknown';
	}

	function canBackUpItem(item: BackupItemState): boolean {
		return (
			(item.itemType === 'project-transcription' || item.itemType === 'collation') &&
			item.status === 'committed-pending-backup'
		);
	}
</script>

<section class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<div class="mb-3 flex items-center justify-between gap-3">
		<div>
			<h2 class="font-serif text-lg font-semibold">Project Backup</h2>
			<p class="text-sm text-base-content/50">Backups publish committed project versions only.</p>
		</div>
		{#if isLoading}
			<span class="loading loading-spinner loading-sm text-base-content/40"></span>
		{:else}
			<CloudArrowUp size={22} class="text-base-content/40" />
		{/if}
	</div>

	{#if error}
		<div class="alert alert-error mb-3 text-sm">{error}</div>
	{/if}

	<div class="grid gap-3 md:grid-cols-3">
		<div class="rounded-box bg-base-200/60 p-3">
			<div class="text-xs uppercase tracking-wide text-base-content/40">Backup location</div>
			<div class="mt-1 text-sm font-medium">{backupTargetLabel}</div>
		</div>
		<div class="rounded-box bg-base-200/60 p-3">
			<div class="text-xs uppercase tracking-wide text-base-content/40">Status</div>
			<div class="mt-1 text-sm font-medium">{statusLabel}</div>
		</div>
		<div class="rounded-box bg-base-200/60 p-3">
			<div class="text-xs uppercase tracking-wide text-base-content/40">Last full backup</div>
			<div class="mt-1 text-sm font-medium">{formatDate(selectedFolder?.lastFullySyncedAt)}</div>
		</div>
	</div>

	{#if selectedFolder}
		<div class="mt-3 rounded-box border border-base-300/60 bg-base-200/40 p-3">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<div class="text-xs uppercase tracking-wide text-base-content/40">Remote backup</div>
					<div class="mt-1 text-sm font-medium">{remoteStatusLabel(remoteComparison)}</div>
					<div class="mt-0.5 text-xs text-base-content/50">
						Last checked: {formatDate(lastRemoteCheckedAt)}
					</div>
				</div>
				<div class="flex flex-wrap gap-2">
					<button
						type="button"
						class="btn btn-outline btn-xs"
						disabled={isCheckingRemote}
						onclick={() => checkRemoteManifest()}
					>
						{#if isCheckingRemote}
							<span class="loading loading-spinner loading-xs"></span>
						{/if}
						Check remote
					</button>
					<button
						type="button"
						class="btn btn-outline btn-xs"
						disabled={isVerifyingHealth}
						onclick={verifyBackupHealth}
					>
						{#if isVerifyingHealth}
							<span class="loading loading-spinner loading-xs"></span>
						{/if}
						Verify backup now
					</button>
					{#if remoteComparison?.state === 'remote-update-available'}
						<button type="button" class="btn btn-warning btn-xs" disabled>
							Pull remote updates
						</button>
					{/if}
				</div>
			</div>
			{#if remoteCheckError}
				<div class="mt-2 text-xs text-warning">{remoteCheckError}</div>
			{/if}
			{#if remoteComparison?.state === 'remote-update-available'}
				<div class="mt-2 text-xs text-warning-content">
					A newer committed version exists in the remote backup. Pull support is explicit and will not run automatically.
				</div>
			{:else if remoteComparison?.state === 'diverged'}
				<div class="mt-2 text-xs text-error">
					Local and remote committed versions both changed since the last backup. Do not back up until this is resolved.
				</div>
			{/if}
		</div>

		<div class="mt-3 rounded-box border border-base-300/60 bg-base-100 p-3">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<div class="text-xs uppercase tracking-wide text-base-content/40">Safe local removal</div>
					<div class="mt-1 flex flex-wrap items-center gap-2">
						<span
							class:badge-success={backupHealth?.safeToRemove}
							class:badge-warning={!backupHealth?.safeToRemove}
							class="badge badge-outline"
						>
							{healthStatusLabel(backupHealth)}
						</span>
						<span class="text-xs text-base-content/50">
							Last verified: {formatDate(lastHealthVerifiedAt)}
						</span>
					</div>
					<p class="mt-2 text-xs text-base-content/60">
						Local removal stays disabled until the selected backup is verified as restorable now.
					</p>
				</div>
				<div class="flex flex-wrap gap-2">
					{#if canBackUpEverythingFirst}
						<button
							type="button"
							class="btn btn-primary btn-xs"
							disabled={isBackingUp || isVerifyingHealth}
							onclick={() => runBackup(true, true)}
						>
							{#if isBackingUp && backupMode === 'strict'}
								<span class="loading loading-spinner loading-xs"></span>
							{/if}
							Back up everything first
						</button>
					{/if}
					<button
						type="button"
						class="btn btn-outline btn-xs"
						disabled={isVerifyingHealth}
						onclick={verifyBackupHealth}
					>
						{#if isVerifyingHealth}
							<span class="loading loading-spinner loading-xs"></span>
						{/if}
						Verify backup now
					</button>
					<button
						type="button"
						class="btn btn-error btn-outline btn-xs"
						disabled={!backupHealth?.safeToRemove || isRemovingLocalCopy}
						onclick={runRemoveLocalCopy}
					>
						{#if isRemovingLocalCopy}
							<span class="loading loading-spinner loading-xs"></span>
						{/if}
						Remove local copy
					</button>
				</div>
			</div>

			{#if backupHealth}
				<ul class="mt-3 space-y-2">
					{#each backupHealth.checks as check (check.id)}
						<li class="flex flex-col gap-1 rounded-box bg-base-200/50 p-2 sm:flex-row sm:items-start sm:justify-between">
							<div>
								<div class="text-sm font-medium">{check.label}</div>
								<div class="text-xs text-base-content/60">{check.message}</div>
							</div>
							<span class={`badge badge-outline ${checkBadgeClass(check)}`}>{check.status}</span>
						</li>
					{/each}
				</ul>
				{#if backupHealth.blockingChecks.length > 0}
					<div class="mt-3 rounded-box border border-warning/30 bg-warning/10 p-2 text-xs text-base-content/70">
						{backupHealth.blockingChecks.length} blocking safety check{backupHealth.blockingChecks.length === 1 ? '' : 's'} must pass before local removal.
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	{#if selectedFolder && summary}
		<div class="mt-4 grid gap-2 sm:grid-cols-4">
			<div class="stat rounded-box bg-base-200/50 p-3">
				<div class="stat-title text-xs">Blocked</div>
				<div class="stat-value text-lg">{summary.blockingItems.length}</div>
			</div>
			<div class="stat rounded-box bg-base-200/50 p-3">
				<div class="stat-title text-xs">Pending</div>
				<div class="stat-value text-lg">{summary.pendingItems.length}</div>
			</div>
			<div class="stat rounded-box bg-base-200/50 p-3">
				<div class="stat-title text-xs">Backed up</div>
				<div class="stat-value text-lg">{backedUpCount}/{entityCount}</div>
			</div>
			<div class="stat rounded-box bg-base-200/50 p-3">
				<div class="stat-title text-xs">Tombstones</div>
				<div class="stat-value text-lg">{summary.tombstones.length}</div>
			</div>
		</div>
	{/if}

	{#if !selectedFolder}
		<div class="mt-4 rounded-box border border-dashed border-base-300 p-3">
			{#if connections.length === 0}
				<div class="flex items-start gap-2 text-sm text-base-content/60">
					<WarningCircle size={18} class="mt-0.5 shrink-0" />
					<span>Connect backup storage from the navigation bar before choosing a backup target.</span>
				</div>
			{:else}
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<label class="form-control flex-1">
						<div class="label py-0 pb-1">
							<span class="label-text text-xs text-base-content/50">Provider</span>
						</div>
						<select class="select select-bordered select-sm" bind:value={selectedConnectionId}>
							{#each connections as connection (connection.id)}
								<option value={connection.id}>
									{providerLabel(connection.providerId)} - {connection.accountEmail}
								</option>
							{/each}
						</select>
					</label>
					<button
						type="button"
						class="btn btn-primary btn-sm gap-1"
						disabled={isBinding || !selectedConnection}
						onclick={bindDefaultFolder}
					>
						{#if isBinding}
							<span class="loading loading-spinner loading-xs"></span>
						{:else}
							<LinkSimple size={14} />
						{/if}
						Use Default Folder
					</button>
				</div>
			{/if}
		</div>
		<div class="mt-3">
			<button
				type="button"
				class="btn btn-outline btn-sm"
				disabled={isForking}
				onclick={runForkProject}
			>
				{#if isForking}
					<span class="loading loading-spinner loading-xs"></span>
				{/if}
				Fork project
			</button>
		</div>
	{:else}
		<div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
			<button
				type="button"
				class="btn btn-primary btn-sm gap-1"
				disabled={isBackingUp || !summary}
				onclick={() => runBackup(true)}
			>
				{#if isBackingUp && backupMode === 'strict'}
					<span class="loading loading-spinner loading-xs"></span>
				{:else}
					<CloudArrowUp size={14} />
				{/if}
				Back up project
			</button>
			{#if summary?.blockingItems.length}
				<button
					type="button"
					class="btn btn-outline btn-sm"
					disabled={isBackingUp}
					onclick={() => runBackup(false)}
				>
					{#if isBackingUp && backupMode === 'eligible'}
						<span class="loading loading-spinner loading-xs"></span>
					{/if}
					Back up everything eligible
				</button>
			{/if}
			<button
				type="button"
				class="btn btn-outline btn-sm"
				disabled={isForking || isBackingUp}
				onclick={runForkProject}
			>
				{#if isForking}
					<span class="loading loading-spinner loading-xs"></span>
				{/if}
				Fork project
			</button>
		</div>

		{#if lastResult}
			<div
				class:alert-success={lastResult.manifestUploaded && lastResult.skippedItems.length === 0}
				class:alert-warning={lastResult.skippedItems.length > 0 || lastResult.quarantines.length > 0}
				class:alert-info={lastResult.skippedItems.length === 0 && !lastResult.manifestUploaded}
				class="alert mt-3 text-sm"
			>
				{resultSummary(lastResult)}
			</div>
		{/if}

		{#if summary && [...summary.transcriptions, ...summary.collations].length > 0}
			<div class="mt-3 rounded-box border border-base-300/60 bg-base-100 p-3">
				<div class="mb-2 flex items-center justify-between gap-2">
					<div class="text-sm font-medium">Project items</div>
					<div class="text-xs text-base-content/50">Committed versions only</div>
				</div>
				<ul class="divide-y divide-base-300/60">
					{#each [...summary.transcriptions, ...summary.collations] as item (itemKey(item))}
						<li class="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
							<div class="min-w-0">
								<div class="truncate text-sm font-medium">{itemLabel(item)} {item.itemId}</div>
								<div class="text-xs text-base-content/50">{statusLabelForItem(item)}</div>
							</div>
							{#if canBackUpItem(item)}
								<button
									type="button"
									class="btn btn-outline btn-xs"
									disabled={isBackingUp || isForking}
									onclick={() => runEntityBackup(item)}
								>
									{#if backingUpItemKey === itemKey(item)}
										<span class="loading loading-spinner loading-xs"></span>
									{/if}
									Back up committed version
								</button>
							{:else if item.status === 'uncommitted-local-changes' || item.status === 'never-committed'}
								<span class="badge badge-warning badge-outline">Commit before backup</span>
							{:else if item.status === 'diverged'}
								<span class="badge badge-error badge-outline">Resolve conflict</span>
							{:else if item.status === 'backed-up'}
								<span class="badge badge-success badge-outline">Backed up</span>
							{:else}
								<span class="badge badge-ghost">{statusLabelForItem(item)}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if summary?.blockingItems.length}
			<div class="mt-3 rounded-box border border-warning/30 bg-warning/10 p-3 text-xs">
				<div class="font-medium text-warning-content">Commit these before a full backup:</div>
				<ul class="mt-1 space-y-1 text-base-content/60">
					{#each summary.blockingItems.slice(0, 4) as item (`${item.itemType}:${item.itemId}`)}
						<li>{item.itemType}: {item.reason ?? item.status}</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}
</section>
