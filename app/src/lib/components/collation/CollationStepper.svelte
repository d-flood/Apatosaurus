<script lang="ts">
import { collationState, type CollationPhase } from '$lib/client/collation/collation-state.svelte';
import Crosshair from 'phosphor-svelte/lib/Crosshair';
import ListBullets from 'phosphor-svelte/lib/ListBullets';
import Table from 'phosphor-svelte/lib/Table';
import TreeStructure from 'phosphor-svelte/lib/TreeStructure';

const steps: { phase: CollationPhase; label: string; icon: typeof Crosshair }[] = [
	{ phase: 'setup', label: 'Setup', icon: Crosshair },
	{ phase: 'alignment', label: 'Alignment', icon: Table },
	{ phase: 'readings', label: 'Readings', icon: ListBullets },
	{ phase: 'stemma', label: 'Stemma', icon: TreeStructure },
];

const phaseOrder: CollationPhase[] = ['setup', 'alignment', 'readings', 'stemma'];

function displayPhase(phase: CollationPhase): CollationPhase {
	return phase === 'regularization' ? 'alignment' : phase;
}

function isCompleted(stepPhase: CollationPhase): boolean {
	return phaseOrder.indexOf(stepPhase) < phaseOrder.indexOf(displayPhase(collationState.furthestPhase));
}

function isCurrent(stepPhase: CollationPhase): boolean {
	return stepPhase === displayPhase(collationState.phase);
}

	function canNavigateTo(stepPhase: CollationPhase): boolean {
		return collationState.canNavigateTo(stepPhase);
	}

function phaseHref(stepPhase: CollationPhase): string {
	if (collationState.collationId) {
		return `/collation/${collationState.collationId}/${stepPhase}`;
		}
		return stepPhase === 'setup' ? '/collation/new' : '#';
	}
</script>

<div class="flex items-center gap-0 w-full" role="navigation" aria-label="Collation workflow steps">
	{#each steps as step, i (step.phase)}
		{@const completed = isCompleted(step.phase)}
		{@const current = isCurrent(step.phase)}
		{@const navigable = canNavigateTo(step.phase)}

		{#if i > 0}
			<div
				class="flex-1 h-px mx-1 transition-colors duration-300"
				class:bg-primary={completed}
				class:bg-base-300={!completed}
			></div>
		{/if}

		<a
			href={phaseHref(step.phase)}
			class="group flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
			class:bg-primary={current}
			class:text-primary-content={current}
			class:hover:bg-base-200={!current && navigable}
			class:opacity-40={!navigable}
			class:cursor-not-allowed={!navigable}
			aria-disabled={!navigable}
			tabindex={navigable ? 0 : -1}
			onclick={(e) => {
				if (!navigable) {
					e.preventDefault();
				}
			}}
			aria-current={current ? 'step' : undefined}
		>
			<div
				class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-200 shrink-0 {current ? 'bg-primary-content text-primary' : completed ? 'bg-primary text-primary-content' : 'bg-base-300 text-base-content/60'}"
			>
				{#if step.phase === 'stemma' || completed}
					<svelte:component this={step.icon} size={14} weight="bold" />
				{:else}
					{i + 1}
				{/if}
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
