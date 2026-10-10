<script lang="ts">
	import { resolve } from '$app/paths';
	import { collationState } from '$lib/collation/collation-state.svelte';
	import OfflineNotice from '$lib/shell/components/OfflineNotice.svelte';
	import EditingNotice from '$lib/shell/components/EditingNotice.svelte';
	import { trackEditingPresence } from '$lib/backup/editing-presence-tracker';
	import { onDestroy, onMount } from 'svelte';

	let { children, params } = $props();
	let error = $state<string | null>(null);
	let isBootstrapping = $state(true);
	let stopPresence: (() => void) | null = null;
	let destroyed = false;

	onMount(async () => {
		try {
			if (collationState.collationId !== params.id) {
				collationState.reset();
				const loaded = await collationState.loadCollationById(params.id);
				if (!loaded) {
					error = `Collation "${params.id}" not found.`;
				}
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load collation.';
		} finally {
			isBootstrapping = false;
		}
		const { projectId, collationId } = collationState;
		if (destroyed || error || !projectId || !collationId) return;
		const presence = trackEditingPresence(projectId, collationId);
		const stopEdits = collationState.onEdit(presence.noteEdit);
		stopPresence = () => {
			stopEdits();
			presence.close();
		};
	});

	onDestroy(() => {
		destroyed = true;
		stopPresence?.();
	});
</script>

{#if isBootstrapping || collationState.isLoading}
	<div class="flex items-center justify-center h-[50vh]">
		<div class="flex items-center gap-3">
			<span class="loading loading-spinner loading-lg"></span>
			<span class="text-lg text-base-content/60">Loading collation...</span>
		</div>
	</div>
{:else if error}
	<div class="container mx-auto max-w-2xl p-4 space-y-4">
		<div class="alert alert-error">{error}</div>
		<a href={resolve('/collation')} class="btn btn-ghost btn-sm">Back to Collations</a>
	</div>
{:else}
	<div class="px-4">
		<OfflineNotice />
		{#if collationState.projectId && collationState.collationId}
			<EditingNotice
				projectId={collationState.projectId}
				documentId={collationState.collationId}
			/>
		{/if}
	</div>
	{@render children()}
{/if}
