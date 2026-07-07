<script lang="ts">
	import { page } from '$app/state';
	import { collationState } from '$lib/client/collation/collation-state.svelte';
	import CollationWorkspace from '$lib/components/collation/CollationWorkspace.svelte';
	import { onMount } from 'svelte';

	onMount(async () => {
		collationState.reset();
		const projectId = page.url.searchParams.get('projectId');
		if (projectId) {
			await collationState.selectProject(projectId);
		}
	});
</script>

<CollationWorkspace />
