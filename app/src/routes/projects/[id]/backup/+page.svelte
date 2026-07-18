<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { ProjectRecord } from '$lib/client/collation/project-collation';
	import ProjectBackupPanel from '$lib/components/projects/ProjectBackupPanel.svelte';

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
