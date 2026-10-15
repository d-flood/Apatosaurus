<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { CompareWitnessesTable } from '@apatosaurus/open-cbgm-wasm';

	import type { CbgmQueries } from '$lib/cbgm/cbgm-queries';
	import { coherenceTableColumns, resultFileStem, toCsv } from '$lib/cbgm/cbgm-query-tables';
	import CbgmCoherenceTable from './CbgmCoherenceTable.svelte';
	import CbgmResultDownloads from './CbgmResultDownloads.svelte';

	let { analysisName, queries }: { analysisName: string; queries: CbgmQueries } = $props();

	let primary = $state('');
	let others = $state<string[]>([]);
	let running = $state(false);
	let runId = 0;
	onDestroy(() => {
		runId += 1;
	});
	let error = $state<string | null>(null);
	let result = $state.raw<CompareWitnessesTable | null>(null);

	const chosenOthers = $derived(others.filter(siglum => siglum !== primary));

	async function run(event: SubmitEvent) {
		event.preventDefault();
		if (!primary || running) return;
		const id = ++runId;
		const source = queries;
		running = true;
		error = null;
		try {
			const next = await queries.compareWitnesses(primary, chosenOthers);
			if (id === runId && source === queries) result = next;
		} catch (err) {
			if (id !== runId || source !== queries) return;
			error = err instanceof Error ? err.message : 'The comparison failed.';
		} finally {
			if (id === runId && source === queries) running = false;
		}
	}
</script>

<div class="space-y-4">
	<form class="space-y-3" onsubmit={run}>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
			<label class="block min-w-0 space-y-1">
				<span class="text-sm font-medium">Witness</span>
				<select class="select select-bordered w-full" bind:value={primary}>
					<option value="" disabled>Choose a witness</option>
					{#each queries.witnesses as siglum (siglum)}
						<option value={siglum}>{siglum}</option>
					{/each}
				</select>
			</label>
			<fieldset class="fieldset min-w-0 rounded-box border border-base-300 p-3">
				<legend class="fieldset-legend">Compare with</legend>
				<p class="text-xs text-base-content/60">None chosen compares with every witness.</p>
				<div class="flex max-h-40 flex-wrap gap-x-3 gap-y-1 overflow-y-auto">
					{#each queries.witnesses.filter(siglum => siglum !== primary) as siglum (siglum)}
						<label class="flex items-center gap-1.5 font-mono text-sm">
							<input
								type="checkbox"
								class="checkbox checkbox-xs"
								value={siglum}
								bind:group={others}
							/>
							{siglum}
						</label>
					{/each}
				</div>
			</fieldset>
		</div>
		<button
			type="submit"
			class="btn btn-primary w-full sm:w-auto"
			disabled={!primary || running}
		>
			{running ? 'Comparing...' : 'Compare'}
		</button>
	</form>

	{#if error}
		<div class="alert alert-error text-sm" role="alert">{error}</div>
	{:else if result}
		{@const table = result}
		<CbgmCoherenceTable {table} />
		<CbgmResultDownloads
			fileStem={resultFileStem(analysisName, 'compare-witnesses', table.primary_wit)}
			csv={() => toCsv(coherenceTableColumns(table), table.rows)}
			json={table}
		/>
	{/if}
</div>
