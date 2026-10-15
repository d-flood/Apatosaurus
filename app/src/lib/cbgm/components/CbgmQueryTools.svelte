<script lang="ts">
	import { untrack } from 'svelte';

	import { openCbgmQueries, type CbgmQueries } from '$lib/cbgm/cbgm-queries';
	import { readCbgmAnalysisCache } from '$lib/db/client';
	import type { CbgmAnalysisMetadata } from '$lib/storage/formats';
	import CbgmCompareWitnesses from './CbgmCompareWitnesses.svelte';
	import CbgmFindRelatives from './CbgmFindRelatives.svelte';
	import CbgmGlobalStemma from './CbgmGlobalStemma.svelte';
	import CbgmOptimizeSubstemmata from './CbgmOptimizeSubstemmata.svelte';
	import CbgmTextualFlow from './CbgmTextualFlow.svelte';

	let { analysis }: { analysis: CbgmAnalysisMetadata } = $props();

	const tools = [
		{ id: 'compare', label: 'Compare witnesses' },
		{ id: 'relatives', label: 'Find relatives' },
		{ id: 'substemmata', label: 'Optimize substemmata' },
		{ id: 'flow', label: 'Textual flow' },
		{ id: 'global-stemma', label: 'Global stemma' },
	] as const;

	let tool = $state<(typeof tools)[number]['id']>('compare');
	let globalStemmaVisited = $state(false);
	let session = $state.raw<{
		cacheHash: string | null;
		queries: CbgmQueries | null;
		error: string | null;
	} | null>(null);

	const cacheHash = $derived(analysis.cache_hash);
	const opened = $derived(session?.cacheHash === cacheHash ? session : null);
	const queries = $derived(opened?.queries ?? null);

	$effect(() => {
		const hash = cacheHash;
		const target = untrack(() => analysis);
		let closed = false;
		let result: CbgmQueries | null = null;
		void (async () => {
			try {
				const cache = await readCbgmAnalysisCache(target.id);
				if (!cache) throw new Error('This analysis has no coherence results yet.');
				result = await openCbgmQueries(target, cache);
				if (closed) result.close();
				else session = { cacheHash: hash, queries: result, error: null };
			} catch (err) {
				if (!closed) {
					const error =
						err instanceof Error ? err.message : 'The analysis could not be opened.';
					session = { cacheHash: hash, queries: null, error };
				}
			}
		})();
		return () => {
			closed = true;
			result?.close();
		};
	});
</script>

{#if opened?.error}
	<div class="alert alert-error text-sm" role="alert">{opened.error}</div>
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
					onclick={() => {
						tool = item.id;
						globalStemmaVisited ||= item.id === 'global-stemma';
					}}
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
		<div role="tabpanel" aria-label="Textual flow" hidden={tool !== 'flow'}>
			<CbgmTextualFlow analysisName={analysis.name} {queries} />
		</div>
		<div role="tabpanel" aria-label="Global stemma" hidden={tool !== 'global-stemma'}>
			{#if globalStemmaVisited}
				<CbgmGlobalStemma {analysis} {queries} />
			{/if}
		</div>
	</div>
{/if}
