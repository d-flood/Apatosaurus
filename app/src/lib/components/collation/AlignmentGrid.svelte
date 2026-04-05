<script lang="ts">
	import { goto } from '$app/navigation';
	import { computeWordDiff, type DiffSegment } from '$lib/client/collation/alignment-diff';
	import type { AlignmentCell } from '$lib/client/collation/alignment-snapshot';
	import { runCollationInWorker } from '$lib/client/collation/collation-service';
	import { collationState } from '$lib/client/collation/collation-state.svelte';
	import type {
		RegularizationRule,
		RegularizationType,
		RuleScope,
		SuppliedTextMode,
	} from '$lib/client/collation/collation-types';
	import AlignmentVariationUnitsView from '$lib/components/collation/AlignmentVariationUnitsView.svelte';
	import ArrowClockwise from 'phosphor-svelte/lib/ArrowClockwise';
	import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
	import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
	import ArrowsInSimple from 'phosphor-svelte/lib/ArrowsInSimple';
	import ArrowsOutSimple from 'phosphor-svelte/lib/ArrowsOutSimple';
	import ArrowUUpLeft from 'phosphor-svelte/lib/ArrowUUpLeft';
	import ArrowUUpRight from 'phosphor-svelte/lib/ArrowUUpRight';
	import Info from 'phosphor-svelte/lib/Info';
	import Lightning from 'phosphor-svelte/lib/Lightning';
	import Plus from 'phosphor-svelte/lib/Plus';
	import ToggleLeft from 'phosphor-svelte/lib/ToggleLeft';
	import ToggleRight from 'phosphor-svelte/lib/ToggleRight';
	import Trash from 'phosphor-svelte/lib/Trash';
	import { onDestroy, onMount } from 'svelte';

	interface WitnessRowGroup {
		id: string;
		representativeId: string;
		representativeRowIndex: number;
		witnessIds: string[];
	}

	let gridEl = $state<HTMLElement | null>(null);
	let contextMenu = $state<{ x: number; y: number; columnId: string; witnessId?: string } | null>(
		null
	);
	let newPattern = $state('');
	let newReplacement = $state('');
	let newScope = $state<RuleScope>('verse');
	let newDescription = $state('');
	let newType = $state<RegularizationType>('none');
	let isCollating = $state(false);
	let isRefreshing = $state(false);
	let collationError = $state<string | null>(null);
	let showRulesSidebar = $state(false);
	let showDiffs = $state(false);
	let expandedWitnessRows = $state<Record<string, boolean>>({});
	let collapsibleWitnessRows = $state<
		Record<string, { hiddenCount: number; collapsedHeight: number }>
	>({});

	let selectedCount = $derived(collationState.selectedColumnIds.size);
	let selectedCellCount = $derived(collationState.selectedCells.size);
	let canMergeColumns = $derived(selectedCount >= 2);
	let canMergeCells = $derived(collationState.canMergeSelectedCells());
	let activeWitnesses = $derived(collationState.witnesses.filter(w => !w.isExcluded));
	let alignmentLayout = $derived(collationState.alignmentLayout);

	function getWitnessSiglum(witnessId: string): string {
		return collationState.witnesses.find(w => w.witnessId === witnessId)?.siglum ?? witnessId;
	}

	function getWitnessTranscriptionId(witnessId: string): string | null {
		return collationState.witnesses.find(w => w.witnessId === witnessId)?.transcriptionId ?? null;
	}

	function buildWitnessHref(witnessId: string): string | null {
		const transcriptionId = getWitnessTranscriptionId(witnessId);
		const verse = collationState.selectedVerse;
		if (!transcriptionId || !verse?.book || !verse.chapter || !verse.verse) return null;

		const params = new URLSearchParams({
			book: verse.book,
			chapter: verse.chapter,
			verse: verse.verse,
		});
		return `/transcription/${encodeURIComponent(transcriptionId)}?${params.toString()}`;
	}

	function buildAlignmentSignature(witnessId: string): string {
		return collationState.alignmentColumns
			.map(col => {
				const cell = col.cells.get(witnessId);
				if (!cell) return '__missing__';
				return `${cell.regularizedText ?? ''}\u0001${cell.isOmission ? 1 : 0}\u0001${cell.isLacuna ? 1 : 0}`;
			})
			.join('\u0002');
	}

	function buildGroupedRows(): WitnessRowGroup[] {
		const sourceIds = collationState.getOrderedActiveWitnessIds();
		const baseId = collationState.getBaseWitnessId();

		const groups = new Map<string, WitnessRowGroup>();
		const ordered: WitnessRowGroup[] = [];

		for (const witnessId of sourceIds) {
			if (baseId && witnessId === baseId) {
				const representativeRowIndex = sourceIds.indexOf(witnessId);
				ordered.push({
					id: `__base__${witnessId}`,
					representativeId: witnessId,
					representativeRowIndex:
						representativeRowIndex === -1 ? ordered.length : representativeRowIndex,
					witnessIds: [witnessId],
				});
				continue;
			}

			const signature =
				collationState.alignmentColumns.length > 0
					? buildAlignmentSignature(witnessId)
					: `__${witnessId}`;

			const existing = groups.get(signature);
			if (existing) {
				existing.witnessIds.push(witnessId);
				continue;
			}

			const representativeRowIndex = sourceIds.indexOf(witnessId);
			const group: WitnessRowGroup = {
				id: signature,
				representativeId: witnessId,
				representativeRowIndex:
					representativeRowIndex === -1 ? ordered.length : representativeRowIndex,
				witnessIds: [witnessId],
			};

			groups.set(signature, group);
			ordered.push(group);
		}

		return ordered;
	}

	let groupedRows = $derived(buildGroupedRows());
	let collapsedCount = $derived(Math.max(0, activeWitnesses.length - groupedRows.length));

	$effect(() => {
		const activeRowIds = new Set(groupedRows.map(row => row.id));
		const nextExpanded = Object.fromEntries(
			Object.entries(expandedWitnessRows).filter(([rowId]) => activeRowIds.has(rowId))
		);
		if (Object.keys(nextExpanded).length !== Object.keys(expandedWitnessRows).length) {
			expandedWitnessRows = nextExpanded;
		}

		const nextCollapsible = Object.fromEntries(
			Object.entries(collapsibleWitnessRows).filter(([rowId]) => activeRowIds.has(rowId))
		);
		if (Object.keys(nextCollapsible).length !== Object.keys(collapsibleWitnessRows).length) {
			collapsibleWitnessRows = nextCollapsible;
		}
	});

	function addRule() {
		if (!newPattern.trim()) return;
		const rule: RegularizationRule = {
			id: crypto.randomUUID(),
			pattern: newPattern,
			replacement: newReplacement,
			scope: newScope,
			description: newDescription || `${newPattern} -> ${newReplacement}`,
			enabled: true,
			type: newType,
		};
		collationState.addRule(rule);
		collationState.applyRegularization();
		newPattern = '';
		newReplacement = '';
		newDescription = '';
		newType = 'none';
	}

	async function runCollation() {
		if (collationState.alignmentColumns.length > 0) {
			const shouldContinue = window.confirm(
				'This collation already has alignment data. Running collation again may undo manual alignments. Continue?'
			);
			if (!shouldContinue) return;
		}

		isCollating = true;
		collationError = null;
		try {
			const witnesses = collationState.buildCollationWitnessInputs();
			const result = await runCollationInWorker({
				witnesses,
				options: { segmentation: collationState.segmentation },
			});
			collationState.setAlignmentSnapshot(result.snapshot);
			collationState.setPhase('alignment');
			if (collationState.collationId) {
				await goto(`/collation/${collationState.collationId}/alignment`, {
					replaceState: true,
				});
			}
		} catch (err) {
			collationError = err instanceof Error ? err.message : 'Collation failed';
		} finally {
			isCollating = false;
		}
	}

	async function goToReadings() {
		if (!collationState.collationId || collationState.alignmentColumns.length === 0) return;
		collationState.setPhase('alignment');
		collationState.nextPhase();
		await goto(`/collation/${collationState.collationId}/readings`, { replaceState: true });
	}

	async function refreshWitnesses() {
		isRefreshing = true;
		collationError = null;
		try {
			await collationState.refreshWitnessesFromSource();
		} catch (err) {
			collationError = err instanceof Error ? err.message : 'Witness refresh failed';
		} finally {
			isRefreshing = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.ctrlKey && e.key === 'z') {
			e.preventDefault();
			collationState.undo();
		} else if (e.ctrlKey && e.key === 'y') {
			e.preventDefault();
			collationState.redo();
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			collationState.moveFocus('left');
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			collationState.moveFocus('right');
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			collationState.moveFocus('up');
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			collationState.moveFocus('down');
		} else if (e.key === 'Escape') {
			collationState.clearColumnSelection();
			collationState.clearCellSelection();
			contextMenu = null;
		}
	}

	function handleHeaderClick(columnId: string, e: MouseEvent) {
		collationState.clearCellSelection();
		if (e.shiftKey) {
			collationState.toggleColumnSelection(columnId);
		} else {
			collationState.clearColumnSelection();
			collationState.toggleColumnSelection(columnId);
		}
	}

	function handleContextMenu(columnId: string, e: MouseEvent, witnessId?: string) {
		e.preventDefault();
		contextMenu = { x: e.clientX, y: e.clientY, columnId, witnessId };
	}

	function closeContextMenu() {
		contextMenu = null;
	}

	function toggleWitnessRowExpansion(rowId: string) {
		expandedWitnessRows = {
			...expandedWitnessRows,
			[rowId]: !expandedWitnessRows[rowId],
		};
	}

	function setCollapsibleWitnessRow(
		rowId: string,
		value: { hiddenCount: number; collapsedHeight: number } | null
	) {
		if (value && value.hiddenCount > 0) {
			collapsibleWitnessRows = {
				...collapsibleWitnessRows,
				[rowId]: value,
			};
			return;
		}

		if (!(rowId in collapsibleWitnessRows) && !(rowId in expandedWitnessRows)) return;

		const nextCollapsible = { ...collapsibleWitnessRows };
		delete nextCollapsible[rowId];
		collapsibleWitnessRows = nextCollapsible;

		if (rowId in expandedWitnessRows) {
			const nextExpanded = { ...expandedWitnessRows };
			delete nextExpanded[rowId];
			expandedWitnessRows = nextExpanded;
		}
	}

	function witnessChipList(node: HTMLDivElement, rowId: string) {
		let currentRowId = rowId;

		const measure = () => {
			const witnessBadges = [
				...node.querySelectorAll<HTMLElement>('[data-witness-chip="true"]'),
			];
			if (witnessBadges.length === 0) {
				setCollapsibleWitnessRow(currentRowId, null);
				return;
			}

			const lineTops = [...new Set(witnessBadges.map(badge => badge.offsetTop))].sort(
				(a, b) => a - b
			);
			if (lineTops.length <= 2) {
				setCollapsibleWitnessRow(currentRowId, null);
				return;
			}

			const thirdLineTop = lineTops[2];
			const visibleBadges = witnessBadges.filter(badge => badge.offsetTop < thirdLineTop);
			const collapsedHeight = visibleBadges.reduce(
				(maxBottom, badge) => Math.max(maxBottom, badge.offsetTop + badge.offsetHeight),
				0
			);

			setCollapsibleWitnessRow(currentRowId, {
				hiddenCount: witnessBadges.length - visibleBadges.length,
				collapsedHeight,
			});
		};

		const scheduleMeasure = () => {
			requestAnimationFrame(measure);
		};

		const resizeObserver =
			typeof ResizeObserver !== 'undefined'
				? new ResizeObserver(() => {
						scheduleMeasure();
					})
				: null;

		resizeObserver?.observe(node);
		scheduleMeasure();

		return {
			update(nextRowId: string) {
				currentRowId = nextRowId;
				scheduleMeasure();
			},
			destroy() {
				resizeObserver?.disconnect();
				setCollapsibleWitnessRow(currentRowId, null);
			},
		};
	}

	function handleMerge() {
		if (canMergeCells) {
			collationState.mergeSelectedCells();
			return;
		}
		if (canMergeColumns) {
			collationState.mergeColumns([...collationState.selectedColumnIds]);
		}
	}

	function handleCellClick(
		columnId: string,
		witnessId: string,
		colIdx: number,
		rowIdx: number,
		e: MouseEvent
	) {
		collationState.clearColumnSelection();
		if (
			e.shiftKey &&
			collationState.focusedRow === rowIdx &&
			collationState.focusedColumn >= 0
		) {
			const anchorColumn = collationState.alignmentColumns[collationState.focusedColumn];
			if (anchorColumn) {
				collationState.clearCellSelection();
				collationState.selectCellRange(witnessId, anchorColumn.id, columnId);
			}
		} else if (e.metaKey || e.ctrlKey) {
			collationState.toggleCellSelection(columnId, witnessId);
		} else {
			collationState.clearCellSelection();
			collationState.toggleCellSelection(columnId, witnessId);
		}
		collationState.focusedColumn = colIdx;
		collationState.focusedRow = rowIdx;
	}

	function getCellVisibleText(cell: AlignmentCell): string | null {
		if (cell.kind === 'gap') {
			return collationState.alignmentDisplayMode === 'regularized' ? '[gap]' : cell.text;
		}
		if (cell.kind === 'untranscribed') {
			return collationState.alignmentDisplayMode === 'regularized'
				? '[untranscribed]'
				: cell.text;
		}
		return collationState.alignmentDisplayMode === 'regularized'
			? cell.regularizedText
			: cell.text;
	}

	function getCellDisplayText(cell: AlignmentCell): string {
		return (getCellVisibleText(cell) ?? '').replaceAll(' ', '\u00a0');
	}

	function getCellDisplaySegments(
		cell: AlignmentCell
	): Array<{ text: string; hasUnclear: boolean }> {
		if (
			collationState.alignmentDisplayMode !== 'original' ||
			!Array.isArray(cell.originalSegments) ||
			cell.originalSegments.length === 0
		) {
			return [{ text: getCellDisplayText(cell), hasUnclear: false }];
		}

		return cell.originalSegments
			.filter(segment => segment.text.length > 0)
			.map(segment => ({
				text: segment.text.replaceAll(' ', '\u00a0'),
				hasUnclear: segment.hasUnclear,
			}));
	}

	function getCellHoverTitle(siglum: string, cell: AlignmentCell): string | undefined {
		if (cell.kind === 'gap' || cell.kind === 'untranscribed') {
			return `${siglum}: ${cell.gap?.source ?? cell.kind}${cell.gap?.reason ? ` (${cell.gap.reason})` : ''}`;
		}
		if (!cell.isRegularized || !cell.text || !cell.regularizedText) return undefined;
		if (collationState.alignmentDisplayMode === 'regularized') {
			return `${siglum}: original ${cell.text}`;
		}
		return `${siglum}: regularized ${cell.regularizedText}`;
	}

	onMount(() => {
		document.addEventListener('click', closeContextMenu);
	});

	onDestroy(() => {
		document.removeEventListener('click', closeContextMenu);
	});

	function isVariationColumn(col: (typeof collationState.alignmentColumns)[0]): boolean {
		const texts = new Set<string>();
		let hasOmission = false;
		for (const [, cell] of col.cells) {
			const text = cell.alignmentValue ?? cell.regularizedText ?? cell.text;
			if (text) texts.add(text);
			else hasOmission = true;
		}
		return texts.size > 1 || (hasOmission && texts.size > 0);
	}

	function cellClasses(
		col: (typeof collationState.alignmentColumns)[0],
		witnessId: string,
		colIdx: number,
		rowIdx: number
	): string {
		const cell = col.cells.get(witnessId);
		const isFocused =
			collationState.focusedColumn === colIdx && collationState.focusedRow === rowIdx;
		const isSelected = collationState.selectedColumnIds.has(col.id);
		const isCellSelected = collationState.selectedCells.has(`${witnessId}::${col.id}`);
		const baseId = collationState.getBaseWitnessId();
		const isBaseRow = witnessId === baseId;
		let cls =
			'px-2.5 py-1.5 text-sm font-greek whitespace-nowrap border-r border-b border-base-300/40 transition-colors duration-100';
		if (cell?.isOmission) cls += ' bg-base-300/30 text-base-content/20 italic';
		else if (cell?.kind === 'gap' || cell?.kind === 'untranscribed')
			cls += ' bg-base-200/70 text-base-content/60 italic';
		else if (isVariationColumn(col)) cls += ' bg-warning/8';
		if (isBaseRow) cls += ' bg-info/10';
		if (isFocused) cls += ' ring-2 ring-inset ring-primary/60';
		if (isSelected) cls += ' bg-primary/20';
		if (isCellSelected) cls += ' bg-accent/20 ring-2 ring-inset ring-accent/50';
		return cls;
	}

	function shouldRenderDiffCell(
		col: (typeof collationState.alignmentColumns)[0],
		witnessId: string
	): boolean {
		if (!showDiffs) return false;
		if (!isVariationColumn(col)) return false;
		const baseId = collationState.getBaseWitnessId();
		if (!baseId || witnessId === baseId) return false;
		return true;
	}

	function getCellDiffSegments(
		col: (typeof collationState.alignmentColumns)[0],
		witnessId: string
	): DiffSegment[] {
		const baseId = collationState.getBaseWitnessId();
		if (!baseId) return [];
		const baseCell = col.cells.get(baseId);
		const witnessCell = col.cells.get(witnessId);
		const baseText = baseCell ? getCellVisibleText(baseCell) : null;
		const witnessText = witnessCell ? getCellVisibleText(witnessCell) : null;
		return computeWordDiff(baseText, witnessText);
	}

	function diffSegmentClass(segment: DiffSegment): string {
		if (segment.kind === 'equal') return '';
		const classes = ['alignment-diff-marker'];
		if (segment.spacing !== 'none') classes.push('rounded');
		if (segment.kind === 'insert') {
			classes.push('alignment-diff-insert');
			return classes.join(' ');
		}
		if (segment.kind === 'replace') {
			classes.push('alignment-diff-replace');
			return classes.join(' ');
		}
		classes.push('alignment-diff-delete', 'line-through');
		return classes.join(' ');
	}

	function computeBaseIndexLabels(): string[] {
		return collationState
			.getDisplayedColumnSlots()
			.map(slot => (slot.start === slot.end ? String(slot.start) : `${slot.start}-${slot.end}`));
	}

	let baseIndexLabels = $derived(computeBaseIndexLabels());

	$effect(() => {
		if (collationState.rules.length >= 0) {
			collationState.applyRegularization();
		}
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="flex flex-col h-full"
	bind:this={gridEl}
	onkeydown={handleKeydown}
	tabindex="0"
	role="application"
	aria-label="Alignment and regularization workspace"
>
	<!-- Toolbar -->
	<div class="flex items-center gap-2 mb-3 px-1">
		<!-- Navigation -->
		<a
			class="btn btn-ghost btn-sm gap-1"
			href={collationState.collationId
				? `/collation/${collationState.collationId}/setup`
				: '#'}
			aria-disabled={!collationState.collationId}
			tabindex={collationState.collationId ? 0 : -1}
			onclick={e => {
				if (!collationState.collationId) e.preventDefault();
			}}
		>
			<ArrowLeft size={16} />
			Setup
		</a>

		<div class="w-px h-5 bg-base-300/60"></div>

		<!-- Primary Actions -->
		<button
			type="button"
			class="btn btn-primary btn-sm gap-1"
			disabled={isCollating || isRefreshing || activeWitnesses.length < 2}
			onclick={runCollation}
		>
			{#if isCollating}
				<span class="loading loading-spinner loading-sm"></span>
				Collating…
			{:else}
				<Lightning size={16} weight="fill" />
				Run Collation
			{/if}
		</button>
		<button
			type="button"
			class="btn btn-ghost btn-sm gap-1"
			disabled={isRefreshing}
			onclick={refreshWitnesses}
		>
			{#if isRefreshing}
				<span class="loading loading-spinner loading-sm"></span>
			{:else}
				<ArrowClockwise size={16} />
			{/if}
			Refresh
		</button>

		{#if collapsedCount > 0}
			<span class="badge badge-ghost text-xs">
				{collapsedCount} duplicate row{collapsedCount === 1 ? '' : 's'} merged
			</span>
		{/if}

		<!-- Contextual Merge Panel -->
		{#if canMergeColumns || selectedCellCount > 0}
			<div
				class="bg-primary/10 border border-primary/30 rounded-box px-3 py-1 flex items-center gap-2"
			>
				<span class="text-xs font-medium text-primary">
					{#if canMergeCells}
						{selectedCellCount} cell{selectedCellCount === 1 ? '' : 's'}
					{:else if selectedCellCount > 0}
						Select contiguous cells to merge
					{:else}
						{selectedCount} unit{selectedCount === 1 ? '' : 's'}
					{/if}
				</span>
				<button
					type="button"
					class="btn btn-primary btn-xs gap-1"
					disabled={!canMergeCells && !canMergeColumns}
					onclick={handleMerge}
				>
					<ArrowsInSimple size={14} />
					Merge
				</button>
			</div>
		{/if}

		<!-- Spacer -->
		<div class="flex-1"></div>

		<!-- View Toggles -->
		<div class="join">
			<input
				class="join-item btn btn-xs"
				type="radio"
				name="layout-toggle"
				aria-label="Grid"
				checked={alignmentLayout === 'grid'}
				onchange={() => collationState.setAlignmentLayout('grid')}
			/>
			<input
				class="join-item btn btn-xs"
				type="radio"
				name="layout-toggle"
				aria-label="Variation Units"
				checked={alignmentLayout === 'variation-units'}
				onchange={() => collationState.setAlignmentLayout('variation-units')}
			/>
		</div>

		<div class="join">
			<input
				class="join-item btn btn-xs"
				type="radio"
				name="display-mode"
				aria-label="Original"
				checked={collationState.alignmentDisplayMode === 'original'}
				onchange={() => collationState.setAlignmentDisplayMode('original')}
			/>
			<input
				class="join-item btn btn-xs"
				type="radio"
				name="display-mode"
				aria-label="Regularized"
				checked={collationState.alignmentDisplayMode === 'regularized'}
				onchange={() => collationState.setAlignmentDisplayMode('regularized')}
			/>
		</div>

		<div class="w-px h-5 bg-base-300/60"></div>

		<!-- Feature Toggles -->
		<button
			type="button"
			class={['btn btn-xs border-none', showDiffs ? 'btn-active' : 'btn-ghost']}
			onclick={() => (showDiffs = !showDiffs)}
			aria-pressed={showDiffs}
		>
			Diffs
		</button>
		<button
			type="button"
			class={['btn btn-xs border-none', showRulesSidebar ? 'btn-active' : 'btn-ghost']}
			onclick={() => (showRulesSidebar = !showRulesSidebar)}
		>
			Rules
		</button>

		<div class="w-px h-5 bg-base-300/60"></div>

		<!-- Workflow Forward -->
		<button
			type="button"
			class="btn btn-secondary btn-sm gap-1"
			disabled={!collationState.collationId || collationState.alignmentColumns.length === 0}
			onclick={goToReadings}
		>
			Readings
			<ArrowRight size={16} />
		</button>
	</div>

	{#if collationError}
		<div class="alert alert-error mb-3 text-sm">{collationError}</div>
	{/if}

	<div class="flex flex-1 gap-3 min-h-0">
		<!-- The Grid -->
		<div class="flex-1 overflow-auto rounded-box border border-base-300/60 bg-base-100">
			{#if collationState.alignmentColumns.length === 0}
				<div class="flex items-center justify-center h-full text-base-content/40">
					Run collation to view and edit the alignment table.
				</div>
			{:else if alignmentLayout === 'variation-units'}
				<AlignmentVariationUnitsView
					alignmentColumns={collationState.alignmentColumns}
					{baseIndexLabels}
					{groupedRows}
					alignmentDisplayMode={collationState.alignmentDisplayMode}
					selectedColumnIds={collationState.selectedColumnIds}
					{getWitnessSiglum}
					getWitnessHref={buildWitnessHref}
					getBaseWitnessId={() => collationState.getBaseWitnessId()}
					onHeaderClick={handleHeaderClick}
					onColumnRangeSelect={columnIds => {
						collationState.clearColumnSelection();
						collationState.clearCellSelection();
						for (const id of columnIds) {
							collationState.toggleColumnSelection(id);
						}
					}}
					onSplitColumn={columnId => {
						if (collationState.canSplitColumn(columnId)) {
							collationState.splitColumn(columnId);
						}
					}}
				/>
			{:else}
				<table class="border-collapse min-w-full">
					<thead>
						<tr>
							<th
								class="sticky left-0 z-20 bg-base-200 px-3 py-2 text-xs font-bold uppercase tracking-wider text-base-content/50 border-r-2 border-b border-base-300 min-w-[180px]"
							>
								Witnesses
							</th>
							{#each collationState.alignmentColumns as col, colIdx (col.id)}
								<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
								<th
									class="px-2.5 py-2 text-xs font-mono border-r border-b border-base-300/60 cursor-pointer select-none whitespace-nowrap transition-colors duration-100 {collationState.selectedColumnIds.has(
										col.id
									)
										? 'bg-primary/15 text-primary'
										: 'bg-base-200 text-base-content/60'}"
									onclick={e => handleHeaderClick(col.id, e)}
									oncontextmenu={e => handleContextMenu(col.id, e)}
									draggable="false"
								>
									<div class="flex items-center gap-1">
										<span>{baseIndexLabels[colIdx] ?? String(colIdx + 1)}</span>
										{#if col.merged}
											<ArrowsInSimple size={10} class="text-info/60" />
										{/if}
										{#if isVariationColumn(col)}
											<span
												class="w-1.5 h-1.5 rounded-full bg-warning/70 inline-block"
											></span>
										{/if}
									</div>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each groupedRows as row (row.id)}
							<tr class="group">
								<td
									class="sticky left-0 z-10 bg-base-200 px-3 py-1.5 font-mono text-xs font-bold text-base-content/70 border-r-2 border-b border-base-300 align-top {row.representativeId ===
									collationState.getBaseWitnessId()
										? 'bg-info/20 text-info-content'
										: ''}"
								>
									<div
										use:witnessChipList={row.id}
										class={`flex flex-wrap items-start gap-1.5 ${
											collapsibleWitnessRows[row.id] &&
											!expandedWitnessRows[row.id]
												? 'overflow-hidden'
												: ''
										}`}
										style={collapsibleWitnessRows[row.id] &&
										!expandedWitnessRows[row.id]
											? `max-height: ${collapsibleWitnessRows[row.id].collapsedHeight}px;`
											: undefined}
									>
										{#each row.witnessIds as witnessId}
											{@const witnessHref = buildWitnessHref(witnessId)}
											<span
												data-witness-chip="true"
												class="rounded-full border border-base-300/70 bg-base-100/80 px-2 py-0.5 leading-tight"
											>
												{#if witnessHref}
													<a
														href={witnessHref}
														target="_blank"
														rel="noopener noreferrer"
														class="transition-colors duration-75 hover:text-primary"
													>
														{getWitnessSiglum(witnessId)}
													</a>
												{:else}
													{getWitnessSiglum(witnessId)}
												{/if}
											</span>
										{/each}
										{#if row.representativeId === collationState.getBaseWitnessId()}
											<span
												class="rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-info-content/80"
											>
												Base
											</span>
										{/if}
									</div>
									{#if collapsibleWitnessRows[row.id]}
										<button
											type="button"
											class="mt-1 text-[10px] font-semibold uppercase tracking-wider text-primary/80 hover:text-primary"
											onclick={() => toggleWitnessRowExpansion(row.id)}
										>
											{#if expandedWitnessRows[row.id]}
												Show less
											{:else}
												{collapsibleWitnessRows[row.id].hiddenCount} more
											{/if}
										</button>
									{/if}
								</td>
								{#each collationState.alignmentColumns as col, colIdx (col.id)}
									{@const cell = col.cells.get(row.representativeId)}
									<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
									<td
										class={cellClasses(
											col,
											row.representativeId,
											colIdx,
											row.representativeRowIndex
										)}
										onclick={e =>
											handleCellClick(
												col.id,
												row.representativeId,
												colIdx,
												row.representativeRowIndex,
												e
											)}
										oncontextmenu={e =>
											handleContextMenu(col.id, e, row.representativeId)}
										title={cell
											? getCellHoverTitle(
													getWitnessSiglum(row.representativeId),
													cell
												)
											: undefined}
									>
										{#if shouldRenderDiffCell(col, row.representativeId)}
											{@const diffSegments = getCellDiffSegments(
												col,
												row.representativeId
											)}
											{#if diffSegments.length === 0}
												<span class="text-[10px]">&mdash;</span>
											{:else}
												<span class="diff-inline">
													{#each diffSegments as segment, segmentIdx}
														<span class={diffSegmentClass(segment)}
															>{segment.text}</span
														>{#if segmentIdx < diffSegments.length - 1 && segment.spacing !== 'none' && diffSegments[segmentIdx + 1].spacing !== 'none'}<span
															>
															</span>{/if}
													{/each}
												</span>
											{/if}
										{:else if cell?.isOmission}
											<span class="text-[10px]">&mdash;</span>
										{:else}
											<span class="inline-flex items-center gap-1">
												<span class="whitespace-pre show-unclear">
													{#if cell}
														{#each getCellDisplaySegments(cell) as segment}
															<span class:unclear={segment.hasUnclear}
																>{segment.text}</span
															>
														{/each}
													{/if}
												</span>
												{#if cell?.isRegularized}
													<span
														class="inline-flex h-4 min-w-4 items-center justify-center text-info/80"
													>
														<Info size={10} weight="bold" />
													</span>
												{/if}
											</span>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		<!-- Rule Panel -->
		{#if showRulesSidebar}
			<div
				class="w-80 shrink-0 overflow-y-auto bg-base-200/40 rounded-box border border-base-300/40 p-3"
			>
				<h3 class="text-sm font-bold tracking-tight text-base-content/80 mb-3">
					Regularization Rules
				</h3>
				<p class="text-xs text-base-content/50 mb-3">
					Adjust rules, run collation, review alignment, and iterate.
				</p>

				<div class="bg-base-100 rounded-box p-3 border border-base-300/50 space-y-3 mb-3">
					<label class="flex items-center justify-between gap-3">
						<div>
							<div class="text-sm font-medium">CollateX segmentation</div>
							<div class="text-xs text-base-content/50">
								Merge identical adjacent runs into one segment when enabled.
							</div>
						</div>
						<input
							type="checkbox"
							class="toggle toggle-sm toggle-primary"
							checked={collationState.segmentation}
							onchange={event =>
								collationState.setSegmentation(
									(event.currentTarget as HTMLInputElement).checked
								)}
						/>
					</label>

					<label class="flex items-center justify-between gap-3">
						<div>
							<div class="text-sm font-medium">Lowercase for alignment</div>
							<div class="text-xs text-base-content/50">
								Collate on lowercase text while preserving original case for
								display.
							</div>
						</div>
						<input
							type="checkbox"
							class="toggle toggle-sm toggle-primary"
							checked={collationState.lowercase}
							onchange={event =>
								collationState.setLowercase(
									(event.currentTarget as HTMLInputElement).checked
								)}
						/>
					</label>

					<label class="flex items-center justify-between gap-3">
						<div>
							<div class="text-sm font-medium">Ignore punctuation</div>
							<div class="text-xs text-base-content/50">
								Automatic unclear handling stays on; punctuation can be excluded
								from alignment.
							</div>
						</div>
						<input
							type="checkbox"
							class="toggle toggle-sm toggle-primary"
							checked={collationState.ignorePunctuation}
							onchange={event =>
								collationState.setIgnorePunctuation(
									(event.currentTarget as HTMLInputElement).checked
								)}
						/>
					</label>

					<label class="form-control w-full">
						<div class="label py-0.5">
							<span class="label-text text-xs">Supplied text mode</span>
						</div>
						<select
							class="select select-bordered select-sm w-full"
							value={collationState.suppliedTextMode}
							onchange={event =>
								collationState.setSuppliedTextMode(
									(event.currentTarget as HTMLSelectElement)
										.value as SuppliedTextMode
								)}
						>
							<option value="clear">Align supplied text as clear text</option>
							<option value="gap">Treat supplied text as gap / lacuna</option>
						</select>
					</label>
				</div>

				<div class="bg-base-100 rounded-box p-3 border border-base-300/50 space-y-2 mb-3">
					<label class="form-control w-full">
						<div class="label py-0.5">
							<span class="label-text text-xs">Pattern (regex)</span>
						</div>
						<input
							type="text"
							class="input input-bordered input-sm w-full font-mono"
							placeholder="e.g. ν(?=\\s|$)"
							bind:value={newPattern}
						/>
					</label>
					<label class="form-control w-full">
						<div class="label py-0.5">
							<span class="label-text text-xs">Replacement</span>
						</div>
						<input
							type="text"
							class="input input-bordered input-sm w-full font-mono"
							placeholder="empty to delete"
							bind:value={newReplacement}
						/>
					</label>
					<label class="form-control w-full">
						<div class="label py-0.5">
							<span class="label-text text-xs">Scope</span>
						</div>
						<select
							class="select select-bordered select-sm w-full"
							bind:value={newScope}
						>
							<option value="verse">Verse-Level</option>
							<option value="project">Project-Level</option>
						</select>
					</label>
					<label class="form-control w-full">
						<div class="label py-0.5"><span class="label-text text-xs">Type</span></div>
						<select
							class="select select-bordered select-sm w-full"
							bind:value={newType}
						>
							<option value="none">None</option>
							<option value="ns">Nomen sacrum</option>
						</select>
					</label>
					<label class="form-control w-full">
						<div class="label py-0.5">
							<span class="label-text text-xs">Description</span>
						</div>
						<input
							type="text"
							class="input input-bordered input-sm w-full"
							placeholder="Optional note"
							bind:value={newDescription}
						/>
					</label>
					<button
						type="button"
						class="btn btn-sm btn-primary w-full gap-1"
						disabled={!newPattern.trim()}
						onclick={addRule}
					>
						<Plus size={14} />
						Add Rule
					</button>
				</div>

				{#if collationState.rules.length === 0}
					<div class="text-center text-sm text-base-content/40 py-4">No rules yet.</div>
				{:else}
					<div class="space-y-2">
						{#each collationState.rules as rule (rule.id)}
							<div
								class="bg-base-100 rounded-box px-3 py-2.5 border border-base-300/40 flex items-start gap-2 group transition-opacity"
								class:opacity-50={!rule.enabled}
							>
								<button
									type="button"
									class="btn btn-ghost btn-xs btn-circle shrink-0 mt-0.5"
									title={rule.enabled ? 'Disable rule' : 'Enable rule'}
									onclick={() => collationState.toggleRule(rule.id)}
								>
									{#if rule.enabled}
										<ToggleRight size={18} class="text-success" />
									{:else}
										<ToggleLeft size={18} class="text-base-content/40" />
									{/if}
								</button>
								<div class="flex-1 min-w-0">
									<div class="font-mono text-xs truncate">
										<span class="text-error/80">{rule.pattern}</span>
										<span class="text-base-content/30 mx-1">&rarr;</span>
										<span class="text-success/80"
											>{rule.replacement || '(delete)'}</span
										>
									</div>
									{#if rule.description}
										<div class="text-xs text-base-content/50 truncate mt-0.5">
											{rule.description}
										</div>
									{/if}
									<div class="mt-1 flex items-center gap-2">
										<span
											class="badge badge-xs {rule.scope === 'project'
												? 'badge-primary'
												: 'badge-ghost'}"
										>
											{rule.scope}
										</span>
										<select
											class="select select-bordered select-xs max-w-[8rem]"
											value={rule.type}
											onchange={e =>
												collationState.setRuleType(
													rule.id,
													(e.currentTarget as HTMLSelectElement)
														.value as RegularizationType
												)}
										>
											<option value="none">none</option>
											<option value="ns">ns</option>
										</select>
									</div>
								</div>
								<button
									type="button"
									class="btn btn-ghost btn-xs btn-circle shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
									title="Remove rule"
									onclick={() => collationState.removeRule(rule.id)}
								>
									<Trash size={14} class="text-error/70" />
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<!-- Context Menu -->
{#if contextMenu}
	{@const canSplitContextColumn = contextMenu
		? collationState.canSplitColumn(contextMenu.columnId)
		: false}
	{@const canShiftContextLeft = contextMenu?.witnessId
		? collationState.canShiftToken(contextMenu.columnId, contextMenu.witnessId, 'left')
		: false}
	{@const canShiftContextRight = contextMenu?.witnessId
		? collationState.canShiftToken(contextMenu.columnId, contextMenu.witnessId, 'right')
		: false}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="fixed z-50 bg-base-100 rounded-box shadow-xl border border-base-300 py-1 min-w-[180px]"
		style="left: {contextMenu.x}px; top: {contextMenu.y}px"
		role="menu"
		onclick={e => e.stopPropagation()}
		onkeydown={e => e.key === 'Escape' && closeContextMenu()}
	>
		<button
			type="button"
			class="w-full text-left px-3 py-1.5 text-sm hover:bg-base-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
			disabled={!canSplitContextColumn}
			onclick={() => {
				if (canSplitContextColumn) collationState.splitColumn(contextMenu!.columnId);
				closeContextMenu();
			}}
		>
			<ArrowsOutSimple size={14} />
			Split Unit
		</button>
		{#if contextMenu.witnessId}
			<button
				type="button"
				class="w-full text-left px-3 py-1.5 text-sm hover:bg-base-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
				disabled={!canShiftContextLeft}
				onclick={() => {
					if (canShiftContextLeft) {
						collationState.shiftToken(
							contextMenu!.columnId,
							contextMenu!.witnessId!,
							'left'
						);
					}
					closeContextMenu();
				}}
			>
				<ArrowUUpLeft size={14} />
				Shift Token Left
			</button>
			<button
				type="button"
				class="w-full text-left px-3 py-1.5 text-sm hover:bg-base-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
				disabled={!canShiftContextRight}
				onclick={() => {
					if (canShiftContextRight) {
						collationState.shiftToken(
							contextMenu!.columnId,
							contextMenu!.witnessId!,
							'right'
						);
					}
					closeContextMenu();
				}}
			>
				<ArrowUUpRight size={14} />
				Shift Token Right
			</button>
		{/if}
	</div>
{/if}

<style>
	@keyframes animate-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.alignment-diff-marker {
		color: var(--color-base-content);
	}

	.alignment-diff-insert {
		background-color: color-mix(in oklab, var(--color-success) 25%, transparent);
	}

	.alignment-diff-replace {
		background-color: color-mix(in oklab, var(--color-warning) 35%, transparent);
	}

	.alignment-diff-delete {
		background-color: color-mix(in oklab, var(--color-error) 20%, transparent);
	}

	:global([data-theme='minuscule']) .alignment-diff-insert {
		background-color: color-mix(in oklab, var(--color-success-content) 30%, transparent);
	}

	:global([data-theme='minuscule']) .alignment-diff-replace {
		background-color: color-mix(in oklab, var(--color-warning-content) 38%, transparent);
	}

	:global([data-theme='minuscule']) .alignment-diff-delete {
		background-color: color-mix(in oklab, var(--color-error-content) 26%, transparent);
	}

	.animate-in {
		animation: animate-in 0.15s ease-out;
	}
	.diff-inline {
		display: inline;
	}
</style>
