<script lang="ts">
	import { networkStatus } from '$lib/client/network-status.svelte';
	import HardDrives from 'phosphor-svelte/lib/HardDrives';
	import WifiSlash from 'phosphor-svelte/lib/WifiSlash';
</script>

{#if !networkStatus.online}
	<div class="tooltip tooltip-bottom z-10" role="tooltip" data-tip="Offline - data remains local">
		<span class="badge badge-ghost gap-1">
			<span class="sr-only">Offline - data remains local</span>
			<WifiSlash size="28" weight="fill" />
		</span>
	</div>
{:else}
	<div class="tooltip tooltip-bottom z-10" role="tooltip" data-tip="Local-first mode active">
		<span class="badge badge-ghost gap-1">
			<span class="sr-only">Local-first mode active</span>
			<HardDrives size="28" weight="fill" />
		</span>
	</div>
{/if}
