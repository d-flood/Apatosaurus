<script lang="ts">
	import { collationState, type StemmaEdge } from '$lib/client/collation/collation-state.svelte';
	import type {
		ClassifiedReading,
		ReadingClassification,
	} from '$lib/client/collation/collation-types';
	import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
	import Lightning from 'phosphor-svelte/lib/Lightning';
	import { onDestroy, onMount } from 'svelte';

	let connectingFrom = $state<string | null>(null);
	let svgEl = $state<SVGSVGElement | null>(null);
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

	let readings = $derived(collationState.peekReadingsForUnit(collationState.selectedUnitIndex));
	let edges = $derived(
		collationState.stemmaEdges.get(String(collationState.selectedUnitIndex)) ?? []
	);

	const classifications: ReadingClassification[] = [
		'unclassified',
		'omit',
		'add',
		'substitute',
		'transpose',
		'orthographic',
	];

	const classColors: Record<ReadingClassification, string> = {
		unclassified: 'badge-ghost',
		omit: 'badge-error',
		add: 'badge-success',
		substitute: 'badge-warning',
		transpose: 'badge-info',
		orthographic: 'badge-neutral',
	};

	const classNodeColors: Record<ReadingClassification, string> = {
		unclassified: '#9ca3af',
		omit: '#ef4444',
		add: '#22c55e',
		substitute: '#f59e0b',
		transpose: '#3b82f6',
		orthographic: '#6b7280',
	};

	// Simple deterministic layout (Dagre-like)
	function layoutNodes(
		readings: ClassifiedReading[],
		_edges: StemmaEdge[]
	): Array<{ id: string; x: number; y: number; reading: ClassifiedReading }> {
		if (readings.length === 0) return [];
		const width = 600;
		const primary = readings.filter(reading => reading.parentReadingId === null);
		const subreadings = readings.filter(reading => reading.parentReadingId !== null);
		const nodes: Array<{
			id: string;
			x: number;
			y: number;
			reading: ClassifiedReading;
		}> = [];

		const primarySpacing = Math.max(120, width / (primary.length + 1));
		primary.forEach((reading, index) => {
			nodes.push({
				id: reading.id,
				x: primarySpacing * (index + 1),
				y: 48,
				reading,
			});
		});

		const primaryNodeById = new Map(nodes.map(node => [node.id, node]));
		const detached = subreadings.filter(
			reading => !reading.parentReadingId || !primaryNodeById.has(reading.parentReadingId)
		);
		const attached = subreadings.filter(
			reading => reading.parentReadingId && primaryNodeById.has(reading.parentReadingId)
		);

		for (const reading of attached) {
			const parent = primaryNodeById.get(reading.parentReadingId!);
			const siblings = attached.filter(
				candidate => candidate.parentReadingId === reading.parentReadingId
			);
			const siblingIndex = siblings.findIndex(candidate => candidate.id === reading.id);
			const offset = (siblingIndex - (siblings.length - 1) / 2) * 120;
			nodes.push({
				id: reading.id,
				x: (parent?.x ?? width / 2) + offset,
				y: 150,
				reading,
			});
		}

		if (detached.length > 0) {
			const detachedSpacing = Math.max(120, width / (detached.length + 1));
			detached.forEach((reading, index) => {
				nodes.push({
					id: reading.id,
					x: detachedSpacing * (index + 1),
					y: 150,
					reading,
				});
			});
		}

		return nodes;
	}

	let nodes = $derived(layoutNodes(readings, edges));

	function getNodePos(readingId: string): { x: number; y: number } | null {
		return nodes.find(n => n.id === readingId) ?? null;
	}

	function getParentOptions(readingId: string): ClassifiedReading[] {
		return readings.filter(
			reading => reading.parentReadingId === null && reading.id !== readingId
		);
	}

	function handleNodeClick(readingId: string) {
		if (connectingFrom === null) {
			connectingFrom = readingId;
		} else if (connectingFrom !== readingId) {
			// Prompt for edge type — use directed by default
			const edge: StemmaEdge = {
				id: crypto.randomUUID(),
				sourceReadingId: connectingFrom,
				targetReadingId: readingId,
				directed: true,
			};
			collationState.addStemmaEdge(collationState.selectedUnitIndex, edge);
			connectingFrom = null;
		} else {
			connectingFrom = null;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			collationState.moveFocus('left');
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			collationState.moveFocus('right');
		} else if (e.key === 'Escape') {
			connectingFrom = null;
		}
	}

	onMount(() => {
		document.addEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		document.removeEventListener('keydown', handleKeydown);
	});

	function getSpanLabel(startIndex: number): number {
		return unitSpans.findIndex(span => span.startIndex === startIndex) + 1;
	}
</script>

<div class="flex flex-col h-full">
	<!-- Top Half: Read-only mini alignment grid -->
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
				Reading Classification & Stemma
			</h2>
		</div>

		<div
			class="mb-3 inline-flex items-center gap-2 rounded-full border border-base-300/60 bg-base-200/60 px-3 py-1 text-xs text-base-content/60"
		>
			<span class="font-semibold uppercase tracking-[0.18em]">Stemma View</span>
			<span class="badge badge-ghost badge-sm">Original Readings</span>
			<span
				>Witnesses aligned together can now be detached and reattached as subreadings.</span
			>
		</div>

		<div class="overflow-x-auto rounded-box border border-base-300/50 bg-base-100">
			<div class="flex">
				{#each unitSpans as span (span.startIndex)}
					<button
						type="button"
						class="shrink-0 border-r border-base-300/40 px-3 py-2 text-center text-xs font-mono transition-all duration-100 min-w-22 {collationState.selectedUnitIndex ===
						span.startIndex
							? 'bg-primary text-primary-content'
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

	<!-- Bottom Half: Classification + Stemma -->
	<div class="flex-1 flex gap-4 min-h-0">
		<!-- Left: Reading Classification -->
		<div class="w-80 shrink-0 overflow-y-auto">
			<h3 class="text-sm font-bold uppercase tracking-wider text-base-content/50 mb-3">
				Readings &mdash; Unit {selectedSpan ? getSpanLabel(selectedSpan.startIndex) : 0}
			</h3>

			{#if readings.length === 0}
				<div class="text-sm text-base-content/40 text-center py-8">
					No distinct readings for this unit.
				</div>
			{:else}
				<div class="space-y-2">
					{#each readings as reading (reading.id)}
						<div
							class="bg-base-200/60 rounded-box p-3 border border-base-300/40 space-y-2"
						>
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0 flex-1">
									<div class="mb-1 flex items-center gap-2">
										<span class="badge badge-outline badge-sm font-mono"
											>{reading.label}</span
										>
										{#if reading.readingType}
											<span class="badge badge-info badge-sm"
												>{reading.readingType}</span
											>
										{/if}
										{#if reading.isSubreading}
											<span class="badge badge-ghost badge-sm"
												>subreading</span
											>
										{/if}
									</div>
									<div class="font-greek text-sm font-medium">
										{#if reading.isOmission}
											<span class="italic text-base-content/40"
												>[omission]</span
											>
										{:else if reading.isLacuna}
											<span class="italic text-base-content/50"
												>[gap / lacuna]</span
											>
										{:else}
											{reading.text}
										{/if}
									</div>
									{#if reading.normalizedText && reading.normalizedText !== reading.text}
										<div class="mt-1 text-[11px] text-base-content/45">
											aligned as <span class="font-mono"
												>{reading.normalizedText}</span
											>
										</div>
									{/if}
								</div>
								<span class="badge badge-xs {classColors[reading.classification]}">
									{reading.classification}
								</span>
							</div>
							<div class="flex flex-wrap gap-1.5">
								{#each reading.witnessGroups as group (group.id)}
									<div
										class="rounded-box border border-base-300/50 bg-base-100/80 px-2 py-1"
									>
										<div class="flex flex-wrap items-center gap-1">
											{#each group.witnessIds as witnessId}
												<span class="badge badge-ghost badge-sm font-mono"
													>{witnessId}</span
												>
												{#if reading.witnessIds.length > 1}
													<button
														type="button"
														class="btn btn-ghost btn-xs px-1"
														title={`Detach ${witnessId}`}
														onclick={() =>
															collationState.splitWitnessFromReading(
																collationState.selectedUnitIndex,
																reading.id,
																witnessId
															)}
													>
														split
													</button>
												{/if}
											{/each}
										</div>
									</div>
								{/each}
							</div>
							<select
								class="select select-bordered select-xs w-full"
								value={reading.classification}
								onchange={e =>
									collationState.classifyReading(
										collationState.selectedUnitIndex,
										reading.id,
										(e.target as HTMLSelectElement)
											.value as ReadingClassification
									)}
							>
								{#each classifications as cls}
									<option value={cls}>{cls}</option>
								{/each}
							</select>
							<label class="form-control">
								<div class="label py-0.5">
									<span class="label-text text-[11px]"
										>Attach as subreading of</span
									>
								</div>
								<select
									class="select select-bordered select-xs w-full"
									value={reading.parentReadingId ?? ''}
									onchange={e =>
										collationState.setReadingParent(
											collationState.selectedUnitIndex,
											reading.id,
											(e.currentTarget as HTMLSelectElement).value || null
										)}
								>
									<option value="">Independent reading</option>
									{#each getParentOptions(reading.id) as option}
										<option value={option.id}
											>{option.label} {option.text ?? 'om.'}</option
										>
									{/each}
								</select>
							</label>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Right: Stemma Graph Canvas -->
		<div class="flex-1 min-w-0 flex flex-col">
			<div class="flex items-center justify-between mb-2">
				<h3 class="text-sm font-bold uppercase tracking-wider text-base-content/50">
					Local Stemma
				</h3>
				<div class="flex items-center gap-2">
					{#if connectingFrom}
						<span class="text-xs text-info animate-pulse"> Click target node... </span>
					{/if}
					<button
						type="button"
						class="btn btn-ghost btn-xs gap-1"
						onclick={() =>
							collationState.suggestStemma(collationState.selectedUnitIndex)}
					>
						<Lightning size={14} weight="fill" />
						Suggest Stemma
					</button>
				</div>
			</div>

			<div
				class="flex-1 bg-base-200/30 rounded-box border border-base-300/40 relative overflow-hidden"
			>
				{#if nodes.length === 0}
					<div
						class="flex items-center justify-center h-full text-sm text-base-content/30"
					>
						Select a variation unit to view its stemma
					</div>
				{:else}
					<svg
						bind:this={svgEl}
						class="w-full h-full"
						viewBox="0 0 600 200"
						preserveAspectRatio="xMidYMid meet"
					>
						<defs>
							<marker
								id="arrowhead"
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

						<!-- Edges -->
						{#each edges as edge (edge.id)}
							{@const src = getNodePos(edge.sourceReadingId)}
							{@const tgt = getNodePos(edge.targetReadingId)}
							{#if src && tgt}
								<g class="group">
									<line
										x1={src.x}
										y1={src.y + 20}
										x2={tgt.x}
										y2={tgt.y - 20}
										stroke="currentColor"
										class="text-base-content/30"
										stroke-width="2"
										marker-end={edge.directed ? 'url(#arrowhead)' : undefined}
									/>
									<!-- Delete edge hitbox -->
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<line
										x1={src.x}
										y1={src.y + 20}
										x2={tgt.x}
										y2={tgt.y - 20}
										stroke="transparent"
										stroke-width="12"
										class="cursor-pointer"
										onclick={() =>
											collationState.removeStemmaEdge(
												collationState.selectedUnitIndex,
												edge.id
											)}
									/>
									{#if !edge.directed}
										<circle
											cx={(src.x + tgt.x) / 2}
											cy={(src.y + tgt.y) / 2 + 4}
											r="3"
											fill="currentColor"
											class="text-base-content/20"
										/>
									{/if}
								</g>
							{/if}
						{/each}

						<!-- Nodes -->
						{#each nodes as node (node.id)}
							{@const color = classNodeColors[node.reading.classification]}
							{@const isConnecting = connectingFrom === node.id}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<g
								class="cursor-pointer"
								onclick={() => handleNodeClick(node.id)}
								transform="translate({node.x}, {node.y})"
							>
								<rect
									x="-58"
									y="-22"
									width="116"
									height="48"
									rx="6"
									fill={color}
									fill-opacity="0.15"
									stroke={color}
									stroke-width={isConnecting ? 3 : 1.5}
									stroke-opacity={isConnecting ? 1 : 0.5}
								/>
								<text
									text-anchor="middle"
									dominant-baseline="middle"
									y="-6"
									font-size="9"
									font-family="monospace"
									fill="currentColor"
									class="text-base-content/60"
								>
									{node.reading.label}{node.reading.readingType
										? ` · ${node.reading.readingType}`
										: ''}
								</text>
								<text
									text-anchor="middle"
									dominant-baseline="middle"
									y="8"
									font-size="11"
									font-family="var(--font-greek, serif)"
									fill="currentColor"
									class="text-base-content"
								>
									{#if node.reading.isOmission}
										om.
									{:else if node.reading.isLacuna}
										gap
									{:else}
										{(node.reading.text ?? '').slice(0, 12)}{(
											node.reading.text ?? ''
										).length > 12
											? '...'
											: ''}
									{/if}
								</text>
								<text
									text-anchor="middle"
									dominant-baseline="middle"
									y="34"
									font-size="8"
									font-family="monospace"
									fill="currentColor"
									class="text-base-content/50"
								>
									{node.reading.witnessIds.join(', ')}
								</text>
							</g>
						{/each}
					</svg>
				{/if}
			</div>

			<div class="mt-2 flex items-center gap-3 text-xs text-base-content/40">
				<span>Click node to start connecting</span>
				<span class="text-base-content/20">|</span>
				<span>Click edge to remove</span>
				<span class="text-base-content/20">|</span>
				<span>Arrow keys to navigate units</span>
			</div>
		</div>
	</div>
</div>
