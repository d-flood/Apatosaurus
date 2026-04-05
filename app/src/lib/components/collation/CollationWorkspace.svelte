<script lang="ts">
	import { resolve } from '$app/paths';
	import { collationState } from '$lib/client/collation/collation-state.svelte';
	import CollationStepper from './CollationStepper.svelte';
	import AutoSaveIndicator from './AutoSaveIndicator.svelte';
	import SetupPhase from './SetupPhase.svelte';
	import AlignmentGrid from './AlignmentGrid.svelte';
	import ReadingsPhase from './ReadingsPhase.svelte';
	import StemmaPhase from './StemmaPhase.svelte';
	import ProjectCollationGate from './ProjectCollationGate.svelte';
	import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
</script>

<div class="flex flex-col h-[calc(100vh-4rem)]">
	<!-- Global Header -->
	<div class="shrink-0 bg-base-200/60 border-b border-base-300/50 px-4 py-3">
		<div class="flex items-center justify-between gap-4 max-w-7xl mx-auto">
			<div class="flex items-center gap-3">
				<a href={resolve('/collation')} class="btn btn-ghost btn-sm btn-circle" title="Back to collations">
					<ArrowLeft size={18} />
				</a>
				<h1 class="text-xl font-serif font-bold tracking-tight text-base-content/90">
					Collation
				</h1>
				{#if collationState.selectedVerse}
					<span class="text-sm text-base-content/50 font-mono">
						{collationState.selectedVerse.identifier}
					</span>
				{/if}
			</div>
			<div class="flex items-center gap-4">
				<CollationStepper />
				<div class="border-l border-base-300 pl-3">
					<AutoSaveIndicator />
				</div>
			</div>
		</div>
	</div>

	<!-- Phase Content -->
	<div class="flex-1 min-h-0 overflow-hidden">
		<div class="h-full w-full px-3 py-4 md:px-4">
			{#if collationState.phase === 'setup' && !collationState.collationId && !collationState.projectId}
				<ProjectCollationGate />
			{:else if collationState.phase === 'setup'}
				<SetupPhase />
			{:else if collationState.phase === 'readings'}
				<ReadingsPhase />
			{:else if collationState.phase === 'stemma'}
				<StemmaPhase />
			{:else}
				<AlignmentGrid />
			{/if}
		</div>
	</div>
</div>
