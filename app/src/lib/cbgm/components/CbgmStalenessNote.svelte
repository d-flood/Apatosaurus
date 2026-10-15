<script lang="ts">
	import Warning from 'phosphor-svelte/lib/Warning';

	import type { CbgmAnalysisCollationStatus } from '$lib/cbgm/cbgm-analysis-staleness';
	import type { CbgmAnalysisMetadata } from '$lib/storage/formats';

	interface Props {
		analysis: CbgmAnalysisMetadata;
		status: CbgmAnalysisCollationStatus;
	}

	let { analysis, status }: Props = $props();

	function names(ids: string[]): string {
		return ids
			.map(
				id =>
					analysis.collations.find(collation => collation.collation_id === id)
						?.segment_name ?? id
			)
			.join(', ');
	}
</script>

{#if status.changed.length > 0 || status.deleted.length > 0}
	<p class="flex items-start gap-1.5 text-xs text-base-content/70">
		<Warning size={14} class="mt-px shrink-0 text-warning" />
		<span class="min-w-0 break-words">
			Out of date.
			{#if status.changed.length > 0}
				Changed since frozen: {names(status.changed)}.
			{/if}
			{#if status.deleted.length > 0}
				Deleted since frozen: {names(status.deleted)}.
			{/if}
		</span>
	</p>
{/if}
{#if status.unavailable.length > 0}
	<p class="flex items-start gap-1.5 text-xs text-base-content/70">
		<Warning size={14} class="mt-px shrink-0 text-error" />
		<span class="min-w-0 break-words">
			Unavailable, so not checked: {names(status.unavailable)}.
		</span>
	</p>
{/if}
