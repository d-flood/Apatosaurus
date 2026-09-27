<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	import ProjectBackupPanel from '$lib/project/components/ProjectBackupPanel.svelte';
	import type { ProjectRecord } from '$lib/db/repositories/projects';

	let { data } = $props<{ data: { project: ProjectRecord } }>();

	async function handleProjectForked(projectId: string) {
		await goto(resolve('/projects/[id]/backup', { id: projectId }));
	}

	async function handleProjectRemoved() {
		await goto(resolve('/projects'));
	}
</script>

<ProjectBackupPanel
	projectId={data.project.id}
	onForked={handleProjectForked}
	onRemoved={handleProjectRemoved}
/>
