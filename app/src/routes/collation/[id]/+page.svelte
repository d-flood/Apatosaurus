<script lang="ts">
	import { goto } from '$app/navigation';
	import { collationState } from '$lib/client/collation/collation-state.svelte';
	import { onMount } from 'svelte';

	let { params } = $props();

	onMount(() => {
		void goto(`/collation/${params.id}/${collationState.phase}`, { replaceState: true });
	});
</script>
