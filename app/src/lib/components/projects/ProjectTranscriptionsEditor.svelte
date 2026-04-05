<script lang="ts">
	import type { ProjectTranscriptionOption } from '$lib/client/collation/project-collation';
	import type { WitnessTreatment } from '$lib/client/collation/collation-types';

	let {
		allTranscriptions,
		selectedTranscriptionIds,
		isLoading = false,
		isSaving = false,
		getTreatment,
		isHandIncluded,
		setTreatment,
		setHandIncluded,
		setAllTreatments,
		onToggleTranscription,
		onToggleAllTranscriptions = undefined,
	} = $props<{
		allTranscriptions: ProjectTranscriptionOption[];
		selectedTranscriptionIds: string[];
		isLoading?: boolean;
		isSaving?: boolean;
		getTreatment: (transcriptionId: string) => WitnessTreatment;
		isHandIncluded: (transcriptionId: string, handId: string) => boolean;
		setTreatment: (transcriptionId: string, treatment: WitnessTreatment) => void;
		setHandIncluded: (
			transcriptionId: string,
			handId: string,
			included: boolean,
		) => Promise<void> | void;
		setAllTreatments: (transcriptionIds: string[], treatment: WitnessTreatment) => void;
		onToggleTranscription: (transcriptionId: string) => Promise<void> | void;
		onToggleAllTranscriptions?: (checked: boolean) => Promise<void> | void;
	}>();

	function normalizeWitnessTreatment(treatment: WitnessTreatment): 'full' | 'fragmentary' {
		return treatment === 'full' ? 'full' : 'fragmentary';
	}

	function getHandKindLabel(kind: ProjectTranscriptionOption['hands'][number]['kind']): string {
		return kind === 'corrector' ? 'Corrector' : 'Base';
	}

	let allSelected = $derived(
		allTranscriptions.length > 0 &&
			allTranscriptions.every((t: ProjectTranscriptionOption) => selectedTranscriptionIds.includes(t.id)),
	);
	let someSelected = $derived(
		!allSelected &&
			allTranscriptions.some((t: ProjectTranscriptionOption) => selectedTranscriptionIds.includes(t.id)),
	);

	function setIndeterminate(value: boolean) {
		return (node: HTMLInputElement) => {
			$effect(() => {
				node.indeterminate = value;
			});
		};
	}

	async function handleSelectAll(checked: boolean) {
		if (onToggleAllTranscriptions) {
			await onToggleAllTranscriptions(checked);
		} else {
			const allIds = allTranscriptions.map((t: ProjectTranscriptionOption) => t.id);
			if (checked) {
				for (const id of allIds) {
					if (!selectedTranscriptionIds.includes(id)) {
						await onToggleTranscription(id);
					}
				}
			} else {
				for (const id of [...selectedTranscriptionIds]) {
					await onToggleTranscription(id);
				}
			}
		}
	}

	let allSelectedWitnessesFull = $derived(
		selectedTranscriptionIds.length > 0 &&
			selectedTranscriptionIds.every(
				(transcriptionId: string) =>
					normalizeWitnessTreatment(getTreatment(transcriptionId)) === 'full',
			),
	);
</script>

<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<div class="mb-3 flex items-center justify-between gap-3">
		<div>
			<h2 class="font-serif text-lg font-semibold">Project Transcriptions</h2>
			<p class="text-xs text-base-content/50">
				Choose which linked transcriptions can supply verses, first-hand witnesses, and corrector hands.
			</p>
		</div>
		{#if isSaving}
			<span class="loading loading-spinner loading-xs"></span>
		{/if}
	</div>

	<div
		class="mb-3 flex items-center justify-between gap-4 rounded-box border border-base-300/50 bg-base-200/40 px-3 py-2.5"
	>
		<div>
			<div class="text-sm font-medium">Corrector treatment</div>
			<div class="text-xs text-base-content/50">
				Apply a full or fragmentary witness treatment to corrector hands from all selected transcriptions.
			</div>
		</div>
		<label class="flex items-center gap-3">
			<span
				class={`text-xs ${!allSelectedWitnessesFull ? 'font-semibold text-base-content/85' : 'text-base-content/50'}`}
			>
				Fragmentary
			</span>
			<input
				type="checkbox"
				class="toggle toggle-sm toggle-primary"
				checked={allSelectedWitnessesFull}
				disabled={selectedTranscriptionIds.length === 0}
				onchange={(event) =>
					setAllTreatments(
						selectedTranscriptionIds,
						(event.currentTarget as HTMLInputElement).checked ? 'full' : 'fragmentary',
					)}
			/>
			<span
				class={`text-xs ${allSelectedWitnessesFull ? 'font-semibold text-base-content/85' : 'text-base-content/50'}`}
			>
				Full
			</span>
		</label>
	</div>

	{#if isLoading}
		<div class="flex items-center gap-2 rounded-box bg-base-200/70 p-4 text-sm text-base-content/60">
			<span class="loading loading-spinner loading-sm"></span>
			Loading project scope...
		</div>
	{:else if allTranscriptions.length === 0}
		<div class="rounded-box border border-dashed border-base-300/80 p-4 text-sm text-base-content/55">
			No transcriptions available yet.
		</div>
	{:else}
		<div class="mb-2 flex items-center gap-2 px-1">
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				checked={allSelected}
				disabled={isSaving || allTranscriptions.length === 0}
				onchange={(event) => handleSelectAll((event.currentTarget as HTMLInputElement).checked)}
				{@attach setIndeterminate(someSelected)}
			/>
			<span class="text-xs text-base-content/50">
				Select all ({allTranscriptions.length})
			</span>
		</div>
		<div class="max-h-[24rem] space-y-1 overflow-y-auto pr-1">
			{#each allTranscriptions as transcription (transcription.id)}
				<div
					class="rounded-box border border-base-300/50 bg-base-100 px-3 py-2 transition-colors hover:border-info/40"
				>
					<div class="flex items-start gap-3">
						<label class="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
							<input
								type="checkbox"
								class="checkbox checkbox-sm"
								checked={selectedTranscriptionIds.includes(transcription.id)}
								disabled={isSaving}
								onchange={() => onToggleTranscription(transcription.id)}
							/>
							<div class="min-w-0 flex-1">
								<div class="font-mono text-sm font-bold">{transcription.displayLabel}</div>
								{#if transcription.title}
									<div class="text-xs text-base-content/40">{transcription.title}</div>
								{/if}
								{#if transcription.description}
									<div class="line-clamp-1 text-xs text-base-content/50">{transcription.description}</div>
								{/if}
								<div class="mt-1 text-[11px] text-base-content/45">
									Corrector treatment stays separate from per-hand inclusion below.
								</div>
							</div>
						</label>
						<div class="ml-auto flex items-center gap-1.5 self-center pl-2" data-treatment-control>
							<span
								class={`text-[11px] ${normalizeWitnessTreatment(getTreatment(transcription.id)) !== 'full' ? 'font-semibold text-base-content/85' : 'text-base-content/50'}`}
							>
								Frag.
							</span>
							<input
								type="checkbox"
								class="toggle toggle-xs toggle-primary"
								checked={normalizeWitnessTreatment(getTreatment(transcription.id)) === 'full'}
								disabled={!selectedTranscriptionIds.includes(transcription.id)}
								onchange={(event) =>
									setTreatment(
										transcription.id,
										(event.currentTarget as HTMLInputElement).checked ? 'full' : 'fragmentary',
									)}
							/>
							<span
								class={`text-[11px] ${normalizeWitnessTreatment(getTreatment(transcription.id)) === 'full' ? 'font-semibold text-base-content/85' : 'text-base-content/50'}`}
							>
								Full
							</span>
						</div>
					</div>

					{#if transcription.hands.length > 1}
						<div
							class="mt-2 ml-7 space-y-1.5 border-t border-base-300/40 pt-2"
							data-hand-control
						>
							<div class="text-[11px] font-medium uppercase tracking-wide text-base-content/45">
								Included hands
							</div>
							{#each transcription.hands as hand (hand.id)}
								<label class="flex items-center justify-between gap-3 rounded-box bg-base-200/35 px-2 py-1.5">
									<div class="min-w-0">
										<div class="flex items-center gap-2 text-xs font-medium text-base-content/80">
											<span class="truncate">{hand.label}</span>
											<span class="badge badge-ghost badge-xs">{getHandKindLabel(hand.kind)}</span>
											{#if hand.isBaseHand}
												<span class="badge badge-primary badge-xs">Default</span>
											{/if}
										</div>
									</div>
									<input
										type="checkbox"
										class="checkbox checkbox-xs"
										checked={isHandIncluded(transcription.id, hand.id)}
										disabled={!selectedTranscriptionIds.includes(transcription.id) || isSaving}
										onchange={(event) =>
											setHandIncluded(
												transcription.id,
												hand.id,
												(event.currentTarget as HTMLInputElement).checked,
											)}
									/>
								</label>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
