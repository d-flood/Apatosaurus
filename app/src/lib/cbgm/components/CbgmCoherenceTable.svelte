<script lang="ts">
	import type { CompareWitnessesTable, FindRelativesTable } from '@apatosaurus/open-cbgm-wasm';

	import { coherenceTableColumns } from '$lib/cbgm/cbgm-query-tables';

	let { table }: { table: CompareWitnessesTable | FindRelativesTable } = $props();

	const columns = $derived(coherenceTableColumns(table));
	const hasUndecided = $derived(table.rows.some(row => row.undecided > 0));
</script>

<div class="min-w-0 space-y-2">
	<p class="text-sm">
		Genealogical comparisons for <span class="font-mono">{table.primary_wit}</span>
		({table.primary_extant} extant units)
		{#if 'primary_rdg' in table}
			at {table.label}, where it reads <span class="font-mono">{table.primary_rdg}</span>
		{/if}
	</p>
	<div class="overflow-x-auto rounded-box border border-base-300">
		<table class="table table-sm table-zebra whitespace-nowrap">
			<thead>
				<tr>
					{#each columns as column (column.header)}
						<th scope="col">{column.header}</th>
					{/each}
				</tr>
			</thead>
			<tbody class="font-mono">
				{#each table.rows as row (row.id)}
					<tr>
						{#each columns as column (column.header)}
							<td>{column.value(row)}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if hasUndecided}
		<p class="text-xs text-base-content/60">
			Undecided counts places where a source decision hasn't been made yet.
		</p>
	{/if}
</div>
