<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		collationState,
		type DisplayedColumnSlot,
		type ReadingEditorType,
		type ReadingFamilyView,
	} from '$lib/client/collation/collation-state.svelte';
	import type { ClassifiedReading } from '$lib/client/collation/collation-types';
	import type { VariationUnitSpan } from '$lib/client/collation/collation-variation-units';
	import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
	import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import CaretUp from 'phosphor-svelte/lib/CaretUp';
	import Plus from 'phosphor-svelte/lib/Plus';
	import Trash from 'phosphor-svelte/lib/Trash';
	import { SvelteSet } from 'svelte/reactivity';

	type BasetextSegment =
		| {
				kind: 'plain';
				id: string;
				text: string;
				label: string;
		  }
		| {
				kind: 'unit';
				id: string;
				text: string;
				label: string;
				span: VariationUnitSpan;
				ordinal: number;
		  };

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

	let spans = $derived(collationState.getVariationUnitSpans());
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

	let baseWitnessId = $derived(collationState.getBaseWitnessId());

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
		return spans.findIndex(span => span.startIndex === startIndex) + 1;
	}

	function getBaseTextForSpan(span: VariationUnitSpan): string {
		return collationState.getBaseTextForVariationUnit(span.startIndex) || 'om.';
	}

	function readingEditorType(reading: ClassifiedReading): ReadingEditorType {
		if (reading.isOmission) return 'om';
		if (reading.isLacuna) return 'lac';
		if (reading.parentReadingId !== null) return 'ns';
		if (reading.readingType === 'ns') return 'ns';
		return 'none';
	}

	function formatSlotLabel(start: number, end: number): string {
		return start === end ? String(start) : `${start}-${end}`;
	}

	function getSpanLabel(span: VariationUnitSpan, slots: DisplayedColumnSlot[]): string {
		const start = slots[span.startIndex];
		const end = slots[span.endIndex];
		if (!start || !end) return String(span.startIndex + 1);
		return formatSlotLabel(start.start, end.end);
	}

	function buildBasetextSegments(): BasetextSegment[] {
		const segments: BasetextSegment[] = [];
		const spanByStart = new Map(
			spans.map((span, index) => [span.startIndex, { span, ordinal: index + 1 }] as const)
		);
		const columns = collationState.alignmentColumns;
		const slots = collationState.getDisplayedColumnSlots();
		let columnIndex = 0;

		while (columnIndex < columns.length) {
			const variationEntry = spanByStart.get(columnIndex);
			const slot = slots[columnIndex];
			if (variationEntry) {
				segments.push({
					kind: 'unit',
					id: `unit-${variationEntry.span.startIndex}`,
					text: getBaseTextForSpan(variationEntry.span),
					label: getSpanLabel(variationEntry.span, slots),
					span: variationEntry.span,
					ordinal: variationEntry.ordinal,
				});
				columnIndex = variationEntry.span.endIndex + 1;
				continue;
			}

			const column = columns[columnIndex];
			const cell = baseWitnessId ? column?.cells.get(baseWitnessId) : null;
			const text = cell?.text?.trim() ?? '';
			if (text.length > 0) {
				segments.push({
					kind: 'plain',
					id: column?.id ?? `plain-${columnIndex}`,
					text,
					label: slot ? formatSlotLabel(slot.start, slot.end) : String(columnIndex + 1),
				});
			}
			columnIndex += 1;
		}

		return segments;
	}

	let basetextSegments = $derived(buildBasetextSegments());

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

	function handleDrop(targetReading: ClassifiedReading) {
		if (!selectedSpan || !draggedReadingId || !canDropOnTarget(targetReading)) return;
		const draggedReading = readings.find(reading => reading.id === draggedReadingId);
		collationState.moveReadingBefore(
			selectedSpan.startIndex,
			draggedReadingId,
			targetReading.id
		);
		liveMessage = `Moved ${draggedReading?.label ?? 'reading'} before ${targetReading.label}.`;
		draggedReadingId = null;
		dropTargetId = null;
	}

	function getSortedWitnesses(witnessIds: string[]): { id: string; siglum: string }[] {
		return witnessIds
			.map(id => ({ id, siglum: getWitnessSiglum(id) }))
			.sort((a, b) => a.siglum.localeCompare(b.siglum));
	}

	function moveReadingUp(reading: ClassifiedReading) {
		if (!selectedSpan) return;
		collationState.moveReadingByOffset(selectedSpan.startIndex, reading.id, -1);
		liveMessage = `Moved ${reading.label} up.`;
	}

	function moveReadingDown(reading: ClassifiedReading) {
		if (!selectedSpan) return;
		collationState.moveReadingByOffset(selectedSpan.startIndex, reading.id, 1);
		liveMessage = `Moved ${reading.label} down.`;
	}

	function toggleWitnessExpand(readingId: string) {
		if (expandedWitnesses.has(readingId)) expandedWitnesses.delete(readingId);
		else expandedWitnesses.add(readingId);
	}

	function autoFocusSelect(node: HTMLElement) {
		requestAnimationFrame(() => node.focus());
	}

	function getFamilyParentChoices(family: ReadingFamilyView): ClassifiedReading[] {
		return family.members;
	}

	function getSelectedUnitLabel(): string {
		if (!selectedSpan) return '';
		return getSpanLabel(selectedSpan, collationState.getDisplayedColumnSlots());
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
				{#each basetextSegments as segment (segment.id)}
					{#if segment.kind === 'plain'}
						<span class="inline-flex items-baseline gap-1 text-base-content/30">
							<span class="text-[0.65rem] font-medium text-base-content/20">
								{segment.label}
							</span>
							<span class="font-greek text-base">{segment.text}</span>
						</span>
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
							<span class="font-greek text-base leading-tight">{segment.text}</span>
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
						<th class="w-16 px-3 py-3">Type</th>
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
								if (!canDropOnTarget(row.reading)) return;
								event.preventDefault();
								dropTargetId = row.reading.id;
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
												onclick={() => moveReadingUp(row.reading)}
											>
												<CaretUp size={12} />
											</button>
											<button
												type="button"
												class="rounded p-0.5 text-base-content/20 hover:bg-base-200 hover:text-base-content/60"
												title="Move down"
												onclick={() => moveReadingDown(row.reading)}
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
										{#if row.parent}
											<div class="text-[0.6rem] text-base-content/35">
												↳ {row.parent.label}
											</div>
										{/if}
									</div>
								</div>
							</td>

							<!-- Type -->
							<td class="px-3 py-3">
								<select
									class="select select-bordered select-sm w-full"
									value={readingEditorType(row.reading)}
									onchange={event =>
										collationState.setReadingEditorType(
											selectedSpan.startIndex,
											row.reading.id,
											(event.currentTarget as HTMLSelectElement)
												.value as ReadingEditorType
										)}
								>
									<option value="none">-</option>
									<option value="om">om</option>
									<option value="lac">lac</option>
									<option value="ns">ns</option>
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
									<label
										class="flex items-center gap-1 text-xs text-base-content/35"
									>
										<span>family parent:</span>
										<select
											class="select select-ghost select-xs"
											value={row.family.parent.id}
											onchange={event =>
												collationState.promoteReadingAsFamilyParent(
													selectedSpan.startIndex,
													(event.currentTarget as HTMLSelectElement)
														.value
												)}
										>
											{#each getFamilyParentChoices(row.family) as candidate (candidate.id)}
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
				</tbody>
			</table>
		{/if}
	</div>
</div>
