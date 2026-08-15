<script lang="ts">
	import { collationState } from '$lib/client/collation/collation-state.svelte';
	import { layoutLocalStemma } from '$lib/client/collation/collation-stemma-layout';
	import type { SourceDecision, StemmaTreeNode } from '$lib/client/collation/collation-stemma';
	import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
	import { onDestroy, onMount, tick } from 'svelte';

	/**
	 * A refusal belongs beside the control that produced it, not at the top of a scrolling panel,
	 * and it must re-announce when the same refusal repeats. `seq` remounts the alert; the unit
	 * and reading it names keep it from outliving the control it refers to.
	 */
	let refusal = $state<{
		unitIndex: number;
		readingId: string;
		message: string;
		seq: number;
	} | null>(null);
	let refusalCount = 0;

	let unitSpans = $derived(collationState.getVariationUnitSpans());
	let selectedSpan = $derived(
		unitSpans.find(span => span.startIndex === collationState.selectedUnitIndex) ??
			unitSpans[0] ??
			null
	);

	$effect(() => {
		if (selectedSpan && collationState.selectedUnitIndex !== selectedSpan.startIndex) {
			collationState.selectedUnitIndex = selectedSpan.startIndex;
		}
		if (selectedSpan) {
			collationState.primeReadingsForUnit(selectedSpan.startIndex);
		}
	});

	let stemma = $derived(collationState.getLocalStemma(collationState.selectedUnitIndex));
	let connectivity = $derived(collationState.getConnectivity(collationState.selectedUnitIndex));
	let layout = $derived(layoutLocalStemma(stemma.nodes));
	let nodeById = $derived(new Map(stemma.nodes.map(node => [node.readingId, node] as const)));
	let labelById = $derived(new Map(stemma.nodes.map(node => [node.readingId, node.label])));
	let focusedNodeId = $state<string | null>(null);
	let liftedReadingId = $state<string | null>(null);
	let liftTargetReadingId = $state<string | null>(null);
	let draggedReadingId = $state<string | null>(null);
	let dropTargetReadingId = $state<string | null>(null);
	let liveMessage = $state('');
	let connectivityRefusal = $state<{
		unitIndex: number;
		message: string;
		seq: number;
	} | null>(null);
	let connectivityRefusalCount = 0;
	const nodeButtons = new Map<string, HTMLButtonElement>();

	$effect(() => {
		const nodeIds = new Set(stemma.nodes.map(node => node.readingId));
		if (!focusedNodeId || !nodeIds.has(focusedNodeId)) {
			focusedNodeId = stemma.nodes[0]?.readingId ?? null;
		}
		if (liftedReadingId && !nodeIds.has(liftedReadingId)) liftedReadingId = null;
		if (liftTargetReadingId && !nodeIds.has(liftTargetReadingId)) liftTargetReadingId = null;
		if (draggedReadingId && !nodeIds.has(draggedReadingId)) draggedReadingId = null;
		if (dropTargetReadingId && !nodeIds.has(dropTargetReadingId)) dropTargetReadingId = null;
	});

	/**
	 * Node colour encodes the source decision and nothing else. Being the lemma is an orthogonal
	 * fact, marked separately, so an unconsidered lemma still reads as unconsidered.
	 */
	const SOURCE_STATES = {
		derived: {
			label: 'Derived',
			classes: 'border-base-content/40 bg-base-content/10 text-base-content',
			stroke: 'text-base-content/50',
		},
		unclear: {
			label: 'Unclear',
			classes: 'border-warning bg-warning/15 text-warning',
			stroke: 'text-warning',
		},
		undecided: {
			label: 'Undecided',
			classes: 'border-dashed border-base-content/30 bg-base-100 text-base-content/50',
			stroke: 'text-base-content/30',
		},
		violation: {
			label: 'Conflicting sources',
			classes: 'border-error bg-error/15 text-error',
			stroke: 'text-error',
		},
	} as const;

	type SourceState = keyof typeof SOURCE_STATES;

	function stateOf(node: StemmaTreeNode): SourceState {
		if (node.violation) return 'violation';
		if (node.sourceDecision.kind === 'derived') return 'derived';
		if (node.sourceDecision.kind === 'unclear') return 'unclear';
		return 'undecided';
	}

	/** The value the select shows. A conflict is no judgement, so it takes its own placeholder. */
	const CONFLICT_VALUE = '__conflict__';

	function selectValueOf(node: StemmaTreeNode): string {
		if (node.violation) return CONFLICT_VALUE;
		if (node.sourceDecision.kind === 'derived') return `derived:${node.sourceDecision.from}`;
		return node.sourceDecision.kind;
	}

	function decisionFromValue(value: string): SourceDecision {
		if (value === 'unclear') return { kind: 'unclear' };
		if (value.startsWith('derived:')) return { kind: 'derived', from: value.slice(8) };
		return { kind: 'undecided' };
	}

	const REFUSALS: Record<string, string> = {
		cycle: 'That source already derives from this reading, so the two would form a cycle. No change was made.',
		'self-source': 'A reading cannot derive from itself. No change was made.',
		'not-a-main-reading': 'Only main readings carry a source. No change was made.',
		'reading-not-found': 'That reading no longer exists. No change was made.',
	};

	function recordSourceRefusal(node: StemmaTreeNode, error: keyof typeof REFUSALS) {
		const message = REFUSALS[error] ?? 'That source was refused.';
		refusalCount += 1;
		refusal = {
			unitIndex: collationState.selectedUnitIndex,
			readingId: node.readingId,
			message,
			seq: refusalCount,
		};
		return message;
	}

	function setSourceDecision(node: StemmaTreeNode, decision: SourceDecision): string | null {
		const result = collationState.setReadingSource(
			collationState.selectedUnitIndex,
			node.readingId,
			decision
		);
		if (result.ok) {
			refusal = null;
			return null;
		}
		return recordSourceRefusal(node, result.error);
	}

	function setConnectivity(value: number) {
		const result = collationState.setConnectivity(collationState.selectedUnitIndex, value);
		if (result.ok) {
			connectivityRefusal = null;
			return;
		}
		connectivityRefusalCount += 1;
		connectivityRefusal = {
			unitIndex: collationState.selectedUnitIndex,
			message:
				result.error === 'invalid-connectivity'
					? 'Connectivity must be a positive whole number. No change was made.'
					: 'This variation unit is no longer available. No change was made.',
			seq: connectivityRefusalCount,
		};
	}

	function setCustomConnectivity(control: HTMLInputElement) {
		setConnectivity(control.valueAsNumber);
	}

	function rerootOnLemma() {
		const result = collationState.rerootStemmaOnLemma(collationState.selectedUnitIndex);
		if (!result.ok) {
			liveMessage = 'The stemma could not be rerooted on the lemma.';
			return;
		}
		liveMessage = `Removed ${result.removed} arc${result.removed === 1 ? '' : 's'} into the lemma.`;
	}

	function chooseSource(node: StemmaTreeNode, control: HTMLSelectElement) {
		if (control.value === CONFLICT_VALUE) return;
		const message = setSourceDecision(node, decisionFromValue(control.value));
		if (!message) return;
		// Nothing was recorded, so the control must not go on showing the refused choice.
		control.value = selectValueOf(node);
	}

	function refusalFor(node: StemmaTreeNode) {
		if (!refusal) return null;
		if (refusal.readingId !== node.readingId) return null;
		return refusal.unitIndex === collationState.selectedUnitIndex ? refusal : null;
	}

	function readingSummary(node: StemmaTreeNode): string {
		if (node.isOmission) return 'om.';
		return node.text ?? '';
	}

	function truncate(value: string, max: number): string {
		return value.length > max ? `${value.slice(0, max)}\u2026` : value;
	}

	function describeNode(node: StemmaTreeNode): string {
		const source = node.violation
			? `conflicting sources (${node.violation.priorReadingIds
					.map(id => labelById.get(id) ?? id)
					.join(', ')})`
			: node.sourceDecision.kind === 'derived'
				? `derived from ${labelById.get(node.sourceDecision.from) ?? node.sourceDecision.from}`
				: node.sourceDecision.kind === 'unclear'
					? 'origin undeterminable'
					: 'origin not yet considered';
		return `${node.label}${node.isLemma ? ' (lemma)' : ''}: ${readingSummary(node)} \u2014 ${source}.`;
	}

	function registerNodeButton(button: HTMLButtonElement, readingId: string) {
		nodeButtons.set(readingId, button);
		return {
			update(nextReadingId: string) {
				nodeButtons.delete(readingId);
				readingId = nextReadingId;
				nodeButtons.set(readingId, button);
			},
			destroy() {
				nodeButtons.delete(readingId);
			},
		};
	}

	async function focusNode(readingId: string) {
		focusedNodeId = readingId;
		await tick();
		nodeButtons.get(readingId)?.focus();
	}

	function sourceIdOf(node: StemmaTreeNode): string | null {
		return node.sourceDecision.kind === 'derived' ? node.sourceDecision.from : null;
	}

	function navigationTarget(node: StemmaTreeNode, key: string): string | null {
		if (key === 'ArrowUp') return sourceIdOf(node);
		if (key === 'ArrowDown') {
			return (
				stemma.nodes.find(other => sourceIdOf(other) === node.readingId)?.readingId ?? null
			);
		}
		const source = sourceIdOf(node);
		const siblings = stemma.nodes.filter(other => sourceIdOf(other) === source);
		const index = siblings.findIndex(other => other.readingId === node.readingId);
		if (index === -1) return null;
		if (key === 'ArrowLeft') return siblings[index - 1]?.readingId ?? null;
		if (key === 'ArrowRight') return siblings[index + 1]?.readingId ?? null;
		return null;
	}

	function describeLiftTarget(lifted: StemmaTreeNode, target: StemmaTreeNode) {
		return `Reading ${target.label} is selected as the prior reading for lifted reading ${lifted.label}.`;
	}

	function moveDiagramFocus(node: StemmaTreeNode, key: string) {
		const targetId = navigationTarget(node, key);
		if (!targetId) return;
		const target = nodeById.get(targetId);
		if (!target) return;
		void focusNode(targetId);
		if (!liftedReadingId) return;
		const lifted = nodeById.get(liftedReadingId);
		if (lifted) {
			liftTargetReadingId = target.readingId;
			liveMessage = describeLiftTarget(lifted, target);
		}
	}

	function liftOrPlace(node: StemmaTreeNode) {
		if (!liftedReadingId) {
			liftedReadingId = node.readingId;
			liftTargetReadingId = null;
			liveMessage = `Lifted reading ${node.label}. Choose its prior reading with the arrow keys.`;
			return;
		}

		const lifted = nodeById.get(liftedReadingId);
		if (!lifted) {
			liftedReadingId = null;
			liftTargetReadingId = null;
			return;
		}
		if (lifted.readingId === node.readingId) {
			liveMessage = `Reading ${lifted.label} cannot be its own prior reading. Choose another reading.`;
			return;
		}

		const refusalMessage = setSourceDecision(lifted, { kind: 'derived', from: node.readingId });
		if (refusalMessage) {
			liveMessage = `Cannot make reading ${lifted.label} derive from reading ${node.label}. ${refusalMessage}`;
			return;
		}
		liftedReadingId = null;
		liftTargetReadingId = null;
		liveMessage = `Reading ${lifted.label} now derives from reading ${node.label}.`;
	}

	function cancelLift() {
		if (!liftedReadingId) return;
		const lifted = nodeById.get(liftedReadingId);
		const target = liftTargetReadingId ? nodeById.get(liftTargetReadingId) : null;
		if (lifted) {
			liveMessage = target
				? `Cancelled placing reading ${lifted.label} on reading ${target.label}. Focus returned to reading ${lifted.label}.`
				: `Cancelled placing reading ${lifted.label}. Focus returned to reading ${lifted.label}.`;
		}
		liftedReadingId = null;
		liftTargetReadingId = null;
		if (!lifted) return;
		void focusNode(lifted.readingId);
	}

	function setNodeState(node: StemmaTreeNode, decision: SourceDecision, action: string) {
		const formerSourceId = sourceIdOf(node);
		const formerSource = formerSourceId ? nodeById.get(formerSourceId) : null;
		const refusalMessage = setSourceDecision(node, decision);
		if (refusalMessage) {
			liveMessage = `Could not ${action} for reading ${node.label}. ${refusalMessage}`;
			return;
		}
		if (decision.kind === 'unclear') {
			liveMessage = `Reading ${node.label} is marked unclear; its origin cannot be determined.`;
			return;
		}
		liveMessage = formerSource
			? `Reading ${node.label} is detached from reading ${formerSource.label} and is now a root.`
			: `Reading ${node.label} is now a root.`;
	}

	function handleNodeKeydown(event: KeyboardEvent, node: StemmaTreeNode) {
		if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
			event.preventDefault();
			event.stopPropagation();
			moveDiagramFocus(node, event.key);
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			liftOrPlace(node);
			return;
		}
		if (event.key === 'Escape' && liftedReadingId) {
			event.preventDefault();
			event.stopPropagation();
			cancelLift();
			return;
		}
		if (liftedReadingId) return;
		if (event.key.toLowerCase() === 'u') {
			event.preventDefault();
			setNodeState(node, { kind: 'unclear' }, 'mark the source unclear');
		} else if (event.key.toLowerCase() === 'r') {
			event.preventDefault();
			setNodeState(node, { kind: 'undecided' }, 'make it a root');
		} else if (event.key.toLowerCase() === 'd') {
			event.preventDefault();
			setNodeState(node, { kind: 'undecided' }, 'detach it');
		}
	}

	function handleDragStart(event: DragEvent, node: StemmaTreeNode) {
		event.dataTransfer?.setData('text/plain', node.readingId);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
		draggedReadingId = node.readingId;
		dropTargetReadingId = null;
		liveMessage = `Lifted reading ${node.label}. Drag it onto its prior reading or drop it on the canvas to make it a root.`;
	}

	function handleDragOverNode(event: DragEvent, node: StemmaTreeNode) {
		if (!draggedReadingId) return;
		event.preventDefault();
		event.stopPropagation();
		if (draggedReadingId === node.readingId || dropTargetReadingId === node.readingId) return;
		dropTargetReadingId = node.readingId;
		const dragged = nodeById.get(draggedReadingId);
		if (dragged) liveMessage = `Drop reading ${dragged.label} on reading ${node.label} to record that relationship.`;
	}

	function handleDragLeaveNode(event: DragEvent, node: StemmaTreeNode) {
		if (dropTargetReadingId !== node.readingId) return;
		const nextTarget = event.relatedTarget;
		if (nextTarget instanceof Node && (event.currentTarget as HTMLElement).contains(nextTarget)) {
			return;
		}
		dropTargetReadingId = null;
		const dragged = draggedReadingId ? nodeById.get(draggedReadingId) : null;
		if (dragged) {
			liveMessage = `Reading ${dragged.label} is no longer targeting a prior reading. Drop it on the canvas to make it a root.`;
		}
	}

	function handleDropOnNode(event: DragEvent, target: StemmaTreeNode) {
		event.preventDefault();
		event.stopPropagation();
		const dragged = draggedReadingId ? nodeById.get(draggedReadingId) : null;
		draggedReadingId = null;
		dropTargetReadingId = null;
		if (!dragged) return;
		if (dragged.readingId === target.readingId) {
			liveMessage = `Reading ${dragged.label} was dropped on itself. No change was made.`;
			void focusNode(dragged.readingId);
			return;
		}
		const refusalMessage = setSourceDecision(dragged, {
			kind: 'derived',
			from: target.readingId,
		});
		if (refusalMessage) {
			liveMessage = `Cannot make reading ${dragged.label} derive from reading ${target.label}. ${refusalMessage}`;
			void focusNode(dragged.readingId);
			return;
		}
		liveMessage = `Reading ${dragged.label} now derives from reading ${target.label}.`;
		void focusNode(dragged.readingId);
	}

	function handleCanvasDrop(event: DragEvent) {
		event.preventDefault();
		const dragged = draggedReadingId ? nodeById.get(draggedReadingId) : null;
		draggedReadingId = null;
		dropTargetReadingId = null;
		if (!dragged) return;
		const formerSourceId = sourceIdOf(dragged);
		const formerSource = formerSourceId ? nodeById.get(formerSourceId) : null;
		const refusalMessage = setSourceDecision(dragged, { kind: 'undecided' });
		if (refusalMessage) {
			liveMessage = `Could not make reading ${dragged.label} a root. ${refusalMessage}`;
		} else if (formerSource) {
			liveMessage = `Reading ${dragged.label} is detached from reading ${formerSource.label} and is now a root.`;
		} else {
			liveMessage = `Reading ${dragged.label} remains a root.`;
		}
		void focusNode(dragged.readingId);
	}

	function handleDragEnd() {
		if (!draggedReadingId) return;
		const dragged = nodeById.get(draggedReadingId);
		draggedReadingId = null;
		dropTargetReadingId = null;
		if (dragged) liveMessage = `Cancelled dragging reading ${dragged.label}.`;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.defaultPrevented) return;
		const target = e.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'SELECT' ||
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable)
		) {
			return;
		}
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			collationState.moveFocus('left');
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			collationState.moveFocus('right');
		}
	}

	onMount(() => {
		document.addEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		document.removeEventListener('keydown', handleKeydown);
	});

	/** The unit's ordinal, or null when it is not one of the current spans. */
	function getSpanLabel(startIndex: number): number | null {
		const index = unitSpans.findIndex(span => span.startIndex === startIndex);
		return index === -1 ? null : index + 1;
	}

	let selectedUnitLabel = $derived(selectedSpan ? getSpanLabel(selectedSpan.startIndex) : null);
</script>

<div class="flex flex-col h-full">
	<div class="shrink-0 mb-4">
		<div class="flex items-center gap-2 mb-2">
			<a
				class="btn btn-ghost btn-sm gap-1"
				href={collationState.collationId
					? `/collation/${collationState.collationId}/readings`
					: '#'}
				aria-disabled={!collationState.collationId}
				tabindex={collationState.collationId ? 0 : -1}
				onclick={e => {
					if (!collationState.collationId) e.preventDefault();
				}}
			>
				<ArrowLeft size={16} />
				Back
			</a>
			<h2 class="text-lg font-serif font-bold text-base-content/90 tracking-tight">
				Readings &amp; Local Stemma
			</h2>
		</div>

		<div
			class="mb-3 inline-flex items-center gap-2 rounded-full border border-base-300/60 bg-base-200/60 px-3 py-1 text-xs text-base-content/60"
		>
			<span class="font-semibold uppercase tracking-[0.18em]">Stemma View</span>
			<span
				>Each reading takes one source. Subreadings are cited with their main reading.</span
			>
		</div>

		<fieldset
			data-testid="connectivity-control"
			class="mb-3 flex flex-wrap items-center gap-2 rounded-box border border-base-300/60 bg-base-100 px-3 py-2"
			aria-label="Connectivity for this variation unit"
		>
			<legend class="sr-only">Connectivity</legend>
			<span class="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/60"
				>Connectivity</span
			>
			<div class="join" aria-label="Common connectivity values">
				{#each [1, 2, 3, 5, 10] as value}
					<button
						type="button"
						class="btn btn-xs join-item {connectivity === value
							? 'btn-primary'
							: 'btn-ghost'}"
						aria-pressed={connectivity === value}
						disabled={selectedSpan === null}
						onclick={() => setConnectivity(value)}
					>
						{value}
					</button>
				{/each}
			</div>
			<label class="flex items-center gap-1 text-xs text-base-content/60">
				<span>Custom</span>
				<input
					class="input input-bordered input-xs w-18 font-mono"
					aria-label="Custom connectivity"
					type="number"
					min="1"
					step="1"
					value={connectivity}
					disabled={selectedSpan === null}
					onchange={event => setCustomConnectivity(event.currentTarget)}
				/>
			</label>
			{#if connectivityRefusal && connectivityRefusal.unitIndex === collationState.selectedUnitIndex}
				{#key connectivityRefusal.seq}
					<p class="text-xs text-error" role="alert">{connectivityRefusal.message}</p>
				{/key}
			{/if}
		</fieldset>

		<div class="overflow-x-auto rounded-box border border-base-300/50 bg-base-100">
			<div class="flex">
				{#each unitSpans as span (span.startIndex)}
					{@const isSelected = collationState.selectedUnitIndex === span.startIndex}
					<button
						type="button"
						aria-current={isSelected ? 'true' : undefined}
						class="shrink-0 border-r border-base-300/40 px-3 py-2 text-center text-xs font-mono transition-all duration-100 min-w-22 {isSelected
							? 'bg-primary text-primary-content font-bold underline underline-offset-4'
							: 'bg-base-200 text-base-content/60'}"
						onclick={() => (collationState.selectedUnitIndex = span.startIndex)}
					>
						<div class="font-semibold">VU {getSpanLabel(span.startIndex)}</div>
						<div class="mt-0.5 text-[10px] opacity-75">
							{span.startIndex + 1}-{span.endIndex + 1}
						</div>
					</button>
				{/each}
			</div>
		</div>
	</div>

	<div class="flex-1 flex gap-4 min-h-0">
		<div class="w-96 shrink-0 overflow-y-auto">
			<h3 class="text-sm font-bold uppercase tracking-wider text-base-content/50 mb-3">
				Sources{selectedUnitLabel === null ? '' : ` — Unit ${selectedUnitLabel}`}
			</h3>

			{#if stemma.nodes.length === 0}
				<div class="text-sm text-base-content/40 text-center py-8">
					No readings for this unit.
				</div>
			{:else}
				<ul class="space-y-2">
					{#each stemma.nodes as node (node.readingId)}
						{@const state = stateOf(node)}
						<li
							class="bg-base-200/60 rounded-box p-3 border border-base-300/40 space-y-2"
						>
							<div class="flex items-center gap-2">
								<span class="badge badge-outline badge-sm font-mono"
									>{node.label}</span
								>
								<span class="font-greek text-sm font-medium">
									{#if node.isOmission}
										<span class="italic text-base-content/40">[omission]</span>
									{:else}
										{node.text}
									{/if}
								</span>
								{#if node.isLemma}
									<span class="badge badge-primary badge-sm">lemma</span>
								{/if}
							</div>
							<div class="text-[11px] font-mono text-base-content/50">
								{node.witnessIds.join(', ')}
							</div>

							{#if node.violation}
								<p class="text-xs text-error">
									{node.violation.priorReadingIds.length} recorded sources ({node.violation.priorReadingIds
										.map(id => labelById.get(id) ?? id)
										.join(', ')}). Choose one below to resolve it.
								</p>
							{/if}

							<label class="block">
								<span
									class="text-[11px] uppercase tracking-wider text-base-content/50"
								>
									Source of reading {node.label}
								</span>
								<select
									class="select select-sm select-bordered w-full mt-1 font-mono"
									value={selectValueOf(node)}
									onchange={e => chooseSource(node, e.currentTarget)}
								>
									<option value="undecided"
										>Undecided &mdash; not yet considered</option
									>
									<option value="unclear"
										>Unclear &mdash; origin undeterminable</option
									>
									{#if node.violation}
										<option value={CONFLICT_VALUE} disabled>
											Conflicting sources &mdash; choose one below
										</option>
									{/if}
									{#each stemma.nodes.filter(other => other.readingId !== node.readingId) as other (other.readingId)}
										<option value={`derived:${other.readingId}`}>
											Derived from {other.label}
											{truncate(readingSummary(other), 18)}
										</option>
									{/each}
								</select>
							</label>

							{#if refusalFor(node)}
								{#key refusal?.seq}
									<div class="alert alert-error py-2 text-xs" role="alert">
										{refusal?.message}
									</div>
								{/key}
							{/if}

							<p
								class="inline-block rounded border px-1.5 py-0.5 text-[11px] {SOURCE_STATES[
									state
								].classes}"
							>
								{SOURCE_STATES[state].label}
							</p>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="flex-1 min-w-0 flex flex-col">
			<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
				<h3 class="text-sm font-bold uppercase tracking-wider text-base-content/50">
					Local Stemma
				</h3>
				{#if stemma.violations.length > 0}
					<span class="text-xs text-error"
						>{stemma.violations.length} stemma warning(s)</span
					>
				{/if}
			</div>
			{#each stemma.violations.filter(violation => violation.kind === 'lemma-is-posterior') as violation (violation.readingId)}
				<div class="alert alert-warning mb-2 py-2 text-xs" role="alert">
					<span>
						The lemma has a recorded prior reading ({violation.priorReadingIds
							.map(id => labelById.get(id) ?? id)
							.join(', ')}). Its incoming arc is preserved until you repair it.
					</span>
					<button type="button" class="btn btn-warning btn-xs" onclick={rerootOnLemma}
						>Reroot on lemma</button
					>
				</div>
			{/each}

			<div class="flex-1 bg-base-200/30 rounded-box border border-base-300/40 relative overflow-auto">
				{#if layout.nodes.length === 0}
					<div
						class="flex items-center justify-center h-full text-sm text-base-content/30"
					>
						Select a variation unit to view its stemma
					</div>
				{:else}
					<div
						class="relative"
						role="group"
						aria-label="Local stemma{selectedUnitLabel === null
							? ''
							: ` for unit ${selectedUnitLabel}`}"
						aria-describedby="stemma-diagram-instructions"
						style="width: {layout.bounds.width}px; height: {layout.bounds.height}px;"
						ondragover={event => event.preventDefault()}
						ondrop={handleCanvasDrop}
					>
						<!-- Geometry is wholly in the layout module; this surface only renders arcs. -->
						<svg
							width={layout.bounds.width}
							height={layout.bounds.height}
							viewBox="0 0 {layout.bounds.width} {layout.bounds.height}"
							class="pointer-events-none absolute inset-0 block"
							aria-hidden="true"
						>
							<defs>
								<marker
									id="stemma-arrowhead"
									markerWidth="10"
									markerHeight="7"
									refX="10"
									refY="3.5"
									orient="auto"
									fill="currentColor"
									class="text-base-content/40"
								>
									<polygon points="0 0, 10 3.5, 0 7" />
								</marker>
							</defs>

							{#each layout.arcs as arc (arc.id)}
								<path
									d={arc.path}
									fill="none"
									stroke="currentColor"
									class="text-base-content/30"
									stroke-width="2"
									marker-end="url(#stemma-arrowhead)"
								/>
							{/each}
						</svg>

						{#each layout.nodes as placed (placed.id)}
							{@const node = nodeById.get(placed.id)}
							{#if node}
								{@const state = stateOf(node)}
								{@const isDropTarget = dropTargetReadingId === node.readingId}
								<button
									use:registerNodeButton={node.readingId}
									type="button"
									draggable="true"
									tabindex={focusedNodeId === node.readingId ? 0 : -1}
									aria-label={describeNode(node)}
									class="absolute overflow-hidden rounded-md border bg-base-100 px-2 py-1 text-center shadow-sm outline-offset-2 transition-colors cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-primary {SOURCE_STATES[
										state
									].classes} {node.isLemma ? 'ring-1 ring-primary ring-inset' : ''} {isDropTarget
										? 'ring-2 ring-success ring-offset-2 ring-offset-base-200'
										: ''} {liftedReadingId === node.readingId ? 'opacity-60 ring-2 ring-primary' : ''}"
									style="left: {placed.x}px; top: {placed.y}px; width: {placed.width}px; height: {placed.height}px;"
									onfocus={() => (focusedNodeId = node.readingId)}
									onkeydown={event => handleNodeKeydown(event, node)}
									ondragstart={event => handleDragStart(event, node)}
									ondragover={event => handleDragOverNode(event, node)}
									ondragleave={event => handleDragLeaveNode(event, node)}
									ondrop={event => handleDropOnNode(event, node)}
									ondragend={handleDragEnd}
								>
									<span class="block truncate font-mono text-[10px] text-base-content/60">
										{node.label}
										{state === 'undecided'
											? ' · ?'
											: state === 'unclear'
												? ' · unclear'
												: state === 'violation'
													? ' · conflict'
													: ' · derived'}
									</span>
									<span class="block truncate font-greek text-xs text-base-content">
										{node.isOmission ? 'om.' : truncate(node.text ?? '', 14)}
									</span>
									<span class="block truncate font-mono text-[9px] text-base-content/50">
										{truncate(node.witnessIds.join(', '), 20)}
									</span>
									{#if node.isLemma}
										<span class="absolute right-1 top-0.5 font-mono text-[8px] text-primary">lemma</span>
									{/if}
								</button>
							{/if}
						{/each}
					</div>
				{/if}
			</div>

			<p id="stemma-diagram-instructions" class="sr-only">
				Use the arrow keys to move between readings. Press Enter to lift a reading and Enter
				again on its prior reading to place it. Press Escape to cancel. Press U to mark a
				reading unclear, R to make it a root, or D to detach it.
			</p>
			<div class="sr-only" aria-live="polite" data-testid="stemma-announcer">{liveMessage}</div>
			{#if refusal && refusal.unitIndex === collationState.selectedUnitIndex}
				{#key refusal.seq}
					<div class="alert alert-error mt-2 py-2 text-xs" role="alert">{refusal.message}</div>
				{/key}
			{/if}

			<div class="mt-2 flex flex-wrap items-center gap-3 text-xs text-base-content/50">
				<span class="inline-flex items-center gap-1">
					<span
						class="inline-block h-3 w-3 rounded border border-dashed border-base-content/40"
					></span>
					Undecided &mdash; not yet considered
				</span>
				<span class="inline-flex items-center gap-1">
					<span class="inline-block h-3 w-3 rounded border border-warning bg-warning/20"
					></span>
					Unclear &mdash; origin undeterminable
				</span>
				<span class="inline-flex items-center gap-1">
					<span
						class="inline-block h-3 w-3 rounded border border-base-content/50 bg-base-content/10"
					></span>
					Derived &mdash; from a named prior reading
				</span>
				<span class="inline-flex items-center gap-1">
					<span class="inline-block h-3 w-3 rounded border border-error bg-error/20"
					></span>
					Conflicting sources
				</span>
				<span class="inline-flex items-center gap-1">
					<span class="inline-block h-3 w-3 rounded border border-primary"></span>
					Lemma &mdash; marked independently of its source
				</span>
				<span class="text-base-content/20">|</span>
				<span>Arrow keys to navigate units</span>
			</div>
		</div>
	</div>
</div>
