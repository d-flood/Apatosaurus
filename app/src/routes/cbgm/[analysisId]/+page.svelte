<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	import {
		coherenceBadge,
		coherenceLabel,
		formatAnalysisTime,
		globalStemmaLabel,
		undecidedReadingsLabel,
	} from '$lib/cbgm/cbgm-analysis-labels';
	import { BUNDLED_READING_TYPES, findReadingTypeDefinition } from '$lib/collation/reading-types';
	import { subscribeLocalDbInvalidations } from '$lib/db/client';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const analysis = $derived(data.analysis);
	const settings = $derived(analysis.settings);
	const settingsSummary = $derived([
		{
			label: 'Rules',
			value: settings.classic_rules ? 'Classic CBGM' : 'open-cbgm standard',
		},
		{
			label: 'Split readings',
			value: settings.merge_split_readings ? 'Count as agreeing' : 'Count separately',
		},
		{ label: 'Minimum extant units', value: settings.min_extant_units ?? 'None' },
		{ label: 'Minimum extant proportion', value: settings.min_extant_proportion ?? 'None' },
		{
			label: 'Correctors',
			value: settings.included_correctors.join(', ') || 'First hands only',
		},
		{ label: 'Excluded witnesses', value: settings.excluded_witnesses.join(', ') || 'None' },
		{
			label: 'Dropped reading types',
			value:
				settings.dropped_reading_types
					.map(id => findReadingTypeDefinition(BUNDLED_READING_TYPES, id)?.label ?? id)
					.join(', ') || 'None',
		},
		{
			label: 'Collations',
			value: analysis.collations.map(collation => collation.segment_name).join(', '),
		},
		{ label: 'Witnesses', value: analysis.witnesses.length },
	]);

	onMount(() =>
		subscribeLocalDbInvalidations(({ domain }) => {
			if (domain === 'cbgm-analyses' || domain === 'projects' || domain === 'all') {
				void invalidate('app:cbgm-analysis');
			}
		})
	);
</script>

<div class="container mx-auto max-w-6xl space-y-6 p-4">
	<header class="space-y-3 rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
		<div>
			<a
				href={resolve('/projects/[id]/cbgm', { id: analysis.project_id })}
				class="link link-hover text-xs text-base-content/55"
			>
				CBGM analyses
			</a>
			<h1 class="break-words font-serif text-xl font-semibold">{analysis.name}</h1>
		</div>

		<div class="flex flex-wrap items-center gap-1.5">
			<span class="badge badge-sm {coherenceBadge(analysis.coherence)}">
				{coherenceLabel(analysis.coherence)}
			</span>
			<span class="badge badge-sm badge-ghost"
				>{globalStemmaLabel(analysis.global_stemma)}</span
			>
			{#if analysis.computing_device}
				<span class="text-xs text-base-content/60">
					by {analysis.computing_device.author_name}
				</span>
			{/if}
		</div>

		<dl class="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
			<div class="flex flex-wrap gap-x-2">
				<dt class="text-base-content/55">Frozen</dt>
				<dd>{formatAnalysisTime(analysis.inputs_frozen_at)}</dd>
			</div>
			<div class="flex flex-wrap gap-x-2">
				<dt class="text-base-content/55">Completed</dt>
				<dd>{formatAnalysisTime(analysis.completed_at)}</dd>
			</div>
		</dl>

		<p class="text-sm">{undecidedReadingsLabel(analysis.undecided_readings.length)}</p>

		{#if analysis.failure}
			<div class="alert alert-error text-sm" role="alert">{analysis.failure}</div>
		{/if}

		<dl
			class="grid grid-cols-1 gap-x-6 gap-y-1 border-t border-base-300/60 pt-3 text-xs sm:grid-cols-2"
		>
			{#each settingsSummary as item (item.label)}
				<div class="flex min-w-0 flex-wrap gap-x-2">
					<dt class="text-base-content/55">{item.label}</dt>
					<dd class="min-w-0 break-words">{item.value}</dd>
				</div>
			{/each}
		</dl>
	</header>

	<section
		class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md"
		aria-labelledby="cbgm-tools-heading"
	>
		<h2 id="cbgm-tools-heading" class="font-serif text-lg font-semibold">Tools</h2>
		{#if analysis.coherence !== 'ready'}
			<p class="mt-1 text-sm text-base-content/55">Tools open once coherence is ready.</p>
		{/if}
	</section>
</div>
