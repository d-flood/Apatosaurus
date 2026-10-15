<script lang="ts">
	import type { FindRelativesTable } from '@apatosaurus/open-cbgm-wasm';

	import type { CbgmQueries } from '$lib/cbgm/cbgm-queries';
	import { coherenceTableColumns, resultFileStem, toCsv } from '$lib/cbgm/cbgm-query-tables';
	import CbgmCoherenceTable from './CbgmCoherenceTable.svelte';
	import CbgmResultDownloads from './CbgmResultDownloads.svelte';

	let { analysisName, queries }: { analysisName: string; queries: CbgmQueries } = $props();

	let witness = $state('');
	let unitId = $state('');
	let readings = $state<string[]>([]);
	let running = $state(false);
	let error = $state<string | null>(null);
	let result = $state.raw<FindRelativesTable | null>(null);

	const unit = $derived(queries.units.find(candidate => candidate.id === unitId));
	const chosenReadings = $derived(
		readings.filter(reading => unit?.readings.includes(reading) ?? false)
	);

	async function run(event: SubmitEvent) {
		event.preventDefault();
		if (!witness || !unit || running) return;
		running = true;
		error = null;
		try {
			result = await queries.findRelatives(witness, unit.id, chosenReadings);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Finding relatives failed.';
		} finally {
			running = false;
		}
	}
</script>

<div class="space-y-4">
	<form class="space-y-3" onsubmit={run}>
		<div
			class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[14rem_minmax(0,1fr)_minmax(0,1fr)]"
		>
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
				<span class="text-sm font-medium">Variation unit</span>
				<select class="select select-bordered w-full" bind:value={unitId}>
					<option value="" disabled>Choose a unit</option>
					{#each queries.units as option (option.id)}
						<option value={option.id}>{option.label}</option>
					{/each}
				</select>
			</label>
			<fieldset
				class="fieldset min-w-0 rounded-box border border-base-300 p-3 sm:col-span-2 lg:col-span-1"
			>
				<legend class="fieldset-legend">Readings</legend>
				{#if unit}
					<p class="text-xs text-base-content/60">None chosen includes every reading.</p>
					<div class="flex flex-wrap gap-x-3 gap-y-1">
						{#each unit.readings as reading (reading)}
							<label class="flex items-center gap-1.5 font-mono text-sm">
								<input
									type="checkbox"
									class="checkbox checkbox-xs"
									value={reading}
									bind:group={readings}
								/>
								{reading}
							</label>
						{/each}
					</div>
				{:else}
					<p class="text-xs text-base-content/60">Choose a unit to limit its readings.</p>
				{/if}
			</fieldset>
		</div>
		<button
			type="submit"
			class="btn btn-primary w-full sm:w-auto"
			disabled={!witness || !unit || running}
		>
			{running ? 'Finding...' : 'Find relatives'}
		</button>
	</form>

	{#if error}
		<div class="alert alert-error text-sm" role="alert">{error}</div>
	{:else if result}
		{@const table = result}
		<CbgmCoherenceTable {table} />
		<CbgmResultDownloads
			fileStem={resultFileStem(analysisName, 'find-relatives', table.primary_wit)}
			csv={() => toCsv(coherenceTableColumns(table), table.rows)}
			json={table}
		/>
	{/if}
</div>
