<script lang="ts">
	import { cancelGlobalStemma, startGlobalStemma } from '$lib/cbgm/cbgm-analysis-runs';
	import { analysisComputation } from '$lib/cbgm/cbgm-progress';
	import type { CbgmQueries } from '$lib/cbgm/cbgm-queries';
	import { resultFileStem } from '$lib/cbgm/cbgm-query-tables';
	import { cbgmScheduler } from '$lib/cbgm/cbgm-scheduler.svelte';
	import type { GlobalStemmaOptions } from '$lib/cbgm/cbgm-worker-types';
	import type { CbgmAnalysisMetadata } from '$lib/storage/formats';
	import CbgmNotifyOsOption from './CbgmNotifyOsOption.svelte';
	import GraphView from './GraphView.svelte';

	let { analysis, queries }: { analysis: CbgmAnalysisMetadata; queries: CbgmQueries } = $props();

	let strengths = $state(false);
	let lengths = $state(false);
	let notifyOs = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let drawn = $state.raw<{
		options: GlobalStemmaOptions;
		dot: string | null;
		error: string | null;
	} | null>(null);

	const ready = $derived(analysis.global_stemma === 'ready');
	const options = $derived<GlobalStemmaOptions>({ strengths, lengths });
	const computation = $derived(
		analysisComputation(cbgmScheduler.progress, cbgmScheduler.queue, analysis.id)
	);
	const computingHere = $derived(computation?.phase === 'global-stemma');
	const shown = $derived(
		drawn
			? [drawn.options.lengths && 'costs', drawn.options.strengths && 'strengths'].filter(
					part => part !== false
				)
			: []
	);
	const title = $derived(
		shown.length > 0 ? `Global stemma with ${shown.join(' and ')}` : 'Global stemma'
	);

	$effect(() => {
		if (ready) void draw(queries, options);
	});

	async function draw(source: CbgmQueries, requested: GlobalStemmaOptions) {
		let next: NonNullable<typeof drawn>;
		try {
			next = { options: requested, dot: await source.globalStemma(requested), error: null };
		} catch (err) {
			const message =
				err instanceof Error ? err.message : 'Drawing the global stemma failed.';
			next = { options: requested, dot: null, error: message };
		}
		if (source === queries && requested === options) drawn = next;
	}

	async function act(action: () => Promise<void>, failure: string) {
		busy = true;
		error = null;
		try {
			await action();
		} catch (err) {
			error = err instanceof Error ? err.message : failure;
		} finally {
			busy = false;
		}
	}
</script>

<div class="space-y-4">
	{#if ready}
		<div class="flex flex-wrap gap-x-5 gap-y-2">
			<label class="flex w-fit items-center gap-2 text-sm">
				<input type="checkbox" class="checkbox checkbox-sm" bind:checked={strengths} />
				Show strengths
			</label>
			<label class="flex w-fit items-center gap-2 text-sm">
				<input type="checkbox" class="checkbox checkbox-sm" bind:checked={lengths} />
				Show costs
			</label>
		</div>
		{#if drawn?.error}
			<div class="alert alert-error text-sm" role="alert">{drawn.error}</div>
		{:else if drawn?.dot}
			<GraphView
				dot={drawn.dot}
				{title}
				filenameBase={resultFileStem(
					analysis.name,
					'global-stemma',
					shown.join('-') || 'plain'
				)}
			/>
		{:else}
			<p class="flex items-center gap-2 text-sm text-base-content/60">
				<span class="loading loading-spinner loading-sm"></span>
				Assembling the global stemma...
			</p>
		{/if}
	{:else if computingHere}
		<p class="text-sm">
			Computing the global stemma on this device. Each witness's substemma is saved as soon as
			it's optimized, so an interrupted computation resumes where it stopped.
		</p>
		{#if computation?.state !== 'writing'}
			<button
				type="button"
				class="btn btn-sm w-full sm:w-auto"
				disabled={busy}
				onclick={() => act(() => cancelGlobalStemma(analysis), 'Cancelling failed.')}
			>
				Cancel
			</button>
		{/if}
	{:else if analysis.global_stemma !== 'imported-dot'}
		<p class="text-sm text-base-content/70">
			{#if analysis.global_stemma === 'computing' && analysis.computing_device}
				{analysis.computing_device.author_name} started computing the global stemma. You can still
				compute it on this device.
			{:else}
				Optimizes every witness's substemma, then assembles them into the global stemma.
				This can take a long time; each witness is saved as soon as it's optimized, so an
				interrupted computation resumes.
			{/if}
		</p>
		<CbgmNotifyOsOption bind:checked={notifyOs} />
		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				class="btn btn-primary w-full sm:w-auto"
				disabled={busy}
				onclick={() => act(() => startGlobalStemma(analysis, notifyOs), 'Starting failed.')}
			>
				Compute global stemma
			</button>
			{#if analysis.failure}
				<button
					type="button"
					class="btn w-full sm:w-auto"
					disabled={busy}
					onclick={() => act(() => cancelGlobalStemma(analysis), 'Discarding failed.')}
				>
					Discard saved progress
				</button>
			{/if}
		</div>
	{/if}
	{#if error}
		<div class="alert alert-error text-sm" role="alert">{error}</div>
	{/if}
</div>
