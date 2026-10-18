<script lang="ts">
	import {
		citationOrder,
		NON_ATTESTATION_LABEL,
		type Segment,
	} from '$lib/collation/collation-apparatus';
	import { collationState } from '$lib/collation/collation-state.svelte';
	import type { ClassifiedReading } from '$lib/collation/collation-types';
	import { findReadingTypeDefinition } from '$lib/collation/reading-types';

	type Row = {
		id: string;
		label: string;
		text: string | null;
		depth: number;
		witnessIds: string[];
	};

	let { segments }: { segments: Segment[] } = $props();

	let hideWitnesses = $state(false);
	let highlightedWitnessId = $state<string | null>(null);
	let vocabulary = $derived(collationState.getReadingTypeVocabulary());
	let descriptions = $derived(
		new Map(
			collationState
				.getManualWitnessMembers()
				.map(witness => [witness.id, witness.description] as const)
		)
	);

	let items = $derived(
		segments.map(segment =>
			segment.kind === 'agreed'
				? {
						key: segment.columnIds.join('+'),
						label: segment.label,
						words: segment.text.split(/\s+/).filter(Boolean),
					}
				: {
						key: segment.span.unitId,
						label: segment.label,
						rows: rowsFor(segment.span.unitId),
					}
		)
	);

	function readingText(reading: ClassifiedReading): string {
		if (reading.isOmission) return 'om.';
		if (reading.isLacuna) return 'lac.';
		const text = reading.text?.trim();
		if (text) return text;
		if (reading.readingType === null) return '—';
		return `[${findReadingTypeDefinition(vocabulary, reading.readingType)?.label ?? reading.readingType}]`;
	}

	function rowsFor(unitId: string): Row[] {
		const view = collationState.peekUnitView(unitId);
		const depths = new Map<string, number>();
		const rows: Row[] = citationOrder(view.readings).map(reading => {
			const parentDepth = reading.parentReadingId
				? depths.get(reading.parentReadingId)
				: undefined;
			const depth = parentDepth === undefined ? 0 : parentDepth + 1;
			depths.set(reading.id, depth);
			return {
				id: reading.id,
				label: reading.label,
				text: readingText(reading),
				depth,
				witnessIds: [...reading.witnessIds, ...(reading.manualWitnessIds ?? [])],
			};
		});
		for (const attestation of view.ambiguousAttestations)
			rows.push({
				id: attestation.id,
				label: attestation.label,
				text: null,
				depth: 0,
				witnessIds: attestation.witnessIds,
			});
		const nonAttesting = collationState.getNonAttestationForUnit(unitId).witnessIds;
		if (nonAttesting.length > 0)
			rows.push({
				id: NON_ATTESTATION_LABEL,
				label: NON_ATTESTATION_LABEL,
				text: null,
				depth: 0,
				witnessIds: nonAttesting,
			});
		return rows;
	}

	function toggleHighlight(witnessId: string) {
		highlightedWitnessId = highlightedWitnessId === witnessId ? null : witnessId;
	}
</script>

<div class="space-y-3 rounded-xl border border-base-300/60 bg-base-100 p-4">
	<label class="flex w-fit cursor-pointer items-center gap-2 text-sm">
		<input type="checkbox" class="checkbox checkbox-sm" bind:checked={hideWitnesses} />
		Hide witnesses
	</label>
	<div class="flex flex-wrap items-start gap-x-2 gap-y-3 text-sm">
		{#each items as item (item.key)}
			{#if 'words' in item}
				{#each item.words as word, index (index)}
					<div class="flex flex-col py-2">
						<span class="h-4 font-mono text-[0.65rem] text-base-content/40"
							>{index === 0 ? item.label : ''}</span
						>
						<span class="select-text font-greek">{word}</span>
					</div>
				{/each}
			{:else}
				<div
					role="group"
					aria-label="Variation unit {item.label}"
					class="min-w-0 max-w-full rounded-lg border border-primary/50 p-2"
				>
					<h4 class="mb-1 text-center font-mono text-xs text-base-content/60">
						{item.label}
					</h4>
					<ul class="divide-y divide-primary/20">
						{#each item.rows as row (row.id)}
							<li
								class={[
									'rounded px-1 py-1',
									row.depth > 0 && 'border-l-2 border-base-300/70',
									highlightedWitnessId !== null &&
										row.witnessIds.includes(highlightedWitnessId) &&
										'bg-primary/15',
								]}
								style:margin-left={row.depth > 0 ? `${row.depth}rem` : undefined}
							>
								<div class="flex items-baseline gap-2">
									<span class="font-mono text-xs font-semibold text-primary"
										>{row.label}</span
									>
									{#if row.text}
										<span class="min-w-0 select-text font-greek wrap-break-word"
											>{row.text}</span
										>
									{/if}
								</div>
								{#if !hideWitnesses && row.witnessIds.length > 0}
									<div class="mt-0.5 flex flex-wrap gap-x-1 text-xs">
										{#each row.witnessIds as witnessId (witnessId)}
											<button
												type="button"
												class={[
													'rounded px-1 font-mono hover:bg-base-200',
													witnessId === highlightedWitnessId &&
														'outline-2 outline-primary',
												]}
												title={descriptions.get(witnessId)}
												aria-pressed={witnessId === highlightedWitnessId}
												onclick={() => toggleHighlight(witnessId)}
												>{collationState.getWitnessSiglum(
													witnessId
												)}</button
											>
										{/each}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		{/each}
	</div>
</div>
