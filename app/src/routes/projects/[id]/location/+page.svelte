<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	import ProjectLocationPanel from '$lib/project/components/ProjectLocationPanel.svelte';
	import type { ProjectRecord } from '$lib/db/repositories/projects';

	let { data } = $props<{ data: { project: ProjectRecord } }>();

	async function handleProjectForked(projectId: string) {
		await goto(resolve('/projects/[id]/location', { id: projectId }));
	}

	async function handleProjectRemoved() {
		await goto(resolve('/projects'));
	}
</script>

<ProjectLocationPanel
	projectId={data.project.id}
	onForked={handleProjectForked}
	onRemoved={handleProjectRemoved}
/>
