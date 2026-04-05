<script lang="ts">
	import { createSmartLinkPlan } from '$lib/client/iiif/linking';
	import type { CanvasRef, PageRef } from '$lib/client/iiif/types';

	let {
		pages,
		canvases,
		startPageId,
		endPageId,
		startCanvasId,
		endCanvasId,
		onStartPageChange,
		onEndPageChange,
		onStartCanvasChange,
		onEndCanvasChange,
		onUseCurrentStartPage,
		onUseCurrentEndPage,
		onUseCurrentStartCanvas,
		onUseCurrentEndCanvas,
		canUseCurrentPage = false,
		canUseCurrentCanvas = false,
		currentPageLabel = 'No active page available.',
		currentCanvasLabel = 'No active canvas available.',
		onApply,
		busy = false,
	}: {
		pages: PageRef[];
		canvases: CanvasRef[];
		startPageId: string;
		endPageId: string;
		startCanvasId: string;
		endCanvasId: string;
		onStartPageChange: (value: string) => void;
		onEndPageChange: (value: string) => void;
		onStartCanvasChange: (value: string) => void;
		onEndCanvasChange: (value: string) => void;
		onUseCurrentStartPage: () => void;
		onUseCurrentEndPage: () => void;
		onUseCurrentStartCanvas: () => void;
		onUseCurrentEndCanvas: () => void;
		canUseCurrentPage?: boolean;
		canUseCurrentCanvas?: boolean;
		currentPageLabel?: string;
		currentCanvasLabel?: string;
		onApply: () => void;
		busy?: boolean;
	} = $props();

	const plan = $derived(
		createSmartLinkPlan({
			pages,
			canvases,
			startPageId,
			endPageId,
			startCanvasId,
			endCanvasId,
		})
	);

	const currentPageHint = $derived(canUseCurrentPage ? `Current: ${currentPageLabel}` : currentPageLabel);
	const currentCanvasHint = $derived(
		canUseCurrentCanvas ? `Current: ${currentCanvasLabel}` : currentCanvasLabel
	);
</script>

<div class="space-y-3 rounded-box border border-base-300 bg-base-100 p-3">
	<div class="grid gap-3 md:grid-cols-2">
		<label class="form-control">
			<span class="label flex flex-wrap items-start justify-between gap-2 px-0 pb-1">
				<span class="label-text max-w-full pr-2 text-xs font-semibold uppercase tracking-[0.12em]">Start page</span>
				<button class="btn btn-ghost btn-xs h-7 min-h-7 shrink-0 px-2" onclick={onUseCurrentStartPage} disabled={!canUseCurrentPage}>Current</button>
			</span>
			<select class="select select-bordered select-sm w-full" value={startPageId} onchange={event => onStartPageChange((event.currentTarget as HTMLSelectElement).value)}>
				<option value="">Choose a page</option>
				{#each pages as page}
					<option value={page.pageId}>{page.pageOrder}. {page.pageName || page.pageId}</option>
				{/each}
			</select>
			<span class="label px-0 pt-1">
				<span class="label-text-alt text-[11px] opacity-70">{currentPageHint}</span>
			</span>
		</label>
		<label class="form-control">
			<span class="label flex flex-wrap items-start justify-between gap-2 px-0 pb-1">
				<span class="label-text max-w-full pr-2 text-xs font-semibold uppercase tracking-[0.12em]">End page</span>
				<button class="btn btn-ghost btn-xs h-7 min-h-7 shrink-0 px-2" onclick={onUseCurrentEndPage} disabled={!canUseCurrentPage}>Current</button>
			</span>
			<select class="select select-bordered select-sm w-full" value={endPageId} onchange={event => onEndPageChange((event.currentTarget as HTMLSelectElement).value)}>
				<option value="">Choose a page</option>
				{#each pages as page}
					<option value={page.pageId}>{page.pageOrder}. {page.pageName || page.pageId}</option>
				{/each}
			</select>
			<span class="label px-0 pt-1">
				<span class="label-text-alt text-[11px] opacity-70">{currentPageHint}</span>
			</span>
		</label>
		<label class="form-control">
			<span class="label flex flex-wrap items-start justify-between gap-2 px-0 pb-1">
				<span class="label-text max-w-full pr-2 text-xs font-semibold uppercase tracking-[0.12em]">Start canvas</span>
				<button class="btn btn-ghost btn-xs h-7 min-h-7 shrink-0 px-2" onclick={onUseCurrentStartCanvas} disabled={!canUseCurrentCanvas}>Current</button>
			</span>
			<select class="select select-bordered select-sm w-full" value={startCanvasId} onchange={event => onStartCanvasChange((event.currentTarget as HTMLSelectElement).value)}>
				<option value="">Choose a canvas</option>
				{#each canvases as canvas}
					<option value={canvas.canvasId}>{canvas.canvasOrder}. {canvas.canvasLabel}</option>
				{/each}
			</select>
			<span class="label px-0 pt-1">
				<span class="label-text-alt text-[11px] opacity-70">{currentCanvasHint}</span>
			</span>
		</label>
		<label class="form-control">
			<span class="label flex flex-wrap items-start justify-between gap-2 px-0 pb-1">
				<span class="label-text max-w-full pr-2 text-xs font-semibold uppercase tracking-[0.12em]">End canvas</span>
				<button class="btn btn-ghost btn-xs h-7 min-h-7 shrink-0 px-2" onclick={onUseCurrentEndCanvas} disabled={!canUseCurrentCanvas}>Current</button>
			</span>
			<select class="select select-bordered select-sm w-full" value={endCanvasId} onchange={event => onEndCanvasChange((event.currentTarget as HTMLSelectElement).value)}>
				<option value="">Choose a canvas</option>
				{#each canvases as canvas}
					<option value={canvas.canvasId}>{canvas.canvasOrder}. {canvas.canvasLabel}</option>
				{/each}
			</select>
			<span class="label px-0 pt-1">
				<span class="label-text-alt text-[11px] opacity-70">{currentCanvasHint}</span>
			</span>
		</label>
	</div>

	<div class={[
		'rounded-box border p-3 text-sm',
		plan.status === 'ready'
			? 'border-success/30 bg-success/10 text-success-content'
			: plan.status === 'mismatch'
				? 'border-warning/30 bg-warning/10 text-warning-content'
				: 'border-base-300 bg-base-200 text-base-content/75',
	]}>
		<p>{plan.message}</p>
		{#if plan.assignments.length > 0}
			<div class="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs">
				{#each plan.assignments as assignment}
					<div class="flex items-center justify-between gap-2 rounded bg-base-100/70 px-2 py-1">
						<span>{assignment.page.pageOrder}. {assignment.page.pageName || assignment.page.pageId}</span>
						<span class="opacity-70">{assignment.canvas.canvasOrder}. {assignment.canvas.canvasLabel}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<button class="btn btn-secondary w-full" onclick={onApply} disabled={busy || plan.status !== 'ready'}>
		{busy ? 'Applying links...' : 'Apply smart link'}
	</button>
</div>
