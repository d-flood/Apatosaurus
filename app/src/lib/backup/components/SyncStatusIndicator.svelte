<script lang="ts">
	import { networkStatus } from '$lib/shell/network-status.svelte';
	import { syncService } from '$lib/backup/sync-service.svelte';
	import {
		syncStatusLabel,
		syncStatusReason,
		type SyncStatusState,
	} from '$lib/backup/sync-status';
	import HardDrives from 'phosphor-svelte/lib/HardDrives';
	import WifiSlash from 'phosphor-svelte/lib/WifiSlash';

	const stateBadgeClass: Record<SyncStatusState, string> = {
		synced: 'badge-success',
		'saved-on-device': 'badge-ghost',
		'needs-attention': 'badge-warning',
	};

	let status = $derived(syncService.overallStatus(networkStatus.online));
	let label = $derived(syncStatusLabel(status));
	let offline = $derived(!networkStatus.online);
</script>

<div class="tooltip tooltip-bottom z-10" role="tooltip" data-tip={syncStatusReason(status)}>
	<span class="badge gap-1 whitespace-nowrap {stateBadgeClass[status.state]}">
		<span class="sr-only">{label}</span>
		{#if offline}
			<WifiSlash size="24" weight="fill" aria-hidden="true" />
		{:else}
			<HardDrives size="24" weight="fill" aria-hidden="true" />
		{/if}
		<span class="hidden text-xs font-medium normal-case xl:inline" aria-hidden="true"
			>{label}</span
		>
	</span>
</div>
