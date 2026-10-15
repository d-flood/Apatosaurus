<script lang="ts">
	import type { CoherenceSettings } from '@apatosaurus/open-cbgm-wasm';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';

	import type { CbgmAnalysisPrefill } from '$lib/cbgm/cbgm-analysis-runs';
	import { buildCbgmInput } from '$lib/cbgm/cbgm-input';
	import {
		resolveReadingTypeVocabulary,
		type ReadingTypeDefinition,
	} from '$lib/collation/reading-types';
	import type {
		CbgmCollationSnapshot,
		CbgmCollationSnapshots,
	} from '$lib/db/repositories/cbgm-analyses';
	import CbgmNotifyOsOption from './CbgmNotifyOsOption.svelte';

	interface Props {
		collations: CbgmCollationSnapshot[];
		unavailable: CbgmCollationSnapshots['unavailable'];
		existingNames: readonly string[];
		readingTypes: readonly ReadingTypeDefinition[];
		prefill?: CbgmAnalysisPrefill | null;
		onStart: (request: {
			name: string;
			collationIds: string[];
			settings: CoherenceSettings;
			notifyOs: boolean;
			native: boolean;
		}) => Promise<void>;
	}

	let { collations, unavailable, existingNames, readingTypes, prefill, onStart }: Props =
		$props();

	const initial = untrack(() => ({
		name: prefill?.name ?? '',
		deselectedCollationIds: prefill
			? collations
					.map(collation => collation.collationId)
					.filter(id => !prefill.collationIds.includes(id))
			: [],
		settings: prefill?.settings ?? {
			minExtantUnits: null,
			minExtantProportion: null,
			excludedWitnesses: [],
			classicRules: false,
			mergeSplitReadings: false,
			droppedReadingTypes: [],
			includedCorrectors: [],
		},
	}));

	let name = $state(initial.name);
	let deselectedCollationIds = $state.raw<string[]>(initial.deselectedCollationIds);
	let draft = $state<CoherenceSettings>(initial.settings);
	let notifyOs = $state(false);
	let isStarting = $state(false);
	let error = $state<string | null>(null);

	const chosen = $derived(
		collations.filter(collation => !deselectedCollationIds.includes(collation.collationId))
	);
	const input = $derived(
		buildCbgmInput(
			chosen.map(collation => collation.document),
			draft
		)
	);
	const vocabulary = $derived(
		resolveReadingTypeVocabulary(readingTypes).filter(type => type.id !== 'omission')
	);
	const settings = $derived.by<CoherenceSettings>(() => {
		const snapshot = $state.snapshot(draft);
		return {
			...snapshot,
			excludedWitnesses: snapshot.excludedWitnesses.filter(siglum =>
				input.witnesses.includes(siglum)
			),
			includedCorrectors: snapshot.includedCorrectors.filter(siglum =>
				input.availableCorrectors.includes(siglum)
			),
			droppedReadingTypes: snapshot.droppedReadingTypes.filter(id =>
				vocabulary.some(type => type.id === id)
			),
		};
	});
	const isDuplicateName = $derived(
		existingNames.some(existing => nameKey(existing) === nameKey(name))
	);
	const thresholdProblem = $derived(
		draft.minExtantUnits !== null &&
			(!Number.isInteger(draft.minExtantUnits) || draft.minExtantUnits < 0)
			? 'Minimum extant units must be a whole number of 0 or more.'
			: draft.minExtantProportion !== null &&
				  (draft.minExtantProportion < 0 || draft.minExtantProportion > 1)
				? 'Minimum extant proportion must be between 0 and 1.'
				: null
	);
	const canStart = $derived(
		!isStarting &&
			name.trim() !== '' &&
			!isDuplicateName &&
			chosen.length > 0 &&
			input.blockingUnits.length === 0 &&
			thresholdProblem === null
	);

	function nameKey(value: string): string {
		return value.trim().toLocaleLowerCase();
	}

	function toggleCollation(collationId: string, checked: boolean) {
		deselectedCollationIds = checked
			? deselectedCollationIds.filter(id => id !== collationId)
			: [...deselectedCollationIds, collationId];
	}

	async function start(event: SubmitEvent) {
		event.preventDefault();
		if (!canStart) return;
		const native = event.submitter?.getAttribute('value') === 'native';
		isStarting = true;
		error = null;
		try {
			await onStart({
				name: name.trim(),
				collationIds: chosen.map(collation => collation.collationId),
				settings,
				notifyOs,
				native,
			});
			name = '';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to start the analysis.';
		} finally {
			isStarting = false;
		}
	}
</script>

<form class="space-y-4" onsubmit={start}>
	<label class="block space-y-1">
		<span class="text-sm font-medium">Name</span>
		<input
			class={['input input-bordered w-full', isDuplicateName && 'input-error']}
			bind:value={name}
			placeholder="e.g. Romans, first hands"
			aria-invalid={isDuplicateName}
		/>
	</label>
	{#if isDuplicateName}
		<p class="text-sm text-error" role="alert">
			This project already has an analysis with this name.
		</p>
	{/if}

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<fieldset class="fieldset min-w-0 rounded-box border border-base-300 p-3">
			<legend class="fieldset-legend">Collations</legend>
			{#if collations.length === 0 && unavailable.length === 0}
				<p class="text-sm text-base-content/55">No collations in this project yet.</p>
			{/if}
			{#each collations as collation (collation.collationId)}
				<label class="flex min-w-0 items-start gap-2 text-sm">
					<input
						type="checkbox"
						class="checkbox checkbox-sm mt-0.5"
						checked={!deselectedCollationIds.includes(collation.collationId)}
						onchange={event =>
							toggleCollation(collation.collationId, event.currentTarget.checked)}
					/>
					<span class="min-w-0 break-words">
						{collation.title}
						<span class="font-mono text-xs text-base-content/50"
							>{collation.segmentName}</span
						>
					</span>
				</label>
			{/each}
			{#each unavailable as collation (collation.collationId)}
				<div class="flex min-w-0 items-start gap-2 text-sm text-base-content/55">
					<input type="checkbox" class="checkbox checkbox-sm mt-0.5" disabled />
					<span class="min-w-0 break-words">
						{collation.title}
						<span class="block text-xs text-error">{collation.message}</span>
					</span>
				</div>
			{/each}
		</fieldset>

		<fieldset class="fieldset min-w-0 rounded-box border border-base-300 p-3">
			<legend class="fieldset-legend">Witnesses</legend>
			<div class="text-xs font-medium text-base-content/60">Correctors to include</div>
			{#if input.availableCorrectors.length === 0}
				<p class="text-sm text-base-content/55">First hands only.</p>
			{:else}
				<div class="flex flex-wrap gap-x-3 gap-y-1">
					{#each input.availableCorrectors as siglum (siglum)}
						<label class="flex items-center gap-1.5 font-mono text-sm">
							<input
								type="checkbox"
								class="checkbox checkbox-xs"
								value={siglum}
								bind:group={draft.includedCorrectors}
							/>
							{siglum}
						</label>
					{/each}
				</div>
			{/if}
			<div class="mt-2 text-xs font-medium text-base-content/60">Witnesses to exclude</div>
			{#if input.witnesses.length === 0}
				<p class="text-sm text-base-content/55">No witnesses in the chosen collations.</p>
			{:else}
				<div class="flex max-h-40 flex-wrap gap-x-3 gap-y-1 overflow-y-auto">
					{#each input.witnesses as siglum (siglum)}
						<label class="flex items-center gap-1.5 font-mono text-sm">
							<input
								type="checkbox"
								class="checkbox checkbox-xs"
								value={siglum}
								bind:group={draft.excludedWitnesses}
							/>
							{siglum}
						</label>
					{/each}
				</div>
			{/if}
		</fieldset>

		<fieldset class="fieldset min-w-0 rounded-box border border-base-300 p-3">
			<legend class="fieldset-legend">Fragmentary witnesses</legend>
			<label class="block space-y-1">
				<span class="text-sm">Minimum extant units</span>
				<input
					type="number"
					min="0"
					step="1"
					class="input input-bordered input-sm w-full"
					placeholder="No minimum"
					bind:value={draft.minExtantUnits}
				/>
			</label>
			<label class="block space-y-1">
				<span class="text-sm">Minimum extant proportion</span>
				<input
					type="number"
					min="0"
					max="1"
					step="0.01"
					class="input input-bordered input-sm w-full"
					placeholder="No minimum (0 to 1)"
					bind:value={draft.minExtantProportion}
				/>
			</label>
			{#if thresholdProblem}
				<p class="text-sm text-error">{thresholdProblem}</p>
			{/if}
		</fieldset>

		<fieldset class="fieldset min-w-0 rounded-box border border-base-300 p-3">
			<legend class="fieldset-legend">Rules</legend>
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					class="checkbox checkbox-sm"
					bind:checked={draft.classicRules}
				/>
				Classic CBGM rules
			</label>
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					class="checkbox checkbox-sm"
					bind:checked={draft.mergeSplitReadings}
				/>
				Count split readings as agreeing
			</label>
			<div class="mt-2 text-xs font-medium text-base-content/60">
				Drop main readings of these types
			</div>
			<div class="flex flex-wrap gap-x-3 gap-y-1">
				{#each vocabulary as type (type.id)}
					<label class="flex items-center gap-1.5 text-sm">
						<input
							type="checkbox"
							class="checkbox checkbox-xs"
							value={type.id}
							bind:group={draft.droppedReadingTypes}
						/>
						{type.label}
					</label>
				{/each}
			</div>
		</fieldset>
	</div>

	{#if input.siglumConflicts.length > 0}
		<div class="alert alert-warning alert-vertical items-start text-sm sm:alert-horizontal">
			<ul class="space-y-1">
				{#each input.siglumConflicts as conflict (conflict.siglum)}
					<li>
						<span class="font-mono">{conflict.siglum}</span> comes from {conflict
							.transcriptionIds.length} transcriptions. They will count as one witness.
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if input.blockingUnits.length > 0}
		<div class="alert alert-error alert-vertical items-start text-sm sm:alert-horizontal">
			<div class="min-w-0 space-y-1">
				<p>These units have no lemma reading. Choose one before starting.</p>
				<ul class="flex flex-wrap gap-x-3 gap-y-1">
					{#each input.blockingUnits as unit (`${unit.collationId}:${unit.unitId}`)}
						<li>
							<a
								class="link font-mono"
								href={resolve('/collation/[id]/[phase]', {
									id: unit.collationId,
									phase: 'readings',
								}) + `?unit=${encodeURIComponent(unit.unitId)}`}>{unit.label}</a
							>
						</li>
					{/each}
				</ul>
			</div>
		</div>
	{/if}

	<CbgmNotifyOsOption bind:checked={notifyOs} />

	{#if error}
		<div class="alert alert-error text-sm" role="alert">{error}</div>
	{/if}

	<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
		<button type="submit" class="btn btn-primary w-full sm:w-auto" disabled={!canStart}>
			{isStarting ? 'Starting...' : 'Start analysis'}
		</button>
		<button type="submit" value="native" class="btn w-full sm:w-auto" disabled={!canStart}>
			Compute natively
		</button>
		<p class="text-xs text-base-content/55">
			Compute natively freezes the inputs for open-cbgm on a workstation or cluster. Import
			its results on the analysis page.
		</p>
	</div>
</form>
