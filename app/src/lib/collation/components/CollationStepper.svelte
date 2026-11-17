<script lang="ts">
	import { collationState, type CollationPhase } from '$lib/collation/collation-state.svelte';

	const steps: { phase: CollationPhase; label: string }[] = [
		{ phase: 'setup', label: 'Setup' },
		{ phase: 'alignment', label: 'Alignment' },
		{ phase: 'readings', label: 'Readings' },
		{ phase: 'stemma', label: 'Stemma' },
		{ phase: 'review', label: 'Review' },
	];

	function phaseHref(stepPhase: CollationPhase): string {
		if (collationState.collationId) {
			return `/collation/${collationState.collationId}/${stepPhase}`;
		}
		return stepPhase === 'setup' ? '/collation/new' : '#';
	}
</script>

<div class="flex items-center gap-0 w-full" role="navigation" aria-label="Collation workflow steps">
	{#each steps as step, i (step.phase)}
		{@const current = step.phase === collationState.phase}
		{@const navigable = collationState.canNavigateTo(step.phase)}

		{#if i > 0}
			<div class="flex-1 h-px mx-1 bg-base-300"></div>
		{/if}

		<a
			href={phaseHref(step.phase)}
			aria-label={step.label}
			class="group flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
			class:bg-primary={current}
			class:text-primary-content={current}
			class:hover:bg-base-200={!current && navigable}
			class:opacity-40={!navigable}
			class:cursor-not-allowed={!navigable}
			aria-disabled={!navigable}
			tabindex={navigable ? 0 : -1}
			onclick={e => {
				if (!navigable) {
					e.preventDefault();
				}
			}}
			aria-current={current ? 'step' : undefined}
		>
			<div
				class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-200 shrink-0 {current
					? 'bg-primary-content text-primary'
					: 'bg-base-300 text-base-content/60'}"
			>
				{i + 1}
			</div>
			<span
				class="text-sm font-medium hidden sm:inline whitespace-nowrap"
				class:font-bold={current}
			>
				{step.label}
			</span>
		</a>
	{/each}
</div>
