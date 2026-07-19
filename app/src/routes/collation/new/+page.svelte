<script lang="ts">
	import { page } from '$app/state';
	import { collationState } from '$lib/client/collation/collation-state.svelte';
	import {
		listProjects,
		type ProjectOption,
	} from '$lib/client/collation/project-collation';
	import { ensureDefaultProject } from '$lib/client/db/client';
	import {
		readLastOpenedProjectId,
		resolveLastOpenedProjectId,
	} from '$lib/client/navigation/last-opened-project';
	import CollationWorkspace from '$lib/components/collation/CollationWorkspace.svelte';
	import { selectInitialCollationProject } from './new-collation-project';
	import { onMount } from 'svelte';

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
			selectedProjectId =
				resolveLastOpenedProjectId(readLastOpenedProjectId(), projects) || defaultProjectId;
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
