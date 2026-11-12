<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { collationState, type ReorderResult } from '$lib/collation/collation-state.svelte';
	import { renderApparatusUnit } from '$lib/collation/collation-apparatus';
	import type { ClassifiedReading } from '$lib/collation/collation-types';
	import {
		CERTAINTY_LEVELS,
		findReadingTypeDefinition,
		type Certainty,
		type ReadingTypeDefinition,
	} from '$lib/collation/reading-types';
	import type { VariationUnitSpan } from '$lib/collation/collation-variation-units';
	import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
	import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import CaretUp from 'phosphor-svelte/lib/CaretUp';
	import DotsThreeVertical from 'phosphor-svelte/lib/DotsThreeVertical';
	import Plus from 'phosphor-svelte/lib/Plus';
	import Trash from 'phosphor-svelte/lib/Trash';
	import { tick } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';

	type ReorderRefusal = Extract<ReorderResult, { ok: false }>['error'];

	type CardNode = { reading: ClassifiedReading; depth: number };
	type Card = { main: ClassifiedReading; nodes: CardNode[] };

	const WITNESS_DISPLAY_LIMIT = 12;
	const NO_VALUE = '';

	const META_CONTROL =
		'rounded px-1.5 py-0.5 text-xs text-base-content/65 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary';

	let liveMessage = $state('');
	let authoredText = $state('');
	let noteCancelled = false;
	const manualDrafts = new SvelteMap<string, string>();
	const manualErrors = new SvelteMap<string, string>();
	let manualWitnesses = $derived(collationState.getManualWitnesses());
	let manualMembers = $derived(collationState.getManualWitnessMembers());
	let witnessDescriptions = $derived(
		new Map(manualMembers.map(witness => [witness.id, witness.description]))
	);
	async function attachManual(reading: ClassifiedReading) {
		const result = await collationState.attachManualWitness(
			unitId,
			reading.id,
			manualDrafts.get(reading.id) ?? ''
		);
		if (result.ok) {
			manualDrafts.delete(reading.id);
			manualErrors.delete(reading.id);
			witnessEditorFor = null;
			void focusSlot(`witness-${reading.id}`);
		} else manualErrors.set(reading.id, result.error);
		liveMessage = result.ok ? 'Attached manual witness.' : result.error;
	}
	function addAuthored() {
		const isOmission = authoredText.trim() === 'om.';
		if (!collationState.addAuthoredReading(unitId, isOmission ? '' : authoredText, isOmission))
			return;
		authoredText = '';
		liveMessage = 'Added authored reading.';
	}
	let chipGroup = $state<HTMLElement | null>(null);

	let segments = $derived(collationState.getSegmentSequence());
	let unitSegments = $derived(segments.filter(segment => segment.kind === 'unit'));
	let spans = $derived(unitSegments.map(segment => segment.span));
	let selectedSpan = $derived(
		spans.find(span => span.unitId === collationState.selectedUnitId) ?? spans[0] ?? null
	);
	let unitId = $derived(selectedSpan?.unitId ?? '');
	let unitView = $derived(collationState.peekUnitView(unitId));

	const expandedWitnesses = $derived.by(() => {
		unitId;
		return new SvelteSet<string>();
	});
	const selectedWitnessIds = $derived.by(() => {
		unitId;
		return new SvelteSet<string>();
	});
	let moveTargetId = $derived.by(() => {
		unitId;
		return NO_VALUE;
	});
	let mergeTargetId = $derived.by(() => {
		unitId;
		return NO_VALUE;
	});
	const ambiguousTargetDrafts = $derived.by(() => {
		unitId;
		return new SvelteSet<string>();
	});
	let activeChipIndex = $derived.by(() => {
		unitId;
		return 0;
	});
	let anchorChipIndex = $derived.by(() => {
		unitId;
		return 0;
	});
	const newSubreadingTypeDrafts = $derived.by(() => {
		unitId;
		return new SvelteMap<string, string>();
	});
	const attachParentDrafts = $derived.by(() => {
		unitId;
		return new SvelteMap<string, string>();
	});
	const attachTypeDrafts = $derived.by(() => {
		unitId;
		return new SvelteMap<string, string>();
	});
	const tagDrafts = $derived.by(() => {
		unitId;
		return new SvelteMap<string, string>();
	});
	let activeRowId = $derived.by(() => {
		unitId;
		return null as string | null;
	});
	let editingNoteFor = $derived.by(() => {
		unitId;
		return null as string | null;
	});
	let editingTagFor = $derived.by(() => {
		unitId;
		return null as string | null;
	});
	let witnessEditorFor = $derived.by(() => {
		unitId;
		return null as string | null;
	});

	/** Opening on click or keyboard focus only: a mousedown-time reveal shifts the row under the pointer. */
	function slotClass(readingId: string): string {
		return activeRowId === readingId
			? 'order-last'
			: 'order-last hidden group-has-[:focus-visible]:inline-block';
	}

	function focusOnMount(node: HTMLElement) {
		node.focus();
	}

	async function focusSlot(slot: string) {
		await tick();
		chipGroup?.querySelector<HTMLElement>(`[data-slot="${slot}"]`)?.focus();
	}

	function closeWhenFocusLeaves(close: () => void) {
		return (event: FocusEvent) => {
			const container = event.currentTarget as HTMLElement;
			if (!container.contains(event.relatedTarget as Node | null)) close();
		};
	}

	function finishNote(reading: ClassifiedReading, value: string) {
		if (!noteCancelled) collationState.setReadingNote(unitId, reading.id, value);
		noteCancelled = false;
		editingNoteFor = null;
	}
	let readingTags = $derived(collationState.getReadingTags());

	async function addTag(reading: ClassifiedReading) {
		const value = tagDrafts.get(reading.id) ?? '';
		const result = await collationState.addReadingTag(unitId, reading.id, value);
		if (!result.ok) return;
		tagDrafts.delete(reading.id);
		liveMessage = `Added tag to reading ${reading.label}.`;
		await tick();
		chipGroup
			?.querySelector<HTMLInputElement>(
				`input[aria-label="Tag for reading ${reading.label}"]`
			)
			?.focus();
	}

	function removeTag(reading: ClassifiedReading, tagId: string) {
		collationState.removeReadingTag(unitId, reading.id, tagId);
		liveMessage = `Removed tag from reading ${reading.label}.`;
	}

	$effect(() => {
		if (selectedSpan) {
			collationState.primeReadingsForUnit(selectedSpan.unitId);
		}
	});

	let displayMode = $derived(collationState.alignmentDisplayMode);
	let readings = $derived(!unitId ? [] : collationState.peekReadingsForUnit(unitId));
	let readingDisplayValues = $derived(
		!unitId ? new Map() : collationState.getReadingDisplayValuesForUnit(unitId)
	);
	let readingTypeVocabulary = $derived(collationState.getReadingTypeVocabulary());
	let subreadingTypeOptions = $derived(readingTypeVocabulary.filter(type => type.selectable));
	let nonAttestation = $derived(
		!unitId
			? { witnessIds: [], untranscribedWitnessIds: [] }
			: collationState.getNonAttestationForUnit(unitId)
	);
	let hasNonAttestation = $derived(
		nonAttestation.witnessIds.length > 0 || nonAttestation.untranscribedWitnessIds.length > 0
	);
	let baseTextWitnessId = $derived(collationState.getBaseTextWitnessId());
	let lemmaReadingId = $derived(!unitId ? null : collationState.getLemmaReadingId(unitId));
	let needsLemmaDecision = $derived(
		!unitId ? false : collationState.unitNeedsLemmaDecision(unitId)
	);
	let ambiguousAttestations = $derived(unitView.ambiguousAttestations);
	let unconfirmedWitnessIds = $derived(unitView.unconfirmedWitnessIds);
	let unresolvedAttestations = $derived(unitView.unresolvedAttestations);

	let spanningReadingIds = $derived(
		collationState.unitDecisions.get(unitId)?.spanningReadingIds ?? []
	);
	let canSpan = $derived(collationState.canMarkSpanning(unitId));

	function confirmAttestations() {
		collationState.confirmUnitAttestations(unitId);
		liveMessage = 'Confirmed attestations at this unit.';
	}

	function resolveAttestation(witnessId: string, readingId: string) {
		const result = collationState.resolveAttestation(unitId, witnessId, readingId);
		liveMessage = result.ok
			? 'Resolved witness attestation.'
			: 'Could not resolve attestation.';
	}

	let ambiguousTargetIds = $derived(
		readings.filter(reading => ambiguousTargetDrafts.has(reading.id)).map(reading => reading.id)
	);

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
		return collationState.getWitnessSiglum(witnessId);
	}

	function getSortedWitnesses(witnessIds: string[]): { id: string; siglum: string }[] {
		return witnessIds
			.map(id => ({ id, siglum: getWitnessSiglum(id) }))
			.sort((a, b) => a.siglum.localeCompare(b.siglum));
	}

	function attestingWitnessesOf(reading: ClassifiedReading): string[] {
		if (!unitId) return reading.witnessIds;
		return collationState.getAttestingWitnessIdsForReading(unitId, reading.id);
	}

	function getDisplayedWitnessIds(reading: ClassifiedReading): string[] {
		if (!unitId) return reading.witnessIds;
		return collationState.getDisplayedWitnessIdsForReading(unitId, reading.id, displayMode);
	}

	function isManualWitness(id: string): boolean {
		return manualWitnesses.some(witness => witness.id === id);
	}

	function displayedManualWitnessIds(reading: ClassifiedReading): string[] {
		return getDisplayedWitnessIds(reading).filter(isManualWitness);
	}

	function displayedTranscribedWitnessIds(reading: ClassifiedReading): string[] {
		return getDisplayedWitnessIds(reading).filter(id => !isManualWitness(id));
	}

	function visibleWitnessesOf(reading: ClassifiedReading): { id: string; siglum: string }[] {
		const sorted = getSortedWitnesses(displayedTranscribedWitnessIds(reading));
		return expandedWitnesses.has(reading.id) ? sorted : sorted.slice(0, WITNESS_DISPLAY_LIMIT);
	}

	function hiddenWitnessCount(reading: ClassifiedReading): number {
		if (expandedWitnesses.has(reading.id)) return 0;
		return Math.max(0, displayedTranscribedWitnessIds(reading).length - WITNESS_DISPLAY_LIMIT);
	}

	let outsideManualIds = $derived([
		...unitView.unrecordedManualWitnessIds,
		...unitView.uncitedManualWitnessIds,
		...unitView.nonAttestingManualWitnessIds,
	]);

	/** Flat chip order keeps one tabstop and lets ranges span readings and the footer. */
	let chips = $derived.by(() => {
		const list: { witnessId: string }[] = [];
		for (const card of cards) {
			for (const node of card.nodes) {
				for (const witness of visibleWitnessesOf(node.reading)) {
					list.push({ witnessId: witness.id });
				}
				for (const id of displayedManualWitnessIds(node.reading)) {
					list.push({ witnessId: id });
				}
			}
		}
		for (const id of outsideManualIds) list.push({ witnessId: id });
		return list;
	});

	let chipIndexOf = $derived(
		new Map(chips.map((chip, index) => [chip.witnessId, index] as const))
	);
	let rovingIndex = $derived(
		Math.min(Math.max(activeChipIndex, 0), Math.max(chips.length - 1, 0))
	);

	/** Reading order, not screen order: only 12 sigla show per reading. */
	let selectedWitnessIdsInOrder = $derived(
		[
			...readings.flatMap(reading => [
				...reading.witnessIds,
				...(reading.manualWitnessIds ?? []),
			]),
			...outsideManualIds,
		].filter(id => selectedWitnessIds.has(id))
	);
	let selectedReadingIds = $derived(
		readings
			.filter(reading => reading.witnessIds.some(id => selectedWitnessIds.has(id)))
			.map(reading => reading.id)
	);
	let selectionCount = $derived(selectedWitnessIdsInOrder.length);
	let hasManualSelection = $derived(selectedWitnessIdsInOrder.some(isManualWitness));
	let manualOnlySelection = $derived(
		selectionCount > 0 && selectedWitnessIdsInOrder.every(isManualWitness)
	);

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
		ambiguousTargetDrafts.clear();
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
		const result = collationState.moveWitnessesToReading(unitId, witnessIds, targetReadingId);
		if (!result.ok) {
			liveMessage =
				result.error === 'no-attesting-witnesses'
					? 'None of the selected witnesses testify here, so there is nothing to move.'
					: 'That reading no longer exists. Nothing was moved.';
			return;
		}
		liveMessage =
			result.moved === 0
				? `Every selected witness already attests ${target.label}. Nothing was moved.`
				: `Moved ${siglaOf(result.movedWitnessIds)} to reading ${target.label}.`;
		clearSelection();
		await focusAfterVerb(witnessIds[0]);
	}

	async function splitSelectionIntoNewReading() {
		const witnessIds = selectedWitnessIdsInOrder;
		const result = collationState.splitWitnessesIntoNewReading(unitId, witnessIds);
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
			.peekReadingsForUnit(unitId)
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
		const result = collationState.mergeReadings(unitId, sourceReadingIds, targetReadingId);
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
			discarded.texts.length > 0
				? ` Discarded the text of ${discarded.texts.join(', ')}.`
				: '';
		const lemmaNote = discarded.lemmaLabel
			? ` ${discarded.lemmaLabel} was the lemma reading, so the lemma has returned to the base text's reading.`
			: '';
		liveMessage = `Merged ${sourceReadingIds.length + 1} readings into ${target.label}.${discardedText}${lemmaNote}`;
		clearSelection();
		await focusAfterVerb(witnessIds[0]);
	}

	function toggleAmbiguousTarget(readingId: string) {
		if (ambiguousTargetDrafts.has(readingId)) ambiguousTargetDrafts.delete(readingId);
		else ambiguousTargetDrafts.add(readingId);
	}

	async function recordAmbiguousSelection() {
		const witnessIds = selectedWitnessIdsInOrder;
		const result = collationState.recordAmbiguousAttestation(
			unitId,
			witnessIds,
			ambiguousTargetIds
		);
		if (!result.ok) {
			liveMessage =
				result.error === 'too-few-targets'
					? 'Choose at least two readings the selected witnesses could support.'
					: result.error === 'witness-already-ambiguous'
						? 'A selected witness already has an ambiguous attestation here.'
						: result.error === 'witness-not-attesting'
							? 'Every selected witness must testify here.'
							: result.error === 'target-emptied'
								? 'Each chosen reading must keep at least one other witness.'
								: 'That reading no longer exists. Nothing was recorded.';
			return;
		}
		const recorded = collationState
			.peekUnitView(unitId)
			.ambiguousAttestations.find(attestation => attestation.id === result.attestationId);
		liveMessage = `Recorded ${siglaOf(witnessIds)} as ${recorded?.label ?? 'ambiguous'}.`;
		clearSelection();
		await focusAfterVerb(undefined);
	}

	async function setSelectedManualTestimony(kind: 'uncited' | 'nonAttestation') {
		const witnessIds = selectedWitnessIdsInOrder;
		for (const id of witnessIds) collationState.setManualWitnessTestimony(unitId, id, kind);
		liveMessage = `${siglaOf(witnessIds)} ${kind === 'uncited' ? 'uncited' : 'does not testify'} here.`;
		clearSelection();
		await focusAfterVerb(witnessIds[0]);
	}

	async function detachSelectedManual() {
		const witnessIds = selectedWitnessIdsInOrder;
		for (const id of witnessIds) collationState.detachManualWitness(unitId, id);
		liveMessage = `Detached ${siglaOf(witnessIds)}.`;
		clearSelection();
		await focusAfterVerb(witnessIds[0]);
	}

	function removeAmbiguousAttestation(attestation: { id: string; label: string }) {
		const result = collationState.removeAmbiguousAttestation(unitId, attestation.id);
		liveMessage = result.ok
			? `Removed ${attestation.label}; its witnesses are back with their readings.`
			: 'That ambiguous attestation no longer exists.';
	}

	function getUnitOrdinal(unitId: string): number {
		return unitSegments.find(segment => segment.span.unitId === unitId)?.ordinal ?? 0;
	}

	function getBaseTextForSpan(span: VariationUnitSpan): string {
		return collationState.getBaseTextForVariationUnit(span.unitId) || 'om.';
	}

	/** Unselectable recorded types stay visible so the control never misstates them. */
	function readingTypeOptions(reading: ClassifiedReading): ReadingTypeDefinition[] {
		const options = readingTypeVocabulary.filter(type => type.selectable);
		const current = reading.readingType;
		if (current !== null && !options.some(type => type.id === current)) {
			const known = readingTypeVocabulary.find(type => type.id === current);
			options.unshift(
				known ?? {
					id: current,
					label: current,
					description: '',
					selectable: false,
					suffix: '',
				}
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
		unitSegments.find(segment => segment.span.unitId === selectedSpan?.unitId) ?? null
	);

	let apparatusNotation = $derived.by(() => {
		if (!selectedSpan || !selectedUnitSegment) return '';
		return renderApparatusUnit(unitView, {
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

	function commitReadingText(reading: ClassifiedReading, value: string) {
		if (value.trim() === getDisplayedReadingText(reading).trim()) return;
		collationState.updateReadingTextForDisplayMode(unitId, reading.id, value, displayMode);
		liveMessage = `Reading ${reading.label} is now ${value.trim() || 'empty'}.`;
	}

	function describeReorderRefusal(error: ReorderRefusal, label: string): string {
		if (error === 'different-group')
			return `${label} can only be reordered within its own reading group.`;
		if (error === 'at-boundary') return `${label} is already at the edge of its group.`;
		return `${label} is no longer available to reorder.`;
	}

	function moveReading(reading: ClassifiedReading, offset: -1 | 1) {
		const result = collationState.moveReadingByOffset(unitId, reading.id, offset);
		liveMessage = result.ok
			? `Moved ${reading.label} ${offset === -1 ? 'up' : 'down'}.`
			: result.error === 'at-boundary'
				? `${reading.label} is already ${offset === -1 ? 'first' : 'last'} in its group.`
				: describeReorderRefusal(result.error, reading.label);
	}

	function establishLemma(reading: ClassifiedReading) {
		const result = collationState.setLemmaReading(unitId, reading.id);
		liveMessage = result.ok
			? `${describeReading(reading)} is now the lemma reading.`
			: 'Only a main reading can be the lemma.';
	}

	function attachParentOf(reading: ClassifiedReading): string {
		return attachParentDrafts.get(reading.id) ?? reading.parentReadingId ?? NO_VALUE;
	}

	function attachTypeOf(reading: ClassifiedReading): string {
		const current = reading.readingType;
		return (
			attachTypeDrafts.get(reading.id) ??
			(subreadingTypeOptions.some(type => type.id === current) ? current! : NO_VALUE)
		);
	}

	function applyAttachment(reading: ClassifiedReading) {
		const parentReadingId = attachParentOf(reading) || null;
		const readingType = attachTypeOf(reading) || undefined;
		if (parentReadingId && !readingType) return;
		attachParentDrafts.delete(reading.id);
		attachTypeDrafts.delete(reading.id);
		attachTo(reading, parentReadingId, readingType);
	}

	function attachTo(
		reading: ClassifiedReading,
		parentReadingId: string | null,
		readingType: string | undefined
	) {
		const result = collationState.setReadingParent(
			unitId,
			reading.id,
			parentReadingId,
			readingType
		);
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
		collationState.deleteReading(unitId, reading.id);
		liveMessage = `Deleted reading ${reading.label}.`;
	}

	function addSubreading(reading: ClassifiedReading, readingType: string) {
		const id = collationState.addReading(unitId, {
			parentReadingId: reading.id,
			readingType,
		});
		newSubreadingTypeDrafts.delete(reading.id);
		const label = collationState
			.peekReadingsForUnit(unitId)
			.find(candidate => candidate.id === id)?.label;
		liveMessage = `Added subreading ${label ?? ''} of ${reading.label}.`;
	}

	function getAttachmentOptions(readingId: string): ClassifiedReading[] {
		return readings.filter(
			reading => reading.parentReadingId === null && reading.id !== readingId
		);
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
	<div class="rounded-xl bg-base-200/50 px-4 py-3">
		<div class="mb-2 flex items-center justify-between">
			<h2 class="text-xs font-semibold uppercase tracking-[0.2em] text-base-content/50">
				Readings Review
			</h2>
			<span class="text-xs text-base-content/30">Select a variation unit</span>
		</div>
		<div class="pb-1">
			<div class="flex flex-wrap items-baseline gap-1.5">
				{#each segments as segment (segment.kind === 'unit' ? segment.span.unitId : segment.columnIds.join('+'))}
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
						{@const isSelected = selectedSpan?.unitId === segment.span.unitId}
						{@const view = collationState.peekUnitView(segment.span.unitId)}
						<button
							type="button"
							class={[
								'inline-flex items-baseline gap-1.5 rounded-md px-2.5 py-1 transition',
								isSelected
									? 'bg-primary text-primary-content shadow-sm'
									: 'bg-base-300/40 text-base-content/70 hover:bg-base-300/70',
							]}
							data-unit-id={segment.span.unitId}
							aria-pressed={isSelected}
							onclick={() => (collationState.selectedUnitId = segment.span.unitId)}
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
							{#if view.unrecordedManualWitnessIds.length > 0}<span
									class="text-xs font-semibold"
									aria-label="Unrecorded manual witnesses">!</span
								>{/if}
							{#if view.unconfirmedWitnessIds.length > 0}
								<span
									class="text-xs font-semibold"
									aria-label="Unconfirmed attestations">●</span
								>
							{/if}
						</button>
					{/if}
				{/each}
			</div>
		</div>
		{#if apparatusNotation}
			<section class="mt-1" aria-label="Apparatus notation for the selected variation unit">
				<p class="select-text font-greek text-sm leading-relaxed text-base-content/70">
					{apparatusNotation}
				</p>
			</section>
		{/if}
	</div>

	<div class="flex flex-wrap items-center justify-between gap-2">
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
					Unit {getUnitOrdinal(selectedSpan.unitId)} · ids {getSelectedUnitLabel()}
				</span>
			{/if}
		</div>
		<div class="flex flex-wrap items-center gap-1.5">
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

	{#if unconfirmedWitnessIds.length > 0}
		<section
			class="flex flex-wrap items-center gap-2 rounded-xl bg-warning/10 px-3 py-2.5"
			aria-label="Unconfirmed attestations"
		>
			<p class="min-w-0 flex-1 text-sm wrap-break-word">
				Unconfirmed: {siglaOf(unconfirmedWitnessIds)}
			</p>
			<button type="button" class="btn btn-sm" onclick={confirmAttestations}
				>Confirm attestations</button
			>
		</section>
	{/if}

	{#if unitView.overlappedWitnessIds.length > 0}
		<section
			class="space-y-2 rounded-xl bg-base-200/50 px-3 py-2.5 text-sm"
			aria-label="Overlapped witnesses"
		>
			<h3 class="font-semibold">Overlapped</h3>
			{#each unitView.overlappedWitnessIds as witnessId (witnessId)}
				<div class="flex flex-wrap items-center gap-2">
					<span>{siglaOf([witnessId])}</span>
					{#each unitView.overlapTargets[witnessId] ?? [] as target (`${target.unitId}:${target.readingId}`)}
						<button
							type="button"
							class="link"
							onclick={() => (collationState.selectedUnitId = target.unitId)}
							>Spanning unit {getUnitOrdinal(target.unitId)}</button
						>
					{/each}
				</div>
			{/each}
		</section>
	{/if}
	{#if unitView.unresolvedOverlapWitnessIds.length > 0}
		<section
			class="space-y-3 rounded-xl bg-warning/10 px-3 py-2.5"
			aria-label="Unresolved overlaps"
		>
			<h3 class="text-sm font-semibold">Resolve overlapping testimony</h3>
			{#each unitView.unresolvedOverlapWitnessIds as witnessId (witnessId)}
				<div class="min-w-0 space-y-2">
					<p class="text-sm">
						{siglaOf([witnessId])} is held out where a spanning reading partly covers this
						unit.
					</p>
					<div class="flex flex-wrap gap-2">
						{#each readings as reading (reading.id)}
							<button
								type="button"
								class="btn btn-sm h-auto min-h-8 max-w-full whitespace-normal wrap-anywhere text-left"
								aria-label={`Assign ${siglaOf([witnessId])} to reading ${reading.label}`}
								onclick={() =>
									collationState.resolveOverlap(unitId, witnessId, {
										kind: 'reading',
										readingId: reading.id,
									})}>{reading.label}: {describeReading(reading)}</button
							>
						{/each}
						<button
							type="button"
							class="btn btn-sm"
							aria-label={`Mark ${siglaOf([witnessId])} overlapped`}
							onclick={() =>
								collationState.resolveOverlap(unitId, witnessId, {
									kind: 'overlapped',
								})}>Overlapped</button
						>
					</div>
				</div>
			{/each}
		</section>
	{/if}

	{#if unresolvedAttestations.length > 0}
		<section
			class="space-y-3 rounded-xl bg-warning/10 px-3 py-2.5"
			aria-label="Unresolved attestations"
		>
			<h3 class="text-sm font-semibold">Resolve attestations</h3>
			{#each unresolvedAttestations as attestation (attestation.witnessId)}
				<div class="min-w-0 space-y-2">
					<p class="text-sm">
						{siglaOf([attestation.witnessId])} is held out of the readings. Choose its reading.
					</p>
					<div class="flex flex-wrap gap-2">
						{#each [true, false] as candidates}
							{#each readings.filter(reading => attestation.candidateReadingIds.includes(reading.id) === candidates) as reading (reading.id)}
								<button
									type="button"
									class="btn btn-sm h-auto min-h-8 max-w-full whitespace-normal wrap-anywhere text-left"
									aria-label={`Assign ${siglaOf([attestation.witnessId])} to reading ${reading.label}${candidates ? ' (candidate)' : ''}`}
									onclick={() =>
										resolveAttestation(attestation.witnessId, reading.id)}
								>
									{reading.label}: {describeReading(reading)}{candidates
										? ' (candidate)'
										: ''}
								</button>
							{/each}
						{/each}
					</div>
				</div>
			{/each}
		</section>
	{/if}

	{#if needsLemmaDecision}
		<div class="rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-base-content/70">
			No lemma: the base text doesn't testify here. Choose the reading to establish as
			<span class="font-mono">a</span>.
		</div>
	{/if}

	{#if selectionCount > 0}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<section
			class="flex flex-wrap items-center gap-2 rounded-xl bg-primary/10 px-3 py-2"
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
			{#if manualOnlySelection}
				<button
					type="button"
					class="btn btn-xs"
					onclick={() => setSelectedManualTestimony('uncited')}>Uncited</button
				>
				<button
					type="button"
					class="btn btn-xs"
					onclick={() => setSelectedManualTestimony('nonAttestation')}
					>Does not testify</button
				>
				<button type="button" class="btn btn-xs" onclick={detachSelectedManual}
					>Detach</button
				>
			{/if}
			<!-- Explicit apply: arrowing a closed select fires change. -->
			<label class="flex items-center gap-1 text-xs text-base-content/60">
				<span>Move to</span>
				<select
					class="select select-bordered select-xs"
					aria-label="Move selected witnesses to reading"
					bind:value={moveTargetId}
				>
					<option value={NO_VALUE}>Choose a reading…</option>
					{#each readings as reading (reading.id)}
						<option value={reading.id}
							>{reading.label}: {describeReading(reading)}</option
						>
					{/each}
				</select>
			</label>
			<button
				type="button"
				class="btn btn-xs"
				disabled={hasManualSelection || moveTargetId === NO_VALUE}
				data-testid="apply-move"
				onclick={() => moveSelectionToReading(moveTargetId)}
			>
				Move
			</button>
			<button
				type="button"
				class="btn btn-xs"
				onclick={splitSelectionIntoNewReading}
				disabled={hasManualSelection}
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
							<option value={reading.id}
								>{reading.label}: {describeReading(reading)}</option
							>
						{/if}
					{/each}
				</select>
			</label>
			<button
				type="button"
				class="btn btn-xs"
				disabled={!selectedReadingIds.includes(mergeTargetId) ||
					selectedReadingIds.length < 2}
				data-testid="apply-merge"
				onclick={() => mergeSelectionInto(mergeTargetId)}
			>
				Merge
			</button>
			<fieldset class="flex flex-wrap items-center gap-1.5 text-xs text-base-content/60">
				<legend class="sr-only">Readings the selected witnesses could support</legend>
				<span aria-hidden="true">Ambiguous between</span>
				{#each readings as reading (reading.id)}
					<label class="flex items-center gap-0.5">
						<input
							type="checkbox"
							class="checkbox checkbox-xs"
							aria-label={`Ambiguous between: ${reading.label}`}
							checked={ambiguousTargetIds.includes(reading.id)}
							onchange={() => toggleAmbiguousTarget(reading.id)}
						/>
						<span class="font-mono">{reading.label}</span>
					</label>
				{/each}
			</fieldset>
			<button
				type="button"
				class="btn btn-xs"
				disabled={ambiguousTargetIds.length < 2}
				data-testid="apply-ambiguous"
				onclick={recordAmbiguousSelection}
			>
				Record zw
			</button>
			{#if mergeTargetId !== NO_VALUE && mergeDiscards.texts.length > 0}
				<p class="w-full text-xs text-warning" data-testid="merge-warning">
					Merging discards the text of {mergeDiscards.texts.join(', ')}.
					{#if mergeDiscards.lemmaLabel}
						{mergeDiscards.lemmaLabel} is the lemma reading; it reverts to the base text.
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

	<div class="min-h-0 flex-1 overflow-auto rounded-xl bg-base-100 p-1 sm:px-2">
		{#if !selectedSpan}
			<div class="flex h-full items-center justify-center p-6 text-sm text-base-content/35">
				No variation units. Adjust the alignment.
			</div>
		{:else}
			<div role="group" aria-label="Witness sigla, grouped by reading" bind:this={chipGroup}>
				<div class="divide-y divide-base-300/60">
					{#each cards as card (card.main.id)}
						<article>
							{#each card.nodes as node (node.reading.id)}
								{@const reading = node.reading}
								{@const isSub = node.depth > 0}
								{@const isLemma = reading.id === lemmaReadingId}
								{@const attesting = attestingWitnessesOf(reading)}
								{@const attachParentId = attachParentOf(reading)}
								{@const attachTypeId = attachTypeOf(reading)}
								{@const manualIds = displayedManualWitnessIds(reading)}
								<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
								<div
									class={[
										'group grid grid-cols-[2.75rem_minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-2 py-2.5 sm:grid-cols-[2.75rem_minmax(7rem,13rem)_minmax(0,1fr)_auto]',
										isLemma && 'rounded-lg bg-base-200/70',
									]}
									role="group"
									aria-label={`Reading ${reading.label}`}
									onclick={() => (activeRowId = reading.id)}
								>
									<div
										class="row-span-3 pt-1 sm:row-span-2"
										style:padding-left={isSub
											? `${node.depth * 0.75}rem`
											: undefined}
									>
										<span
											class={[
												'block font-semibold leading-tight',
												isSub
													? 'font-medium text-base-content/65'
													: isLemma
														? 'text-primary'
														: 'text-base-content',
											]}>{reading.label}</span
										>
										{#if isLemma}
											<span
												class="block text-[0.65rem] font-medium text-primary"
												>lemma</span
											>
										{:else if baseTextWitnessId && reading.witnessIds.includes(baseTextWitnessId)}
											<span class="block text-[0.65rem] text-base-content/45"
												>base text</span
											>
										{/if}
									</div>

									<input
										class={[
											'col-start-2 row-start-1 w-full min-w-0 border-b border-transparent bg-transparent font-greek leading-tight hover:border-base-300 focus:border-primary focus:outline-none disabled:hover:border-transparent',
											isSub ? 'text-lg text-base-content/80' : 'text-xl',
										]}
										aria-label={`Text of reading ${reading.label}`}
										disabled={reading.isOmission || reading.isLacuna}
										value={getDisplayedReadingText(reading)}
										placeholder={reading.isOmission
											? 'om.'
											: reading.isLacuna
												? 'lac.'
												: 'Reading text'}
										onblur={event =>
											commitReadingText(reading, event.currentTarget.value)}
										onkeydown={event => {
											if (event.key === 'Enter') event.currentTarget.blur();
										}}
									/>

									<div
										class="col-span-2 col-start-2 row-start-3 flex min-w-0 flex-wrap items-baseline gap-0.5 sm:col-span-1 sm:col-start-3 sm:row-start-1"
									>
										{#if getDisplayedWitnessIds(reading).length === 0}
											<span class="px-1 text-sm italic text-base-content/30"
												>no witnesses</span
											>
										{/if}
										{#each visibleWitnessesOf(reading) as witness (witness.id)}
											{@render witnessChip(witness.id)}
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
										{#if manualIds.length > 0}
											{#if displayedTranscribedWitnessIds(reading).length > 0}
												<span
													class="mx-1 h-3.5 w-px self-center bg-base-300"
													aria-hidden="true"
												></span>
											{/if}
											{#each manualIds as id (id)}
												{@render witnessChip(id)}
											{/each}
										{/if}
										<button
											type="button"
											class="ml-1 rounded px-1 text-xs text-base-content/40 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
											data-slot={`witness-${reading.id}`}
											aria-label={`Add manual witness to reading ${reading.label}`}
											aria-expanded={witnessEditorFor === reading.id}
											onclick={() => (witnessEditorFor = reading.id)}
											>+ witness</button
										>
										{#if witnessEditorFor === reading.id}
											<div
												class="flex basis-full flex-wrap items-center gap-1 pt-1"
												onfocusout={closeWhenFocusLeaves(
													() => (witnessEditorFor = null)
												)}
											>
												<input
													class="input input-xs min-w-0 flex-1 sm:max-w-64"
													aria-label={`Manual witness for reading ${reading.label}`}
													aria-describedby={manualErrors.has(reading.id)
														? `manual-error-${reading.id}`
														: undefined}
													list={`manual-witnesses-${reading.id}`}
													placeholder="Choose or enter a siglum"
													value={manualDrafts.get(reading.id) ?? ''}
													oninput={event =>
														manualDrafts.set(
															reading.id,
															event.currentTarget.value
														)}
													onkeydown={event => {
														if (event.key === 'Enter') {
															event.preventDefault();
															void attachManual(reading);
														} else if (event.key === 'Escape') {
															event.preventDefault();
															witnessEditorFor = null;
															void focusSlot(`witness-${reading.id}`);
														}
													}}
													{@attach focusOnMount}
												/>
												<datalist id={`manual-witnesses-${reading.id}`}>
													{#each manualWitnesses as witness (witness.id)}<option
															value={witness.siglum}
														></option>{/each}
												</datalist>
												<button
													type="button"
													class="btn btn-xs"
													aria-label={`Attach manual witness to reading ${reading.label}`}
													disabled={!(
														manualDrafts.get(reading.id) ?? ''
													).trim()}
													onclick={() => attachManual(reading)}
													>Attach</button
												>
												{#if manualErrors.has(reading.id)}
													<p
														id={`manual-error-${reading.id}`}
														role="alert"
														class="basis-full text-xs text-error"
													>
														{manualErrors.get(reading.id)}
													</p>
												{/if}
											</div>
										{/if}
									</div>
									<div
										class="col-span-2 col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-1"
									>
										{#if canSpan}
											<label
												class="flex items-center gap-1.5 px-1.5 text-xs text-base-content/65"
											>
												<input
													type="checkbox"
													class="checkbox checkbox-xs"
													aria-label={`Reading ${reading.label} spans this unit`}
													checked={spanningReadingIds.includes(
														reading.id
													)}
													onchange={event =>
														collationState.setReadingSpanning(
															unitId,
															reading.id,
															event.currentTarget.checked
														)}
												/>
												Spans this unit
											</label>
										{/if}
										<select
											class={[
												META_CONTROL,
												'field-sizing-content cursor-pointer appearance-none bg-transparent',
												reading.readingType === null &&
													slotClass(reading.id),
											]}
											aria-label={`Reading type for reading ${reading.label}`}
											value={reading.readingType ?? ''}
											onchange={event =>
												collationState.setReadingType(
													unitId,
													reading.id,
													event.currentTarget.value || null
												)}
										>
											<option value=""
												>{reading.readingType === null
													? '+ type'
													: 'No type'}</option
											>
											{#each readingTypeOptions(reading) as type (type.id)}
												<option
													value={type.id}
													disabled={!type.selectable}
													title={type.description}>{type.label}</option
												>
											{/each}
										</select>
										<select
											class={[
												META_CONTROL,
												'field-sizing-content cursor-pointer appearance-none bg-transparent',
												reading.certainty === null && slotClass(reading.id),
											]}
											aria-label={`Certainty for reading ${reading.label}`}
											value={reading.certainty === null
												? ''
												: String(reading.certainty)}
											onchange={event =>
												collationState.setReadingCertainty(
													unitId,
													reading.id,
													parseCertainty(event.currentTarget.value)
												)}
										>
											<option value=""
												>{reading.certainty === null
													? '+ certainty'
													: 'No certainty'}</option
											>
											{#each certaintyOptions(reading) as level (level)}
												<option value={level}>certainty {level}</option>
											{/each}
										</select>
										{#each reading.readingTags ?? [] as tagId (tagId)}
											{@const label =
												readingTags.find(tag => tag.id === tagId)?.label ??
												tagId}
											<button
												type="button"
												class="badge badge-ghost badge-sm h-auto max-w-full gap-1 whitespace-normal break-words py-0.5 text-left"
												aria-label={`Remove tag ${label} from reading ${reading.label}`}
												onclick={() => removeTag(reading, tagId)}
												>{label}
												<span aria-hidden="true">×</span></button
											>
										{/each}
										{#if editingTagFor === reading.id}
											<div
												class="order-last flex basis-full flex-wrap items-center gap-1"
												onfocusout={closeWhenFocusLeaves(
													() => (editingTagFor = null)
												)}
											>
												<input
													class="input input-xs min-w-0 flex-1 sm:max-w-64"
													aria-label={`Tag for reading ${reading.label}`}
													list={`reading-tags-${reading.id}`}
													placeholder="Choose or enter a tag"
													value={tagDrafts.get(reading.id) ?? ''}
													oninput={event =>
														tagDrafts.set(
															reading.id,
															event.currentTarget.value
														)}
													onkeydown={event => {
														if (event.key === 'Enter') {
															event.preventDefault();
															void addTag(reading);
														} else if (event.key === 'Escape') {
															event.preventDefault();
															editingTagFor = null;
															void focusSlot(`tag-${reading.id}`);
														}
													}}
													{@attach focusOnMount}
												/>
												<datalist id={`reading-tags-${reading.id}`}>
													{#each readingTags.filter(tag => !reading.readingTags?.includes(tag.id)) as tag (tag.id)}
														<option value={tag.label}></option>
													{/each}
												</datalist>
												<button
													type="button"
													class="btn btn-ghost btn-xs"
													aria-label={`Add tag to reading ${reading.label}`}
													onclick={() => addTag(reading)}>Add tag</button
												>
											</div>
										{:else}
											<button
												type="button"
												class={[META_CONTROL, slotClass(reading.id)]}
												data-slot={`tag-${reading.id}`}
												aria-label={`Tag reading ${reading.label}`}
												onclick={() => (editingTagFor = reading.id)}
												>+ tag</button
											>
										{/if}
										{#if editingNoteFor === reading.id}
											<textarea
												class="textarea textarea-xs order-last basis-full"
												aria-label={`Note for reading ${reading.label}`}
												value={reading.note ?? ''}
												onblur={event =>
													finishNote(reading, event.currentTarget.value)}
												onkeydown={event => {
													if (event.key !== 'Escape') return;
													event.preventDefault();
													noteCancelled = true;
													event.currentTarget.blur();
													void focusSlot(`note-${reading.id}`);
												}}
												{@attach focusOnMount}
											></textarea>
										{:else if reading.note}
											<button
												type="button"
												class={[
													META_CONTROL,
													'max-w-full whitespace-pre-line break-words text-left italic',
												]}
												data-slot={`note-${reading.id}`}
												title="Edit note"
												onclick={() => (editingNoteFor = reading.id)}
												>{reading.note}</button
											>
										{:else}
											<button
												type="button"
												class={[META_CONTROL, slotClass(reading.id)]}
												data-slot={`note-${reading.id}`}
												aria-label={`Add a note to reading ${reading.label}`}
												onclick={() => (editingNoteFor = reading.id)}
												>+ note</button
											>
										{/if}
									</div>

									<details
										class="dropdown dropdown-end col-start-3 row-start-1 justify-self-end sm:col-start-4"
									>
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

											{#if !isSub && !isLemma}
												<button
													type="button"
													class="btn btn-ghost btn-xs w-full justify-start"
													onclick={() => establishLemma(reading)}
												>
													Elevate to lemma
												</button>
											{/if}

											{#if !isSub}
												{@const newSubreadingType =
													newSubreadingTypeDrafts.get(reading.id) ??
													NO_VALUE}
												<div class="flex items-end gap-1">
													<label
														class="block min-w-0 flex-1 text-xs text-base-content/50"
													>
														<span>New subreading type</span>
														<select
															class="select select-bordered select-xs mt-1 w-full"
															value={newSubreadingType}
															onchange={event =>
																newSubreadingTypeDrafts.set(
																	reading.id,
																	event.currentTarget.value
																)}
														>
															<option value={NO_VALUE}
																>Choose a reading type…</option
															>
															{#each subreadingTypeOptions as type (type.id)}
																<option
																	value={type.id}
																	title={type.description}
																	>{type.label} ({type.suffix})</option
																>
															{/each}
														</select>
													</label>
													<button
														type="button"
														class="btn btn-ghost btn-xs gap-1"
														disabled={newSubreadingType === NO_VALUE}
														onclick={() =>
															addSubreading(
																reading,
																newSubreadingType
															)}
													>
														<Plus size={12} /> Add subreading
													</button>
												</div>
											{/if}

											<label class="block text-xs text-base-content/50">
												<span>Attach as subreading of</span>
												<select
													class="select select-bordered select-xs mt-1 w-full"
													value={attachParentId}
													onchange={event =>
														attachParentDrafts.set(
															reading.id,
															event.currentTarget.value
														)}
												>
													<option value={NO_VALUE}
														>Independent reading</option
													>
													{#each getAttachmentOptions(reading.id) as candidate (candidate.id)}
														<option value={candidate.id}
															>{candidate.label}: {describeReading(
																candidate
															)}</option
														>
													{/each}
												</select>
											</label>
											{#if attachParentId !== (reading.parentReadingId ?? NO_VALUE)}
												{#if attachParentId !== NO_VALUE}
													<label
														class="block text-xs text-base-content/50"
													>
														<span>Subreading type</span>
														<select
															class="select select-bordered select-xs mt-1 w-full"
															value={attachTypeId}
															onchange={event =>
																attachTypeDrafts.set(
																	reading.id,
																	event.currentTarget.value
																)}
														>
															<option value={NO_VALUE}
																>Choose a reading type…</option
															>
															{#each subreadingTypeOptions as type (type.id)}
																<option
																	value={type.id}
																	title={type.description}
																	>{type.label} ({type.suffix})</option
																>
															{/each}
														</select>
													</label>
												{/if}
												<button
													type="button"
													class="btn btn-xs w-full"
													disabled={attachParentId !== NO_VALUE &&
														attachTypeId === NO_VALUE}
													onclick={() => applyAttachment(reading)}
												>
													{attachParentId === NO_VALUE
														? 'Make independent'
														: 'Attach'}
												</button>
											{/if}

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
													{attesting.length} witness(es) still attest this reading.
													Move them first.
												</p>
											{/if}
										</div>
									</details>
								</div>
							{/each}
						</article>
					{/each}

					<form
						class="grid grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-x-3 px-2 py-3"
						aria-label="Add authored reading"
						onsubmit={event => {
							event.preventDefault();
							addAuthored();
						}}
					>
						<span class="pl-0.5 text-base-content/40" aria-hidden="true">+</span>
						<input
							class="w-full min-w-0 border-b border-base-300 bg-transparent py-0.5 font-greek text-lg placeholder:font-sans placeholder:text-sm placeholder:text-base-content/40 focus:border-primary focus:outline-none"
							aria-label="New reading text"
							placeholder="Add a reading, or om. for an omission"
							bind:value={authoredText}
						/>
					</form>
				</div>

				{#if outsideManualIds.length > 0 || hasNonAttestation || ambiguousAttestations.length > 0}
					<div class="mx-2 mt-1 mb-3 space-y-1.5 border-t border-base-300 pt-3 text-sm">
						<h3 class="font-serif text-sm font-semibold">Not in a reading</h3>
						{#if unitView.unrecordedManualWitnessIds.length > 0}
							<section
								class="flex flex-wrap items-baseline gap-x-4 gap-y-1"
								aria-label="Manual witnesses with nothing recorded"
							>
								<h4 class="w-32 shrink-0 text-base-content/60">Not recorded</h4>
								<div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-0.5">
									{#each unitView.unrecordedManualWitnessIds as id (id)}
										{@render witnessChip(id)}
									{/each}
									<span class="ml-2 text-xs text-base-content/55"
										><span class="text-warning" aria-hidden="true">●</span> needs
										a decision</span
									>
								</div>
							</section>
						{/if}
						{#if unitView.uncitedManualWitnessIds.length > 0}
							<section
								class="flex flex-wrap items-baseline gap-x-4 gap-y-1"
								aria-label="Uncited manual witnesses"
							>
								<h4 class="w-32 shrink-0 text-base-content/60">Uncited</h4>
								<div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-0.5">
									{#each unitView.uncitedManualWitnessIds as id (id)}
										{@render witnessChip(id)}
									{/each}
								</div>
							</section>
						{/if}
						{#if hasNonAttestation}
							{@const transcribedNonAttesting = nonAttestation.witnessIds.filter(
								id => !isManualWitness(id)
							)}
							<section
								class="flex flex-wrap items-baseline gap-x-4 gap-y-1"
								aria-label="Witnesses that do not testify"
							>
								<h4 class="w-32 shrink-0 text-base-content/60">Does not testify</h4>
								<div class="min-w-0 flex-1 space-y-0.5">
									<div class="flex flex-wrap items-baseline gap-0.5">
										{#if transcribedNonAttesting.length > 0}
											<span class="px-1 tabular-nums text-base-content/70">
												{getSortedWitnesses(transcribedNonAttesting)
													.map(witness => witness.siglum)
													.join('. ')}
											</span>
										{/if}
										{#each unitView.nonAttestingManualWitnessIds as id (id)}
											{@render witnessChip(id)}
										{/each}
										<span class="ml-2 text-xs text-base-content/45"
											>Damaged, lost or illegible. Takes no letter and no
											place in the local stemma.</span
										>
									</div>
									{#if nonAttestation.untranscribedWitnessIds.length > 0}
										<div class="px-1 text-xs text-base-content/45">
											Not yet transcribed: {getSortedWitnesses(
												nonAttestation.untranscribedWitnessIds
											)
												.map(witness => witness.siglum)
												.join('. ')}
										</div>
									{/if}
								</div>
							</section>
						{/if}
						{#if ambiguousAttestations.length > 0}
							<section
								class="flex flex-wrap items-baseline gap-x-4 gap-y-1"
								aria-label="Ambiguous attestations"
							>
								<h4 class="w-32 shrink-0 text-base-content/60">Ambiguous</h4>
								<div class="min-w-0 flex-1">
									<ul class="space-y-0.5">
										{#each ambiguousAttestations as attestation (attestation.id)}
											<li class="flex flex-wrap items-baseline gap-2 px-1">
												<span class="font-semibold"
													>{attestation.label}</span
												>
												<span class="tabular-nums text-base-content/70">
													{getSortedWitnesses(attestation.witnessIds)
														.map(witness => witness.siglum)
														.join(' ')}
												</span>
												<button
													type="button"
													class="btn btn-ghost btn-xs"
													aria-label={`Remove ${attestation.label}`}
													onclick={() =>
														removeAmbiguousAttestation(attestation)}
												>
													Remove
												</button>
											</li>
										{/each}
									</ul>
									<p class="px-1 text-xs text-base-content/45">
										Compatible with more than one reading. Takes no letter and
										no place in the local stemma.
									</p>
								</div>
							</section>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

{#snippet witnessChip(id: string)}
	{@const index = chipIndexOf.get(id) ?? 0}
	{@const isSelected = selectedWitnessIds.has(id)}
	{@const isUnconfirmed = unconfirmedWitnessIds.includes(id)}
	<button
		type="button"
		data-chip-index={index}
		data-witness-id={id}
		title={isUnconfirmed ? 'Unconfirmed attestation' : witnessDescriptions.get(id)}
		tabindex={index === rovingIndex ? 0 : -1}
		aria-pressed={isSelected}
		class={[
			'rounded px-1 py-0.5 text-sm tabular-nums transition',
			isManualWitness(id) && 'italic',
			isSelected
				? 'bg-primary text-primary-content'
				: 'text-base-content/70 hover:bg-base-200 hover:text-base-content',
		]}
		onclick={event => handleChipClick(event, index)}
		onkeydown={event => handleChipKeydown(event, index)}
		onfocus={() => (activeChipIndex = index)}
	>
		{getWitnessSiglum(id)}
		{#if isUnconfirmed}
			<span class="text-warning" aria-label="Unconfirmed attestation">●</span>
		{/if}
	</button>
{/snippet}
