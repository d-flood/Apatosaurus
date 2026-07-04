<script lang="ts">
	import { onMount } from 'svelte';
	import { ensureLocalDbRuntime } from '$lib/client/db/runtime';
	import { waitForBrowserIdle } from '$lib/client/defer';
	import CloudArrowDown from 'phosphor-svelte/lib/CloudArrowDown';
	import LinkSimple from 'phosphor-svelte/lib/LinkSimple';
	import WarningCircle from 'phosphor-svelte/lib/WarningCircle';
	import {
		importCloudProject,
		listCloudConnections,
		listCloudProjectCandidates,
		pollLinkedProjectManifest,
		pullLinkedProjectUpdates,
		upsertCloudProjectFolder,
	} from '$lib/client/db/client';
	import type { CloudConnectionRecord } from '$lib/client/db/repositories/cloud-connections';
	import type {
		CloudProjectCandidate,
		RemoteProjectManifestComparison,
	} from '$lib/client/sync/project-restore';

	interface Props {
		selectedProjectId?: string | null;
		onOpenProject?: (projectId: string) => void | Promise<void>;
		onProjectImported?: (projectId: string) => void | Promise<void>;
	}

	let { onOpenProject, onProjectImported }: Props = $props();

	let connections = $state.raw<CloudConnectionRecord[]>([]);
	let selectedConnectionId = $state('');
	let rootFolderId = $state('');
	let candidates = $state.raw<CloudProjectCandidate[]>([]);
	let comparisons = $state.raw<Record<string, RemoteProjectManifestComparison>>({});
	let loadingConnections = $state(false);
	let loadingCandidates = $state(false);
	let actionKey = $state<string | null>(null);
	let error = $state<string | null>(null);
	let lastResult = $state<string | null>(null);

	let selectedConnection = $derived(
		connections.find(connection => connection.id === selectedConnectionId) ??
			connections[0] ??
			null
	);
	let canBrowse = $derived(Boolean(selectedConnection && !loadingCandidates));

	onMount(() => {
		let cancelled = false;
		void loadConnectionsAfterStartup(() => cancelled);
		return () => {
			cancelled = true;
		};
	});

	async function loadConnectionsAfterStartup(isCancelled: () => boolean) {
		try {
			await ensureLocalDbRuntime();
			await waitForBrowserIdle();
			if (!isCancelled()) await loadConnections();
		} catch (err) {
			if (!isCancelled()) {
				error = err instanceof Error ? err.message : 'Failed to load sync folders.';
			}
		}
	}

	async function loadConnections() {
		loadingConnections = true;
		error = null;
		try {
			connections = await listCloudConnections();
			selectedConnectionId = connections[0]?.id ?? '';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load sync folders.';
		} finally {
			loadingConnections = false;
		}
	}

	async function browseCloudProjects() {
		const connection = selectedConnection;
		if (!connection || loadingCandidates) return;
		loadingCandidates = true;
		error = null;
		lastResult = null;
		comparisons = {};
		try {
			candidates = await listCloudProjectCandidates(
				connection.id,
				rootFolderId.trim() || undefined
			);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to browse sync folder projects.';
			candidates = [];
		} finally {
			loadingCandidates = false;
		}
	}

	async function importCandidate(candidate: CloudProjectCandidate) {
		const key = candidateKey(candidate);
		actionKey = key;
		error = null;
		lastResult = null;
		try {
			const result = await importCloudProject({
				connectionId: candidate.connectionId,
				folderId: candidate.folderId,
				folderPath: candidate.folderPath,
				mode: 'create-local',
			});
			if (result.quarantines.length > 0) {
				error = `Import blocked by ${result.quarantines.length} quarantined file${result.quarantines.length === 1 ? '' : 's'}.`;
				return;
			}
			lastResult = `Imported ${candidate.name}.`;
			await onProjectImported?.(result.projectId);
			await browseCloudProjects();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to import project.';
		} finally {
			actionKey = null;
		}
	}

	async function linkCandidate(candidate: CloudProjectCandidate) {
		const key = candidateKey(candidate);
		actionKey = key;
		error = null;
		lastResult = null;
		try {
			await upsertCloudProjectFolder({
				projectId: candidate.projectId,
				connectionId: candidate.connectionId,
				cloudFolderId: candidate.folderId,
				cloudFolderPath: candidate.folderPath,
			});
			lastResult = `Linked ${candidate.name}.`;
			await browseCloudProjects();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to link cloud project.';
		} finally {
			actionKey = null;
		}
	}

	async function checkLinkedCandidate(candidate: CloudProjectCandidate) {
		const key = candidateKey(candidate);
		actionKey = key;
		error = null;
		lastResult = null;
		try {
			const result = await pollLinkedProjectManifest({
				connectionId: candidate.connectionId,
				projectId: candidate.projectId,
				cloudFolderId: candidate.folderId,
				cloudFolderPath: candidate.folderPath,
			});
			if (!result.ok) {
				error = result.providerMessage;
				return;
			}
			comparisons = { ...comparisons, [key]: result.comparison };
			lastResult = `Remote status: ${comparisonLabel(result.comparison.status)}.`;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to check remote project.';
		} finally {
			actionKey = null;
		}
	}

	async function pullCandidate(candidate: CloudProjectCandidate) {
		const key = candidateKey(candidate);
		actionKey = key;
		error = null;
		lastResult = null;
		try {
			const result = await pullLinkedProjectUpdates({
				connectionId: candidate.connectionId,
				projectId: candidate.projectId,
				cloudFolderId: candidate.folderId,
				cloudFolderPath: candidate.folderPath,
			});
			if (result.quarantines.length > 0) {
				error = `Pull blocked by ${result.quarantines.length} quarantined file${result.quarantines.length === 1 ? '' : 's'}.`;
				return;
			}
			lastResult = `Pulled updates for ${candidate.name}.`;
			await onProjectImported?.(result.projectId);
			await checkLinkedCandidate(candidate);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to pull remote updates.';
		} finally {
			actionKey = null;
		}
	}

	function candidateKey(candidate: CloudProjectCandidate): string {
		return `${candidate.connectionId}:${candidate.folderId}:${candidate.projectId}`;
	}

	function providerLabel(providerId: string): string {
		if (providerId === 'local-folder') return 'Local folder';
		if (providerId === 'mock') return 'Mock provider';
		return providerId;
	}

	function classificationLabel(classification: CloudProjectCandidate['classification']): string {
		if (classification === 'not-local') return 'Not local';
		if (classification === 'already-linked') return 'Linked';
		if (classification === 'local-same-id-unlinked') return 'Same ID, unlinked';
		if (classification === 'local-conflict') return 'Conflict';
		if (classification === 'quarantined') return 'Quarantined';
		return 'Unavailable';
	}

	function classificationClass(classification: CloudProjectCandidate['classification']): string {
		if (classification === 'not-local') return 'badge-info';
		if (classification === 'already-linked') return 'badge-success';
		if (classification === 'local-same-id-unlinked') return 'badge-warning';
		if (classification === 'local-conflict' || classification === 'quarantined')
			return 'badge-error';
		return 'badge-warning';
	}

	function comparisonLabel(status: RemoteProjectManifestComparison['status']): string {
		if (status === 'up-to-date') return 'Up to date';
		if (status === 'remote-update-available') return 'Remote update available';
		if (status === 'pending-local-backup') return 'Pending local backup';
		if (status === 'local-uncommitted-changes') return 'Local uncommitted changes';
		if (status === 'diverged') return 'Conflict';
		if (status === 'missing-local-entity') return 'Missing local entity';
		return 'Unknown';
	}
</script>

<section class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<div class="mb-3 flex items-start justify-between gap-3">
		<div>
			<h2 class="font-serif text-lg font-semibold">Sync Folder Projects</h2>
			<p class="mt-1 text-xs text-base-content/50">
				Browse project backups in the selected folder, sync them locally, or pull linked
				updates after review.
			</p>
		</div>
		{#if loadingConnections || loadingCandidates}
			<span class="loading loading-spinner loading-sm text-base-content/40"></span>
		{/if}
	</div>

	<div class="grid gap-2">
		{#if connections.length > 0}
			<label class="form-control">
				<span class="label py-1 text-xs text-base-content/50">Sync folder</span>
				<select class="select select-bordered select-sm" bind:value={selectedConnectionId}>
					{#each connections as connection (connection.id)}
						<option value={connection.id}>
							{providerLabel(connection.providerId)}: {connection.accountEmail}
						</option>
					{/each}
				</select>
			</label>
			<label class="form-control">
				<span class="label py-1 text-xs text-base-content/50">Root folder override</span>
				<input
					type="text"
					class="input input-bordered input-sm"
				placeholder="Use selected folder root"
					bind:value={rootFolderId}
				/>
			</label>
			<button
				class="btn btn-outline btn-sm"
				type="button"
				disabled={!canBrowse}
				onclick={browseCloudProjects}
			>
				Browse sync folder projects
			</button>
		{:else}
			<div class="rounded-box bg-base-200/60 p-3 text-sm text-base-content/55">
				No sync folder is configured yet.
			</div>
		{/if}
	</div>

	{#if error}
		<div class="alert alert-error mt-3 py-2 text-sm">{error}</div>
	{/if}
	{#if lastResult}
		<div class="alert alert-success mt-3 py-2 text-sm">{lastResult}</div>
	{/if}

	{#if candidates.length > 0}
		<div class="mt-4 space-y-2">
			{#each candidates as candidate (candidateKey(candidate))}
				{@const key = candidateKey(candidate)}
				{@const comparison = comparisons[key]}
				<article class="rounded-box border border-base-300/70 bg-base-200/30 p-3">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="font-serif text-sm font-semibold">{candidate.name}</div>
							<div class="mt-0.5 truncate text-xs text-base-content/45">
								{candidate.folderPath || candidate.folderId}
							</div>
							<div class="mt-1 text-[0.68rem] text-base-content/40">
								Updated {new Date(candidate.updatedAt).toLocaleString()}
							</div>
						</div>
						<span
							class="badge badge-xs {classificationClass(candidate.classification)}"
						>
							{classificationLabel(candidate.classification)}
						</span>
					</div>

					{#if comparison}
						<div class="mt-2 rounded bg-base-100/70 p-2 text-xs text-base-content/60">
							Remote status: {comparisonLabel(comparison.status)}. Changed items: {comparison.entities.filter(
								entity => entity.status === 'remote-update-available'
							).length}
						</div>
					{/if}

					{#if candidate.providerMessage}
						<div
							class="mt-2 flex gap-2 rounded bg-warning/10 p-2 text-xs text-warning-content"
						>
							<WarningCircle size={14} class="mt-0.5 shrink-0" />
							<span>{candidate.providerMessage}</span>
						</div>
					{/if}

					{#if candidate.quarantines.length > 0}
						<details class="mt-2 text-xs">
							<summary class="cursor-pointer text-error"
								>{candidate.quarantines.length} quarantined file{candidate
									.quarantines.length === 1
									? ''
									: 's'}</summary
							>
							<ul class="mt-1 space-y-1 text-base-content/55">
								{#each candidate.quarantines as quarantine}
									<li>{quarantine.path}: {quarantine.message}</li>
								{/each}
							</ul>
						</details>
					{/if}

					<div class="mt-3 flex flex-wrap gap-2">
						{#if candidate.classification === 'not-local'}
							<button
								class="btn btn-primary btn-xs gap-1"
								type="button"
								disabled={actionKey === key}
								onclick={() => importCandidate(candidate)}
							>
								<CloudArrowDown size={14} />
								Sync locally
							</button>
						{:else if candidate.classification === 'local-same-id-unlinked'}
							<button
								class="btn btn-warning btn-xs gap-1"
								type="button"
								disabled={actionKey === key}
								onclick={() => linkCandidate(candidate)}
							>
								<LinkSimple size={14} />
								Link local project
							</button>
						{:else if candidate.classification === 'already-linked'}
							<button
								class="btn btn-outline btn-xs"
								type="button"
								disabled={actionKey === key}
								onclick={() => checkLinkedCandidate(candidate)}
							>
								Check remote
							</button>
							{#if comparison?.status === 'remote-update-available'}
								<button
									class="btn btn-primary btn-xs"
									type="button"
									disabled={actionKey === key}
									onclick={() => pullCandidate(candidate)}
								>
									Pull remote updates
								</button>
							{/if}
							<button
								class="btn btn-ghost btn-xs"
								type="button"
								onclick={() => onOpenProject?.(candidate.projectId)}
							>
								Open local project
							</button>
						{/if}
						{#if actionKey === key}
							<span class="loading loading-spinner loading-xs"></span>
						{/if}
					</div>
				</article>
			{/each}
		</div>
	{:else if !loadingCandidates && selectedConnection && lastResult === null}
		<div class="mt-3 rounded-box bg-base-200/50 p-3 text-sm text-base-content/45">
			Browse to list project backups.
		</div>
	{/if}
</section>
