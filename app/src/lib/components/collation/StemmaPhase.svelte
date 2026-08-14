<script lang="ts">
	import { collationState } from '$lib/client/collation/collation-state.svelte';
	import { layoutLocalStemma } from '$lib/client/collation/collation-stemma-layout';
	import type { SourceDecision, StemmaTreeNode } from '$lib/client/collation/collation-stemma';
	import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
	import { onDestroy, onMount } from 'svelte';

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
	let layout = $derived(layoutLocalStemma(stemma.nodes));
	let nodeById = $derived(new Map(stemma.nodes.map(node => [node.readingId, node] as const)));
	let labelById = $derived(new Map(stemma.nodes.map(node => [node.readingId, node.label])));

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

	function chooseSource(node: StemmaTreeNode, control: HTMLSelectElement) {
		if (control.value === CONFLICT_VALUE) return;
		const result = collationState.setReadingSource(
			collationState.selectedUnitIndex,
			node.readingId,
			decisionFromValue(control.value)
		);
		if (result.ok) {
			refusal = null;
			return;
		}
		refusalCount += 1;
		refusal = {
			unitIndex: collationState.selectedUnitIndex,
			readingId: node.readingId,
			message: REFUSALS[result.error] ?? 'That source was refused.',
			seq: refusalCount,
		};
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

	/** What a screen reader gets from the diagram until ticket 09 makes the nodes controls. */
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

	let diagramDescription = $derived(stemma.nodes.map(describeNode).join(' '));

	function handleKeydown(e: KeyboardEvent) {
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
			<div class="flex items-center justify-between mb-2">
				<h3 class="text-sm font-bold uppercase tracking-wider text-base-content/50">
					Local Stemma
				</h3>
				{#if stemma.violations.length > 0}
					<span class="text-xs text-error">
						{stemma.violations.length} reading(s) with more than one recorded source
					</span>
				{/if}
			</div>

			<div
				class="flex-1 bg-base-200/30 rounded-box border border-base-300/40 relative overflow-auto"
			>
				{#if layout.nodes.length === 0}
					<div
						class="flex items-center justify-center h-full text-sm text-base-content/30"
					>
						Select a variation unit to view its stemma
					</div>
				{:else}
					<!-- Natural size: scaling to fit crushes reading text to a few pixels, so the
					     container scrolls instead. -->
					<svg
						width={layout.bounds.width}
						height={layout.bounds.height}
						viewBox="0 0 {layout.bounds.width} {layout.bounds.height}"
						class="block"
						role="img"
						aria-labelledby="stemma-diagram-title"
						aria-describedby="stemma-diagram-desc"
					>
						<title id="stemma-diagram-title"
							>Local stemma{selectedUnitLabel === null
								? ''
								: ` for unit ${selectedUnitLabel}`}</title
						>
						<desc id="stemma-diagram-desc">{diagramDescription}</desc>
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

						{#each layout.nodes as placed (placed.id)}
							{@const node = nodeById.get(placed.id)}
							{#if node}
								{@const state = stateOf(node)}
								<g transform="translate({placed.x}, {placed.y})">
									<rect
										width={placed.width}
										height={placed.height}
										rx="6"
										class="fill-base-100"
									/>
									<rect
										width={placed.width}
										height={placed.height}
										rx="6"
										fill="none"
										stroke="currentColor"
										stroke-width="1.5"
										stroke-dasharray={state === 'undecided' ? '4 3' : undefined}
										class={SOURCE_STATES[state].stroke}
									/>
									{#if node.isLemma}
										<!-- Lemma is a separate axis from the source decision, so it
										     is marked without touching the outline's colour. -->
										<rect
											x="3"
											y="3"
											width={placed.width - 6}
											height={placed.height - 6}
											rx="4"
											fill="none"
											stroke="currentColor"
											stroke-width="1"
											class="text-primary"
										/>
										<text
											x={placed.width - 5}
											y="12"
											text-anchor="end"
											font-size="8"
											font-family="monospace"
											fill="currentColor"
											class="text-primary"
										>
											lemma
										</text>
									{/if}
									<text
										x={placed.width / 2}
										y="16"
										text-anchor="middle"
										font-size="10"
										font-family="monospace"
										fill="currentColor"
										class="text-base-content/60"
									>
										{node.label}
										{state === 'undecided'
											? '· ?'
											: state === 'unclear'
												? '· unclear'
												: state === 'violation'
													? '· conflict'
													: '· derived'}
									</text>
									<text
										x={placed.width / 2}
										y="32"
										text-anchor="middle"
										font-size="12"
										font-family="var(--font-greek, serif)"
										fill="currentColor"
										class="text-base-content"
									>
										{node.isOmission ? 'om.' : truncate(node.text ?? '', 14)}
									</text>
									<text
										x={placed.width / 2}
										y="47"
										text-anchor="middle"
										font-size="9"
										font-family="monospace"
										fill="currentColor"
										class="text-base-content/50"
									>
										{truncate(node.witnessIds.join(', '), 20)}
									</text>
								</g>
							{/if}
						{/each}
					</svg>
				{/if}
			</div>

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
