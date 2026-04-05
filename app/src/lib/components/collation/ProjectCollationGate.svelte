<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { collationState } from '$lib/client/collation/collation-state.svelte';
	import { listProjects, type ProjectOption } from '$lib/client/collation/project-collation';
	import FolderOpen from 'phosphor-svelte/lib/FolderOpen';
	import Plus from 'phosphor-svelte/lib/Plus';
	import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
	import { onMount } from 'svelte';

	let projects = $state<ProjectOption[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let projectName = $state('');
	let creating = $state(false);
	let selectingId = $state<string | null>(null);

	async function refreshProjects() {
		try {
			projects = await listProjects();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load projects';
		} finally {
			isLoading = false;
		}
	}

	onMount(async () => {
		await refreshProjects();
	});

	async function chooseProject(projectId: string) {
		selectingId = projectId;
		error = null;
		try {
			await collationState.selectProject(projectId);
			await goto(resolve('/collation/new'), { replaceState: true });
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to select project';
		} finally {
			selectingId = null;
		}
	}

	async function createProject() {
		const name = projectName.trim();
		if (!name) return;
		creating = true;
		error = null;
		try {
			await collationState.createProject(name);
			projectName = '';
			await refreshProjects();
			await goto(resolve('/collation/new'), { replaceState: true });
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create project';
		} finally {
			creating = false;
		}
	}
</script>

<div class="container mx-auto max-w-3xl p-4">
	<div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div class="space-y-1">
			<h2 class="text-2xl font-serif font-bold tracking-tight">Select a Project</h2>
			<p class="text-sm text-base-content/60">
				Choose or create a project to begin collating. Projects define which transcriptions, witnesses, and settings are available.
			</p>
		</div>
		<a href={resolve('/projects')} class="btn btn-ghost btn-sm">Manage Projects</a>
	</div>

	{#if error}
		<div class="alert alert-error mb-4 text-sm">{error}</div>
	{/if}

	{#if isLoading}
		<div class="flex items-center gap-2 p-6 bg-base-200 rounded-box justify-center">
			<span class="loading loading-spinner loading-md"></span>
			<span>Loading projects...</span>
		</div>
	{:else if projects.length === 0}
		<div class="text-center py-12 space-y-3">
			<FolderOpen size={32} class="mx-auto text-base-content/30" />
			<div class="text-base-content/30 text-lg">No projects yet</div>
			<p class="text-sm text-base-content/50 max-w-md mx-auto">
				Create a project to start linking transcriptions and collation settings.
			</p>
		</div>
	{:else}
		<ul class="list rounded-box shadow-md bg-base-100 mb-6">
			{#each projects as project (project.id)}
				<li class="list-row gap-4 items-center">
					<div class="flex items-center gap-3 text-base-content/60">
						<FolderOpen size={18} />
					</div>
					<div class="flex-1 min-w-0">
						<div class="font-serif font-medium">{project.name}</div>
						{#if project.description}
							<div class="text-xs text-base-content/50 mt-0.5 line-clamp-1">
								{project.description}
							</div>
						{/if}
					</div>
					<button
						class="btn btn-ghost btn-sm gap-1"
						onclick={() => chooseProject(project.id)}
						disabled={selectingId !== null}
					>
						{#if selectingId === project.id}
							<span class="loading loading-spinner loading-xs"></span>
						{:else}
							Select
							<ArrowRight size={14} />
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="divider text-xs text-base-content/40">OR CREATE A NEW PROJECT</div>

	<div class="bg-base-100 rounded-box shadow-md p-5">
		<div class="flex gap-3">
			<label class="form-control flex-1">
				<input
					type="text"
					class="input input-bordered w-full"
					placeholder="Project name, e.g. Romans Majuscule Study"
					bind:value={projectName}
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							void createProject();
						}
					}}
				/>
			</label>
			<button
				type="button"
				class="btn btn-primary gap-2"
				disabled={creating || !projectName.trim()}
				onclick={createProject}
			>
				{#if creating}
					<span class="loading loading-spinner loading-sm"></span>
				{:else}
					<Plus size={16} />
				{/if}
				Create
			</button>
		</div>
	</div>
</div>
