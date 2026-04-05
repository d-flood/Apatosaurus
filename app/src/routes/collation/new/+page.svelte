<script lang="ts">
	import { collationState } from '$lib/client/collation/collation-state.svelte';
	import CollationWorkspace from '$lib/components/collation/CollationWorkspace.svelte';
	import { onMount } from 'svelte';

	onMount(() => {
		collationState.reset();
	});
</script>

<CollationWorkspace />
