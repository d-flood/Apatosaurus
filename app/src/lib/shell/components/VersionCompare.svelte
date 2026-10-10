<script lang="ts">
	import type { CompareChoices, ComparePart } from '$lib/shell/version-compare';

	let {
		parts,
		leftLabel,
		rightLabel,
		format,
		mode = 'view',
		onChoose,
	}: {
		parts: ComparePart[];
		leftLabel: string;
		rightLabel: string;
		format: (value: unknown) => string;
		mode?: 'view' | 'choose';
		onChoose?: (choices: CompareChoices) => void;
	} = $props();

	let overrides = $state<CompareChoices>({});
	const choices = $derived(
		Object.fromEntries(
			parts.map(part => [part.key, overrides[part.key] ?? 'left'])
		) as CompareChoices
	);
	const changedCount = $derived(parts.filter(part => part.differs).length);
</script>

<div class="space-y-2" data-testid="version-compare">
	<p class="text-sm text-base-content/60" data-testid="version-compare-summary">
		{changedCount ? `${changedCount} of ${parts.length} parts differ` : 'No differences'}
	</p>
	<div
		class="sticky top-0 z-10 hidden grid-cols-2 gap-2 sm:grid bg-base-100 py-1 text-xs font-semibold uppercase tracking-wide text-base-content/70"
	>
		<span>{leftLabel}</span>
		<span>{rightLabel}</span>
	</div>
	{#each parts as part (part.key)}
		<details
			open={part.differs}
			class={[
				'rounded-box border',
				part.differs ? 'border-warning bg-warning/10' : 'border-base-300',
			]}
			data-testid="compare-part"
			data-differs={part.differs}
		>
			<summary class="cursor-pointer px-3 py-2 text-sm font-semibold">
				{part.label}
				{#if !part.differs}
					<span class="font-normal text-base-content/50">· unchanged</span>
				{/if}
			</summary>
			<div class="grid grid-cols-1 gap-2 px-3 pb-3 sm:grid-cols-2">
				{#each ['left', 'right'] as const as side (side)}
					{@const value = side === 'left' ? part.left : part.right}
					<div class="min-w-0 rounded-box bg-base-100 p-2">
						<p class="mb-1 text-xs text-base-content/60 sm:hidden">
							{side === 'left' ? leftLabel : rightLabel}
						</p>
						{#if value === null}
							<p class="text-sm italic text-base-content/50">Not present</p>
						{:else}
							<pre class="whitespace-pre-wrap break-words font-serif text-sm">{format(
									value
								)}</pre>
						{/if}
						{#if mode === 'choose'}
							<label class="mt-2 flex items-center gap-2 text-sm">
								<input
									type="radio"
									class="radio radio-sm"
									name="choice-{part.key}"
									checked={choices[part.key] === side}
									onchange={() => (overrides[part.key] = side)}
								/>
								Keep {side === 'left' ? leftLabel : rightLabel}
							</label>
						{/if}
					</div>
				{/each}
			</div>
		</details>
	{/each}
	{#if mode === 'choose'}
		<div class="flex justify-end">
			<button
				type="button"
				class="btn btn-primary btn-sm"
				onclick={() => onChoose?.(choices)}
			>
				Use these choices
			</button>
		</div>
	{/if}
</div>
