<script lang="ts">
	import { page } from '$app/state';
	import { collationState } from '$lib/client/collation/collation-state.svelte';
	import { ensureDefaultProject } from '$lib/client/db/client';
	import CollationWorkspace from '$lib/components/collation/CollationWorkspace.svelte';
	import { selectInitialCollationProject } from './new-collation-project';
	import { onMount } from 'svelte';

	onMount(async () => {
		collationState.reset();
		const projectId = page.url.searchParams.get('projectId');
		await selectInitialCollationProject(projectId, {
			ensureDefaultProject,
			selectProject: collationState.selectProject,
		});
	});
</script>

<CollationWorkspace />
