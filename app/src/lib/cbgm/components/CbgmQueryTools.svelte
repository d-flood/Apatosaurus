<script lang="ts">
	import { onMount } from 'svelte';

	import { openCbgmQueries, type CbgmQueries } from '$lib/cbgm/cbgm-queries';
	import { readCbgmAnalysisCache } from '$lib/db/client';
	import type { CbgmAnalysisMetadata } from '$lib/storage/formats';
	import CbgmCompareWitnesses from './CbgmCompareWitnesses.svelte';
	import CbgmFindRelatives from './CbgmFindRelatives.svelte';
	import CbgmOptimizeSubstemmata from './CbgmOptimizeSubstemmata.svelte';

	let { analysis }: { analysis: CbgmAnalysisMetadata } = $props();

	const tools = [
		{ id: 'compare', label: 'Compare witnesses' },
		{ id: 'relatives', label: 'Find relatives' },
		{ id: 'substemmata', label: 'Optimize substemmata' },
	] as const;

	let tool = $state<(typeof tools)[number]['id']>('compare');
	let queries = $state.raw<CbgmQueries | null>(null);
	let error = $state<string | null>(null);

	onMount(() => {
		let destroyed = false;
		let opened: CbgmQueries | null = null;
		void (async () => {
			try {
				const cache = await readCbgmAnalysisCache(analysis.id);
				if (!cache) throw new Error('This analysis has no coherence results yet.');
				opened = await openCbgmQueries(analysis, cache);
				if (destroyed) opened.close();
				else queries = opened;
			} catch (err) {
				if (!destroyed) {
					error =
						err instanceof Error ? err.message : 'The analysis could not be opened.';
				}
			}
		})();
		return () => {
			destroyed = true;
			opened?.close();
		};
	});
</script>

{#if error}
	<div class="alert alert-error text-sm" role="alert">{error}</div>
{:else if !queries}
	<p class="flex items-center gap-2 text-sm text-base-content/60">
		<span class="loading loading-spinner loading-sm"></span>
		Opening the analysis...
	</p>
{:else}
	<div class="space-y-4">
		<div role="tablist" class="tabs tabs-box bg-base-200">
			{#each tools as item (item.id)}
				<button
					type="button"
					role="tab"
					class={['tab', tool === item.id && 'tab-active']}
					aria-selected={tool === item.id}
					onclick={() => (tool = item.id)}
				>
					{item.label}
				</button>
			{/each}
		</div>
		<div role="tabpanel" aria-label="Compare witnesses" hidden={tool !== 'compare'}>
			<CbgmCompareWitnesses analysisName={analysis.name} {queries} />
		</div>
		<div role="tabpanel" aria-label="Find relatives" hidden={tool !== 'relatives'}>
			<CbgmFindRelatives analysisName={analysis.name} {queries} />
		</div>
		<div role="tabpanel" aria-label="Optimize substemmata" hidden={tool !== 'substemmata'}>
			<CbgmOptimizeSubstemmata analysisName={analysis.name} {queries} />
		</div>
	</div>
{/if}
