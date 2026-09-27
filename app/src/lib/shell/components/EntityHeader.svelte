<script lang="ts">
	type CommitState = 'never-committed' | 'clean' | 'dirty';

	let {
		label,
		projectName,
		commitState,
		checkpointRevisionId = null,
	}: {
		label?: string;
		projectName: string | null | undefined;
		commitState: CommitState | null | undefined;
		checkpointRevisionId?: string | null;
	} = $props();

	const projectLabel = $derived(projectName?.trim() || 'Project unavailable');
	const commitStateText = $derived.by(() => {
		if (commitState === 'never-committed') return 'No committed version yet';
		if (commitState === 'dirty') return 'Uncommitted changes';
		if (commitState === 'clean') return 'Committed';
		return 'Commit state unavailable';
	});
	const checkpointText = $derived.by(() => {
		if (!checkpointRevisionId) return '';
		return `Revision ${shortRevisionId(checkpointRevisionId)}`;
	});

	function shortRevisionId(revisionId: string): string {
		return revisionId.length <= 12 ? revisionId : `${revisionId.slice(0, 8)}...`;
	}
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid="entity-header">
	{#if label}
		<span class="font-semibold text-base-content/80">{label}</span>
	{/if}
	<span class="badge badge-outline" data-testid="entity-project">Project: {projectLabel}</span>
	<span class="badge" class:badge-warning={commitState === 'dirty'} data-testid="entity-commit-state">
		{commitStateText}
	</span>
	{#if checkpointText}
		<span class="font-mono text-xs text-base-content/60" data-testid="entity-revision">
			{checkpointText}
		</span>
	{/if}
</div>
