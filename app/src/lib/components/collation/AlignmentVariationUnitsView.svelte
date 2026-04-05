<script lang="ts">
	import type { AlignmentColumn } from '$lib/client/collation/alignment-snapshot';
	import type { AlignmentDisplayMode } from '$lib/client/collation/collation-types';
	import {
		buildCollapsedReadingGroups,
		type CollapsedReadingDisplay,
		type CollapsedReadingGroupDisplay,
		isVariationColumn,
		readingText,
	} from '$lib/client/collation/collation-variation-units';
	import ArrowsOutSimpleIcon from 'phosphor-svelte/lib/ArrowsOutSimpleIcon';
	import { SvelteSet } from 'svelte/reactivity';

	interface WitnessRowGroup {
		id: string;
		representativeId: string;
		representativeRowIndex: number;
		witnessIds: string[];
	}

	interface Props {
		alignmentColumns: AlignmentColumn[];
		baseIndexLabels: string[];
		groupedRows: WitnessRowGroup[];
		alignmentDisplayMode: AlignmentDisplayMode;
		selectedColumnIds: Set<string>;
		getWitnessSiglum: (witnessId: string) => string;
		getWitnessHref: (witnessId: string) => string | null;
		getBaseWitnessId: () => string | null;
		onHeaderClick: (columnId: string, event: MouseEvent) => void;
		onColumnRangeSelect?: (columnIds: string[]) => void;
		onSplitColumn?: (columnId: string) => void;
	}

	type DisplayUnit = {
		id: string;
		index: number;
		label: string;
		heading: string;
		isVariation: boolean;
		isMerged: boolean;
		readingGroups: CollapsedReadingGroupDisplay[];
	};

	type DecoratedReading = CollapsedReadingDisplay & { tooltip: string };

	const INLINE_SIGLA_THRESHOLD = 5;

	let {
		alignmentColumns,
		baseIndexLabels,
		groupedRows,
		alignmentDisplayMode,
		selectedColumnIds,
		getWitnessSiglum,
		getWitnessHref,
		getBaseWitnessId,
		onHeaderClick,
		onColumnRangeSelect,
		onSplitColumn,
	}: Props = $props();

	let expandedReadings = new SvelteSet<string>();
	let layout = $state<'wrap' | 'scroll' | 'vertical'>('wrap');
	let dragAnchorIndex = $state<number | null>(null);
	let dragCurrentIndex = $state<number | null>(null);
	let isDragging = $state(false);
	let focusedUnitIndex = $state<number | null>(null);
	let shiftAnchorIndex = $state<number | null>(null);

	let dragRange = $derived.by(() => {
		if (dragAnchorIndex === null || dragCurrentIndex === null) return null;
		const start = Math.min(dragAnchorIndex, dragCurrentIndex);
		const end = Math.max(dragAnchorIndex, dragCurrentIndex);
		return { start, end };
	});

	function isInDragRange(index: number): boolean {
		if (!dragRange) return false;
		return index >= dragRange.start && index <= dragRange.end;
	}

	function isInKeyboardRange(index: number): boolean {
		if (focusedUnitIndex === null || shiftAnchorIndex === null) return false;
		const start = Math.min(focusedUnitIndex, shiftAnchorIndex);
		const end = Math.max(focusedUnitIndex, shiftAnchorIndex);
		return index >= start && index <= end;
	}

	function toggleReadingExpand(readingId: string) {
		if (expandedReadings.has(readingId)) {
			expandedReadings.delete(readingId);
		} else {
			expandedReadings.add(readingId);
		}
	}

	function handlePointerDown(index: number, e: PointerEvent) {
		if (e.button !== 0) return;
		dragAnchorIndex = index;
		dragCurrentIndex = index;
		isDragging = true;
	}

	function handleWrapperPointerMove(e: PointerEvent) {
		if (!isDragging) return;
		const target = (e.target as HTMLElement).closest<HTMLElement>('[data-unit-idx]');
		if (target) {
			const idx = Number(target.dataset.unitIdx);
			if (!Number.isNaN(idx)) dragCurrentIndex = idx;
		}
	}

	function handlePointerUp() {
		if (!isDragging) return;
		isDragging = false;

		if (dragRange && dragRange.start !== dragRange.end && onColumnRangeSelect) {
			const columnIds = displayUnits.slice(dragRange.start, dragRange.end + 1).map(u => u.id);
			onColumnRangeSelect(columnIds);
		} else if (dragRange && dragRange.start === dragRange.end) {
			const unit = displayUnits[dragRange.start];
			if (unit) {
				onHeaderClick(unit.id, new MouseEvent('click'));
			}
		}

		dragAnchorIndex = null;
		dragCurrentIndex = null;
	}

	function focusUnitElement(idx: number) {
		const el = document.querySelector<HTMLElement>(`[data-unit-idx="${idx}"]`);
		el?.focus();
	}

	function handleUnitKeydown(e: KeyboardEvent, index: number) {
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			e.stopPropagation();
			const next = Math.min(index + 1, displayUnits.length - 1);
			focusedUnitIndex = next;
			focusUnitElement(next);
			if (e.shiftKey) {
				if (shiftAnchorIndex === null) shiftAnchorIndex = index;
			} else {
				shiftAnchorIndex = null;
			}
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			e.stopPropagation();
			const prev = Math.max(index - 1, 0);
			focusedUnitIndex = prev;
			focusUnitElement(prev);
			if (e.shiftKey) {
				if (shiftAnchorIndex === null) shiftAnchorIndex = index;
			} else {
				shiftAnchorIndex = null;
			}
		} else if (e.key === 'Enter' && shiftAnchorIndex !== null && onColumnRangeSelect) {
			e.preventDefault();
			e.stopPropagation();
			const start = Math.min(focusedUnitIndex!, shiftAnchorIndex);
			const end = Math.max(focusedUnitIndex!, shiftAnchorIndex);
			const columnIds = displayUnits.slice(start, end + 1).map(u => u.id);
			onColumnRangeSelect(columnIds);
			shiftAnchorIndex = null;
		} else if (e.key === 'Escape') {
			e.stopPropagation();
			shiftAnchorIndex = null;
			focusedUnitIndex = null;
		}
	}

	function buildTooltip(witnessIds: string[]): string {
		return witnessIds.map(witnessId => getWitnessSiglum(witnessId)).join(', ');
	}

	function decorateReading(reading: CollapsedReadingDisplay): DecoratedReading {
		return {
			...reading,
			tooltip: buildTooltip(reading.witnessIds),
		};
	}

	function buildReadingGroups(column: AlignmentColumn): Array<
		CollapsedReadingGroupDisplay & {
			parent: DecoratedReading;
			children: DecoratedReading[];
		}
	> {
		const baseWitnessId = getBaseWitnessId();
		return buildCollapsedReadingGroups({
			column,
			groupedRows,
			alignmentDisplayMode,
			baseWitnessId,
		}).map(group => ({
			...group,
			parent: decorateReading(group.parent),
			children: group.children.map(reading => decorateReading(reading)),
		}));
	}

	let displayUnits = $derived.by(() =>
		alignmentColumns.map((column, index) => {
			const readingGroups = buildReadingGroups(column);
			const allReadings = readingGroups.flatMap(group => [group.parent, ...group.children]);
			const baseReading = allReadings.find(reading => reading.isBase) ?? allReadings[0];
			return {
				id: column.id,
				index,
				label: baseIndexLabels[index] ?? String(index + 1),
				heading: baseReading ? readingText(baseReading) : '—',
				isVariation: isVariationColumn(column),
				isMerged: column.merged,
				readingGroups,
			} satisfies DisplayUnit;
		})
	);
</script>

{#snippet readingRow(reading: DecoratedReading, child: boolean = false)}
	{@const isExpanded = expandedReadings.has(reading.id)}
	{@const witnessCount = reading.witnessIds.length}
	{@const showInline = witnessCount <= INLINE_SIGLA_THRESHOLD}
	<div
		class={[
			'flex flex-wrap items-baseline gap-x-1 text-[0.82rem] leading-snug py-px',
			reading.isBase && !child && 'pb-1 mb-0.5 border-b border-base-content/15',
			child && 'text-[0.78rem]',
			alignmentDisplayMode === 'original' && reading.hasRegularization && 'opacity-60',
		]}
	>
		<span
			class={[
				'font-sans font-semibold text-xs shrink-0',
				child ? 'text-base-content/45' : 'text-base-content/55',
			]}>{reading.label}</span
		>
		<span
			class="font-greek text-[0.88rem] font-normal text-base-content wrap-break-word show-unclear"
		>
			{#each reading.segments as segment, segIdx (`${reading.id}-${segIdx}`)}
				<span class:unclear={segment.hasUnclear}>{segment.text}</span>
			{/each}
		</span>
		<span class="font-sans font-light text-base-content/30 shrink-0">]</span>
		{#if showInline}
			<span
				class="tooltip tooltip-bottom font-sans text-[0.72rem] font-medium text-base-content/55 tracking-tight"
				data-tip={reading.tooltip}
			>
				{#each reading.witnessIds as id, idx (id)}
					{@const witnessHref = getWitnessHref(id)}
					{#if witnessHref}
						<a
							href={witnessHref}
							target="_blank"
							rel="noopener noreferrer"
							class="transition-colors duration-75 hover:text-primary"
							onclick={e => e.stopPropagation()}
							onpointerdown={e => e.stopPropagation()}
						>
							{getWitnessSiglum(id)}
						</a>
					{:else}
						<span>{getWitnessSiglum(id)}</span>
					{/if}
					{#if idx < reading.witnessIds.length - 1}
						<span aria-hidden="true"> </span>
					{/if}
				{/each}
			</span>
		{:else}
			<span class="tooltip tooltip-bottom" data-tip={reading.tooltip}>
				<button
					type="button"
					class={[
						'font-sans text-[0.65rem] font-semibold tracking-wide text-base-content/50 bg-base-300/50 border-none rounded-full px-1.5 py-px cursor-pointer transition-[opacity,background-color] duration-75',
						isExpanded
							? 'opacity-80 bg-base-300/80'
							: 'hover:opacity-80 hover:bg-base-300/80',
					]}
					onclick={e => {
						e.stopPropagation();
						toggleReadingExpand(reading.id);
					}}
				>
					{witnessCount} wits.
				</button>
			</span>
		{/if}
	</div>
	{#if !showInline && isExpanded}
		<div
			class="font-sans text-[0.68rem] font-normal text-base-content/50 leading-relaxed pl-4.5 wrap-break-word max-w-56"
		>
			{#each reading.witnessIds as id, idx (id)}
				{@const witnessHref = getWitnessHref(id)}
				{#if witnessHref}
					<a
						href={witnessHref}
						target="_blank"
						rel="noopener noreferrer"
						class="transition-colors duration-75 hover:text-primary"
						onclick={e => e.stopPropagation()}
						onpointerdown={e => e.stopPropagation()}
					>
						{getWitnessSiglum(id)}
					</a>
				{:else}
					<span>{getWitnessSiglum(id)}</span>
				{/if}
				{#if idx < reading.witnessIds.length - 1}
					<span aria-hidden="true"> </span>
				{/if}
			{/each}
		</div>
	{/if}
{/snippet}

{#if alignmentColumns.length === 0}
	<div class="flex items-center justify-center h-full text-base-content/40">
		Run collation to review collapsed readings.
	</div>
{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="overflow-auto h-full p-4 px-3"
		onpointermove={handleWrapperPointerMove}
		onpointerup={handlePointerUp}
	>
		<div class="join mb-3">
			<input
				class="join-item btn btn-xs"
				type="radio"
				name="vu-layout"
				aria-label="Wrap"
				checked={layout === 'wrap'}
				onchange={() => (layout = 'wrap')}
			/>
			<input
				class="join-item btn btn-xs"
				type="radio"
				name="vu-layout"
				aria-label="Scroll"
				checked={layout === 'scroll'}
				onchange={() => (layout = 'scroll')}
			/>
			<input
				class="join-item btn btn-xs"
				type="radio"
				name="vu-layout"
				aria-label="Vertical"
				checked={layout === 'vertical'}
				onchange={() => (layout = 'vertical')}
			/>
		</div>
		<div
			class={[
				'flex items-start leading-relaxed',
				layout === 'wrap' && 'flex-wrap gap-y-3',
				layout === 'scroll' && 'flex-nowrap gap-x-1',
				layout === 'vertical' && 'flex-col gap-y-1',
			]}
			role="listbox"
			aria-label="Alignment units"
			aria-orientation={layout === 'vertical' ? 'vertical' : 'horizontal'}
		>
			{#each displayUnits as unit, unitIdx (unit.id)}
				{@const isSelected = selectedColumnIds.has(unit.id)}
				{@const inDrag = isInDragRange(unitIdx)}
				{@const inKbRange = isInKeyboardRange(unitIdx)}
				{@const isFocused = focusedUnitIndex === unitIdx}
				<div
					class={[
						'py-0.5 px-1.5 rounded outline-none cursor-default select-none transition-colors duration-75 min-w-fit shrink-0',
						(isSelected || inDrag || inKbRange) && 'bg-primary/10',
						isFocused && 'ring-1.5 ring-inset ring-primary',
						unit.isMerged && 'bg-info/8',
						!isSelected &&
							!inDrag &&
							!inKbRange &&
							!unit.isMerged &&
							'hover:bg-base-200/60',
					]}
					role="option"
					aria-selected={isSelected || inDrag || inKbRange}
					tabindex={unitIdx === (focusedUnitIndex ?? 0) ? 0 : -1}
					data-unit-idx={unitIdx}
					onpointerdown={e => handlePointerDown(unitIdx, e)}
					onkeydown={e => handleUnitKeydown(e, unitIdx)}
				>
					<span class="whitespace-nowrap">
						<span
							class={[
								'font-greek text-base-content',
								unit.isVariation ? 'font-semibold' : 'font-normal',
								'text-[1.05rem] leading-snug show-unclear',
							]}>{unit.heading}</span
						>
						<sup
							class="font-sans text-[0.6rem] font-semibold text-base-content/40 ml-px align-super leading-none"
							>{unit.label}{#if unit.isMerged}<span
									class="text-[0.55rem] text-info ml-px">m</span
								>{/if}</sup
						>
						{#if unit.isMerged && onSplitColumn}
							<button
								type="button"
								class="inline-flex items-center ml-1 align-middle text-info hover:text-info/80 cursor-pointer transition-colors duration-75"
								title="Unmerge unit"
								onclick={e => {
									e.stopPropagation();
									onSplitColumn(unit.id);
								}}
							>
								<ArrowsOutSimpleIcon size={14} />
							</button>
						{/if}
					</span>

					{#if unit.isVariation}
						<div
							class=" rounded-bl-box pl-1.5 pb-0.5 mt-0.5 border-l-2 border-b-2 border-warning/45"
						>
							{#each unit.readingGroups as group, groupIdx (group.id)}
								<div class={groupIdx > 0 ? 'mt-0.5' : ''}>
									{@render readingRow(group.parent)}
									{#if group.children.length > 0}
										<div
											class="ml-3 pl-2 border-l border-base-content/15 space-y-0.5"
										>
											{#each group.children as child (child.id)}
												{@render readingRow(child, true)}
											{/each}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.unclear {
		text-decoration: underline dotted;
		text-underline-offset: 0.18em;
	}
</style>
