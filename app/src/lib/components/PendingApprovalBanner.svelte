<script lang="ts">
	import Warning from 'phosphor-svelte/lib/Warning';

	let { show = false }: { show: boolean } = $props();
</script>

{#if show}
	<div
		role="alert"
		class="alert alert-warning sticky top-0 z-50 rounded-none flex items-center gap-3"
	>
		<Warning size={24} weight="fill" />
		<div class="flex flex-col">
			<span class="font-semibold">Account Pending Approval - Offline Mode Only</span>
			<span class="text-sm"
				>Your work is saved locally and will sync automatically when approved.</span
			>
		</div>
	</div>
{/if}
