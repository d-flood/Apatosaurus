<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { gatherWitnessesForVerse } from '$lib/client/collation/collation-runner';
	import {
		collationState,
		type WitnessConfig,
		type WitnessTreatment,
	} from '$lib/client/collation/collation-state.svelte';
	import { gatherVerses, type AggregatedVerse } from '$lib/client/collation/gather-verses';
	import {
		getProjectTranscriptionIds,
		listTranscriptions,
		syncProjectTranscriptionIds,
		type ProjectTranscriptionOption,
	} from '$lib/client/collation/project-collation';
	import {
		rebuildVerseIndexForTranscriptions,
		type VerseIndexRebuildProgress,
	} from '$lib/client/transcription/verse-index';
	import ProjectCollationSettingsEditor from '$lib/components/projects/ProjectCollationSettingsEditor.svelte';
	import ProjectTranscriptionsEditor from '$lib/components/projects/ProjectTranscriptionsEditor.svelte';
	import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
	import ArrowsClockwise from 'phosphor-svelte/lib/ArrowsClockwise';
	import Eye from 'phosphor-svelte/lib/Eye';
	import EyeSlash from 'phosphor-svelte/lib/EyeSlash';
	import FolderOpen from 'phosphor-svelte/lib/FolderOpen';
	import LinkBreak from 'phosphor-svelte/lib/LinkBreak';
	import LinkSimple from 'phosphor-svelte/lib/LinkSimple';

	let verses = $state<AggregatedVerse[]>([]);
	let allTranscriptions = $state<ProjectTranscriptionOption[]>([]);
	let selectedTranscriptionIds = $state<string[]>([]);
	let isLoadingSetup = $state(true);
	let isLoadingWitnesses = $state(false);
	let isSavingTranscriptions = $state(false);
	let isRebuildingVerseIndex = $state(false);
	let error = $state<string | null>(null);
	let statusMessage = $state<string | null>(null);
	let setupLoadedForProject: string | null = null;
	let verseFilter = $state('');
	let rebuildProgress = $state<VerseIndexRebuildProgress | null>(null);

	let matchingVerse = $derived(
		verses.find(
			v =>
				v.book === collationState.selectedBook &&
				v.chapter === collationState.selectedChapter &&
				v.verse === collationState.selectedVerseNum
		) ?? null
	);
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

	$effect(() => {
		const currentProjectId = collationState.projectId;
		if (!currentProjectId) return;
		if (setupLoadedForProject === currentProjectId) return;
		setupLoadedForProject = currentProjectId;
		void (async () => {
			isLoadingSetup = true;
			error = null;
			statusMessage = null;
			try {
				allTranscriptions = await listTranscriptions();
				selectedTranscriptionIds = await getProjectTranscriptionIds(currentProjectId);
				await reloadVerses();
			} catch (err) {
				error = err instanceof Error ? err.message : 'Failed to load setup data';
			} finally {
				isLoadingSetup = false;
			}
		})();
	});

	$effect(() => {
		if (
			matchingVerse &&
			collationState.selectedVerse?.identifier !== matchingVerse.identifier &&
			!isLoadingWitnesses &&
			selectedTranscriptionIds.length > 0
		) {
			const verse = matchingVerse;
			void (async () => {
				isLoadingWitnesses = true;
				error = null;
				try {
					const prepared = await gatherWitnessesForVerse(
						verse.identifier,
						selectedTranscriptionIds,
						{
							ignoreWordBreaks: collationState.ignoreWordBreaks,
						}
					);
					const configs: WitnessConfig[] = prepared.map((witness, index) => ({
						witnessId: witness.id,
						siglum: witness.siglum,
						transcriptionId: witness.transcriptionUid,
						kind: witness.kind,
						handId: witness.handId,
						sourceVersion: witness.sourceVersion,
						content: witness.content,
						tokens: witness.tokens,
						fullContent: witness.fullContent,
						fullTokens: witness.fullTokens,
						fragmentaryContent: witness.fragmentaryContent,
						fragmentaryTokens: witness.fragmentaryTokens,
						treatment: witness.kind === 'corrector' ? 'inherit' : 'full',
						isBaseText: index === 0,
						isExcluded: false,
						overridesDefault: false,
					}));
					collationState.setWitnesses(configs);
					collationState.selectedVerse = verse;
				} catch (err) {
					error = err instanceof Error ? err.message : 'Failed to load witnesses';
				} finally {
					isLoadingWitnesses = false;
				}
			})();
		}
	});

	async function toggleProjectTranscription(transcriptionId: string) {
		if (!collationState.projectId) return;
		isSavingTranscriptions = true;
		error = null;
		statusMessage = null;
		try {
			const nextIds = selectedTranscriptionIds.includes(transcriptionId)
				? selectedTranscriptionIds.filter(id => id !== transcriptionId)
				: [...selectedTranscriptionIds, transcriptionId];
			await syncProjectTranscriptionIds(collationState.projectId, nextIds);
			selectedTranscriptionIds = nextIds;
			collationState.setWitnesses([]);
			collationState.selectedVerse = null;
			collationState.selectedBook = '';
			collationState.selectedChapter = '';
			collationState.selectedVerseNum = '';
			await reloadVerses();
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

	async function chooseDifferentProject() {
		if (collationState.collationId) return;
		await collationState.clearProjectSelection();
		await goto(resolve('/collation/new'), { replaceState: true });
	}

	function selectVerse(verse: AggregatedVerse) {
		collationState.selectedBook = verse.book;
		collationState.selectedChapter = verse.chapter;
		collationState.selectedVerseNum = verse.verse;
		collationState.setWitnesses([]);
		collationState.selectedVerse = null;
	}
</script>

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
					collationState.applyRegularization();
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
				Changing transcription preprocessing may rebuild downstream alignment and readings.
			</div>
		</div>
	</div>

	<div class="min-h-0 flex-1 min-w-0">
		<div class="mb-4 flex items-center justify-between">
			<div>
				<h2 class="font-serif text-2xl font-bold tracking-tight text-base-content/90">
					Textual Scope
				</h2>
				<p class="text-sm text-base-content/55">
					Choose a verse from the currently linked project transcriptions and review the
					witnesses that will enter collation.
				</p>
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
					Project scope is empty right now. Select transcriptions in the sidebar to
					populate the available verses and witnesses.
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
												matchingVerse?.identifier === verse.identifier
													? 'border-primary/40 bg-primary/10'
													: 'border-base-300/40 bg-base-100'
											}`}
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
									<th class="w-16 text-center">Base</th>
								</tr>
							</thead>
							<tbody>
								{#each collationState.witnesses as witness (witness.witnessId)}
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
							if (!targetId && matchingVerse) {
								targetId = await collationState.createNewCollation(
									`Collation ${matchingVerse.identifier}`,
									matchingVerse.identifier
								);
							}
							collationState.setPhase('alignment');
							if (targetId) {
								await goto(resolve('/collation/[id]/[phase]', { id: targetId, phase: 'alignment' }), {
									replaceState: true,
								});
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
