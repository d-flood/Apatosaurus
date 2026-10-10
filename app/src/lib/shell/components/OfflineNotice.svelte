<script lang="ts">
	import { networkStatus } from '$lib/shell/network-status.svelte';
	import WifiSlash from 'phosphor-svelte/lib/WifiSlash';
</script>

<div role="status">
	{#if !networkStatus.online}
		<div class="alert alert-info alert-soft my-2 py-2 text-sm">
			<WifiSlash size={18} weight="fill" aria-hidden="true" />
			<span>You're offline. Changes are saved on this device.</span>
		</div>
	{/if}
</div>
