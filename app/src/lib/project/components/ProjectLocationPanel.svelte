<script lang="ts">
	import { onMount } from 'svelte';
	import FolderOpen from 'phosphor-svelte/lib/FolderOpen';
	import WarningCircle from 'phosphor-svelte/lib/WarningCircle';
	import { exportProjectZip, forkProject, subscribeLocalDbInvalidations } from '$lib/db/client';
	import { resolve } from '$app/paths';
	import {
		dismissPlacementNotice,
		removeProjectFromDevice,
	} from '$lib/backup/location-connections';
	import {
		listProjectLocations,
		listProjectPlacements,
		listStorageAccounts,
		type ProjectLocation,
		type ProjectPlacement,
		type StorageAccount,
	} from '$lib/storage/project-locations';
	import { downloadZipArchive } from '$lib/shell/download-blob';
	import { getProjectBackupMetadata, recordProjectZipExport } from '$lib/storage/backup-metadata';
	import { syncService } from '$lib/backup/sync-service.svelte';
	import { isNotBackedUp, syncStatusLabel, syncStatusReason } from '$lib/backup/sync-status';
	import StorageSignInButtons from '$lib/backup/components/StorageSignInButtons.svelte';
	import { networkStatus } from '$lib/shell/network-status.svelte';

	interface Props {
		projectId: string;
		onForked?: (projectId: string) => void | Promise<void>;
		onRemoved?: () => void | Promise<void>;
	}

	let { projectId, onForked, onRemoved }: Props = $props();

	let placement = $state.raw<ProjectPlacement | null>(null);
	let locations = $state.raw<ProjectLocation[]>([]);
	let accounts = $state.raw<StorageAccount[]>([]);
	let loaded = $state(false);
	let chosenLocationId = $state('');
	let isLoading = $state(false);
	let isMoving = $state(false);
	let isExporting = $state(false);
	let isForking = $state(false);
	let isRemoving = $state(false);
	let isDeleting = $state(false);
	let deleteDialog = $state<HTMLDialogElement>();
	let lastExportedAt = $state<string | null>(null);
	let error = $state<string | null>(null);
	let loadRunId = 0;

	let location = $derived(
		locations.find(candidate => candidate.id === placement?.locationId) ?? null
	);
	let syncStatus = $derived(syncService.projectStatus(projectId, networkStatus.online));
	let destinations = $derived(locations.filter(candidate => candidate.id !== location?.id));
	let signedIn = $derived(accounts.some(account => account.signedIn));
	let notBackedUp = $derived(loaded && isNotBackedUp(placement ?? undefined));

	onMount(() =>
		subscribeLocalDbInvalidations(event => {
			if (
				['projects', 'transcriptions', 'collations', 'sync-targets', 'all'].includes(
					event.domain
				)
			)
				void loadLocation(projectId);
		})
	);

	$effect(() => {
		if (projectId) void loadLocation(projectId);
	});

	async function loadLocation(nextProjectId: string) {
		const runId = ++loadRunId;
		isLoading = true;
		try {
			const [placements, nextLocations, nextAccounts, metadata] = await Promise.all([
				listProjectPlacements(),
				listProjectLocations(),
				listStorageAccounts(),
				getProjectBackupMetadata(nextProjectId),
			]);
			if (runId !== loadRunId) return;
			placement = placements.find(candidate => candidate.projectId === nextProjectId) ?? null;
			locations = nextLocations;
			accounts = nextAccounts;
			if (!destinations.some(candidate => candidate.id === chosenLocationId)) {
				chosenLocationId = destinations[0]?.id ?? '';
			}
			lastExportedAt = metadata.lastExportedAt;
			loaded = true;
		} catch (err) {
			if (runId !== loadRunId) return;
			error = err instanceof Error ? err.message : 'Failed to load the project location.';
		} finally {
			if (runId === loadRunId) isLoading = false;
		}
	}

	async function moveProject() {
		const destination = destinations.find(candidate => candidate.id === chosenLocationId);
		if (!destination || isMoving) return;
		if (
			location &&
			!confirm(
				`Move this project and all its versions to ${destination.displayPath}? Its folder in ${location.displayPath} is replaced with a notice that it moved, and anyone still using it there stops syncing.`
			)
		)
			return;
		isMoving = true;
		error = null;
		try {
			await syncService.moveProject(projectId, destination.id);
			await loadLocation(projectId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to move the project.';
		} finally {
			isMoving = false;
		}
	}

	async function dismissMoved() {
		await dismissPlacementNotice(projectId);
		await loadLocation(projectId);
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

	async function removeFromDevice() {
		if (!projectId || isRemoving) return;
		if (
			!confirm(
				`Remove this project from this device? It stays in ${location?.displayPath} and downloads again the next time you sign in.`
			)
		)
			return;
		await runRemoveFromDevice();
	}

	async function runRemoveFromDevice() {
		isRemoving = true;
		error = null;
		try {
			await removeProjectFromDevice(projectId);
			await onRemoved?.();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to remove the project.';
		} finally {
			isRemoving = false;
		}
	}

	async function deleteProject() {
		if (!projectId || isDeleting) return;
		isDeleting = true;
		error = null;
		try {
			await syncService.deleteProject(projectId);
			deleteDialog?.close();
			await onRemoved?.();
		} catch (err) {
			deleteDialog?.close();
			error = err instanceof Error ? err.message : 'Failed to delete the project.';
		} finally {
			isDeleting = false;
		}
	}

	async function removeFromDeviceInstead() {
		deleteDialog?.close();
		await runRemoveFromDevice();
	}

	async function runZipExport() {
		if (!projectId || isExporting) return;
		isExporting = true;
		error = null;
		try {
			const result = await exportProjectZip(projectId);
			downloadZipArchive(result.fileName, result.bytes);
			await recordProjectZipExport(projectId, result.exportedAt);
			lastExportedAt = result.exportedAt;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to export project zip.';
		} finally {
			isExporting = false;
		}
	}

	function formatDate(value: string | null | undefined): string {
		if (!value) return 'Never';
		return new Date(value).toLocaleString();
	}
</script>

<section class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<div class="mb-3 flex items-center justify-between gap-3">
		<div>
			<h2 class="font-serif text-lg font-semibold">Location</h2>
			<p class="text-sm text-base-content/50">Where this project lives.</p>
		</div>
		{#if isLoading || isMoving}
			<span class="loading loading-spinner loading-sm text-base-content/40"></span>
		{:else}
			<FolderOpen size={22} class="text-base-content/40" />
		{/if}
	</div>

	{#if error}
		<div class="alert alert-error mb-3 text-sm">{error}</div>
	{/if}

	{#if placement?.moved}
		<div class="alert alert-warning mb-3 text-sm" data-testid="project-moved-notice">
			<WarningCircle size={18} />
			<div>
				<div class="font-medium">
					Moved by {placement.moved.movedBy} on {formatDate(placement.moved.movedAt)}
				</div>
				<div class="text-xs opacity-80">
					Now in {placement.moved.destinationLabel}. This copy no longer syncs.
				</div>
			</div>
			<button type="button" class="btn btn-ghost btn-sm" onclick={dismissMoved}>
				Dismiss
			</button>
		</div>
	{/if}

	{#if placement?.deleted}
		<div class="alert alert-warning mb-3 text-sm" data-testid="project-deleted-notice">
			<WarningCircle size={18} />
			<div>
				<div class="font-medium">
					Deleted by {placement.deleted.deletedBy} on {formatDate(
						placement.deleted.deletedAt
					)}
				</div>
				<div class="text-xs opacity-80">This copy no longer syncs.</div>
			</div>
			<button type="button" class="btn btn-ghost btn-sm" onclick={dismissMoved}>
				Dismiss
			</button>
		</div>
	{/if}

	<div class="grid gap-3 sm:grid-cols-2">
		<div class="rounded-box bg-base-200/60 p-3">
			<div class="text-xs uppercase tracking-wide text-base-content/40">Lives in</div>
			<div class="mt-1 text-sm font-medium" data-testid="project-location">
				{location?.displayPath ?? 'This browser only'}
			</div>
		</div>
		<div class="rounded-box bg-base-200/60 p-3">
			<div class="text-xs uppercase tracking-wide text-base-content/40">Status</div>
			<div class="mt-1 text-sm font-medium">{syncStatusLabel(syncStatus)}</div>
			<div class="text-xs text-base-content/60">{syncStatusReason(syncStatus)}</div>
		</div>
	</div>

	{#if notBackedUp}
		<div class="alert alert-warning alert-vertical mt-3 text-sm sm:alert-horizontal">
			<WarningCircle size={18} />
			<div>
				<div class="font-medium">Not backed up</div>
				<div class="text-xs opacity-80">
					{!signedIn
						? 'Sign in to back it up as you work, or export a zip now.'
						: destinations.length > 0
							? 'Move it to a location for continuous sync, or export a zip now.'
							: 'Add a location for continuous sync, or export a zip now.'}
				</div>
			</div>
			{#if !signedIn}
				<div><StorageSignInButtons /></div>
			{:else if destinations.length === 0}
				<a href={resolve('/data')} class="btn btn-warning btn-sm">Add a location</a>
			{/if}
		</div>
	{/if}

	{#if destinations.length > 0}
		<div class="mt-4 rounded-box border border-base-300/60 bg-base-200/40 p-3">
			<div class="text-sm font-medium">Move</div>
			<div class="text-xs text-base-content/60">Moves the project and all its versions.</div>
			<div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
				<select
					class="select select-bordered select-sm w-full sm:w-auto"
					aria-label="Move to"
					bind:value={chosenLocationId}
					disabled={isMoving}
				>
					{#each destinations as candidate (candidate.id)}
						<option value={candidate.id}>{candidate.displayPath}</option>
					{/each}
				</select>
				<button
					type="button"
					class="btn btn-primary btn-sm"
					disabled={!chosenLocationId || isMoving}
					onclick={moveProject}
				>
					{#if isMoving}<span class="loading loading-spinner loading-xs"></span>{/if}
					Move
				</button>
			</div>
		</div>
	{/if}

	<div class="mt-4 rounded-box border border-base-300/60 bg-base-200/40 p-3">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<div class="text-sm font-medium">Zip export</div>
				<div class="text-xs text-base-content/60">
					Last exported: {formatDate(lastExportedAt)}
				</div>
			</div>
			<button
				type="button"
				class="btn btn-outline btn-sm"
				disabled={isExporting}
				onclick={runZipExport}
			>
				{#if isExporting}<span class="loading loading-spinner loading-xs"></span>{/if}
				Export project zip
			</button>
		</div>
	</div>

	<div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
		<button
			type="button"
			class="btn btn-outline btn-sm"
			disabled={isForking}
			onclick={runForkProject}
		>
			{#if isForking}<span class="loading loading-spinner loading-xs"></span>{/if}
			Fork project
		</button>
		{#if location}
			<button
				type="button"
				class="btn btn-ghost btn-sm"
				disabled={isRemoving}
				onclick={removeFromDevice}
			>
				{#if isRemoving}<span class="loading loading-spinner loading-xs"></span>{/if}
				Remove from this device
			</button>
		{/if}
		<button
			type="button"
			class="btn btn-ghost btn-sm text-error sm:ml-auto"
			disabled={isDeleting}
			onclick={() => deleteDialog?.showModal()}
		>
			Delete project
		</button>
	</div>
</section>

<dialog
	bind:this={deleteDialog}
	class="modal"
	aria-label="Delete project"
	oncancel={event => isDeleting && event.preventDefault()}
>
	<div class="modal-box w-full max-w-md space-y-3">
		<h3 class="font-serif text-lg font-bold">Delete project</h3>
		<p class="text-sm text-base-content/70" data-testid="delete-project-message">
			{#if location?.kind === 'team'}
				This deletes the project for everyone in the team location {location.displayPath}.
				Teammates' copies stop syncing.
			{:else if location}
				This deletes the project from {location.displayPath} and from this device.
			{:else}
				This deletes the project from this browser. It can't be undone.
			{/if}
			{#if location?.accountId}
				Its files go to your storage provider's trash.
			{/if}
		</p>
		<div class="modal-action mt-2 flex-wrap">
			<button
				type="button"
				class="btn btn-sm btn-ghost"
				disabled={isDeleting}
				onclick={() => deleteDialog?.close()}
			>
				Cancel
			</button>
			{#if location}
				<button
					type="button"
					class="btn btn-sm btn-outline"
					disabled={isDeleting || isRemoving}
					onclick={removeFromDeviceInstead}
				>
					Remove from this device
				</button>
			{/if}
			<button
				type="button"
				class="btn btn-sm btn-error"
				disabled={isDeleting}
				onclick={deleteProject}
			>
				{#if isDeleting}<span class="loading loading-spinner loading-xs"></span>{/if}
				{location?.kind === 'team' ? 'Delete for everyone' : 'Delete project'}
			</button>
		</div>
	</div>
</dialog>
