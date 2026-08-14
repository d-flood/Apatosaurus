<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		collationState,
		type ReadingFamilyView,
		type ReorderResult,
	} from '$lib/client/collation/collation-state.svelte';
	import { renderApparatusUnit } from '$lib/client/collation/collation-apparatus';
	import type { ClassifiedReading } from '$lib/client/collation/collation-types';
	import {
		CERTAINTY_LEVELS,
		findReadingTypeDefinition,
		type Certainty,
		type ReadingTypeDefinition,
	} from '$lib/client/collation/reading-types';
	import type { VariationUnitSpan } from '$lib/client/collation/collation-variation-units';
	import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
	import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import CaretUp from 'phosphor-svelte/lib/CaretUp';
	import Plus from 'phosphor-svelte/lib/Plus';
	import Trash from 'phosphor-svelte/lib/Trash';
	import { SvelteSet } from 'svelte/reactivity';

	type ReorderRefusal = Extract<ReorderResult, { ok: false }>['error'];

	type DisplayRow = {
		family: ReadingFamilyView;
		reading: ClassifiedReading;
		parent: ClassifiedReading | null;
		depth: number;
		canReorder: boolean;
	};

	let draggedReadingId = $state<string | null>(null);
	let dropTargetId = $state<string | null>(null);
	let liveMessage = $state('');
	let expandedWitnesses = new SvelteSet<string>();
	let reassigningWitnessId = $state<string | null>(null);

	const WITNESS_DISPLAY_LIMIT = 12;

	let segments = $derived(collationState.getSegmentSequence());
	let unitSegments = $derived(segments.filter(segment => segment.kind === 'unit'));
	let spans = $derived(unitSegments.map(segment => segment.span));
	let selectedSpan = $derived(
		spans.find(span => span.startIndex === collationState.selectedUnitIndex) ?? spans[0] ?? null
	);

	$effect(() => {
		if (selectedSpan && collationState.selectedUnitIndex !== selectedSpan.startIndex) {
			collationState.selectedUnitIndex = selectedSpan.startIndex;
		}
		if (selectedSpan) {
			collationState.primeReadingsForUnit(selectedSpan.startIndex);
		}
	});

	let selectedUnitKey = $derived(selectedSpan?.startIndex ?? null);

	$effect(() => {
		selectedUnitKey;
		expandedWitnesses.clear();
		reassigningWitnessId = null;
	});

	let readings = $derived(
		selectedSpan ? collationState.peekReadingsForUnit(selectedSpan.startIndex) : []
	);

	let readingFamilies = $derived(
		selectedSpan ? collationState.getReadingFamiliesForUnit(selectedSpan.startIndex) : []
	);

	let readingDisplayValues = $derived(
		selectedSpan ? collationState.getReadingDisplayValuesForUnit(selectedSpan.startIndex) : new Map()
	);

	let nonAttestation = $derived(
		selectedSpan
			? collationState.getNonAttestationForUnit(selectedSpan.startIndex)
			: { witnessIds: [], untranscribedWitnessIds: [] }
	);

	let hasNonAttestation = $derived(
		nonAttestation.witnessIds.length > 0 || nonAttestation.untranscribedWitnessIds.length > 0
	);

	let baseTextWitnessId = $derived(collationState.getBaseTextWitnessId());

	let lemmaReadingId = $derived(
		selectedSpan ? collationState.getLemmaReadingId(selectedSpan.startIndex) : null
	);

	let needsLemmaDecision = $derived(
		selectedSpan ? collationState.unitNeedsLemmaDecision(selectedSpan.startIndex) : false
	);

	let displayRows = $derived.by(() => {
		const rows: DisplayRow[] = [];
		for (const family of readingFamilies) {
			rows.push({
				family,
				reading: family.parent,
				parent: null,
				depth: 0,
				canReorder: readingFamilies.length > 1,
			});
			if (displayMode !== 'original') continue;
			for (const child of family.children) {
				rows.push({
					family,
					reading: child,
					parent: family.parent,
					depth: 1,
					canReorder: family.children.length > 1,
				});
			}
		}
		return rows;
	});

	let displayMode = $derived(collationState.alignmentDisplayMode);
	let readingTypeVocabulary = $derived(collationState.getReadingTypeVocabulary());

	let visibleDestinationReadings = $derived(
		displayMode === 'regularized'
			? readingFamilies.map(family => family.parent)
			: readingFamilies.flatMap(family => family.members)
	);

	let isSingleReading = $derived(readingFamilies.length <= 1);

	function getWitnessSiglum(witnessId: string): string {
		return (
			collationState.witnesses.find(witness => witness.witnessId === witnessId)?.siglum ??
			witnessId
		);
	}

	function getUnitOrdinal(startIndex: number): number {
		return (
			unitSegments.find(segment => segment.span.startIndex === startIndex)?.ordinal ?? 0
		);
	}

	function getBaseTextForSpan(span: VariationUnitSpan): string {
		return collationState.getBaseTextForVariationUnit(span.startIndex) || 'om.';
	}

	/**
	 * The options the type control offers, plus whatever the reading already carries. A type the
	 * aligner determined, or a project value dropped from the vocabulary, is reported but not
	 * selectable, so the control never misstates what is recorded.
	 */
	function readingTypeOptions(reading: ClassifiedReading): ReadingTypeDefinition[] {
		const options = readingTypeVocabulary.filter(type => type.selectable);
		const current = reading.readingType;
		if (current !== null && !options.some(type => type.id === current)) {
			const known = readingTypeVocabulary.find(type => type.id === current);
			options.unshift(
				known ?? { id: current, label: current, description: '', selectable: false }
			);
		}
		return options;
	}

	function certaintyOptions(reading: ClassifiedReading): string[] {
		const levels: string[] = [...CERTAINTY_LEVELS];
		return typeof reading.certainty === 'number'
			? [...levels, String(reading.certainty)]
			: levels;
	}

	function parseCertainty(value: string): Certainty | null {
		if (value === '') return null;
		if ((CERTAINTY_LEVELS as readonly string[]).includes(value)) return value as Certainty;
		const numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : null;
	}

	let selectedUnitSegment = $derived(
		unitSegments.find(segment => segment.span.startIndex === selectedSpan?.startIndex) ?? null
	);

	let apparatusNotation = $derived.by(() => {
		if (!selectedSpan || !selectedUnitSegment) return '';
		return renderApparatusUnit(collationState.peekUnitView(selectedSpan.startIndex), {
			label: selectedUnitSegment.label,
			siglumOf: getWitnessSiglum,
			nonAttestation,
			readingTypeLabelOf: readingType =>
				findReadingTypeDefinition(readingTypeVocabulary, readingType)?.label ?? readingType,
		});
	});

	function describeReading(reading: ClassifiedReading): string {
		if (reading.isOmission) return 'om.';
		if (reading.isLacuna) return 'lac.';
		return getDisplayedReadingText(reading) || 'empty reading';
	}

	function getDisplayedReadingText(reading: ClassifiedReading): string {
		const displayValue = readingDisplayValues.get(reading.id);
		if (displayMode === 'regularized') {
			if (displayValue && reading.normalizedText === displayValue.sourceNormalizedText) {
				return displayValue.regularizedDisplayText;
			}
			return reading.normalizedText ?? reading.text ?? '';
		}
		if (displayValue && reading.text === displayValue.sourceOriginalText) {
			return displayValue.originalDisplayText;
		}
		return reading.text ?? '';
	}

	function getDisplayedWitnessIds(reading: ClassifiedReading): string[] {
		if (!selectedSpan) return reading.witnessIds;
		return collationState.getDisplayedWitnessIdsForReading(
			selectedSpan.startIndex,
			reading.id,
			displayMode
		);
	}

	function canDropOnTarget(targetReading: ClassifiedReading): boolean {
		if (!draggedReadingId || draggedReadingId === targetReading.id) return false;
		const sourceReading = readings.find(reading => reading.id === draggedReadingId);
		if (!sourceReading) return false;
		return sourceReading.parentReadingId === targetReading.parentReadingId;
	}

	function describeReorderRefusal(error: ReorderRefusal, label: string): string {
		if (error === 'different-group')
			return `${label} can only be reordered within its own reading group.`;
		if (error === 'at-boundary') return `${label} is already at the edge of its group.`;
		return `${label} is no longer available to reorder.`;
	}

	function handleDrop(targetReading: ClassifiedReading) {
		if (!selectedSpan || !draggedReadingId) return;
		const draggedReading = readings.find(reading => reading.id === draggedReadingId);
		const label = draggedReading?.label ?? 'reading';
		const result = collationState.moveReadingBefore(
			selectedSpan.startIndex,
			draggedReadingId,
			targetReading.id
		);
		liveMessage = result.ok
			? `Moved ${label} before ${targetReading.label}.`
			: describeReorderRefusal(result.error, label);
		draggedReadingId = null;
		dropTargetId = null;
	}

	function getSortedWitnesses(witnessIds: string[]): { id: string; siglum: string }[] {
		return witnessIds
			.map(id => ({ id, siglum: getWitnessSiglum(id) }))
			.sort((a, b) => a.siglum.localeCompare(b.siglum));
	}

	function moveReading(reading: ClassifiedReading, offset: -1 | 1) {
		if (!selectedSpan) return;
		const result = collationState.moveReadingByOffset(
			selectedSpan.startIndex,
			reading.id,
			offset
		);
		liveMessage = result.ok
			? `Moved ${reading.label} ${offset === -1 ? 'up' : 'down'}.`
			: result.error === 'at-boundary'
				? `${reading.label} is already ${offset === -1 ? 'first' : 'last'} in its group.`
				: describeReorderRefusal(result.error, reading.label);
	}

	function establishLemma(reading: ClassifiedReading) {
		if (!selectedSpan) return;
		const result = collationState.setLemmaReading(selectedSpan.startIndex, reading.id);
		liveMessage = result.ok
			? `${describeReading(reading)} is now the lemma reading.`
			: 'Only a main reading can be the lemma.';
	}

	function toggleWitnessExpand(readingId: string) {
		if (expandedWitnesses.has(readingId)) expandedWitnesses.delete(readingId);
		else expandedWitnesses.add(readingId);
	}

	function autoFocusSelect(node: HTMLElement) {
		requestAnimationFrame(() => node.focus());
	}

	function getAttachmentOptions(readingId: string): ClassifiedReading[] {
		return readings.filter(
			reading => reading.parentReadingId === null && reading.id !== readingId
		);
	}

	function getSelectedUnitLabel(): string {
		return selectedUnitSegment?.label ?? '';
	}

	async function goToStemma() {
		if (!collationState.collationId) return;
		collationState.setPhase('readings');
		collationState.nextPhase();
		await goto(resolve('/collation/[id]/[phase]', {
			id: collationState.collationId,
			phase: 'stemma',
		}), {
			replaceState: true,
		});
	}

	async function goToAlignment() {
		if (!collationState.collationId) return;
		await goto(resolve('/collation/[id]/[phase]', {
			id: collationState.collationId,
			phase: 'alignment',
		}), {
			replaceState: true,
		});
	}
</script>

<div class="flex h-full flex-col gap-2">
	<!-- Basetext strip -->
	<div class="rounded-xl border border-base-300/50 bg-base-200/30 px-4 py-3">
		<div class="mb-2 flex items-center justify-between">
			<h2 class="text-xs font-semibold uppercase tracking-[0.2em] text-base-content/50">
				Readings Review
			</h2>
			<span class="text-xs text-base-content/30">Select a variation unit</span>
		</div>
		<div class="pb-1">
			<div class="flex flex-wrap items-baseline gap-1.5">
				{#each segments as segment (segment.kind === 'unit' ? `unit-${segment.span.startIndex}` : segment.columnIds.join('+'))}
					{#if segment.kind === 'agreed'}
						{#if segment.text.length > 0}
							<span class="inline-flex items-baseline gap-1 text-base-content/30">
								<span class="text-[0.65rem] font-medium text-base-content/20">
									{segment.label}
								</span>
								<span class="font-greek text-base">{segment.text}</span>
							</span>
						{/if}
					{:else}
						{@const isSelected = selectedSpan?.startIndex === segment.span.startIndex}
						<button
							type="button"
							class={[
								'inline-flex items-baseline gap-1.5 rounded-md px-2.5 py-1 transition',
								isSelected
									? 'bg-primary text-primary-content shadow-sm'
									: 'bg-base-300/40 text-base-content/70 hover:bg-base-300/70',
							]}
							onclick={() =>
								(collationState.selectedUnitIndex = segment.span.startIndex)}
						>
							<span class="font-greek text-base leading-tight"
								>{getBaseTextForSpan(segment.span)}</span
							>
							<span
								class={[
									'font-sans text-[0.65rem] font-medium',
									isSelected ? 'text-primary-content/60' : 'text-base-content/25',
								]}
							>
								{segment.label}
							</span>
						</button>
					{/if}
				{/each}
			</div>
		</div>
	</div>

	<!-- Live apparatus notation for the selected unit: real text, so it can be read out,
	     selected, and copied. -->
	{#if apparatusNotation}
		<section
			class="rounded-xl border border-base-300/50 bg-base-100 px-4 py-2"
			aria-label="Apparatus notation for the selected variation unit"
		>
			<p class="select-text font-greek text-sm leading-relaxed text-base-content/80">
				{apparatusNotation}
			</p>
		</section>
	{/if}

	<!-- Toolbar -->
	<div class="flex items-center justify-between gap-2">
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="btn btn-ghost btn-sm gap-1"
				disabled={!collationState.collationId}
				onclick={goToAlignment}
			>
				<ArrowLeft size={14} />
				Alignment
			</button>
			{#if selectedSpan}
				<span class="text-sm text-base-content/40">
					Unit {getUnitOrdinal(selectedSpan.startIndex)} · ids {getSelectedUnitLabel()}
				</span>
			{/if}
		</div>
		<div class="flex items-center gap-1.5">
			<div class="join">
				<input
					class="join-item btn btn-xs"
					type="radio"
					name="readings-display-mode"
					aria-label="Original"
					checked={displayMode === 'original'}
					onchange={() => collationState.setAlignmentDisplayMode('original')}
				/>
				<input
					class="join-item btn btn-xs"
					type="radio"
					name="readings-display-mode"
					aria-label="Regularized"
					checked={displayMode === 'regularized'}
					onchange={() => collationState.setAlignmentDisplayMode('regularized')}
				/>
			</div>
			<button
				type="button"
				class="btn btn-primary btn-sm gap-1"
				disabled={!selectedSpan}
				onclick={() => selectedSpan && collationState.addReading(selectedSpan.startIndex)}
			>
				<Plus size={14} />
				Reading
			</button>
			<button
				type="button"
				class="btn btn-secondary btn-sm gap-1"
				disabled={!collationState.collationId}
				onclick={goToStemma}
			>
				Stemma
				<ArrowRight size={14} />
			</button>
		</div>
	</div>

	<div class="sr-only" aria-live="polite">{liveMessage}</div>

	{#if needsLemmaDecision}
		<div
			class="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-base-content/70"
		>
			The base text does not testify here, so this unit has no lemma. Choose the reading to
			establish as <span class="font-mono">a</span>.
		</div>
	{/if}

	<!-- Readings table -->
	<div class="min-h-0 flex-1 overflow-auto rounded-xl border border-base-300/50 bg-base-100">
		{#if !selectedSpan}
			<div class="flex h-full items-center justify-center p-6 text-sm text-base-content/35">
				No variation units available. Return to alignment to adjust the collation.
			</div>
		{:else}
			<table class="w-full border-collapse">
				<thead>
					<tr
						class="sticky top-0 z-10 border-b-2 border-primary bg-base-200 text-left text-sm font-semibold text-base-content"
					>
						<th class="w-12 px-4 py-3">ID</th>
						<th class="w-40 px-3 py-3">Type</th>
						<th class="w-72 px-3 py-3">Reading</th>
						<th class="px-3 py-3">Witnesses</th>
						<th class="w-20 px-3 py-3"></th>
					</tr>
				</thead>
				<tbody>
					{#if isSingleReading && displayRows.length === 1}
						<tr>
							<td
								colspan="5"
								class="px-4 py-2 text-center text-sm text-base-content/30"
							>
								Unanimous — single reading
							</td>
						</tr>
					{/if}
					{#each displayRows as row (row.reading.id)}
						{@const sortedWitnesses = getSortedWitnesses(getDisplayedWitnessIds(row.reading))}
						{@const isExpanded = expandedWitnesses.has(row.reading.id)}
						{@const visibleWitnesses = isExpanded
							? sortedWitnesses
							: sortedWitnesses.slice(0, WITNESS_DISPLAY_LIMIT)}
						{@const overflowCount = sortedWitnesses.length - WITNESS_DISPLAY_LIMIT}

						<tr
							class={[
								'border-b border-base-300/40 align-top transition',
								row.depth === 0 ? 'bg-base-100' : 'bg-base-200/25',
								dropTargetId === row.reading.id ? 'ring-2 ring-inset ring-primary/40' : '',
							]}
							ondragover={event => {
								if (!draggedReadingId || draggedReadingId === row.reading.id) return;
								// Accept the drop even where it will be refused, so the refusal
								// is explained rather than the drag silently doing nothing.
								event.preventDefault();
								dropTargetId = canDropOnTarget(row.reading) ? row.reading.id : null;
							}}
							ondragleave={() => {
								if (dropTargetId === row.reading.id) dropTargetId = null;
							}}
							ondrop={event => {
								event.preventDefault();
								handleDrop(row.reading);
							}}
						>
							<!-- ID + reorder -->
							<td class="px-4 py-3">
								<div
									class="flex items-center gap-1"
									style:padding-left="{row.depth * 1.5}rem"
								>
									{#if row.canReorder}
										<div class="flex flex-col items-center">
											<button
												type="button"
												class="rounded p-0.5 text-base-content/20 hover:bg-base-200 hover:text-base-content/60"
												title="Move up"
												onclick={() => moveReading(row.reading, -1)}
											>
												<CaretUp size={12} />
											</button>
											<button
												type="button"
												class="rounded p-0.5 text-base-content/20 hover:bg-base-200 hover:text-base-content/60"
												title="Move down"
												onclick={() => moveReading(row.reading, 1)}
											>
												<CaretDown size={12} />
											</button>
										</div>
									{/if}
									<div>
										<span
											class="whitespace-nowrap font-mono text-sm font-medium text-base-content"
											>{row.reading.label}</span
										>
										{#if row.reading.id === lemmaReadingId}
											<div class="text-[0.6rem] font-medium text-primary">
												lemma
											</div>
										{:else if baseTextWitnessId && row.reading.witnessIds.includes(baseTextWitnessId)}
											<div class="text-[0.6rem] text-base-content/35">
												base text
											</div>
										{/if}
										{#if row.parent}
											<div class="text-[0.6rem] text-base-content/35">
												↳ {row.parent.label}
											</div>
										{/if}
									</div>
								</div>
							</td>

							<!-- Type -->
							<td class="space-y-1 px-3 py-3">
								<select
									class="select select-bordered select-sm w-full"
									aria-label="Reading type"
									value={row.reading.readingType ?? ''}
									onchange={event =>
										collationState.setReadingType(
											selectedSpan.startIndex,
											row.reading.id,
											(event.currentTarget as HTMLSelectElement).value || null
										)}
								>
									<option value="">-</option>
									{#each readingTypeOptions(row.reading) as type (type.id)}
										<option
											value={type.id}
											disabled={!type.selectable}
											title={type.description}>{type.label}</option
										>
									{/each}
								</select>
								<select
									class="select select-bordered select-xs w-full"
									aria-label="Certainty"
									value={row.reading.certainty === null
										? ''
										: String(row.reading.certainty)}
									onchange={event =>
										collationState.setReadingCertainty(
											selectedSpan.startIndex,
											row.reading.id,
											parseCertainty(
												(event.currentTarget as HTMLSelectElement).value
											)
										)}
								>
									<option value="">certainty -</option>
									{#each certaintyOptions(row.reading) as level (level)}
										<option value={level}>{level}</option>
									{/each}
								</select>
							</td>

							<!-- Reading text -->
							<td class="px-3 py-3">
								<input
									class="input input-bordered input-sm w-full font-greek text-base"
									disabled={row.reading.isOmission || row.reading.isLacuna}
									value={getDisplayedReadingText(row.reading)}
									placeholder={row.reading.isOmission
										? 'om.'
										: row.reading.isLacuna
											? 'lac.'
											: 'Reading text'}
									onchange={event =>
										collationState.updateReadingTextForDisplayMode(
											selectedSpan.startIndex,
											row.reading.id,
											(event.currentTarget as HTMLInputElement).value,
											displayMode
										)}
								/>
								<div class="mt-1.5 flex items-center gap-2">
									{#if row.depth === 0}
										<button
											type="button"
											class="btn btn-ghost btn-xs gap-0.5 text-xs"
											onclick={() =>
												collationState.addReading(selectedSpan.startIndex, {
													parentReadingId: row.reading.id,
												})}
										>
											<Plus size={11} />
											sub
										</button>
									{/if}
									<label class="flex items-center gap-1 text-xs text-base-content/35">
										<span>Attach as subreading of:</span>
										<select
											class="select select-ghost select-xs"
											value={row.reading.parentReadingId ?? ''}
											onchange={event =>
												collationState.setReadingParent(
													selectedSpan.startIndex,
													row.reading.id,
													(event.currentTarget as HTMLSelectElement).value || null
												)}
										>
											<option value="">Independent reading</option>
											{#each getAttachmentOptions(row.reading.id) as candidate (candidate.id)}
												<option value={candidate.id}
													>{candidate.label}: {describeReading(candidate)}</option
												>
											{/each}
										</select>
									</label>
								</div>
							</td>

							<!-- Witnesses -->
							<td class="px-3 py-3">
								{#if row.reading.witnessIds.length === 0}
									<span class="text-sm italic text-base-content/25">—</span>
								{:else}
									<div
										class={[
											'text-sm leading-relaxed',
											isExpanded && sortedWitnesses.length > 50
												? 'max-h-48 overflow-y-auto'
												: '',
										]}
									>
										{#each visibleWitnesses as witness, i (witness.id)}
											{#if reassigningWitnessId === witness.id}
												<span
													class="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5"
												>
													<span
														class="font-mono text-sm font-semibold text-primary"
														>{witness.siglum}</span
													>
													<span class="text-xs text-base-content/30"
														>→</span
													>
													<select
														class="select select-bordered select-xs text-xs"
														value={row.reading.id}
														use:autoFocusSelect
														onchange={event => {
															collationState.moveWitnessToReading(
																selectedSpan.startIndex,
																witness.id,
																(
																	event.currentTarget as HTMLSelectElement
																).value
															);
															reassigningWitnessId = null;
														}}
														onkeydown={event => {
															if (event.key === 'Escape') {
																event.preventDefault();
																reassigningWitnessId = null;
															}
														}}
													>
														{#each visibleDestinationReadings as dest (dest.id)}
															<option value={dest.id}>
																{dest.label}: {describeReading(
																	dest
																)}
															</option>
														{/each}
													</select>
													<button
														type="button"
														class="text-xs text-base-content/30 hover:text-base-content/60"
														onclick={() =>
															(reassigningWitnessId = null)}
													>
														✕
													</button>
												</span>
											{:else}
												<button
													type="button"
													class="font-mono text-sm text-base-content/70 transition hover:text-primary hover:underline"
													title={`Reassign ${witness.siglum}`}
													onclick={() =>
														(reassigningWitnessId = witness.id)}
													>{witness.siglum}</button
												>
											{/if}{#if i < visibleWitnesses.length - 1}<span
													class="text-base-content/20"
													>.
												</span>{/if}
										{/each}
										{#if overflowCount > 0 && !isExpanded}
											<button
												type="button"
												class="ml-1 text-sm text-primary/50 hover:text-primary hover:underline"
												onclick={() => toggleWitnessExpand(row.reading.id)}
											>
												+{overflowCount} more
											</button>
										{:else if overflowCount > 0}
											<button
												type="button"
												class="ml-1 text-sm text-primary/50 hover:text-primary hover:underline"
												onclick={() => toggleWitnessExpand(row.reading.id)}
											>
												show less
											</button>
										{/if}
									</div>
								{/if}
							</td>

							<!-- Actions -->
							<td class="px-3 py-3 text-right">
								{#if row.depth === 0 && row.reading.id !== lemmaReadingId}
									<button
										type="button"
										class="btn btn-ghost btn-xs text-xs text-base-content/40 hover:text-primary"
										title="Establish this reading as the lemma"
										onclick={() => establishLemma(row.reading)}
									>
										lemma
									</button>
								{/if}
								<button
									type="button"
									class="btn btn-ghost btn-sm text-base-content/30 hover:text-error"
									disabled={row.reading.witnessIds.length > 0}
									title={row.reading.witnessIds.length > 0
										? 'Remove witnesses first'
										: 'Delete reading'}
									onclick={() =>
										collationState.deleteReading(
											selectedSpan.startIndex,
											row.reading.id
										)}
								>
									<Trash size={14} />
								</button>
							</td>
						</tr>
					{/each}

					<!-- Non-attestation is not a reading: pinned last, unlettered, and its sigla are
					     plain text because there is nothing to move or merge them into. -->
					{#if hasNonAttestation}
						<tr class="border-t-2 border-base-300 bg-base-200/40 align-top">
							<td class="px-4 py-3">
								<span class="font-mono text-sm text-base-content/40">—</span>
							</td>
							<td colspan="2" class="px-3 py-3">
								<div class="text-sm font-medium text-base-content/60">
									Does not testify
								</div>
								<div class="mt-0.5 text-xs text-base-content/40">
									Damaged, lost, or illegible. Takes no letter and no place in the
									local stemma.
								</div>
							</td>
							<td class="px-3 py-3 text-sm leading-relaxed">
								{#if nonAttestation.witnessIds.length > 0}
									<div class="text-base-content/60">
										{getSortedWitnesses(nonAttestation.witnessIds)
											.map(witness => witness.siglum)
											.join('. ')}
									</div>
								{/if}
								{#if nonAttestation.untranscribedWitnessIds.length > 0}
									<div class="mt-1 text-xs text-base-content/40">
										<span class="uppercase tracking-wide">Not yet transcribed</span>:
										{getSortedWitnesses(nonAttestation.untranscribedWitnessIds)
											.map(witness => witness.siglum)
											.join('. ')}
									</div>
								{/if}
							</td>
							<td class="px-3 py-3"></td>
						</tr>
					{/if}
				</tbody>
			</table>
		{/if}
	</div>
</div>
