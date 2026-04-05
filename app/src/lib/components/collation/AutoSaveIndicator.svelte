<script lang="ts">
	import { collationState } from '$lib/client/collation/collation-state.svelte';
	import Check from 'phosphor-svelte/lib/Check';
	import CircleNotch from 'phosphor-svelte/lib/CircleNotch';
	import Warning from 'phosphor-svelte/lib/Warning';
	import CloudArrowUp from 'phosphor-svelte/lib/CloudArrowUp';
</script>

<div class="flex items-center gap-1.5 text-xs font-mono tracking-wide select-none">
	{#if collationState.saveStatus === 'saved'}
		<Check size={14} class="text-success" />
		<span class="text-success/80">Saved</span>
	{:else if collationState.saveStatus === 'saving'}
		<CircleNotch size={14} class="text-info animate-spin" />
		<span class="text-info/80">Saving</span>
	{:else if collationState.saveStatus === 'unsaved'}
		<CloudArrowUp size={14} class="text-warning" />
		<span class="text-warning/80">Unsaved</span>
	{:else}
		<Warning size={14} class="text-error" />
		<span class="text-error/80">Error</span>
	{/if}
</div>
