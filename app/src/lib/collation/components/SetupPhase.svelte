<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { gatherWitnessesForSegment } from '$lib/collation/collation-runner';
	import { buildWitnessSourceKey } from '$lib/collation/witness-config';
	import {
		collationState,
		type WitnessConfig,
		type WitnessTreatment,
	} from '$lib/collation/collation-state.svelte';
	import { gatherVerses, type AggregatedVerse } from '$lib/collation/gather-verses';
	import { listTranscriptions, type ProjectTranscriptionOption } from '$lib/project/projects';
	import type { TranscriptionSourceOptions } from '$lib/db/repositories/revisions';
	import SourceVersionPicker from '$lib/shell/components/SourceVersionPicker.svelte';
	import { formatWitnessSourceLabel } from '$lib/shell/source-labels';
	import {
		rebuildVerseIndexForTranscriptions,
		type VerseIndexRebuildProgress,
	} from '$lib/transcription/verse-index';
	import ProjectCollationSettingsEditor from '$lib/project/components/ProjectCollationSettingsEditor.svelte';
	import ProjectTranscriptionsEditor from '$lib/project/components/ProjectTranscriptionsEditor.svelte';
	import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
	import ArrowsClockwise from 'phosphor-svelte/lib/ArrowsClockwise';
	import Eye from 'phosphor-svelte/lib/Eye';
	import EyeSlash from 'phosphor-svelte/lib/EyeSlash';
	import FolderOpen from 'phosphor-svelte/lib/FolderOpen';
	import LinkBreak from 'phosphor-svelte/lib/LinkBreak';
	import LinkSimple from 'phosphor-svelte/lib/LinkSimple';
	import Warning from 'phosphor-svelte/lib/Warning';
	import X from 'phosphor-svelte/lib/X';
	import { onMount } from 'svelte';
	import type {
		CollationWitnessSourceStatus,
		CollationWitnessVersionState,
	} from '$lib/db/repositories/collations';
	import {
		getProjectTranscriptionIds,
		getTranscriptionSourceOptions,
		syncProjectTranscriptionIds,
	} from '$lib/db/client';

	interface Props {
		witnessStatuses?: CollationWitnessSourceStatus[] | null;
	}

	let { witnessStatuses = null }: Props = $props();

	let manualWitnesses = $derived(collationState.getManualWitnesses());
	let verses = $state<AggregatedVerse[]>([]);
	let allTranscriptions = $state<ProjectTranscriptionOption[]>([]);
	let selectedTranscriptionIds = $state<string[]>([]);
	let isLoadingSetup = $state(true);
	let isLoadingWitnesses = $state(false);
	let isSavingTranscriptions = $state(false);
	let isRebuildingVerseIndex = $state(false);
	let error = $state<string | null>(null);
	let statusMessage = $state<string | null>(null);
	let setupLoadToken = 0;
	let verseFilter = $state('');
	let rebuildProgress = $state<VerseIndexRebuildProgress | null>(null);
	let activeWitnessLoadKey: string | null = null;
	type WitnessLoadRequest = {
		verse: AggregatedVerse | null;
		members: string[];
		transcriptionIds: string[];
		ignoreWordBreaks: boolean;
		key: string;
	};

	let matchingVerse = $derived(
		verses.find(v => collationState.segment?.members.includes(v.identifier)) ?? null
	);
	let selectedMemberIdentifiers = $derived(collationState.segment?.members ?? []);
	let normalizedVerseFilter = $derived(verseFilter.trim().toLowerCase());
	let filteredVerses = $derived(
		normalizedVerseFilter.length === 0
			? verses
			: verses.filter(verse => {
					const haystacks = [
						verse.identifier,
						verse.book,
						`${verse.chapter}:${verse.verse}`,
						`${verse.book} ${verse.chapter}`,
						`${verse.book} ${verse.verse}`,
					];
					return haystacks.some(value =>
						value.toLowerCase().includes(normalizedVerseFilter)
					);
				})
	);

	let activeWitnessCount = $derived(
		collationState.witnesses.filter(witness => !witness.isExcluded).length
	);

	async function reloadVerses() {
		verses = await gatherVerses(selectedTranscriptionIds);
	}

	function buildWitnessLoadKey(
		members: string[],
		transcriptionIds: string[],
		ignoreWordBreaks: boolean
	) {
		return JSON.stringify({
			members,
			transcriptionIds,
			ignoreWordBreaks,
		});
	}

	function clearSetupProjectLoad() {
		setupLoadToken += 1;
		isLoadingSetup = false;
	}

	function isCurrentSetupLoad(projectId: string, loadToken: number) {
		return setupLoadToken === loadToken && collationState.projectId === projectId;
	}

	async function loadSetupForProject(projectId: string, loadToken: number) {
		isLoadingSetup = true;
		error = null;
		statusMessage = null;
		try {
			const nextAllTranscriptions = await listTranscriptions(projectId);
			if (!isCurrentSetupLoad(projectId, loadToken)) return;
			allTranscriptions = nextAllTranscriptions;

			const nextSelectedTranscriptionIds = await getProjectTranscriptionIds(projectId);
			if (!isCurrentSetupLoad(projectId, loadToken)) return;
			selectedTranscriptionIds = nextSelectedTranscriptionIds;

			const nextVerses = await gatherVerses(nextSelectedTranscriptionIds);
			if (!isCurrentSetupLoad(projectId, loadToken)) return;
			verses = nextVerses;
		} catch (err) {
			if (!isCurrentSetupLoad(projectId, loadToken)) return;
			error = err instanceof Error ? err.message : 'Failed to load setup data';
		} finally {
			if (isCurrentSetupLoad(projectId, loadToken)) {
				isLoadingSetup = false;
			}
		}
	}

	function isCurrentWitnessLoad(request: WitnessLoadRequest) {
		return (
			activeWitnessLoadKey === request.key &&
			JSON.stringify(collationState.segment?.members ?? []) ===
				JSON.stringify(request.members) &&
			buildWitnessLoadKey(
				request.members,
				selectedTranscriptionIds,
				collationState.ignoreWordBreaks
			) === request.key
		);
	}

	function createWitnessLoadRequest(verse: AggregatedVerse | null): WitnessLoadRequest | null {
		const members = [...(collationState.segment?.members ?? [])];
		if (members.length === 0 || selectedTranscriptionIds.length === 0) return null;

		const transcriptionIds = [...selectedTranscriptionIds];
		const ignoreWordBreaks = collationState.ignoreWordBreaks;
		return {
			verse,
			members,
			transcriptionIds,
			ignoreWordBreaks,
			key: buildWitnessLoadKey(members, transcriptionIds, ignoreWordBreaks),
		};
	}

	async function loadWitnessesForRequest(request: WitnessLoadRequest, segmentChanged: boolean) {
		activeWitnessLoadKey = request.key;
		isLoadingWitnesses = true;
		error = null;
		collationState.setOrphanedMembers([]);
		try {
			const result = await gatherWitnessesForSegment(
				{ members: request.members },
				request.transcriptionIds,
				{
					ignoreWordBreaks: request.ignoreWordBreaks,
				}
			);
			if (!isCurrentWitnessLoad(request)) return;
			if (result.error) {
				if (collationState.alignmentColumns.length === 0) collationState.setWitnesses([]);
				collationState.selectedVerse = request.verse;
				collationState.setOrphanedMembers(result.orphanedMembers);
				error = result.error.message;
				return;
			}

			collationState.setOrphanedMembers(result.orphanedMembers);
			const usedIds = new Set(collationState.witnesses.map(witness => witness.witnessId));
			const configs: WitnessConfig[] = result.witnesses.map((witness, index) => {
				const previous = collationState.witnesses.find(
					config =>
						buildWitnessSourceKey(config) ===
						buildWitnessSourceKey({
							transcriptionId: witness.transcriptionUid,
							kind: witness.kind,
							handId: witness.handId,
						})
				);
				const witnessId =
					previous?.witnessId ??
					(usedIds.has(witness.id) ? crypto.randomUUID() : witness.id);
				usedIds.add(witnessId);
				return {
					witnessId,
					siglum: witness.siglum,
					transcriptionId: witness.transcriptionUid,
					kind: witness.kind,
					handId: witness.handId,
					source: witness.source,
					content: witness.content,
					tokens: witness.tokens,
					fullContent: witness.fullContent,
					fullTokens: witness.fullTokens,
					fragmentaryContent: witness.fragmentaryContent,
					fragmentaryTokens: witness.fragmentaryTokens,
					treatment:
						previous?.treatment ?? (witness.kind === 'corrector' ? 'inherit' : 'full'),
					isBaseText:
						previous?.isBaseText ??
						(collationState.witnesses.length === 0 && index === 0),
					isExcluded: previous?.isExcluded ?? false,
					overridesDefault: previous?.overridesDefault ?? false,
				};
			});
			collationState.setWitnesses(configs, { segmentChanged });
			collationState.selectedVerse = request.verse;
		} catch (err) {
			console.error('Failed to load witnesses for segment', request.members, err);
			if (!isCurrentWitnessLoad(request)) return;
			collationState.setOrphanedMembers([]);
			error = err instanceof Error ? err.message : 'Failed to load witnesses';
		} finally {
			if (activeWitnessLoadKey === request.key) {
				activeWitnessLoadKey = null;
				isLoadingWitnesses = false;
			}
		}
	}

	onMount(() => {
		const projectId = collationState.projectId;
		if (!projectId) {
			clearSetupProjectLoad();
			return;
		}
		const loadToken = ++setupLoadToken;
		void loadSetupForProject(projectId, loadToken);

		return () => {
			setupLoadToken += 1;
		};
	});

	async function toggleProjectTranscription(transcriptionId: string) {
		const projectId = collationState.projectId;
		if (!projectId) return;
		isSavingTranscriptions = true;
		error = null;
		statusMessage = null;
		try {
			const nextIds = selectedTranscriptionIds.includes(transcriptionId)
				? selectedTranscriptionIds.filter(id => id !== transcriptionId)
				: [...selectedTranscriptionIds, transcriptionId];
			const syncedIds = await syncProjectTranscriptionIds(projectId, nextIds);
			if (collationState.projectId !== projectId) return;
			selectedTranscriptionIds = syncedIds;
			allTranscriptions = await listTranscriptions(projectId);
			await reloadVerses();
			const request = createWitnessLoadRequest(collationState.selectedVerse);
			if (request) {
				await loadWitnessesForRequest(request, false);
			} else {
				collationState.setWitnesses([]);
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to update project transcriptions';
		} finally {
			isSavingTranscriptions = false;
		}
	}

	async function rebuildCurrentProjectVerseIndex() {
		if (selectedTranscriptionIds.length === 0 || isRebuildingVerseIndex) return;

		isRebuildingVerseIndex = true;
		error = null;
		statusMessage = null;
		rebuildProgress = {
			completed: 0,
			total: selectedTranscriptionIds.length,
			currentLabel: '',
			currentTranscriptionId: '',
		};

		try {
			const result = await rebuildVerseIndexForTranscriptions(selectedTranscriptionIds, {
				onProgress: progress => {
					rebuildProgress = progress;
				},
				suppressReactiveNotifications: true,
				pauseUploads: true,
			});
			await reloadVerses();
			statusMessage =
				result.failed === 0
					? `Rebuilt verse index for ${result.succeeded} transcription${result.succeeded === 1 ? '' : 's'}.`
					: `Rebuilt ${result.succeeded} transcription${result.succeeded === 1 ? '' : 's'}; ${result.failed} failed.`;
			if (result.failed > 0) {
				const [firstFailure] = result.failures;
				error = firstFailure
					? `Verse-index rebuild failed for ${firstFailure.label}: ${firstFailure.message}`
					: 'Some verse indexes could not be rebuilt.';
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to rebuild verse index';
		} finally {
			isRebuildingVerseIndex = false;
		}
	}

	function cycleTreatment(current: WitnessTreatment): WitnessTreatment {
		const cycle: WitnessTreatment[] = ['inherit', 'full', 'fragmentary'];
		return cycle[(cycle.indexOf(current) + 1) % cycle.length];
	}

	const treatmentLabel: Record<WitnessTreatment, string> = {
		inherit: 'Inherit Default',
		full: 'Full Witness',
		fragmentary: 'Fragmentary',
	};

	const treatmentBadge: Record<WitnessTreatment, string> = {
		inherit: 'badge-ghost',
		full: 'badge-primary',
		fragmentary: 'badge-warning',
	};

	function isCorrectorWitness(witness: WitnessConfig): boolean {
		return witness.kind === 'corrector';
	}

	let refreshWitnessId = $state<string | null>(null);
	let refreshInFlight = $state(false);
	let refreshError = $state<string | null>(null);
	let refreshOptions = $state<TranscriptionSourceOptions | null>(null);
	let selectedRefreshVersionId = $state<string | null>(null);
	let refreshOptionsLoadToken = 0;

	const refreshWitness = $derived(
		refreshWitnessId
			? (collationState.witnesses.find(w => w.witnessId === refreshWitnessId) ?? null)
			: null
	);

	function witnessStatusFor(witnessId: string): CollationWitnessSourceStatus | null {
		if (!witnessStatuses) return null;
		return witnessStatuses.find(entry => entry.witnessId === witnessId) ?? null;
	}

	function witnessVersionStateLabel(state: CollationWitnessVersionState): string {
		switch (state) {
			case 'source-changed':
				return 'Source changed';
			case 'source-missing':
				return 'Source missing';
			default:
				return '';
		}
	}

	function witnessVersionStateBadgeClass(state: CollationWitnessVersionState): string {
		return state === 'source-changed' ? 'badge-info' : 'badge-ghost';
	}

	function canRefreshWitness(status: CollationWitnessSourceStatus | null): boolean {
		return status?.versionState === 'source-changed';
	}

	async function openRefreshDialog(witnessId: string) {
		const witness = collationState.witnesses.find(w => w.witnessId === witnessId);
		if (!witness?.transcriptionId) return;
		refreshWitnessId = witnessId;
		refreshError = null;
		refreshOptions = null;
		selectedRefreshVersionId = null;
		const loadToken = ++refreshOptionsLoadToken;
		try {
			const options = await getTranscriptionSourceOptions(witness.transcriptionId);
			if (loadToken !== refreshOptionsLoadToken || refreshWitnessId !== witnessId) return;
			refreshOptions = options;
			selectedRefreshVersionId =
				witness.source?.kind === 'version' ? (options.versions[0]?.id ?? null) : null;
		} catch (err) {
			if (loadToken !== refreshOptionsLoadToken || refreshWitnessId !== witnessId) return;
			refreshError = err instanceof Error ? err.message : 'Failed to load source versions.';
		}
	}

	function closeRefreshDialog() {
		if (refreshInFlight) return;
		refreshWitnessId = null;
		refreshError = null;
		refreshOptions = null;
		selectedRefreshVersionId = null;
		refreshOptionsLoadToken++;
	}

	async function handleRefreshWitness(event: SubmitEvent) {
		event.preventDefault();
		if (!refreshWitnessId || refreshInFlight || !refreshOptions) return;
		refreshInFlight = true;
		refreshError = null;
		try {
			const refreshed = await collationState.refreshWitnessSource(
				refreshWitnessId,
				selectedRefreshVersionId
			);
			if (!refreshed) {
				refreshError = 'Witness source could not be refreshed from the selected source.';
			} else {
				refreshWitnessId = null;
			}
		} catch (err) {
			refreshError = err instanceof Error ? err.message : 'Failed to refresh witness source.';
		} finally {
			refreshInFlight = false;
		}
	}

	async function chooseDifferentProject() {
		if (collationState.collationId) return;
		await collationState.clearProjectSelection();
		await goto(resolve('/collation/new'), { replaceState: true });
	}

	function updateSegmentMembers(members: string[]) {
		error = null;
		collationState.setSegmentMembers(members);
		const primaryVerse = verses.find(verse => members.includes(verse.identifier)) ?? null;
		if (primaryVerse) {
			collationState.selectedBook = primaryVerse.book;
			collationState.selectedChapter = primaryVerse.chapter;
			collationState.selectedVerseNum = primaryVerse.verse;
		} else {
			collationState.selectedBook = '';
			collationState.selectedChapter = '';
			collationState.selectedVerseNum = '';
		}
		collationState.selectedVerse = primaryVerse;

		const request = createWitnessLoadRequest(primaryVerse);
		if (request) {
			void loadWitnessesForRequest(request, true);
		} else {
			collationState.setWitnesses([], { segmentChanged: true });
		}
	}

	function selectVerse(verse: AggregatedVerse) {
		const currentMembers = collationState.segment?.members ?? [];
		const nextMembers = currentMembers.includes(verse.identifier)
			? currentMembers.filter(member => member !== verse.identifier)
			: [...currentMembers, verse.identifier];
		updateSegmentMembers(nextMembers);
	}

	function removeSegmentMember(member: string) {
		updateSegmentMembers(
			(collationState.segment?.members ?? []).filter(candidate => candidate !== member)
		);
	}
</script>

{#if manualWitnesses.length > 0}
	<section
		class="space-y-3 rounded-box border border-base-300/50 bg-base-100 p-4"
		aria-label="Manual witnesses"
	>
		<h2 class="font-serif text-lg font-semibold">Manual witnesses</h2>
		{#each manualWitnesses as witness (witness.id)}
			{@const override = collationState.getManualWitnessOverride(witness.id)}
			<div class="flex flex-wrap items-center gap-3">
				<label class="flex min-w-0 flex-1 items-center gap-2 break-all">
					<input
						type="checkbox"
						class="checkbox checkbox-sm"
						aria-label={`Include manual witness ${witness.siglum}`}
						checked={!override.isExcluded}
						onchange={event =>
							collationState.updateManualWitness(witness.id, {
								isExcluded: !event.currentTarget.checked,
							})}
					/>
					<span>{witness.siglum}</span>
				</label>
				<select
					class="select select-bordered select-sm max-w-full"
					aria-label={`Treatment for manual witness ${witness.siglum}`}
					value={override.treatment}
					onchange={event =>
						collationState.updateManualWitness(witness.id, {
							treatment: event.currentTarget.value as WitnessTreatment,
						})}
				>
					<option value="inherit">Project default ({witness.treatment})</option>
					<option value="full">Full</option>
					<option value="fragmentary">Fragmentary</option>
				</select>
			</div>
		{/each}
	</section>
{/if}

<div class="flex h-full min-h-0 flex-col gap-6 overflow-y-auto lg:flex-row">
	<div class="shrink-0 lg:w-100 lg:pr-2">
		<div class="space-y-4">
			<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
				<div class="flex items-center gap-2 mb-1">
					<FolderOpen size={16} class="text-base-content/50" />
					<span
						class="text-xs font-semibold uppercase tracking-wider text-base-content/50"
						>Project</span
					>
				</div>
				<div class="font-serif text-xl font-semibold">
					{collationState.projectName}
				</div>
				<p class="mt-1 text-xs text-base-content/50">
					Only project-linked transcriptions appear below.
				</p>
				<div class="mt-3 flex flex-wrap gap-2">
					<a href={resolve('/projects')} class="btn btn-ghost btn-sm">Manage Project</a>
					{#if !collationState.collationId}
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							onclick={chooseDifferentProject}
						>
							Choose Different Project
						</button>
					{/if}
				</div>
			</div>

			<ProjectTranscriptionsEditor
				{allTranscriptions}
				{selectedTranscriptionIds}
				isLoading={isLoadingSetup}
				isSaving={isSavingTranscriptions}
				getTreatment={collationState.getProjectTranscriptionTreatment}
				isHandIncluded={collationState.isProjectTranscriptionHandIncluded}
				setTreatment={collationState.setProjectTranscriptionTreatment}
				setHandIncluded={collationState.setProjectTranscriptionHandIncluded}
				setAllTreatments={collationState.setAllProjectTranscriptionTreatments}
				onToggleTranscription={toggleProjectTranscription}
			/>

			<ProjectCollationSettingsEditor
				rules={collationState.rules}
				lowercase={collationState.lowercase}
				ignoreWordBreaks={collationState.ignoreWordBreaks}
				ignorePunctuation={collationState.ignorePunctuation}
				suppliedTextMode={collationState.suppliedTextMode}
				segmentation={collationState.segmentation}
				onAddRule={rule => {
					collationState.addRule(rule);
				}}
				onRemoveRule={collationState.removeRule}
				onToggleRule={collationState.toggleRule}
				onSetRuleType={collationState.setRuleType}
				onSetLowercase={collationState.setLowercase}
				onSetIgnoreWordBreaks={collationState.setIgnoreWordBreaks}
				onSetIgnorePunctuation={collationState.setIgnorePunctuation}
				onSetSuppliedTextMode={collationState.setSuppliedTextMode}
				onSetSegmentation={collationState.setSegmentation}
			/>

			<div
				class="rounded-box border border-base-300/40 bg-base-200/40 px-3 py-2 text-xs text-base-content/55"
			>
				Changing preprocessing may rebuild alignment and readings.
			</div>
		</div>
	</div>

	<div class="min-h-0 flex-1 min-w-0">
		<div class="mb-4 flex items-center justify-between">
			<div>
				<h2 class="font-serif text-2xl font-bold tracking-tight text-base-content/90">
					Textual Scope
				</h2>
				<p class="text-sm text-base-content/55">Choose a verse and its witnesses.</p>
			</div>
			{#if collationState.witnesses.length > 0}
				<span class="text-xs font-mono text-base-content/50">
					{activeWitnessCount} / {collationState.witnesses.length} active
				</span>
			{/if}
		</div>

		{#if error}
			<div class="alert alert-error mb-4 text-sm">{error}</div>
		{/if}

		{#if statusMessage}
			<div class="alert alert-info mb-4 text-sm">{statusMessage}</div>
		{/if}

		{#if selectedTranscriptionIds.length === 0}
			<div
				class="mb-5 rounded-3xl border border-dashed border-base-300/80 bg-base-100 p-8 text-center"
			>
				<div
					class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-base-300/70 bg-base-200/70"
				>
					<FolderOpen size={24} class="text-base-content/40" />
				</div>
				<h3 class="font-serif text-xl font-semibold text-base-content/82">
					Link at least one transcription
				</h3>
				<p class="mx-auto mt-2 max-w-lg text-sm leading-6 text-base-content/55">
					Select transcriptions in the sidebar.
				</p>
			</div>
		{/if}

		<div class="grid gap-5 xl:grid-cols-[0.95fr_1.35fr]">
			<section
				class="rounded-3xl border border-base-300/50 bg-base-100 p-4 shadow-md shadow-base-300/10"
			>
				<div class="mb-3 flex items-center justify-between">
					<h3 class="font-serif text-lg font-semibold text-base-content/85">
						Verse Selector
					</h3>
					<div class="flex items-center gap-2">
						<span class="badge badge-ghost badge-sm">
							{verses.length} verse{verses.length === 1 ? '' : 's'}
						</span>
						<button
							type="button"
							class="btn btn-ghost btn-sm gap-2"
							disabled={isLoadingSetup ||
								isRebuildingVerseIndex ||
								selectedTranscriptionIds.length === 0}
							onclick={rebuildCurrentProjectVerseIndex}
						>
							{#if isRebuildingVerseIndex}
								<span class="loading loading-spinner loading-xs"></span>
							{:else}
								<ArrowsClockwise size={14} />
							{/if}
							Rebuild Verse Index
						</button>
					</div>
				</div>

				{#if isRebuildingVerseIndex && rebuildProgress}
					<div class="mb-3 rounded-box border border-base-300/50 bg-base-200/50 p-3">
						<div class="flex items-center justify-between gap-3 text-sm">
							<div class="font-medium">
								Indexing {rebuildProgress.completed} of {rebuildProgress.total}
							</div>
							{#if rebuildProgress.currentLabel}
								<div class="max-w-[16rem] truncate text-xs text-base-content/55">
									{rebuildProgress.currentLabel}
								</div>
							{/if}
						</div>
						<progress
							class="progress progress-primary mt-2 w-full"
							value={rebuildProgress.completed}
							max={Math.max(rebuildProgress.total, 1)}
						></progress>
					</div>
				{/if}

				{#if isLoadingSetup}
					<div
						class="flex items-center gap-2 rounded-box bg-base-200/70 p-4 text-sm text-base-content/60"
					>
						<span class="loading loading-spinner loading-sm"></span>
						Loading verses...
					</div>
				{:else if verses.length === 0}
					<div
						class="rounded-box border border-dashed border-base-300/80 p-4 text-sm text-base-content/55"
					>
						No verses are available for the current project scope.
					</div>
				{:else}
					<div class="space-y-3">
						<label class="form-control w-full">
							<div class="label">
								<span class="label-text font-medium">Filter verses</span>
							</div>
							<input
								type="text"
								class="input input-bordered w-full"
								placeholder="Search by book, chapter, verse, or identifier"
								bind:value={verseFilter}
								disabled={selectedTranscriptionIds.length === 0}
							/>
						</label>

						<div class="rounded-box border border-base-300/50 bg-base-200/40 p-2">
							<div
								class="mb-2 flex items-center justify-between px-1 text-xs text-base-content/50"
							>
								<span
									>{filteredVerses.length} match{filteredVerses.length === 1
										? ''
										: 'es'}</span
								>
								{#if matchingVerse}
									<span class="font-mono">{matchingVerse.identifier}</span>
								{/if}
							</div>
							{#if selectedMemberIdentifiers.length > 0}
								<div
									class="mb-2 rounded-box border border-primary/20 bg-primary/5 p-2"
								>
									<div class="mb-1 text-xs font-medium text-base-content/60">
										Selected segment members
									</div>
									<div class="space-y-1">
										{#each selectedMemberIdentifiers as member (member)}
											<div
												class="flex items-center justify-between gap-2 text-xs"
											>
												<span class="min-w-0 truncate font-mono"
													>{member}</span
												>
												<button
													type="button"
													class="btn btn-ghost btn-xs"
													aria-label={`Remove ${member} from segment`}
													onclick={() => removeSegmentMember(member)}
												>
													Remove
												</button>
											</div>
										{/each}
									</div>
								</div>
							{/if}
							<div class="max-h-88 space-y-1 overflow-y-auto pr-1">
								{#if filteredVerses.length === 0}
									<div
										class="rounded-box border border-dashed border-base-300/80 p-4 text-sm text-base-content/55"
									>
										No verses match the current filter.
									</div>
								{:else}
									{#each filteredVerses as verse (verse.identifier)}
										<button
											type="button"
											class={`w-full rounded-box border px-3 py-2 text-left transition-colors ${
												collationState.segment?.members.includes(
													verse.identifier
												)
													? 'border-primary/40 bg-primary/10'
													: 'border-base-300/40 bg-base-100'
											}`}
											aria-pressed={collationState.segment?.members.includes(
												verse.identifier
											)}
											onclick={() => selectVerse(verse)}
										>
											<div class="flex items-center justify-between gap-3">
												<span class="font-serif text-sm font-semibold"
													>{verse.identifier}</span
												>
												<span class="badge badge-ghost badge-sm">
													{verse.count}
												</span>
											</div>
											<div class="mt-1 text-xs text-base-content/50">
												{verse.count} witness source{verse.count === 1
													? ''
													: 's'} in project scope
											</div>
										</button>
									{/each}
								{/if}
							</div>
						</div>

						{#if matchingVerse}
							<div class="rounded-box bg-base-200/70 p-3 text-sm">
								<div class="font-serif font-bold">{matchingVerse.identifier}</div>
								<div class="text-base-content/55">
									{matchingVerse.count} witness source{matchingVerse.count === 1
										? ''
										: 's'} in project scope
								</div>
							</div>
						{/if}

						<label class="form-control mt-4 w-full">
							<div class="label">
								<span class="label-text font-medium">Segment name*</span>
							</div>
							<input
								type="text"
								class="input input-bordered w-full"
								placeholder="Name this passage"
								value={collationState.segment?.name ?? ''}
								disabled={!collationState.segment}
								required
								aria-describedby="segment-name-hint"
								oninput={event =>
									collationState.setSegmentName(event.currentTarget.value)}
							/>
							<p id="segment-name-hint" class="mt-1 text-xs text-base-content/50">
								Shown as the passage reference in output.
							</p>
						</label>
					</div>
				{/if}
			</section>

			<section
				class="rounded-3xl border border-base-300/50 bg-base-100 p-4 shadow-md shadow-base-300/10"
			>
				<div class="mb-3 flex items-center justify-between">
					<h3 class="font-serif text-lg font-semibold text-base-content/85">Witnesses</h3>
					{#if matchingVerse}
						<span class="text-xs font-mono text-base-content/45"
							>{matchingVerse.identifier}</span
						>
					{/if}
				</div>

				{#if isLoadingWitnesses}
					<div
						class="flex items-center justify-center gap-2 rounded-box bg-base-200/70 p-6"
					>
						<span class="loading loading-spinner loading-md"></span>
						<span>Loading witnesses...</span>
					</div>
				{:else if !matchingVerse && collationState.orphanedMembers.length > 0}
					<div class="alert alert-warning">
						No witnesses were gathered: every selected segment member is orphaned.
					</div>
				{:else if !matchingVerse}
					<div class="flex h-48 items-center justify-center text-sm text-base-content/40">
						Choose a verse to load project witnesses.
					</div>
				{:else if collationState.witnesses.length === 0}
					<div class="alert alert-warning">
						No witnesses found for this verse within the project scope.
					</div>
				{:else}
					<div class="overflow-y-auto max-h-[58vh]">
						<table class="table table-sm w-full">
							<thead>
								<tr class="text-xs uppercase tracking-wider text-base-content/50">
									<th class="w-10"></th>
									<th>Siglum</th>
									<th>Text Preview</th>
									<th class="w-36">Treatment</th>
									<th class="w-40">Source</th>
									<th class="w-16 text-center">Base</th>
								</tr>
							</thead>
							<tbody>
								{#each collationState.witnesses as witness (witness.witnessId)}
									{@const witnessStatus = witnessStatusFor(witness.witnessId)}
									<tr
										class:opacity-40={witness.isExcluded}
										class="transition-opacity duration-200"
									>
										<td>
											<button
												type="button"
												class="btn btn-ghost btn-xs btn-circle"
												title={witness.isExcluded
													? 'Include witness'
													: 'Exclude witness'}
												onclick={() =>
													collationState.toggleWitnessExclusion(
														witness.witnessId
													)}
											>
												{#if witness.isExcluded}
													<EyeSlash size={16} class="text-error/70" />
												{:else}
													<Eye size={16} class="text-success/70" />
												{/if}
											</button>
										</td>
										<td>
											<div class="flex flex-wrap items-center gap-2">
												<span class="font-mono font-bold text-sm"
													>{witness.siglum}</span
												>
												<span
													class={`badge badge-xs ${isCorrectorWitness(witness) ? 'badge-secondary' : 'badge-ghost'}`}
												>
													{isCorrectorWitness(witness)
														? `Corrector${witness.handId ? ` · ${witness.handId}` : ''}`
														: 'First Hand'}
												</span>
											</div>
										</td>
										<td>
											<span
												class="line-clamp-1 font-greek text-sm text-base-content/70"
											>
												{witness.content}
											</span>
										</td>
										<td>
											{#if isCorrectorWitness(witness)}
												<button
													type="button"
													class="btn btn-xs gap-1 {treatmentBadge[
														witness.treatment
													]}"
													onclick={() =>
														collationState.updateWitness(
															witness.witnessId,
															{
																treatment: cycleTreatment(
																	witness.treatment
																),
															}
														)}
												>
													{#if witness.overridesDefault}
														<LinkBreak size={12} class="text-warning" />
													{:else}
														<LinkSimple size={12} class="opacity-50" />
													{/if}
													{treatmentLabel[witness.treatment]}
												</button>
											{:else}
												<span class="badge badge-ghost badge-sm"
													>First Hand</span
												>
											{/if}
										</td>
										<td>
											<div class="flex flex-col items-start gap-1">
												<button
													type="button"
													class="link link-hover text-left text-xs text-base-content/70"
													title="Choose witness source"
													disabled={refreshInFlight ||
														!witness.transcriptionId}
													onclick={() =>
														void openRefreshDialog(witness.witnessId)}
												>
													{formatWitnessSourceLabel(
														witness.source,
														witnessStatus?.sourceVersionLabel ?? null
													)}
												</button>
												{#if witnessStatus && witnessVersionStateLabel(witnessStatus.versionState)}
													<span
														class={`badge badge-xs whitespace-nowrap ${witnessVersionStateBadgeClass(witnessStatus.versionState)}`}
													>
														{witnessVersionStateLabel(
															witnessStatus.versionState
														)}
													</span>
												{/if}
												{#if canRefreshWitness(witnessStatus)}
													<button
														type="button"
														class="btn btn-xs btn-outline btn-secondary gap-1"
														disabled={refreshInFlight}
														onclick={() =>
															void openRefreshDialog(
																witness.witnessId
															)}
													>
														<ArrowsClockwise size={12} />
														Refresh
													</button>
												{/if}
											</div>
										</td>
										<td class="text-center">
											<input
												type="radio"
												name="baseText"
												class="radio radio-primary radio-xs"
												checked={witness.isBaseText}
												disabled={witness.isExcluded}
												onchange={() =>
													collationState.setBaseText(witness.witnessId)}
											/>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}

				<div class="mt-6 flex justify-end">
					<button
						type="button"
						class="btn btn-primary gap-2"
						disabled={!collationState.canAdvance()}
						onclick={async () => {
							let targetId = collationState.collationId;
							if (!targetId && collationState.segment?.members.length) {
								targetId = await collationState.createNewCollation(
									`Collation ${collationState.segment.name}`,
									collationState.segment.name
								);
							}
							collationState.setPhase('alignment');
							await collationState.flushPendingSave();
							// The alignment workspace is live during the flush; don't pull back an editor who moved on.
							if (targetId && collationState.phase === 'alignment') {
								await goto(
									resolve('/collation/[id]/[phase]', {
										id: targetId,
										phase: 'alignment',
									}),
									{
										replaceState: true,
									}
								);
							}
						}}
					>
						Proceed to Alignment
						<ArrowRight size={18} />
					</button>
				</div>
			</section>
		</div>
	</div>
</div>

{#if refreshWitnessId && refreshWitness}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<div
			class="absolute inset-0 bg-black/40"
			role="button"
			tabindex="-1"
			aria-label="Close source dialog"
			onclick={closeRefreshDialog}
			onkeydown={event => {
				if (event.key === 'Escape') closeRefreshDialog();
			}}
		></div>
		<div
			class="relative z-10 w-full max-w-lg rounded-box border border-base-300/60 bg-base-100 p-5 shadow-xl"
		>
			<div class="flex items-start justify-between gap-3">
				<div class="flex items-start gap-3">
					<div class="rounded-box bg-secondary/10 p-2 text-secondary">
						<ArrowsClockwise size={20} />
					</div>
					<div>
						<h2 class="font-serif text-lg font-semibold leading-tight">
							Choose witness source
						</h2>
						<p class="text-xs text-base-content/50">
							{refreshWitness.siglum} · now {formatWitnessSourceLabel(
								refreshWitness.source,
								witnessStatusFor(refreshWitness.witnessId)?.sourceVersionLabel ??
									null
							)}
						</p>
					</div>
				</div>
				<button
					type="button"
					class="btn btn-sm btn-circle btn-ghost"
					aria-label="Close source dialog"
					disabled={refreshInFlight}
					onclick={closeRefreshDialog}
				>
					<X size={16} />
				</button>
			</div>

			<div class="mt-4 space-y-3 text-sm">
				<p class="text-base-content/80">
					Replaces the witness text with a version of the transcription.
				</p>
				{#if refreshOptions}
					<SourceVersionPicker
						currentEditedAt={refreshOptions.currentEditedAt}
						versions={refreshOptions.versions}
						bind:value={selectedRefreshVersionId}
						disabled={refreshInFlight}
					/>
				{:else if !refreshError}
					<div class="flex items-center gap-2 text-xs text-base-content/60">
						<span class="loading loading-spinner loading-xs"></span>
						Loading versions...
					</div>
				{/if}
				<div
					class="flex items-start gap-2 rounded-box border border-warning/40 bg-warning/10 p-3 text-xs text-base-content/80"
				>
					<Warning size={16} class="mt-0.5 shrink-0 text-warning" />
					<span>
						Rebuilds alignment and readings. Clears classified readings and stemma.
					</span>
				</div>
				{#if refreshError}
					<p class="text-sm text-error" role="alert">{refreshError}</p>
				{/if}
			</div>

			<div class="mt-5 flex items-center justify-end gap-2">
				<button
					type="button"
					class="btn btn-sm btn-ghost"
					disabled={refreshInFlight}
					onclick={closeRefreshDialog}
				>
					Cancel
				</button>
				<form onsubmit={handleRefreshWitness}>
					<button
						type="submit"
						class="btn btn-sm btn-secondary gap-1"
						disabled={refreshInFlight || !refreshOptions}
					>
						{#if refreshInFlight}
							<span class="loading loading-spinner loading-xs"></span>
							Refreshing...
						{:else}
							<ArrowsClockwise size={14} />
							Use this source
						{/if}
					</button>
				</form>
			</div>
		</div>
	</div>
{/if}
