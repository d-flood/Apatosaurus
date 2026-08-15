<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		collationState,
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
	import DotsThreeVertical from 'phosphor-svelte/lib/DotsThreeVertical';
	import Plus from 'phosphor-svelte/lib/Plus';
	import Trash from 'phosphor-svelte/lib/Trash';
	import { tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	type ReorderRefusal = Extract<ReorderResult, { ok: false }>['error'];

	/** A reading and how deep it sits inside its main reading's card. */
	type CardNode = { reading: ClassifiedReading; depth: number };
	type Card = { main: ClassifiedReading; nodes: CardNode[] };

	const WITNESS_DISPLAY_LIMIT = 12;
	const NO_VALUE = '';

	let liveMessage = $state('');
	let expandedWitnesses = new SvelteSet<string>();
	/**
	 * The witness selection. Component state, never the store's: it is not editorial work and
	 * must not consume an undo entry.
	 */
	let selectedWitnessIds = new SvelteSet<string>();
	let activeChipIndex = $state(0);
	/** Where a `Shift`-extended range starts. */
	let anchorChipIndex = $state(0);
	let chipGroup = $state<HTMLElement | null>(null);
	/** Chosen targets for the two destructive verbs, which act only on an explicit apply. */
	let moveTargetId = $state(NO_VALUE);
	let mergeTargetId = $state(NO_VALUE);

	let segments = $derived(collationState.getSegmentSequence());
	let unitSegments = $derived(segments.filter(segment => segment.kind === 'unit'));
	let spans = $derived(unitSegments.map(segment => segment.span));
	let selectedSpan = $derived(
		spans.find(span => span.startIndex === collationState.selectedUnitIndex) ?? spans[0] ?? null
	);
	let unitIndex = $derived(selectedSpan?.startIndex ?? -1);

	$effect(() => {
		if (selectedSpan && collationState.selectedUnitIndex !== selectedSpan.startIndex) {
			collationState.selectedUnitIndex = selectedSpan.startIndex;
		}
		if (selectedSpan) {
			collationState.primeReadingsForUnit(selectedSpan.startIndex);
		}
	});

	$effect(() => {
		unitIndex;
		expandedWitnesses.clear();
		clearSelection();
		activeChipIndex = 0;
		anchorChipIndex = 0;
	});

	let displayMode = $derived(collationState.alignmentDisplayMode);
	let readings = $derived(unitIndex < 0 ? [] : collationState.peekReadingsForUnit(unitIndex));
	let readingDisplayValues = $derived(
		unitIndex < 0 ? new Map() : collationState.getReadingDisplayValuesForUnit(unitIndex)
	);
	let readingTypeVocabulary = $derived(collationState.getReadingTypeVocabulary());
	let nonAttestation = $derived(
		unitIndex < 0
			? { witnessIds: [], untranscribedWitnessIds: [] }
			: collationState.getNonAttestationForUnit(unitIndex)
	);
	let hasNonAttestation = $derived(
		nonAttestation.witnessIds.length > 0 || nonAttestation.untranscribedWitnessIds.length > 0
	);
	let baseTextWitnessId = $derived(collationState.getBaseTextWitnessId());
	let lemmaReadingId = $derived(unitIndex < 0 ? null : collationState.getLemmaReadingId(unitIndex));
	let needsLemmaDecision = $derived(
		unitIndex < 0 ? false : collationState.unitNeedsLemmaDecision(unitIndex)
	);

	/**
	 * One card per main reading, holding the whole chain of subreadings beneath it. Regularized
	 * display folds subreadings into their main reading, so they are not shown separately there.
	 */
	let cards = $derived.by<Card[]>(() => {
		const childrenOf = new Map<string, ClassifiedReading[]>();
		for (const reading of readings) {
			if (reading.parentReadingId === null) continue;
			const siblings = childrenOf.get(reading.parentReadingId) ?? [];
			siblings.push(reading);
			childrenOf.set(reading.parentReadingId, siblings);
		}
		const seen = new Set<string>();
		const collect = (reading: ClassifiedReading, depth: number, nodes: CardNode[]) => {
			if (seen.has(reading.id)) return;
			seen.add(reading.id);
			nodes.push({ reading, depth });
			if (displayMode === 'regularized') return;
			for (const child of childrenOf.get(reading.id) ?? []) collect(child, depth + 1, nodes);
		};
		return readings
			.filter(reading => reading.parentReadingId === null)
			.map(main => {
				const nodes: CardNode[] = [];
				collect(main, 0, nodes);
				return { main, nodes };
			});
	});

	function getWitnessSiglum(witnessId: string): string {
		return (
			collationState.witnesses.find(witness => witness.witnessId === witnessId)?.siglum ??
			witnessId
		);
	}

	function getSortedWitnesses(witnessIds: string[]): { id: string; siglum: string }[] {
		return witnessIds
			.map(id => ({ id, siglum: getWitnessSiglum(id) }))
			.sort((a, b) => a.siglum.localeCompare(b.siglum));
	}

	/** The witnesses that keep a reading undeletable: its own and its subreadings'. */
	function attestingWitnessesOf(reading: ClassifiedReading): string[] {
		if (unitIndex < 0) return reading.witnessIds;
		return collationState.getAttestingWitnessIdsForReading(unitIndex, reading.id);
	}

	function getDisplayedWitnessIds(reading: ClassifiedReading): string[] {
		if (unitIndex < 0) return reading.witnessIds;
		return collationState.getDisplayedWitnessIdsForReading(unitIndex, reading.id, displayMode);
	}

	/** The witnesses a reading shows, honouring its own show-more state. */
	function visibleWitnessesOf(reading: ClassifiedReading): { id: string; siglum: string }[] {
		const sorted = getSortedWitnesses(getDisplayedWitnessIds(reading));
		return expandedWitnesses.has(reading.id) ? sorted : sorted.slice(0, WITNESS_DISPLAY_LIMIT);
	}

	function hiddenWitnessCount(reading: ClassifiedReading): number {
		if (expandedWitnesses.has(reading.id)) return 0;
		return Math.max(0, getDisplayedWitnessIds(reading).length - WITNESS_DISPLAY_LIMIT);
	}

	/**
	 * Every witness chip on screen, in reading order across all cards. One flat sequence is what
	 * makes the group a single tabstop and lets a range span more than one card.
	 */
	let chips = $derived.by(() => {
		const list: { witnessId: string; readingId: string }[] = [];
		for (const card of cards) {
			for (const node of card.nodes) {
				for (const witness of visibleWitnessesOf(node.reading)) {
					list.push({ witnessId: witness.id, readingId: node.reading.id });
				}
			}
		}
		return list;
	});

	let chipIndexOf = $derived(
		new Map(chips.map((chip, index) => [chip.witnessId, index] as const))
	);
	let rovingIndex = $derived(Math.min(Math.max(activeChipIndex, 0), Math.max(chips.length - 1, 0)));

	/**
	 * The selection itself, in reading order — never the chips on screen. A reading shows at most
	 * twelve sigla, so a verb reading the selection off the chips would act on a subset of what
	 * the scholar selected and announce only that subset.
	 */
	let selectedWitnessIdsInOrder = $derived(
		readings.flatMap(reading => reading.witnessIds.filter(id => selectedWitnessIds.has(id)))
	);
	let selectedReadingIds = $derived(
		readings
			.filter(reading => reading.witnessIds.some(id => selectedWitnessIds.has(id)))
			.map(reading => reading.id)
	);
	let selectionCount = $derived(selectedWitnessIdsInOrder.length);

	/**
	 * What merging into the chosen target would throw away. Shown before the scholar commits,
	 * because a merge discards the text of every reading it collapses and may take the lemma
	 * reading with it.
	 */
	let mergeDiscards = $derived.by(() => {
		const sources = readings.filter(
			reading => reading.id !== mergeTargetId && selectedReadingIds.includes(reading.id)
		);
		return {
			texts: sources
				.filter(reading => describeReading(reading).length > 0)
				.map(reading => `${reading.label} (${describeReading(reading)})`),
			lemmaLabel: sources.find(reading => reading.id === lemmaReadingId)?.label ?? null,
		};
	});

	function focusChip(index: number) {
		activeChipIndex = index;
		chipGroup?.querySelector<HTMLButtonElement>(`[data-chip-index="${index}"]`)?.focus();
	}

	function toggleChip(witnessId: string, index: number) {
		if (selectedWitnessIds.has(witnessId)) selectedWitnessIds.delete(witnessId);
		else selectedWitnessIds.add(witnessId);
		anchorChipIndex = index;
		activeChipIndex = index;
	}

	function selectChipRange(from: number, to: number) {
		const [start, end] = from <= to ? [from, to] : [to, from];
		for (let i = start; i <= end; i += 1) {
			const chip = chips[i];
			if (chip) selectedWitnessIds.add(chip.witnessId);
		}
	}

	function clearSelection() {
		selectedWitnessIds.clear();
		moveTargetId = NO_VALUE;
		mergeTargetId = NO_VALUE;
	}

	function handleChipKeydown(event: KeyboardEvent, index: number) {
		const step =
			event.key === 'ArrowRight' || event.key === 'ArrowDown'
				? 1
				: event.key === 'ArrowLeft' || event.key === 'ArrowUp'
					? -1
					: 0;
		if (step !== 0) {
			event.preventDefault();
			const next = Math.min(Math.max(index + step, 0), chips.length - 1);
			if (event.shiftKey) selectChipRange(anchorChipIndex, next);
			focusChip(next);
			return;
		}
		if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			const next = event.key === 'Home' ? 0 : chips.length - 1;
			if (event.shiftKey) selectChipRange(anchorChipIndex, next);
			focusChip(next);
			return;
		}
		if (event.key === ' ' || event.key === 'Spacebar') {
			event.preventDefault();
			const chip = chips[index];
			if (chip) toggleChip(chip.witnessId, index);
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			clearSelection();
			liveMessage = 'Selection cleared.';
		}
	}

	function handleChipClick(event: MouseEvent, index: number) {
		const chip = chips[index];
		if (!chip) return;
		if (event.shiftKey) {
			selectChipRange(anchorChipIndex, index);
			activeChipIndex = index;
			return;
		}
		toggleChip(chip.witnessId, index);
	}

	function siglaOf(witnessIds: string[]): string {
		return witnessIds.map(getWitnessSiglum).join(', ');
	}

	/**
	 * Where focus lands once a verb has run and the selection bar — with the control that ran it —
	 * has gone. The witnesses acted on are where the scholar's attention already is.
	 */
	async function focusAfterVerb(witnessId: string | undefined) {
		await tick();
		const target =
			(witnessId
				? chipGroup?.querySelector<HTMLButtonElement>(`[data-witness-id="${witnessId}"]`)
				: null) ?? chipGroup?.querySelector<HTMLButtonElement>('[data-chip-index]');
		if (!target) return;
		activeChipIndex = Number(target.dataset.chipIndex ?? 0);
		target.focus();
	}

	async function moveSelectionToReading(targetReadingId: string) {
		const target = readings.find(reading => reading.id === targetReadingId);
		if (!target) return;
		const witnessIds = selectedWitnessIdsInOrder;
		const result = collationState.moveWitnessesToReading(unitIndex, witnessIds, targetReadingId);
		if (!result.ok) {
			liveMessage =
				result.error === 'no-attesting-witnesses'
					? 'None of the selected witnesses testify here, so there is nothing to move.'
					: 'That reading no longer exists. Nothing was moved.';
			return;
		}
		// Witnesses that already attested the target did not move, so they are not announced as
		// though they had.
		liveMessage =
			result.moved === 0
				? `Every selected witness already attests ${target.label}. Nothing was moved.`
				: `Moved ${siglaOf(result.movedWitnessIds)} to reading ${target.label}.`;
		clearSelection();
		await focusAfterVerb(witnessIds[0]);
	}

	async function splitSelectionIntoNewReading() {
		const witnessIds = selectedWitnessIdsInOrder;
		const result = collationState.splitWitnessesIntoNewReading(unitIndex, witnessIds);
		if (!result.ok) {
			liveMessage =
				result.error === 'whole-reading'
					? 'That selection is the whole of its reading, so splitting it would record no distinction.'
					: result.error === 'no-attesting-witnesses'
						? 'None of the selected witnesses testify here, so there is nothing to split.'
						: 'That reading no longer exists. Nothing was split.';
			return;
		}
		const created = collationState
			.peekReadingsForUnit(unitIndex)
			.find(reading => reading.id === result.readingId);
		liveMessage = `Split ${siglaOf(witnessIds)} into new reading ${created?.label ?? ''}.`;
		clearSelection();
		await focusAfterVerb(witnessIds[0]);
	}

	async function mergeSelectionInto(targetReadingId: string) {
		const target = readings.find(reading => reading.id === targetReadingId);
		if (!target) return;
		const witnessIds = selectedWitnessIdsInOrder;
		const sourceReadingIds = selectedReadingIds.filter(id => id !== targetReadingId);
		const discarded = mergeDiscards;
		const result = collationState.mergeReadings(unitIndex, sourceReadingIds, targetReadingId);
		if (!result.ok) {
			liveMessage =
				result.error === 'target-under-source'
					? 'A reading cannot be merged into its own subreading.'
					: result.error === 'nothing-to-merge'
						? 'Select witnesses from more than one reading to merge.'
						: 'That reading no longer exists. Nothing was merged.';
			return;
		}
		const discardedText =
			discarded.texts.length > 0 ? ` Discarded the text of ${discarded.texts.join(', ')}.` : '';
		const lemmaNote = discarded.lemmaLabel
			? ` ${discarded.lemmaLabel} was the lemma reading, so the lemma has returned to the base text's reading.`
			: '';
		liveMessage = `Merged ${sourceReadingIds.length + 1} readings into ${target.label}.${discardedText}${lemmaNote}`;
		clearSelection();
		await focusAfterVerb(witnessIds[0]);
	}

	function getUnitOrdinal(startIndex: number): number {
		return unitSegments.find(segment => segment.span.startIndex === startIndex)?.ordinal ?? 0;
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
			options.unshift(known ?? { id: current, label: current, description: '', selectable: false });
		}
		return options;
	}

	function certaintyOptions(reading: ClassifiedReading): string[] {
		const levels: string[] = [...CERTAINTY_LEVELS];
		return typeof reading.certainty === 'number' ? [...levels, String(reading.certainty)] : levels;
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

	/** Commit on blur, which is what keeps a text edit one undo entry rather than one per keystroke. */
	function commitReadingText(reading: ClassifiedReading, value: string) {
		if (value.trim() === getDisplayedReadingText(reading).trim()) return;
		collationState.updateReadingTextForDisplayMode(unitIndex, reading.id, value, displayMode);
		liveMessage = `Reading ${reading.label} is now ${value.trim() || 'empty'}.`;
	}

	function describeReorderRefusal(error: ReorderRefusal, label: string): string {
		if (error === 'different-group')
			return `${label} can only be reordered within its own reading group.`;
		if (error === 'at-boundary') return `${label} is already at the edge of its group.`;
		return `${label} is no longer available to reorder.`;
	}

	function moveReading(reading: ClassifiedReading, offset: -1 | 1) {
		const result = collationState.moveReadingByOffset(unitIndex, reading.id, offset);
		liveMessage = result.ok
			? `Moved ${reading.label} ${offset === -1 ? 'up' : 'down'}.`
			: result.error === 'at-boundary'
				? `${reading.label} is already ${offset === -1 ? 'first' : 'last'} in its group.`
				: describeReorderRefusal(result.error, reading.label);
	}

	function establishLemma(reading: ClassifiedReading) {
		const result = collationState.setLemmaReading(unitIndex, reading.id);
		liveMessage = result.ok
			? `${describeReading(reading)} is now the lemma reading.`
			: 'Only a main reading can be the lemma.';
	}

	function attachTo(reading: ClassifiedReading, parentReadingId: string | null) {
		const result = collationState.setReadingParent(unitIndex, reading.id, parentReadingId);
		liveMessage = result.ok
			? parentReadingId
				? `${reading.label} is now a subreading.`
				: `${reading.label} is now an independent reading.`
			: result.error === 'cycle'
				? `${reading.label} cannot be attached to one of its own subreadings.`
				: result.error === 'self-attachment'
					? `${reading.label} cannot be attached to itself.`
					: 'That reading no longer exists.';
	}

	function deleteReading(reading: ClassifiedReading) {
		collationState.deleteReading(unitIndex, reading.id);
		liveMessage = `Deleted reading ${reading.label}.`;
	}

	function addSubreading(reading: ClassifiedReading) {
		collationState.addReading(unitIndex, { parentReadingId: reading.id });
		liveMessage = `Added a subreading of ${reading.label}.`;
	}

	function getAttachmentOptions(readingId: string): ClassifiedReading[] {
		return readings.filter(reading => reading.parentReadingId === null && reading.id !== readingId);
	}

	function toggleWitnessExpand(readingId: string) {
		if (expandedWitnesses.has(readingId)) expandedWitnesses.delete(readingId);
		else expandedWitnesses.add(readingId);
	}

	function getSelectedUnitLabel(): string {
		return selectedUnitSegment?.label ?? '';
	}

	async function goToStemma() {
		if (!collationState.collationId) return;
		collationState.setPhase('readings');
		collationState.nextPhase();
		await goto(
			resolve('/collation/[id]/[phase]', {
				id: collationState.collationId,
				phase: 'stemma',
			}),
			{ replaceState: true }
		);
	}

	async function goToAlignment() {
		if (!collationState.collationId) return;
		await goto(
			resolve('/collation/[id]/[phase]', {
				id: collationState.collationId,
				phase: 'alignment',
			}),
			{ replaceState: true }
		);
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
							onclick={() => (collationState.selectedUnitIndex = segment.span.startIndex)}
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
				disabled={unitIndex < 0}
				onclick={() => collationState.addReading(unitIndex)}
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

	<div class="sr-only" aria-live="polite" data-testid="readings-announcer">{liveMessage}</div>

	{#if needsLemmaDecision}
		<div
			class="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-base-content/70"
		>
			The base text does not testify here, so this unit has no lemma. Choose the reading to
			establish as <span class="font-mono">a</span>.
		</div>
	{/if}

	<!-- Contextual verbs: they act on the whole selection, once per gesture. -->
	{#if selectionCount > 0}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<section
			class="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2"
			aria-label="Actions for the selected witnesses"
			data-testid="selection-bar"
			onkeydown={event => {
				if (event.key !== 'Escape') return;
				event.preventDefault();
				clearSelection();
				liveMessage = 'Selection cleared.';
				void focusAfterVerb(undefined);
			}}
		>
			<span class="text-sm font-medium text-base-content/70" data-testid="selection-count">
				{selectionCount}
				{selectionCount === 1 ? 'witness' : 'witnesses'} selected
				<span class="text-base-content/40">({siglaOf(selectedWitnessIdsInOrder)})</span>
			</span>
			<!-- Both verbs act on an explicit apply: arrowing through a closed select fires change,
			     which would otherwise perform a move nobody asked for. -->
			<label class="flex items-center gap-1 text-xs text-base-content/60">
				<span>Move to</span>
				<select
					class="select select-bordered select-xs"
					aria-label="Move selected witnesses to reading"
					bind:value={moveTargetId}
				>
					<option value={NO_VALUE}>Choose a reading…</option>
					{#each readings as reading (reading.id)}
						<option value={reading.id}>{reading.label}: {describeReading(reading)}</option>
					{/each}
				</select>
			</label>
			<button
				type="button"
				class="btn btn-xs"
				disabled={moveTargetId === NO_VALUE}
				data-testid="apply-move"
				onclick={() => moveSelectionToReading(moveTargetId)}
			>
				Move
			</button>
			<button
				type="button"
				class="btn btn-xs"
				onclick={splitSelectionIntoNewReading}
				data-testid="split-selection"
			>
				Split into a new reading
			</button>
			<label class="flex items-center gap-1 text-xs text-base-content/60">
				<span>Merge readings into</span>
				<select
					class="select select-bordered select-xs"
					aria-label="Merge the selected readings into"
					disabled={selectedReadingIds.length < 2}
					bind:value={mergeTargetId}
				>
					<option value={NO_VALUE}>
						{selectedReadingIds.length < 2
							? 'Select witnesses from two readings'
							: 'Choose the surviving reading…'}
					</option>
					{#each selectedReadingIds as readingId (readingId)}
						{@const reading = readings.find(entry => entry.id === readingId)}
						{#if reading}
							<option value={reading.id}>{reading.label}: {describeReading(reading)}</option>
						{/if}
					{/each}
				</select>
			</label>
			<button
				type="button"
				class="btn btn-xs"
				disabled={!selectedReadingIds.includes(mergeTargetId) || selectedReadingIds.length < 2}
				data-testid="apply-merge"
				onclick={() => mergeSelectionInto(mergeTargetId)}
			>
				Merge
			</button>
			{#if mergeTargetId !== NO_VALUE && mergeDiscards.texts.length > 0}
				<p class="w-full text-xs text-warning" data-testid="merge-warning">
					Merging discards the text of {mergeDiscards.texts.join(', ')}.
					{#if mergeDiscards.lemmaLabel}
						{mergeDiscards.lemmaLabel} is the lemma reading; the lemma will return to the base
						text's reading.
					{/if}
				</p>
			{/if}
			<button
				type="button"
				class="btn btn-ghost btn-xs"
				onclick={() => {
					clearSelection();
					liveMessage = 'Selection cleared.';
					void focusAfterVerb(undefined);
				}}
			>
				Clear
			</button>
		</section>
	{/if}

	<!-- Reading cards -->
	<div class="min-h-0 flex-1 overflow-auto rounded-xl border border-base-300/50 bg-base-100 p-3">
		{#if !selectedSpan}
			<div class="flex h-full items-center justify-center p-6 text-sm text-base-content/35">
				No variation units available. Return to alignment to adjust the collation.
			</div>
		{:else}
			<div
				class="space-y-3"
				role="group"
				aria-label="Witness sigla, grouped by reading"
				bind:this={chipGroup}
			>
				{#each cards as card (card.main.id)}
					<article
						class="rounded-xl border border-base-300/60 bg-base-100 shadow-sm"
						aria-label={`Reading ${card.main.label}`}
					>
						{#each card.nodes as node (node.reading.id)}
							{@const reading = node.reading}
							{@const isSub = node.depth > 0}
							{@const attesting = attestingWitnessesOf(reading)}
							<div
								class={[
									'flex gap-3 px-3 py-3',
									isSub
										? 'ml-6 border-l-2 border-base-300/70 bg-base-200/30 pl-3'
										: '',
								]}
								style:margin-left={isSub ? `${node.depth * 1.25}rem` : undefined}
							>
								<!-- The letter is the card's anchor. -->
								<div class="w-16 shrink-0">
									<span
										class={[
											'font-mono text-sm font-semibold',
											isSub ? 'text-base-content/70' : 'text-base-content',
										]}>{reading.label}</span
									>
									{#if reading.id === lemmaReadingId}
										<div class="text-[0.6rem] font-medium text-primary">lemma</div>
									{:else if baseTextWitnessId && reading.witnessIds.includes(baseTextWitnessId)}
										<div class="text-[0.6rem] text-base-content/35">base text</div>
									{/if}
									{#if reading.readingType}
										<div class="text-[0.6rem] text-base-content/40">
											{findReadingTypeDefinition(
												readingTypeVocabulary,
												reading.readingType
											)?.label ?? reading.readingType}
										</div>
									{/if}
								</div>

								<div class="min-w-0 flex-1 space-y-2">
									<!-- Edited in place: no permanent box, committed on blur. -->
									<input
										class="input input-ghost w-full max-w-md px-1 font-greek text-base"
										aria-label={`Text of reading ${reading.label}`}
										disabled={reading.isOmission || reading.isLacuna}
										value={getDisplayedReadingText(reading)}
										placeholder={reading.isOmission
											? 'om.'
											: reading.isLacuna
												? 'lac.'
												: 'Reading text'}
										onblur={event => commitReadingText(reading, event.currentTarget.value)}
										onkeydown={event => {
											if (event.key === 'Enter') event.currentTarget.blur();
										}}
									/>

									{#if getDisplayedWitnessIds(reading).length === 0}
										<span class="text-sm italic text-base-content/25">no witnesses</span>
									{:else}
										<div class="flex flex-wrap items-center gap-1">
											{#each visibleWitnessesOf(reading) as witness (witness.id)}
												{@const index = chipIndexOf.get(witness.id) ?? 0}
												{@const isSelected = selectedWitnessIds.has(witness.id)}
												<button
													type="button"
													data-chip-index={index}
													data-witness-id={witness.id}
													tabindex={index === rovingIndex ? 0 : -1}
													aria-pressed={isSelected}
													class={[
														'rounded px-1.5 py-0.5 font-mono text-sm transition',
														isSelected
															? 'bg-primary text-primary-content'
															: 'text-base-content/70 hover:bg-base-200',
													]}
													onclick={event => handleChipClick(event, index)}
													onkeydown={event => handleChipKeydown(event, index)}
													onfocus={() => (activeChipIndex = index)}
												>
													{witness.siglum}
												</button>
											{/each}
											{#if hiddenWitnessCount(reading) > 0}
												<button
													type="button"
													class="ml-1 text-sm text-primary/60 hover:text-primary hover:underline"
													onclick={() => toggleWitnessExpand(reading.id)}
												>
													+{hiddenWitnessCount(reading)} more
												</button>
											{:else if expandedWitnesses.has(reading.id)}
												<button
													type="button"
													class="ml-1 text-sm text-primary/60 hover:text-primary hover:underline"
													onclick={() => toggleWitnessExpand(reading.id)}
												>
													show less
												</button>
											{/if}
										</div>
									{/if}
								</div>

								<!-- Rare operations live here and nowhere else on the card. -->
								<details class="dropdown dropdown-end shrink-0">
									<summary
										class="btn btn-ghost btn-xs"
										aria-label={`More actions for reading ${reading.label}`}
									>
										<DotsThreeVertical size={16} />
									</summary>
									<div
										class="dropdown-content z-20 w-72 space-y-2 rounded-box border border-base-300/60 bg-base-100 p-3 shadow-lg"
									>
										<div class="flex items-center gap-1">
											<button
												type="button"
												class="btn btn-ghost btn-xs gap-1"
												onclick={() => moveReading(reading, -1)}
											>
												<CaretUp size={12} /> Move up
											</button>
											<button
												type="button"
												class="btn btn-ghost btn-xs gap-1"
												onclick={() => moveReading(reading, 1)}
											>
												<CaretDown size={12} /> Move down
											</button>
										</div>

										{#if !isSub && reading.id !== lemmaReadingId}
											<button
												type="button"
												class="btn btn-ghost btn-xs w-full justify-start"
												onclick={() => establishLemma(reading)}
											>
												Elevate to lemma
											</button>
										{/if}

										{#if !isSub}
											<button
												type="button"
												class="btn btn-ghost btn-xs w-full justify-start gap-1"
												onclick={() => addSubreading(reading)}
											>
												<Plus size={12} /> Add subreading
											</button>
										{/if}

										<label class="block text-xs text-base-content/50">
											<span>Attach as subreading of</span>
											<select
												class="select select-bordered select-xs mt-1 w-full"
												value={reading.parentReadingId ?? ''}
												onchange={event =>
													attachTo(reading, event.currentTarget.value || null)}
											>
												<option value="">Independent reading</option>
												{#each getAttachmentOptions(reading.id) as candidate (candidate.id)}
													<option value={candidate.id}
														>{candidate.label}: {describeReading(candidate)}</option
													>
												{/each}
											</select>
										</label>

										<label class="block text-xs text-base-content/50">
											<span>Reading type</span>
											<select
												class="select select-bordered select-xs mt-1 w-full"
												value={reading.readingType ?? ''}
												onchange={event =>
													collationState.setReadingType(
														unitIndex,
														reading.id,
														event.currentTarget.value || null
													)}
											>
												<option value="">-</option>
												{#each readingTypeOptions(reading) as type (type.id)}
													<option
														value={type.id}
														disabled={!type.selectable}
														title={type.description}>{type.label}</option
													>
												{/each}
											</select>
										</label>

										<label class="block text-xs text-base-content/50">
											<span>Certainty</span>
											<select
												class="select select-bordered select-xs mt-1 w-full"
												value={reading.certainty === null
													? ''
													: String(reading.certainty)}
												onchange={event =>
													collationState.setReadingCertainty(
														unitIndex,
														reading.id,
														parseCertainty(event.currentTarget.value)
													)}
											>
												<option value="">certainty -</option>
												{#each certaintyOptions(reading) as level (level)}
													<option value={level}>{level}</option>
												{/each}
											</select>
										</label>

										<button
											type="button"
											class="btn btn-ghost btn-xs w-full justify-start gap-1 text-error"
											disabled={attesting.length > 0}
											onclick={() => deleteReading(reading)}
										>
											<Trash size={12} /> Delete reading
										</button>
										{#if attesting.length > 0}
											<p class="text-[0.65rem] text-base-content/40">
												{attesting.length} witness(es) still attest this reading, counting its
												subreadings. Move them elsewhere before deleting it.
											</p>
										{/if}
									</div>
								</details>
							</div>
						{/each}
					</article>
				{/each}

				<!-- Non-attestation is not a reading: pinned last, unlettered, and its sigla are
				     plain text because there is nothing to move or merge them into. -->
				{#if hasNonAttestation}
					<section
						class="rounded-xl border border-base-300/60 bg-base-200/40 px-3 py-3"
						aria-label="Witnesses that do not testify"
					>
						<div class="text-sm font-medium text-base-content/60">Does not testify</div>
						<div class="mt-0.5 text-xs text-base-content/40">
							Damaged, lost, or illegible. Takes no letter and no place in the local stemma.
						</div>
						{#if nonAttestation.witnessIds.length > 0}
							<div class="mt-1 font-mono text-sm text-base-content/60">
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
					</section>
				{/if}
			</div>
		{/if}
	</div>
</div>
