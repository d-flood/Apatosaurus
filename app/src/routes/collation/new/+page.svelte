<script lang="ts">
	import { page } from '$app/state';
	import { collationState } from '$lib/collation/collation-state.svelte';

	import { ensureDefaultProject, listProjects } from '$lib/db/client';
	import { resolveCreationTargetProjectId } from '$lib/shell/last-opened-project';
	import CollationWorkspace from '$lib/collation/components/CollationWorkspace.svelte';
	import { selectInitialCollationProject } from './new-collation-project';
	import { onMount } from 'svelte';
	import type { ProjectOption } from '$lib/db/repositories/projects';

	let projects = $state<ProjectOption[]>([]);
	let selectedProjectId = $state('');
	let isSelectingProject = $state(false);
	let showProjectSelector = $state(false);

	onMount(async () => {
		collationState.reset();
		const projectId = page.url.searchParams.get('projectId');
		if (!projectId) {
			showProjectSelector = true;
			const defaultProjectId = await ensureDefaultProject();
			projects = await listProjects();
			selectedProjectId = resolveCreationTargetProjectId(
				projectId,
				projects,
				defaultProjectId
			);
		}
		await selectInitialCollationProject(projectId, {
			ensureDefaultProject: async () => selectedProjectId || ensureDefaultProject(),
			selectProject: collationState.selectProject,
		});
	});

	async function selectProject() {
		if (!selectedProjectId) return;
		isSelectingProject = true;
		try {
			await collationState.selectProject(selectedProjectId);
		} finally {
			isSelectingProject = false;
		}
	}
</script>

{#if showProjectSelector}
	<div class="container mx-auto max-w-6xl px-4 pt-4">
		<label class="select w-full md:max-w-md">
			<span class="font-bold label">Project*</span>
			<select
				bind:value={selectedProjectId}
				disabled={isSelectingProject}
				onchange={selectProject}
				required
			>
				{#each projects as project (project.id)}
					<option value={project.id}>{project.name}</option>
				{/each}
			</select>
		</label>
	</div>
{/if}

<CollationWorkspace />
