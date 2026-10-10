<script lang="ts">
	import { readEditingNotice, subscribeLocalDbInvalidations } from '$lib/db/client';
	import PencilSimple from 'phosphor-svelte/lib/PencilSimple';
	import X from 'phosphor-svelte/lib/X';
	import { onMount } from 'svelte';

	let { projectId, documentId }: { projectId: string; documentId: string } = $props();
	let notice = $state<string | null>(null);
	let dismissed = $state(false);

	async function check() {
		try {
			notice = await readEditingNotice(projectId, documentId);
		} catch (error) {
			console.warn('[presence] notice check failed', error);
		}
	}

	onMount(() => {
		void check();
		return subscribeLocalDbInvalidations(event => {
			if (event.domain === 'sync-targets') void check();
		});
	});
</script>

<div role="status">
	{#if notice && !dismissed}
		<div class="alert alert-warning alert-soft my-2 py-2 text-sm">
			<PencilSimple size={18} weight="fill" aria-hidden="true" />
			<span>{notice}</span>
			<button
				type="button"
				class="btn btn-ghost btn-xs btn-square"
				aria-label="Dismiss editing notice"
				onclick={() => (dismissed = true)}
			>
				<X size={14} />
			</button>
		</div>
	{/if}
</div>
