<script lang="ts">
	import { networkStatus } from '$lib/client/network-status.svelte';
	import { syncService } from '$lib/client/sync/sync-service.svelte';
	import type { SyncUiState } from '$lib/client/sync/sync-manager';
	import HardDrives from 'phosphor-svelte/lib/HardDrives';
	import WifiSlash from 'phosphor-svelte/lib/WifiSlash';

	const stateBadgeClass: Record<SyncUiState, string> = {
		'saved locally': 'badge-ghost',
		'uncommitted local changes': 'badge-warning',
		'committed locally': 'badge-info',
		'sync pending': 'badge-info',
		'synced': 'badge-success',
		'remote update available': 'badge-warning',
		'conflict requires resolution': 'badge-error',
	};

	let displayState = $derived(syncService.uiState);
	let offline = $derived(!networkStatus.online);
	let connectionLabel = $derived.by(() => {
		if (offline) return 'Offline';
		if (syncService.connected) return 'Connected';
		if (syncService.ready) return 'Sync not connected';
		return 'Local-first mode';
	});
	let tooltip = $derived(`${connectionLabel} · ${displayState}`);
	let badgeClass = $derived(`badge gap-1 whitespace-nowrap ${stateBadgeClass[displayState]}`);
</script>

<div class="tooltip tooltip-bottom z-10" role="tooltip" data-tip={tooltip}>
	<span class={badgeClass}>
		<span class="sr-only">{displayState}</span>
		{#if offline}
			<WifiSlash size="24" weight="fill" aria-hidden="true" />
		{:else}
			<HardDrives size="24" weight="fill" aria-hidden="true" />
		{/if}
		<span class="hidden text-xs font-medium normal-case xl:inline">{displayState}</span>
	</span>
</div>
