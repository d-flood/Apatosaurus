<script lang="ts">
	import { computationStateLabel, countLabel, phaseLabel } from '$lib/cbgm/cbgm-analysis-labels';
	import { analysisComputation, isComputing } from '$lib/cbgm/cbgm-progress';
	import { cbgmScheduler } from '$lib/cbgm/cbgm-scheduler.svelte';

	let { analysisId }: { analysisId: string } = $props();

	const computation = $derived(
		analysisComputation(cbgmScheduler.progress, cbgmScheduler.queue, analysisId)
	);
</script>

{#if computation}
	<div class="space-y-1 text-xs">
		<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
			<span class="font-medium">{phaseLabel(computation.phase)}</span>
			<span
				class={[
					'badge badge-xs',
					computation.state === 'paused' ? 'badge-warning' : 'badge-info',
				]}
			>
				{computationStateLabel(computation.state)}
			</span>
			{#if computation.state === 'queued'}
				<span class="text-base-content/60">Position {computation.position} in queue</span>
			{:else if computation.total > 0}
				<span class="text-base-content/60">
					{computation.done} of {countLabel(computation.total, 'witness', 'witnesses')}
				</span>
			{:else if computation.done > 0}
				<span class="text-base-content/60">
					{countLabel(computation.done, 'witness', 'witnesses')} done
				</span>
			{/if}
		</div>
		{#if computation.state !== 'queued'}
			{#if computation.total > 0}
				<progress
					class="progress progress-info w-full max-w-xs"
					value={computation.done}
					max={computation.total}
					aria-label="{phaseLabel(computation.phase)} progress"
				></progress>
			{/if}
			{#if computation.currentWitnesses.length > 0}
				<p class="break-words text-base-content/60">
					In progress: <span class="font-mono"
						>{computation.currentWitnesses.join(', ')}</span
					>
				</p>
			{/if}
			{#if isComputing(computation)}
				<p class="text-base-content/60">
					Sleep or closing the laptop pauses this; it resumes when you return.
				</p>
			{/if}
		{/if}
	</div>
{/if}
