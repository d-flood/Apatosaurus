<script lang="ts">
	import type { CoherenceSettings } from '@apatosaurus/open-cbgm-wasm';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	import { isNotBackedUp } from '$lib/backup/sync-status';
	import { startCbgmAnalysis } from '$lib/cbgm/cbgm-analysis-runs';
	import {
		coherenceBadge,
		coherenceLabel,
		countLabel,
		formatAnalysisTime,
		globalStemmaLabel,
	} from '$lib/cbgm/cbgm-analysis-labels';
	import CbgmAnalysisForm from '$lib/cbgm/components/CbgmAnalysisForm.svelte';
	import { parseProjectCollationSettings } from '$lib/collation/project-settings';
	import {
		listCbgmAnalyses,
		loadCbgmCollationSnapshots,
		readCbgmAnalysis,
		subscribeLocalDbInvalidations,
	} from '$lib/db/client';
	import type {
		CbgmAnalysisRow,
		CbgmCollationSnapshots,
	} from '$lib/db/repositories/cbgm-analyses';
	import type { ProjectRecord } from '$lib/db/repositories/projects';
	import { listProjectLocations, listProjectPlacements } from '$lib/storage/project-locations';

	type AnalysisListRow = CbgmAnalysisRow & { id: string };
	type AnalysisListing = {
		projectId: string;
		rows: AnalysisListRow[];
		computingAuthors: Map<string, string | null>;
		locationLabel: string;
	};

	let { data } = $props<{ data: { project: ProjectRecord } }>();

	let listing = $state.raw<AnalysisListing | null>(null);
	let snapshots = $state.raw<{ projectId: string; value: CbgmCollationSnapshots } | null>(null);
	let listingError = $state.raw<{ projectId: string; message: string } | null>(null);
	let collationsError = $state.raw<{ projectId: string; message: string } | null>(null);
	let listingRunId = 0;
	let collationsRunId = 0;
	let destroyed = false;

	const projectId = $derived(data.project.id);
	const analyses = $derived(listing && listing.projectId === projectId ? listing : null);
	const collations = $derived(
		snapshots && snapshots.projectId === projectId ? snapshots.value : null
	);
	const listingErrorMessage = $derived(
		listingError && listingError.projectId === projectId ? listingError.message : null
	);
	const collationsErrorMessage = $derived(
		collationsError && collationsError.projectId === projectId ? collationsError.message : null
	);
	const readingTypes = $derived(
		parseProjectCollationSettings(data.project.collationSettings).readingTypes ?? []
	);

	$effect(() => {
		void loadListing(projectId);
		void loadCollations(projectId);
	});

	onMount(() => {
		const unsubscribe = subscribeLocalDbInvalidations(({ domain }) => {
			if (['cbgm-analyses', 'projects', 'sync-targets', 'all'].includes(domain)) {
				void loadListing(data.project.id);
			}
			if (['collations', 'projects', 'all'].includes(domain)) {
				void loadCollations(data.project.id);
			}
		});
		return () => {
			destroyed = true;
			unsubscribe();
		};
	});

	async function loadListing(id: string) {
		const runId = ++listingRunId;
		try {
			const [indexRows, placements, locations] = await Promise.all([
				listCbgmAnalyses(id),
				listProjectPlacements(),
				listProjectLocations(),
			]);
			const rows = indexRows.map(row => ({ ...row, id: row.id ?? '' }));
			const computingAuthors = new Map<string, string | null>();
			for (const row of rows.filter(isComputing)) {
				const metadata = await readCbgmAnalysis(row.id).catch(() => null);
				computingAuthors.set(row.id, metadata?.computing_device?.author_name ?? null);
			}
			if (destroyed || runId !== listingRunId) return;
			const placement = placements.find(candidate => candidate.projectId === id);
			listing = {
				projectId: id,
				rows,
				computingAuthors,
				locationLabel: isNotBackedUp(placement)
					? 'Not backed up'
					: (locations.find(location => location.id === placement?.locationId)
							?.displayPath ?? 'Needs attention'),
			};
			listingError = null;
		} catch (err) {
			if (destroyed || runId !== listingRunId) return;
			listingError = { projectId: id, message: errorMessage(err, 'Failed to load analyses') };
		}
	}

	async function loadCollations(id: string) {
		const runId = ++collationsRunId;
		try {
			const value = await loadCbgmCollationSnapshots(id);
			if (destroyed || runId !== collationsRunId) return;
			snapshots = { projectId: id, value };
			collationsError = null;
		} catch (err) {
			if (destroyed || runId !== collationsRunId) return;
			collationsError = {
				projectId: id,
				message: errorMessage(err, 'Failed to load collations'),
			};
		}
	}

	async function start(request: {
		name: string;
		collationIds: string[];
		settings: CoherenceSettings;
	}) {
		await startCbgmAnalysis({ projectId: data.project.id, ...request });
	}

	function isComputing(row: AnalysisListRow): boolean {
		return row.coherence === 'computing' || row.global_stemma === 'computing';
	}

	function inputCounts(row: AnalysisListRow): string {
		const collations = (JSON.parse(row.collation_ids) as string[]).length;
		return `${countLabel(collations, 'collation')} · ${countLabel(row.witness_count, 'witness', 'witnesses')}`;
	}

	function errorMessage(err: unknown, fallback: string): string {
		return err instanceof Error ? err.message : fallback;
	}
</script>

<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<div class="mb-3">
		<h2 class="font-serif text-lg font-semibold">CBGM Analyses</h2>
		{#if analyses}
			<p class="text-xs text-base-content/50">
				Saved with this project · {analyses.locationLabel}
			</p>
		{/if}
	</div>

	{#if listingErrorMessage}
		<div class="alert alert-error mb-3 text-sm">{listingErrorMessage}</div>
	{/if}

	{#if !analyses}
		<div
			class="flex items-center gap-2 rounded-box bg-base-200/70 p-4 text-sm text-base-content/60"
		>
			<span class="loading loading-spinner loading-sm"></span>
			Loading analyses...
		</div>
	{:else if analyses.rows.length === 0}
		<div
			class="rounded-box border border-dashed border-base-300/80 p-4 text-sm text-base-content/55"
		>
			No analyses in this project yet.
		</div>
	{:else}
		<ul class="divide-y divide-base-300/60">
			{#each analyses.rows as row (row.id)}
				<li class="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
					<div class="min-w-0 space-y-0.5">
						<a
							href={resolve('/cbgm/[analysisId]', { analysisId: row.id })}
							class="link link-hover break-words font-serif font-medium"
						>
							{row.name}
						</a>
						<div class="text-xs text-base-content/55">
							Frozen {formatAnalysisTime(row.inputs_frozen_at)} · Completed {formatAnalysisTime(
								row.completed_at
							)}
						</div>
						<div class="text-xs text-base-content/55">
							{inputCounts(row)}
						</div>
					</div>
					<div class="flex flex-wrap items-center gap-1.5 sm:justify-end">
						<span class="badge badge-sm {coherenceBadge(row.coherence)}">
							{coherenceLabel(row.coherence)}
						</span>
						<span class="badge badge-sm badge-ghost"
							>{globalStemmaLabel(row.global_stemma)}</span
						>
						{#if isComputing(row) && analyses.computingAuthors.get(row.id)}
							<span class="text-xs text-base-content/60">
								by {analyses.computingAuthors.get(row.id)}
							</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<h2 class="mb-3 font-serif text-lg font-semibold">New Analysis</h2>
	{#key projectId}
		{#if collationsErrorMessage}
			<div class="alert alert-error text-sm">{collationsErrorMessage}</div>
		{:else if !collations}
			<div
				class="flex items-center gap-2 rounded-box bg-base-200/70 p-4 text-sm text-base-content/60"
			>
				<span class="loading loading-spinner loading-sm"></span>
				Loading collations...
			</div>
		{:else}
			<CbgmAnalysisForm
				collations={collations.collations}
				unavailable={collations.unavailable}
				existingNames={analyses?.rows.map(row => row.name) ?? []}
				{readingTypes}
				onStart={start}
			/>
		{/if}
	{/key}
</div>
