<script lang="ts">
	import type { CoherenceSettings } from '@apatosaurus/open-cbgm-wasm';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	import { isNotBackedUp } from '$lib/backup/sync-status';
	import {
		deleteAnalysis,
		recomputePrefill,
		startCbgmAnalysis,
		type CbgmAnalysisPrefill,
	} from '$lib/cbgm/cbgm-analysis-runs';
	import {
		coherenceBadge,
		coherenceLabel,
		countLabel,
		formatAnalysisTime,
		globalStemmaLabel,
	} from '$lib/cbgm/cbgm-analysis-labels';
	import {
		analysisCollationStatus,
		type CbgmAnalysisCollationStatus,
	} from '$lib/cbgm/cbgm-analysis-staleness';
	import CbgmAnalysisForm from '$lib/cbgm/components/CbgmAnalysisForm.svelte';
	import CbgmComputationProgress from '$lib/cbgm/components/CbgmComputationProgress.svelte';
	import CbgmStalenessNote from '$lib/cbgm/components/CbgmStalenessNote.svelte';
	import { parseProjectCollationSettings } from '$lib/collation/project-settings';
	import {
		listCbgmAnalyses,
		loadCbgmCollationSnapshots,
		readCbgmAnalysis,
		readCbgmCollationHashes,
		subscribeLocalDbInvalidations,
	} from '$lib/db/client';
	import type {
		CbgmAnalysisRow,
		CbgmCollationSnapshots,
	} from '$lib/db/repositories/cbgm-analyses';
	import type { ProjectRecord } from '$lib/db/repositories/projects';
	import type { CbgmAnalysisMetadata } from '$lib/storage/formats';
	import { listProjectLocations, listProjectPlacements } from '$lib/storage/project-locations';

	type AnalysisListRow = CbgmAnalysisRow & { id: string };
	type AnalysisListEntry = {
		row: AnalysisListRow;
		analysis: CbgmAnalysisMetadata | null;
		status: CbgmAnalysisCollationStatus | null;
	};
	type AnalysisListing = {
		projectId: string;
		entries: AnalysisListEntry[];
		locationLabel: string;
	};
	type Recompute = {
		projectId: string;
		from: string;
		removed: CbgmAnalysisMetadata['collations'];
		prefill: CbgmAnalysisPrefill;
	};

	let { data } = $props<{ data: { project: ProjectRecord } }>();

	let listing = $state.raw<AnalysisListing | null>(null);
	let snapshots = $state.raw<{ projectId: string; value: CbgmCollationSnapshots } | null>(null);
	let listingError = $state.raw<{ projectId: string; message: string } | null>(null);
	let collationsError = $state.raw<{ projectId: string; message: string } | null>(null);
	let recompute = $state.raw<Recompute | null>(null);
	let pendingDelete = $state.raw<{ projectId: string; row: AnalysisListRow } | null>(null);
	let deleteError = $state<string | null>(null);
	let isDeleting = $state(false);
	let deleteDialog = $state<HTMLDialogElement>();
	let formSection = $state<HTMLElement>();
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
	const manualWitnesses = $derived(
		parseProjectCollationSettings(data.project.collationSettings).manualWitnesses ?? []
	);
	const activeRecompute = $derived(recompute?.projectId === projectId ? recompute : null);
	const deleting = $derived(
		pendingDelete && pendingDelete.projectId === projectId ? pendingDelete.row : null
	);

	$effect(() => {
		void loadListing(projectId);
		void loadCollations(projectId);
	});

	onMount(() => {
		const unsubscribe = subscribeLocalDbInvalidations(({ domain }) => {
			if (
				['cbgm-analyses', 'collations', 'projects', 'sync-targets', 'all'].includes(domain)
			) {
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
			const metadata = await Promise.all(
				rows.map(row => readCbgmAnalysis(row.id).catch(() => null))
			);
			const current = await readCbgmCollationHashes(
				id,
				metadata.flatMap(
					analysis => analysis?.collations.map(collation => collation.collation_id) ?? []
				)
			);
			if (destroyed || runId !== listingRunId) return;
			const placement = placements.find(candidate => candidate.projectId === id);
			listing = {
				projectId: id,
				entries: rows.map((row, index) => {
					const analysis = metadata[index];
					return {
						row,
						analysis,
						status: analysis ? analysisCollationStatus(analysis, current) : null,
					};
				}),
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
		notifyOs: boolean;
		native: boolean;
	}) {
		await startCbgmAnalysis({ projectId: data.project.id, ...request });
		recompute = null;
	}

	function computeAgain(analysis: CbgmAnalysisMetadata, status: CbgmAnalysisCollationStatus) {
		recompute = {
			projectId: analysis.project_id,
			from: analysis.name,
			removed: analysis.collations.filter(collation =>
				status.deleted.includes(collation.collation_id)
			),
			prefill: recomputePrefill(analysis, status.deleted),
		};
		formSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function askDelete(row: AnalysisListRow) {
		pendingDelete = { projectId: data.project.id, row };
		deleteError = null;
		deleteDialog?.showModal();
	}

	async function confirmDelete() {
		if (!deleting || isDeleting) return;
		isDeleting = true;
		deleteError = null;
		try {
			await deleteAnalysis(deleting.project_id, deleting.id);
			deleteDialog?.close();
		} catch (err) {
			deleteError = errorMessage(err, 'Failed to delete the analysis.');
		} finally {
			isDeleting = false;
		}
	}

	function isComputing(row: Pick<AnalysisListRow, 'coherence' | 'global_stemma'>): boolean {
		return row.coherence === 'computing' || row.global_stemma === 'computing';
	}

	function inputCounts(analysis: CbgmAnalysisMetadata): string {
		return `${countLabel(analysis.collations.length, 'collation')} · ${countLabel(analysis.witnesses.length, 'witness', 'witnesses')}`;
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
	{:else if analyses.entries.length === 0}
		<div
			class="rounded-box border border-dashed border-base-300/80 p-4 text-sm text-base-content/55"
		>
			No analyses in this project yet.
		</div>
	{:else}
		<ul class="divide-y divide-base-300/60">
			{#each analyses.entries as { row, analysis, status } (row.id)}
				<li class="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
					<div class="min-w-0 space-y-0.5">
						<a
							href={resolve('/cbgm/[analysisId]', { analysisId: row.id })}
							class="link link-hover break-words font-serif font-medium"
						>
							{analysis?.name ?? 'Unavailable analysis'}
						</a>
						{#if analysis}
							<div class="text-xs text-base-content/55">
								Frozen {formatAnalysisTime(analysis.inputs_frozen_at)} · Completed {formatAnalysisTime(
									analysis.completed_at
								)}
							</div>
							<div class="text-xs text-base-content/55">
								{inputCounts(analysis)}
							</div>
							<CbgmComputationProgress analysisId={row.id} />
						{:else}
							<p class="text-sm text-error">
								Analysis metadata is missing or unreadable.
							</p>
						{/if}
						{#if analysis && status}
							<CbgmStalenessNote {analysis} {status} />
						{/if}
					</div>
					<div class="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
						{#if analysis}
							<span class="badge badge-sm {coherenceBadge(analysis.coherence)}">
								{coherenceLabel(analysis.coherence)}
							</span>
							<span class="badge badge-sm badge-ghost"
								>{globalStemmaLabel(analysis.global_stemma)}</span
							>
							{#if isComputing(analysis) && analysis.computing_device}
								<span class="text-xs text-base-content/60">
									by {analysis.computing_device.author_name}
								</span>
							{/if}
						{/if}
						<div class="flex w-full flex-wrap gap-1 sm:justify-end">
							<button
								type="button"
								class="btn btn-ghost btn-xs"
								disabled={!analysis || !status}
								onclick={() => analysis && status && computeAgain(analysis, status)}
							>
								Compute again
							</button>
							<button
								type="button"
								class="btn btn-ghost btn-xs text-error"
								onclick={() =>
									askDelete({
										...row,
										name: analysis?.name ?? 'Unavailable analysis',
									})}
							>
								Delete
							</button>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<div
	bind:this={formSection}
	class="scroll-mt-4 rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md"
>
	<h2 class="mb-3 font-serif text-lg font-semibold">New Analysis</h2>
	{#if activeRecompute}
		<div class="mb-3 space-y-1 rounded-box bg-base-200/70 p-3 text-sm">
			<p>
				Prefilled from <span class="font-medium">{activeRecompute.from}</span>.
				<button type="button" class="link" onclick={() => (recompute = null)}>
					Start blank
				</button>
			</p>
			{#each activeRecompute.removed as collation (collation.collation_id)}
				<p class="text-base-content/70">
					{collation.segment_name} was deleted since that analysis was frozen, so it is left
					out.
				</p>
			{/each}
		</div>
	{/if}
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
			{#key activeRecompute}
				<CbgmAnalysisForm
					collations={collations.collations}
					unavailable={collations.unavailable}
					existingNames={analyses?.entries.map(({ row }) => row.name) ?? []}
					{readingTypes}
					{manualWitnesses}
					prefill={activeRecompute?.prefill}
					onStart={start}
				/>
			{/key}
		{/if}
	{/key}
</div>

<dialog
	bind:this={deleteDialog}
	class="modal"
	aria-label="Delete analysis"
	oncancel={event => isDeleting && event.preventDefault()}
>
	<div class="modal-box w-full max-w-md space-y-3">
		<h3 class="font-serif text-lg font-bold">Delete analysis</h3>
		{#if deleting}
			<p class="text-sm text-base-content/70">
				This deletes <span class="font-medium">{deleting.name}</span> and its results from
				this project. It can't be undone.
				{#if isComputing(deleting)}
					Its computation stops, and progress saved on this device is discarded.
				{/if}
			</p>
		{/if}
		{#if deleteError}
			<div class="alert alert-error text-sm" role="alert">{deleteError}</div>
		{/if}
		<div class="modal-action mt-2 flex-wrap">
			<button
				type="button"
				class="btn btn-sm btn-ghost"
				disabled={isDeleting}
				onclick={() => deleteDialog?.close()}
			>
				Cancel
			</button>
			<button
				type="button"
				class="btn btn-sm btn-error"
				disabled={isDeleting || !deleting}
				onclick={confirmDelete}
			>
				{#if isDeleting}<span class="loading loading-spinner loading-xs"></span>{/if}
				Delete analysis
			</button>
		</div>
	</div>
</dialog>
