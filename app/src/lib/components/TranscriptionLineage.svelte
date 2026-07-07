<script lang="ts">
	import type { ProjectTranscriptionStatus } from '$lib/client/db/repositories/projects';

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
		const revision = origin?.sourceRevisionId || origin?.sourceContentHash || '';
		return revision ? shortRevisionId(revision) : 'uncommitted source';
	});
	const sourceStateText = $derived.by(() => {
		const state = status?.sourceState.kind;
		if (state === 'newer-source-available') return 'Newer source available';
		if (state === 'source-missing') return 'Source unavailable';
		if (state === 'source-has-no-committed-version') return 'Source has no committed version';
		if (state === 'source-has-uncommitted-changes') return 'Source has uncommitted changes';
		if (state === 'up-to-date') return 'Source current';
		return '';
	});

	function shortRevisionId(revisionId: string): string {
		return revisionId.length <= 12 ? revisionId : `${revisionId.slice(0, 8)}...`;
	}
</script>

{#if hasLineage}
	<div class="text-xs text-base-content/70" data-testid="transcription-lineage">
		<span>Copied from {sourceProjectLabel} @ {sourceRevisionLabel}</span>
		{#if sourceStateText}
			<span
				class="ml-2 badge badge-sm"
				class:badge-warning={status?.sourceState.kind === 'newer-source-available'}
				class:badge-error={status?.sourceState.kind === 'source-missing'}
				data-testid="transcription-lineage-state"
			>
				{sourceStateText}
			</span>
		{/if}
	</div>
{/if}
