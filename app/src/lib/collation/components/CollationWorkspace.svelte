<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { collationState } from '$lib/collation/collation-state.svelte';
	import {
		createCommittedCollationCheckpoint,
		getCollationVersionStatus,
		listCollationVersions,
		loadCollationVersionDocument,
		replaceCollationCurrent,
		restoreCollationVersion,
		subscribeLocalDbInvalidations,
		updateCollationVersionNote,
	} from '$lib/db/client';
	import type { CollationVersionStatus } from '$lib/db/repositories/collations';
	import CollationStepper from './CollationStepper.svelte';
	import AutoSaveIndicator from './AutoSaveIndicator.svelte';
	import EntityHeader from '$lib/shell/components/EntityHeader.svelte';
	import VersionControls, {
		type VersionActions,
	} from '$lib/shell/components/VersionControls.svelte';
	import { compareCollations, formatCollationPart } from '$lib/shell/version-compare';
	import SetupPhase from './SetupPhase.svelte';
	import AlignmentGrid from './AlignmentGrid.svelte';
	import ReadingsPhase from './ReadingsPhase.svelte';
	import ReviewPhase from './ReviewPhase.svelte';
	import StemmaPhase from './StemmaPhase.svelte';
	import ProjectCollationGate from './ProjectCollationGate.svelte';
	import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
	import ArrowUUpLeft from 'phosphor-svelte/lib/ArrowUUpLeft';
	import ArrowUUpRight from 'phosphor-svelte/lib/ArrowUUpRight';
	import Note from 'phosphor-svelte/lib/Note';
	import Warning from 'phosphor-svelte/lib/Warning';

	let collationVersionStatus = $state<CollationVersionStatus | null>(null);
	let versionStatusError = $state<string | null>(null);
	let bulkRefreshInFlight = $state(false);
	let bulkRefreshError = $state<string | null>(null);

	async function flushCollation(id: string) {
		const flushed = await collationState.flushPendingSave();
		if (!flushed) throw new Error('Local save failed. Try again.');
		if (collationState.collationId !== id) throw new Error('Collation changed. Try again.');
	}

	async function reloadCollation(id: string) {
		await collationState.reloadCollation();
		await loadCollationVersionStatus(id);
	}

	function versionActionsFor(id: string): VersionActions {
		return {
			list: () => listCollationVersions(id),
			async name(label, note) {
				await flushCollation(id);
				const version = await createCommittedCollationCheckpoint({
					collationId: id,
					label,
					commitMessage: note,
				});
				await loadCollationVersionStatus(id);
				return version.warnings?.map(warning => warning.message) ?? [];
			},
			async restore(versionId) {
				await flushCollation(id);
				const previous = await restoreCollationVersion(id, versionId);
				await reloadCollation(id);
				return async () => {
					await flushCollation(id);
					await replaceCollationCurrent(id, previous);
					await reloadCollation(id);
				};
			},
			editNote: (versionId, note) => updateCollationVersionNote(id, versionId, note),
			async compare(leftVersionId, rightVersionId) {
				if (!rightVersionId) await flushCollation(id);
				const [left, right] = await Promise.all([
					loadCollationVersionDocument(id, leftVersionId),
					loadCollationVersionDocument(id, rightVersionId),
				]);
				return compareCollations(left, right);
			},
			formatPart: formatCollationPart,
		};
	}

	const witnessSourceSummary = $derived.by(() => {
		const witnessStatuses = collationVersionStatus?.witnesses ?? [];
		if (witnessStatuses.length === 0) return null;
		let changedCount = 0;
		let missingCount = 0;
		for (const witness of witnessStatuses) {
			if (witness.versionState === 'source-changed') changedCount++;
			if (witness.versionState === 'source-missing') missingCount++;
		}
		return { changedCount, missingCount };
	});

	const witnessSourceSummaryText = $derived.by(() => {
		const summary = witnessSourceSummary;
		if (!summary) return '';
		if (summary.changedCount === 0 && summary.missingCount === 0) {
			return 'All witness sources current';
		}
		const parts: string[] = [];
		if (summary.changedCount > 0) {
			parts.push(
				`${summary.changedCount} witness source${summary.changedCount === 1 ? '' : 's'} changed`
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
			witness => witness.versionState === 'source-changed'
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

	async function refreshStaleWitnessSources() {
		if (!collationState.collationId || staleWitnessCount === 0 || bulkRefreshInFlight) return;
		const confirmed = window.confirm(
			`Refresh ${staleWitnessCount} stale witness source${staleWitnessCount === 1 ? '' : 's'} from their source? Alignment/readings will be rebuilt.`
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

	async function followPhase() {
		const id = collationState.collationId;
		const routePhase = page.params.phase;
		if (!id || !routePhase || routePhase === collationState.phase) return;
		await goto(resolve('/collation/[id]/[phase]', { id, phase: collationState.phase }), {
			replaceState: true,
		});
	}

	function undo() {
		collationState.undo();
		void followPhase();
	}

	function redo() {
		collationState.redo();
		void followPhase();
	}

	function handleHistoryKeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
		const target = e.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable)
		) {
			return;
		}
		const key = e.key.toLowerCase();
		if (key === 'z' && !e.shiftKey) {
			e.preventDefault();
			undo();
		} else if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)) {
			e.preventDefault();
			redo();
		}
	}
</script>

<svelte:window onkeydown={handleHistoryKeydown} />

<div class="flex flex-col h-[calc(100vh-4rem)]">
	<div class="shrink-0 bg-base-200/60 border-b border-base-300/50 px-4 py-3">
		<div class="flex max-lg:flex-wrap items-center justify-between gap-4 max-w-7xl mx-auto">
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
				{#if collationState.segment}
					<span class="text-sm text-base-content/50 font-mono">
						{collationState.segment.name}
					</span>
				{/if}
				<details class="dropdown">
					<summary
						class={[
							'btn btn-sm btn-square',
							collationState.notes.trim() ? 'btn-secondary' : 'btn-ghost',
						]}
						title="Verse note"
						aria-label="Verse note"
					>
						<Note size={16} />
					</summary>
					<div
						class="dropdown-content z-30 mt-1 w-[min(24rem,calc(100vw-2rem))] rounded-box border border-base-300/60 bg-base-100 p-3 shadow-lg"
					>
						<label class="block text-xs text-base-content/50">
							<span>Verse note</span>
							<textarea
								class="textarea textarea-bordered mt-1 h-40 w-full text-sm"
								aria-label="Verse note text"
								value={collationState.notes}
								onblur={event => collationState.setNotes(event.currentTarget.value)}
							></textarea>
						</label>
					</div>
				</details>
			</div>
			<div class="flex max-lg:min-w-0 max-lg:max-w-full max-lg:flex-wrap items-center gap-4">
				<CollationStepper />
				<div class="border-l border-base-300 pl-3 flex items-center gap-1">
					<button
						type="button"
						class="btn btn-ghost btn-sm btn-square"
						title="Undo (Ctrl+Z)"
						aria-label="Undo"
						disabled={!collationState.canUndo}
						onclick={undo}
					>
						<ArrowUUpLeft size={16} />
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-sm btn-square"
						title="Redo (Ctrl+Shift+Z)"
						aria-label="Redo"
						disabled={!collationState.canRedo}
						onclick={redo}
					>
						<ArrowUUpRight size={16} />
					</button>
				</div>
				<div class="border-l border-base-300 pl-3">
					<AutoSaveIndicator />
				</div>
				{#if collationVersionStatus && collationState.collationId}
					<div
						class="border-l border-base-300 pl-3 flex max-lg:flex-wrap items-center gap-2"
					>
						<EntityHeader
							label="Collation"
							projectName={collationVersionStatus.projectName}
						/>
						<VersionControls
							actions={versionActionsFor(collationState.collationId)}
							basedOnVersionId={collationVersionStatus.currentCheckpoint
								?.revisionId ?? null}
							changedSinceBase={collationVersionStatus.commitState !== 'clean'}
						/>
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
		{#if bulkRefreshError}
			<p class="mt-2 max-w-7xl mx-auto text-sm text-error">{bulkRefreshError}</p>
		{/if}
	</div>

	<div class="flex-1 min-h-0 overflow-hidden">
		<div class="h-full w-full px-3 py-4 md:px-4">
			{#if collationState.orphanedMembers.length > 0}
				<div class="mx-auto mb-4 max-w-7xl">
					<div
						class="alert alert-warning items-start text-sm"
						data-testid="orphaned-segment-members"
						role="status"
					>
						<Warning size={18} class="mt-0.5 shrink-0" />
						<div>
							<div class="font-semibold">
								Orphaned segment member{collationState.orphanedMembers.length === 1
									? ''
									: 's'}
							</div>
							<p class="mt-1">
								These no longer match a transcription and were skipped. Other
								witnesses still collate.
							</p>
							<ul class="mt-2 list-inside list-disc font-mono text-xs">
								{#each collationState.orphanedMembers as member (member)}
									<li>{member}</li>
								{/each}
							</ul>
						</div>
					</div>
				</div>
			{/if}
			{#if collationState.phase === 'setup' && !collationState.collationId && !collationState.projectId}
				<ProjectCollationGate />
			{:else if collationState.phase === 'setup'}
				<SetupPhase witnessStatuses={collationVersionStatus?.witnesses ?? null} />
			{:else if collationState.phase === 'readings'}
				<ReadingsPhase />
			{:else if collationState.phase === 'stemma'}
				<StemmaPhase />
			{:else if collationState.phase === 'review'}
				<ReviewPhase />
			{:else}
				<AlignmentGrid />
			{/if}
		</div>
	</div>
</div>
