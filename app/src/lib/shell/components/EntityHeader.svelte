<script lang="ts">
	let {
		label,
		projectName,
	}: {
		label?: string;
		projectName: string | null | undefined;
	} = $props();

	const projectLabel = $derived(projectName?.trim() || 'Project unavailable');
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid="entity-header">
	{#if label}
		<span class="font-semibold text-base-content/80">{label}</span>
	{/if}
	<span class="badge badge-outline" data-testid="entity-project">Project: {projectLabel}</span>
</div>
