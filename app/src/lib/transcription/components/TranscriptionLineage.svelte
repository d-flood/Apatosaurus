<script lang="ts">
	import type { ProjectTranscriptionStatus } from '$lib/db/repositories/projects';
	import { formatSourceDate } from '$lib/shell/source-labels';

	let { status }: { status: ProjectTranscriptionStatus | null | undefined } = $props();

	const origin = $derived(status?.immediateSource ?? null);
	const hasLineage = $derived(!!origin);
	const sourceProjectLabel = $derived.by(() => {
		return (
			status?.canonicalSource?.projectName?.trim() ||
			origin?.sourceProjectName?.trim() ||
			origin?.sourceProjectId ||
			'source unavailable'
		);
	});
	const sourceRevisionLabel = $derived.by(() => {
		if (origin?.sourceRevisionId) return origin.sourceVersionLabel || 'Named version';
		return origin?.sourceCapturedAt
			? `Current as of ${formatSourceDate(origin.sourceCapturedAt)}`
			: 'Current';
	});
	const sourceStateText = $derived.by(() => {
		const state = status?.sourceState.kind;
		if (state === 'source-changed') return 'Source changed';
		if (state === 'source-missing') return 'Source unavailable';
		if (state === 'up-to-date') return 'Source current';
		return '';
	});
</script>

{#if hasLineage}
	<div class="text-xs text-base-content/70" data-testid="transcription-lineage">
		<span>Copied from {sourceProjectLabel} @ {sourceRevisionLabel}</span>
		{#if sourceStateText}
			<span
				class="ml-2 badge badge-sm"
				class:badge-warning={status?.sourceState.kind === 'source-changed'}
				class:badge-error={status?.sourceState.kind === 'source-missing'}
				data-testid="transcription-lineage-state"
			>
				{sourceStateText}
			</span>
		{/if}
	</div>
{/if}
