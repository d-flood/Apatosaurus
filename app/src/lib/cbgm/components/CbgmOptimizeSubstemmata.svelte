<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { CbgmQueries, OptimizeSubstemmataResult } from '$lib/cbgm/cbgm-queries';
	import { resultFileStem, substemmataColumns, toCsv } from '$lib/cbgm/cbgm-query-tables';
	import CbgmResultDownloads from './CbgmResultDownloads.svelte';

	let { analysisName, queries }: { analysisName: string; queries: CbgmQueries } = $props();

	const messages = {
		'no-potential-ancestors': 'This witness has no potential ancestors.',
		'no-data': "There isn't enough local stemma data for this witness yet.",
	};

	let witness = $state('');
	let maxCost = $state<number | null>(null);
	let running = $state(false);
	let runId = 0;
	onDestroy(() => {
		runId += 1;
	});
	let error = $state<string | null>(null);
	let result = $state.raw<OptimizeSubstemmataResult | null>(null);

	const maxCostProblem = $derived(
		maxCost !== null && !(maxCost >= 0) ? 'Maximum cost must be 0 or more.' : null
	);

	async function run(event: SubmitEvent) {
		event.preventDefault();
		if (!witness || maxCostProblem || running) return;
		const id = ++runId;
		const source = queries;
		running = true;
		error = null;
		try {
			const next = await queries.optimizeSubstemmata(witness, maxCost ?? undefined);
			if (id === runId && source === queries) result = next;
		} catch (err) {
			if (id !== runId || source !== queries) return;
			error = err instanceof Error ? err.message : 'Optimizing substemmata failed.';
		} finally {
			if (id === runId && source === queries) running = false;
		}
	}
</script>

<div class="space-y-4">
	<form class="space-y-3" onsubmit={run}>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,14rem)]">
			<label class="block min-w-0 space-y-1">
				<span class="text-sm font-medium">Witness</span>
				<select class="select select-bordered w-full" bind:value={witness}>
					<option value="" disabled>Choose a witness</option>
					{#each queries.witnesses as siglum (siglum)}
						<option value={siglum}>{siglum}</option>
					{/each}
				</select>
			</label>
			<label class="block min-w-0 space-y-1">
				<span class="text-sm font-medium">Maximum cost</span>
				<input
					type="number"
					min="0"
					step="any"
					class="input input-bordered w-full"
					placeholder="Best solutions only"
					bind:value={maxCost}
				/>
			</label>
		</div>
		{#if maxCostProblem}
			<p class="text-sm text-error">{maxCostProblem}</p>
		{:else}
			<p class="text-xs text-base-content/60">
				A maximum cost lists every solution that costs no more.
			</p>
		{/if}
		<button
			type="submit"
			class="btn btn-primary w-full sm:w-auto"
			disabled={!witness || maxCostProblem !== null || running}
		>
			{running ? 'Optimizing...' : 'Optimize'}
		</button>
	</form>

	{#if error}
		<div class="alert alert-error text-sm" role="alert">{error}</div>
	{:else if result && 'kind' in result}
		<p class="rounded-box bg-base-200 p-3 text-sm" role="status">{messages[result.kind]}</p>
	{:else if result}
		{@const table = result}
		<p class="text-sm">
			Substemmata for <span class="font-mono">{table.primary_wit}</span>
			({table.primary_extant} extant units)
		</p>
		{#if table.rows.length === 0}
			<p class="text-sm text-base-content/60">No substemma is within this maximum cost.</p>
		{:else}
			<div class="overflow-x-auto rounded-box border border-base-300">
				<table class="table table-sm table-zebra">
					<thead>
						<tr>
							{#each substemmataColumns as column (column.header)}
								<th scope="col">{column.header}</th>
							{/each}
						</tr>
					</thead>
					<tbody class="font-mono">
						{#each table.rows as row, index (index)}
							<tr>
								{#each substemmataColumns as column (column.header)}
									<td>{column.value(row)}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<CbgmResultDownloads
				fileStem={resultFileStem(analysisName, 'optimize-substemmata', table.primary_wit)}
				csv={() => toCsv(substemmataColumns, table.rows)}
				json={table}
			/>
		{/if}
	{/if}
</div>
