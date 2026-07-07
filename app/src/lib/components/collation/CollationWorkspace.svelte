<script lang="ts">
	import { resolve } from '$app/paths';
	import { collationState } from '$lib/client/collation/collation-state.svelte';
	import {
		createCommittedCollationCheckpoint,
		getCollationVersionStatus,
		subscribeLocalDbInvalidations,
	} from '$lib/client/db/client';
	import type {
		CollationVersionStatus,
		CollationWitnessSourceStatus,
	} from '$lib/client/db/repositories/collations';
	import CollationStepper from './CollationStepper.svelte';
	import AutoSaveIndicator from './AutoSaveIndicator.svelte';
	import EntityHeader from '$lib/components/EntityHeader.svelte';
	import SetupPhase from './SetupPhase.svelte';
	import AlignmentGrid from './AlignmentGrid.svelte';
	import ReadingsPhase from './ReadingsPhase.svelte';
	import StemmaPhase from './StemmaPhase.svelte';
	import ProjectCollationGate from './ProjectCollationGate.svelte';
	import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
	import GitCommit from 'phosphor-svelte/lib/GitCommit';

	let collationVersionStatus = $state<CollationVersionStatus | null>(null);
	let versionStatusError = $state<string | null>(null);
	let isCommitFormOpen = $state(false);
	let commitMessage = $state('');
	let commitInFlight = $state(false);
	let commitError = $state<string | null>(null);
	let commitSuccess = $state<string | null>(null);
	let bulkRefreshInFlight = $state(false);
	let bulkRefreshError = $state<string | null>(null);

	const canCommitVersion = $derived(
		!!collationState.collationId &&
			!commitInFlight &&
			!!collationVersionStatus &&
			(collationVersionStatus.commitState === 'never-committed' ||
				collationVersionStatus.commitState === 'dirty')
	);

	const commitDisabledReason = $derived.by(() => {
		if (!collationState.collationId) return 'No collation loaded.';
		if (!collationVersionStatus) return 'Version status is loading.';
		if (commitInFlight) return 'Committing version.';
		if (collationVersionStatus.commitState === 'clean') {
			return 'No changes since the last committed version.';
		}
		return '';
	});

	const witnessSourceSummary = $derived.by(() => {
		const witnessStatuses = collationVersionStatus?.witnesses ?? [];
		if (witnessStatuses.length === 0) return null;
		let newerCount = 0;
		let uncommittedCount = 0;
		let missingCount = 0;
		let noCommittedCount = 0;
		for (const witness of witnessStatuses) {
			switch (witness.versionState) {
				case 'newer-source-available':
					newerCount++;
					break;
				case 'source-has-uncommitted-changes':
					uncommittedCount++;
					break;
				case 'source-missing':
					missingCount++;
					break;
				case 'source-has-no-committed-version':
					noCommittedCount++;
					break;
			}
		}
		return { newerCount, uncommittedCount, missingCount, noCommittedCount };
	});

	const witnessSourceSummaryText = $derived.by(() => {
		const summary = witnessSourceSummary;
		if (!summary) return '';
		if (
			summary.newerCount === 0 &&
			summary.uncommittedCount === 0 &&
			summary.missingCount === 0 &&
			summary.noCommittedCount === 0
		) {
			return 'All witness sources current';
		}
		const parts: string[] = [];
		if (summary.newerCount > 0) {
			parts.push(
				`${summary.newerCount} witness source${summary.newerCount === 1 ? '' : 's'} with newer committed version${summary.newerCount === 1 ? '' : 's'}`
			);
		}
		if (summary.uncommittedCount > 0) {
			parts.push(
				`${summary.uncommittedCount} witness source${summary.uncommittedCount === 1 ? '' : 's'} with uncommitted edits`
			);
		}
		if (summary.noCommittedCount > 0) {
			parts.push(
				`${summary.noCommittedCount} witness source${summary.noCommittedCount === 1 ? '' : 's'} without committed version`
			);
		}
		if (summary.missingCount > 0) {
			parts.push(
				`${summary.missingCount} witness source${summary.missingCount === 1 ? '' : 's'} missing`
			);
		}
		return parts.join(' · ');
	});

	const staleWitnessCount = $derived(
		collationVersionStatus?.witnesses.filter(
			witness => witness.versionState === 'newer-source-available'
		).length ?? 0
	);

	async function loadCollationVersionStatus(
		id: string,
		isCancelled: () => boolean = () => false
	) {
		try {
			const nextStatus = await getCollationVersionStatus(id);
			if (isCancelled()) return;
			if (collationState.collationId !== id) return;
			collationVersionStatus = nextStatus;
			versionStatusError = null;
		} catch (err) {
			if (isCancelled()) return;
			versionStatusError =
				err instanceof Error ? err.message : 'Failed to load version status';
			console.error('Failed to load collation version status:', err);
		}
	}

	function openCommitForm() {
		commitError = null;
		commitSuccess = null;
		isCommitFormOpen = true;
	}

	function closeCommitForm() {
		if (commitInFlight) return;
		isCommitFormOpen = false;
		commitMessage = '';
		commitError = null;
	}

	async function handleCommitVersion(event: SubmitEvent) {
		event.preventDefault();
		if (!canCommitVersion || !collationVersionStatus || !collationState.collationId) return;
		const id = collationState.collationId;
		commitInFlight = true;
		commitError = null;
		commitSuccess = null;
		try {
			const flushed = await collationState.flushPendingSave();
			if (!flushed) {
				throw new Error('Local save failed. Commit was not created.');
			}
			if (collationState.collationId !== id) {
				throw new Error('Collation changed before commit completed. Commit was not created.');
			}
			await createCommittedCollationCheckpoint({
				collationId: id,
				commitMessage: commitMessage.trim() || null,
			});
			await loadCollationVersionStatus(id);
			isCommitFormOpen = false;
			commitMessage = '';
			commitSuccess = 'Committed locally';
		} catch (err) {
			commitError = err instanceof Error ? err.message : 'Failed to commit version';
		} finally {
			commitInFlight = false;
		}
	}

	async function refreshStaleWitnessSources() {
		if (!collationState.collationId || staleWitnessCount === 0 || bulkRefreshInFlight) return;
		const confirmed = window.confirm(
			`Refresh ${staleWitnessCount} stale witness source${staleWitnessCount === 1 ? '' : 's'} from the latest committed source version? Alignment/readings will be rebuilt and the collation will need a new commit.`
		);
		if (!confirmed) return;
		const id = collationState.collationId;
		bulkRefreshInFlight = true;
		bulkRefreshError = null;
		try {
			const refreshedCount = await collationState.refreshAllStaleWitnessSources();
			if (refreshedCount === 0) {
				bulkRefreshError = 'No stale witness sources could be refreshed.';
			} else {
				const flushed = await collationState.flushPendingSave();
				if (!flushed) throw new Error('Local save failed after refreshing witnesses.');
				await loadCollationVersionStatus(id);
			}
		} catch (err) {
			bulkRefreshError =
				err instanceof Error ? err.message : 'Failed to refresh stale witnesses';
		} finally {
			bulkRefreshInFlight = false;
		}
	}

	$effect(() => {
		const id = collationState.collationId;
		let cancelled = false;
		collationVersionStatus = null;
		versionStatusError = null;
		isCommitFormOpen = false;
		commitMessage = '';
		commitError = null;
		commitSuccess = null;
		bulkRefreshError = null;
		if (!id) {
			return;
		}
		void loadCollationVersionStatus(id, () => cancelled);
		const unsubscribe = subscribeLocalDbInvalidations(event => {
			if (event.domain === 'collations') {
				void loadCollationVersionStatus(id, () => cancelled);
			}
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	});

	$effect(() => {
		if (collationState.saveStatus === 'unsaved') {
			commitSuccess = null;
		}
	});
</script>

<div class="flex flex-col h-[calc(100vh-4rem)]">
	<!-- Global Header -->
	<div class="shrink-0 bg-base-200/60 border-b border-base-300/50 px-4 py-3">
		<div class="flex items-center justify-between gap-4 max-w-7xl mx-auto">
			<div class="flex items-center gap-3">
				<a
					href={resolve('/collation')}
					class="btn btn-ghost btn-sm btn-circle"
					title="Back to collations"
				>
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
				{#if collationVersionStatus}
					<div class="border-l border-base-300 pl-3 flex items-center gap-2">
						<GitCommit size={14} class="text-base-content/60" />
						<EntityHeader
							label="Collation"
							projectName={collationVersionStatus.projectName}
							commitState={collationVersionStatus.commitState}
							checkpointRevisionId={collationVersionStatus.currentCheckpoint?.revisionId ?? null}
						/>
						<button
							type="button"
							class="btn btn-sm btn-secondary"
							disabled={!canCommitVersion}
							title={commitDisabledReason}
							onclick={openCommitForm}
						>
							{commitInFlight ? 'Committing...' : 'Commit version'}
						</button>
					</div>
				{:else if versionStatusError}
					<div class="border-l border-base-300 pl-3" title={versionStatusError}>
						<span class="text-xs text-warning/80">Version status unavailable</span>
					</div>
				{/if}
				{#if witnessSourceSummaryText}
					<div
						class="border-l border-base-300 pl-3 max-w-sm"
						title={witnessSourceSummaryText}
					>
						<span class="text-[11px] text-base-content/55 line-clamp-2">
							{witnessSourceSummaryText}
						</span>
						{#if staleWitnessCount > 0}
							<button
								type="button"
								class="btn btn-xs btn-outline btn-secondary mt-1"
								disabled={bulkRefreshInFlight}
								onclick={refreshStaleWitnessSources}
							>
								{bulkRefreshInFlight ? 'Refreshing...' : 'Refresh stale witnesses'}
							</button>
						{/if}
					</div>
				{/if}
			</div>
		</div>
		{#if commitSuccess}
			<p class="mt-2 max-w-7xl mx-auto text-sm text-success">{commitSuccess}</p>
		{/if}
		{#if bulkRefreshError}
			<p class="mt-2 max-w-7xl mx-auto text-sm text-error">{bulkRefreshError}</p>
		{/if}
	</div>

	{#if isCommitFormOpen}
		<div class="shrink-0 bg-base-100 border-b border-base-300 px-4 py-3">
			<form class="max-w-7xl mx-auto space-y-2" onsubmit={handleCommitVersion}>
				<div class="flex items-center justify-between gap-3">
					<p class="text-xs font-semibold uppercase tracking-[0.14em] opacity-70">
						Commit collation version
					</p>
					<div class="flex gap-2">
						<button
							type="button"
							class="btn btn-sm btn-ghost"
							disabled={commitInFlight}
							onclick={closeCommitForm}
						>
							Cancel
						</button>
						<button
							type="submit"
							class="btn btn-sm btn-primary"
							disabled={commitInFlight}
						>
							{commitInFlight ? 'Committing...' : 'Commit version'}
						</button>
					</div>
				</div>
				<label class="form-control">
					<span class="label pb-1">
						<span class="label-text text-xs">Optional note for this local version.</span
						>
					</span>
					<textarea
						bind:value={commitMessage}
						class="textarea textarea-bordered textarea-sm min-h-20"
						placeholder="Describe this version"
						disabled={commitInFlight}
					></textarea>
				</label>
				{#if commitError}
					<p class="text-sm text-error" role="alert">{commitError}</p>
				{/if}
			</form>
		</div>
	{/if}

	<!-- Phase Content -->
	<div class="flex-1 min-h-0 overflow-hidden">
		<div class="h-full w-full px-3 py-4 md:px-4">
			{#if collationState.phase === 'setup' && !collationState.collationId && !collationState.projectId}
				<ProjectCollationGate />
			{:else if collationState.phase === 'setup'}
				<SetupPhase witnessStatuses={collationVersionStatus?.witnesses ?? null} />
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
