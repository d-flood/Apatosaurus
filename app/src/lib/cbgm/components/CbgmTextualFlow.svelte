<script lang="ts">
	import type { CbgmQueries, CbgmUnit } from '$lib/cbgm/cbgm-queries';
	import { resultFileStem } from '$lib/cbgm/cbgm-query-tables';
	import type { TextualFlowKind } from '$lib/cbgm/cbgm-worker-types';
	import { splitDigraphs } from '$lib/cbgm/render-dot';
	import GraphView from './GraphView.svelte';

	let { analysisName, queries }: { analysisName: string; queries: CbgmQueries } = $props();

	const kinds: { id: TextualFlowKind; label: string }[] = [
		{ id: 'flow', label: 'Textual flow' },
		{ id: 'attestations', label: 'Coherence in attestations' },
		{ id: 'variants', label: 'Coherence in variant passages' },
	];

	type FlowGraph = { reading: string | null; title: string; filenameBase: string; dot: string };

	let unitId = $state('');
	let kind = $state<TextualFlowKind>('flow');
	let connectivityLimit = $state<number | null>(null);
	let strengths = $state(false);
	let running = $state(false);
	let error = $state<string | null>(null);
	let graphs = $state.raw<FlowGraph[] | null>(null);
	let shownGraph = $state(0);

	const unit = $derived(queries.units.find(candidate => candidate.id === unitId));
	const limitProblem = $derived(
		connectivityLimit !== null &&
			!(Number.isInteger(connectivityLimit) && connectivityLimit > 0)
			? 'Connectivity limit must be a whole number above 0.'
			: null
	);
	const graph = $derived(graphs?.[shownGraph]);

	async function run(event: SubmitEvent) {
		event.preventDefault();
		if (!unit || limitProblem || running) return;
		running = true;
		error = null;
		const chosenKind = kind;
		try {
			const dot = await queries.textualFlow(unit.id, chosenKind, {
				connectivityLimit: connectivityLimit ?? undefined,
				strengths,
			});
			graphs = graphsFor(unit, chosenKind, dot);
			shownGraph = 0;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Drawing the textual flow failed.';
		} finally {
			running = false;
		}
	}

	function graphsFor(unit: CbgmUnit, kind: TextualFlowKind, dot: string): FlowGraph[] {
		const label = kinds.find(option => option.id === kind)!.label;
		const tool = `textual-flow-${kind}`;
		if (kind !== 'attestations') {
			return [
				{
					reading: null,
					title: `${label}, ${unit.label}`,
					filenameBase: resultFileStem(analysisName, tool, unit.label),
					dot,
				},
			];
		}
		return splitDigraphs(dot).map((graph, index) => {
			const reading = unit.readings[index];
			return {
				reading,
				title: `${label}, ${unit.label}, reading ${reading}`,
				filenameBase: resultFileStem(analysisName, tool, `${unit.label} ${reading}`),
				dot: graph,
			};
		});
	}
</script>

<div class="space-y-4">
	<form class="space-y-3" onsubmit={run}>
		<div
			class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,12rem)]"
		>
			<label class="block min-w-0 space-y-1">
				<span class="text-sm font-medium">Variation unit</span>
				<select class="select select-bordered w-full" bind:value={unitId}>
					<option value="" disabled>Choose a unit</option>
					{#each queries.units as option (option.id)}
						<option value={option.id}>{option.label}</option>
					{/each}
				</select>
			</label>
			<label class="block min-w-0 space-y-1">
				<span class="text-sm font-medium">Graph</span>
				<select class="select select-bordered w-full" bind:value={kind}>
					{#each kinds as option (option.id)}
						<option value={option.id}>{option.label}</option>
					{/each}
				</select>
			</label>
			<label class="block min-w-0 space-y-1">
				<span class="text-sm font-medium">Connectivity limit</span>
				<input
					type="number"
					min="1"
					step="1"
					class="input input-bordered w-full"
					placeholder="The unit's own"
					bind:value={connectivityLimit}
				/>
			</label>
		</div>
		<label class="flex w-fit items-center gap-2 text-sm">
			<input type="checkbox" class="checkbox checkbox-sm" bind:checked={strengths} />
			Show flow strengths
		</label>
		{#if limitProblem}
			<p class="text-sm text-error">{limitProblem}</p>
		{/if}
		<button
			type="submit"
			class="btn btn-primary w-full sm:w-auto"
			disabled={!unit || limitProblem !== null || running}
		>
			{running ? 'Drawing...' : 'Draw graph'}
		</button>
	</form>

	{#if error}
		<div class="alert alert-error text-sm" role="alert">{error}</div>
	{:else if graphs && graph}
		{#if graphs.length > 1}
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-sm text-base-content/60">Reading</span>
				<div class="join flex-wrap">
					{#each graphs as option, index (index)}
						<button
							type="button"
							class={[
								'btn btn-sm join-item font-mono',
								index === shownGraph && 'btn-active',
							]}
							aria-pressed={index === shownGraph}
							onclick={() => (shownGraph = index)}
						>
							{option.reading}
						</button>
					{/each}
				</div>
			</div>
		{/if}
		<GraphView dot={graph.dot} title={graph.title} filenameBase={graph.filenameBase} />
	{/if}
</div>
