<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createProjectRecord } from '$lib/project/projects';
	import { subscribeLocalDbInvalidations, listProjects } from '$lib/db/client';
	import { ensureLocalDbRuntime } from '$lib/db/runtime';
	import { placeProjectInLocation } from '$lib/backup/location-connections';
	import { syncService } from '$lib/backup/sync-service.svelte';
	import {
		syncStatusLabels,
		syncStatusReason,
		worstSyncStatus,
		type SyncStatusState,
	} from '$lib/backup/sync-status';
	import { networkStatus } from '$lib/shell/network-status.svelte';
	import {
		readLastUsedLocationId,
		recordLastUsedLocation,
		resolveDefaultLocationId,
	} from '$lib/shell/last-used-location';
	import {
		groupProjectsByLocation,
		type ProjectLocationGroup,
	} from '$lib/shell/project-location-groups';
	import {
		listProjectLocations,
		listProjectPlacements,
		listStorageAccounts,
		type ProjectLocation,
		type ProjectPlacement,
		type StorageAccount,
	} from '$lib/storage/project-locations';
	import ProjectZipImportPanel from '$lib/project/components/ProjectZipImportPanel.svelte';
	import FolderOpen from 'phosphor-svelte/lib/FolderOpen';
	import Plus from 'phosphor-svelte/lib/Plus';
	import { onMount } from 'svelte';
	import type { ProjectOption } from '$lib/db/repositories/projects';

	const PROJECTS_LOG_PREFIX = '[projects-route]';

	let projects = $state.raw<ProjectOption[]>([]);
	let placements = $state.raw<ProjectPlacement[]>([]);
	let locations = $state.raw<ProjectLocation[]>([]);
	let accounts = $state.raw<StorageAccount[]>([]);
	let chosenLocationId = $state('');
	let createName = $state('');
	let isBooting = $state(true);
	let isCreating = $state(false);
	let error = $state<string | null>(null);

	let groups = $derived(groupProjectsByLocation(projects, placements, locations, accounts));
	let projectCountLabel = $derived(
		`${projects.length} project${projects.length === 1 ? '' : 's'}`
	);

	function logProjects(
		level: 'debug' | 'warn' | 'error',
		message: string,
		details?: Record<string, unknown>
	) {
		const logger =
			level === 'error' ? console.error : level === 'warn' ? console.warn : console.debug;
		logger(`${PROJECTS_LOG_PREFIX} ${message}`, details ?? {});
	}

	async function loadProjects() {
		isBooting = true;
		error = null;
		try {
			await ensureLocalDbRuntime();
			const [projectRows] = await Promise.all([listProjects(), loadLocations()]);
			projects = projectRows;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to load projects';
			logProjects('error', 'project picker load failed', { error });
		} finally {
			isBooting = false;
		}
	}

	async function loadLocations() {
		[placements, locations, accounts] = await Promise.all([
			listProjectPlacements(),
			listProjectLocations(),
			listStorageAccounts(),
		]);
		if (!locations.some(location => location.id === chosenLocationId)) {
			chosenLocationId = resolveDefaultLocationId(readLastUsedLocationId(), locations) ?? '';
		}
	}

	function groupStatus(group: ProjectLocationGroup) {
		return worstSyncStatus(
			group.projects.map(project =>
				syncService.projectStatus(project.id, networkStatus.online)
			)
		);
	}

	const statusBadgeClass: Record<SyncStatusState, string> = {
		synced: 'badge-success',
		'saved-on-device': 'badge-ghost',
		'needs-attention': 'badge-warning',
	};

	async function createProject() {
		const name = createName.trim();
		if (!name || isCreating) return;
		isCreating = true;
		error = null;
		try {
			const projectId = await createProjectRecord({ name });
			if (chosenLocationId) {
				await placeProjectInLocation(projectId, chosenLocationId);
				recordLastUsedLocation(chosenLocationId);
			}
			await openProject(projectId);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to create project';
		} finally {
			isCreating = false;
		}
	}

	async function openProject(projectId: string) {
		await goto(resolve('/projects/[id]/transcriptions', { id: projectId }));
	}

	onMount(() => {
		void loadProjects();
		return subscribeLocalDbInvalidations(event => {
			if (event.domain === 'projects' || event.domain === 'all') void loadProjects();
			else if (event.domain === 'sync-targets') void loadLocations();
		});
	});
</script>

<main class="container mx-auto max-w-5xl p-4">
	<header class="mb-6 flex items-end justify-between gap-4">
		<div>
			<h1 class="font-serif text-3xl font-bold tracking-tight">Projects</h1>
		</div>
		<span class="badge badge-outline text-xs">{projectCountLabel}</span>
	</header>

	{#if error}<div class="alert alert-error mb-4 text-sm">{error}</div>{/if}

	<section class="rounded-box border border-base-300/60 bg-base-100 p-5 shadow-sm">
		<h2 class="font-serif text-xl font-semibold">Create a project</h2>
		<div class="mt-3 flex max-w-2xl flex-col gap-2 sm:flex-row">
			<input
				type="text"
				class="input input-bordered flex-1"
				placeholder="New project name"
				bind:value={createName}
				onkeydown={event => {
					if (event.key === 'Enter') {
						event.preventDefault();
						void createProject();
					}
				}}
			/>
			{#if locations.length > 1}
				<select
					class="select select-bordered sm:max-w-56"
					aria-label="Location"
					bind:value={chosenLocationId}
				>
					{#each locations as location (location.id)}
						<option value={location.id}>{location.displayPath}</option>
					{/each}
				</select>
			{/if}
			<button
				type="button"
				class="btn btn-primary gap-2"
				disabled={isCreating || !createName.trim()}
				onclick={createProject}
			>
				{#if isCreating}<span class="loading loading-spinner loading-xs"></span>{:else}<Plus
						size={16}
					/>{/if}
				Create
			</button>
		</div>
	</section>

	<section class="mt-6" aria-labelledby="project-library-heading">
		<h2 id="project-library-heading" class="font-serif text-xl font-semibold">
			Project Library
		</h2>
		{#if isBooting}
			<div
				class="mt-3 flex items-center gap-2 rounded-box bg-base-200 p-5 text-sm text-base-content/55"
			>
				<span class="loading loading-spinner loading-sm"></span> Loading projects...
			</div>
		{:else if projects.length === 0}
			<div class="mt-3 rounded-box border border-dashed border-base-300 p-8 text-center">
				<FolderOpen size={28} class="mx-auto text-base-content/30" />
				<p class="mt-2 font-medium">No projects yet</p>
				<p class="mt-1 text-sm text-base-content/55">
					Name your first project above to begin.
				</p>
			</div>
		{:else}
			{#each groups as group (group.id)}
				{@const status = group.location ? groupStatus(group) : null}
				<section class="mt-4" aria-label={group.label}>
					<div class="flex flex-wrap items-center gap-2">
						<h3 class="font-medium">{group.label}</h3>
						{#if group.owner}
							<span class="text-sm text-base-content/55">{group.owner}</span>
						{/if}
						{#if status}
							<span
								class="badge badge-sm {statusBadgeClass[status.state]}"
								title={syncStatusReason(status)}
							>
								{syncStatusLabels[status.state]}{status.state === 'synced'
									? ''
									: ` · ${syncStatusReason(status)}`}
							</span>
						{/if}
					</div>
					{#if group.signedOut}
						<p class="mt-1 text-sm text-warning">
							Changes stay on this device until you sign in again.
						</p>
					{/if}
					<div class="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{#each group.projects as project (project.id)}
							{@const projectStatus = syncService.projectStatus(
								project.id,
								networkStatus.online
							)}
							<article
								class="rounded-box border border-base-300/60 bg-base-100 p-5 shadow-sm"
							>
								<h4 class="font-serif text-lg font-semibold">{project.name}</h4>
								<p class="mt-1 min-h-10 text-sm text-base-content/55">
									{project.description || 'No description'}
								</p>
								<div class="mt-4 flex items-center justify-between gap-3">
									<span
										class="badge badge-sm {statusBadgeClass[
											projectStatus.state
										]}"
										title={syncStatusReason(projectStatus)}
									>
										{syncStatusLabels[projectStatus.state]}
									</span>
									<a
										href={resolve('/projects/[id]/transcriptions', {
											id: project.id,
										})}
										class="btn btn-primary btn-sm">Open</a
									>
								</div>
							</article>
						{/each}
					</div>
				</section>
			{/each}
		{/if}
	</section>

	<section class="mt-6 max-w-xl">
		<ProjectZipImportPanel onImported={openProject} />
	</section>
</main>
