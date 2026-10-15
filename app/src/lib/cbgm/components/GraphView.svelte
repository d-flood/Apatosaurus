<script lang="ts">
	import CornersOut from 'phosphor-svelte/lib/CornersOut';
	import MagnifyingGlassMinus from 'phosphor-svelte/lib/MagnifyingGlassMinus';
	import MagnifyingGlassPlus from 'phosphor-svelte/lib/MagnifyingGlassPlus';

	import { renderDot } from '$lib/cbgm/render-dot';
	import { downloadBlob } from '$lib/shell/download-blob';

	let { dot, title, filenameBase }: { dot: string; title: string; filenameBase: string } =
		$props();

	type Graph = { svg: string; markup: string; width: number; height: number };
	type View = { x: number; y: number; scale: number };
	type Point = { x: number; y: number };

	const margin = 16;
	const minScale = 0.02;
	const maxScale = 8;
	const zoomStep = 1.25;

	let rendered = $state.raw<{ dot: string; graph: Graph | null; error: string | null } | null>(
		null
	);
	let adjusted = $state.raw<{ graph: Graph; view: View } | null>(null);
	let viewport = $state<HTMLDivElement>();
	let viewportWidth = $state(0);
	let viewportHeight = $state(0);
	const pointers = new Map<number, Point>();

	const current = $derived(rendered?.dot === dot ? rendered : null);
	const graph = $derived(current?.graph ?? null);
	const view = $derived(
		graph &&
			(adjusted?.graph === graph
				? adjusted.view
				: fitView(graph, viewportWidth, viewportHeight))
	);

	$effect(() => {
		void draw(dot);
	});

	async function draw(source: string) {
		let next: NonNullable<typeof rendered>;
		try {
			next = { dot: source, graph: prepareGraph(await renderDot(source)), error: null };
		} catch (err) {
			const error = err instanceof Error ? err.message : 'The graph could not be drawn.';
			next = { dot: source, graph: null, error };
		}
		if (source === dot) rendered = next;
	}

	function prepareGraph(svg: string): Graph {
		const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
		if (!(root instanceof SVGSVGElement)) throw new Error('Graphviz did not return an SVG.');
		// Imported DOT can carry URL attributes; never render them as live links.
		for (const link of root.querySelectorAll('a')) {
			link.removeAttribute('href');
			link.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
		}
		const { width, height } = root.viewBox.baseVal;
		root.setAttribute('width', String(width));
		root.setAttribute('height', String(height));
		return { svg, markup: root.outerHTML, width, height };
	}

	function clampScale(scale: number): number {
		return Math.min(maxScale, Math.max(minScale, scale));
	}

	function fitView(graph: Graph, width: number, height: number): View {
		const scale = clampScale(
			Math.min((width - 2 * margin) / graph.width, (height - 2 * margin) / graph.height, 1)
		);
		return {
			scale,
			x: (width - graph.width * scale) / 2,
			y: (height - graph.height * scale) / 2,
		};
	}

	function zoomAt(from: View, point: Point, factor: number): View {
		const scale = clampScale(from.scale * factor);
		const applied = scale / from.scale;
		return {
			scale,
			x: point.x - (point.x - from.x) * applied,
			y: point.y - (point.y - from.y) * applied,
		};
	}

	function setView(next: View) {
		if (graph) adjusted = { graph, view: next };
	}

	function zoomFromCenter(factor: number) {
		if (view) setView(zoomAt(view, { x: viewportWidth / 2, y: viewportHeight / 2 }, factor));
	}

	function localPoint(event: PointerEvent | WheelEvent): Point {
		const rect = viewport!.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	function centroid(points: Point[]): Point {
		return {
			x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
			y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
		};
	}

	function spread(points: Point[]): number {
		const center = centroid(points);
		return points.reduce(
			(sum, point) => sum + Math.hypot(point.x - center.x, point.y - center.y),
			0
		);
	}

	function startPointer(event: PointerEvent) {
		if (!view || event.button !== 0) return;
		viewport!.setPointerCapture(event.pointerId);
		pointers.set(event.pointerId, localPoint(event));
	}

	function movePointer(event: PointerEvent) {
		if (!view || !pointers.has(event.pointerId)) return;
		const before = [...pointers.values()];
		pointers.set(event.pointerId, localPoint(event));
		const after = [...pointers.values()];
		const from = centroid(before);
		const to = centroid(after);
		const previousSpread = spread(before);
		const factor = after.length > 1 && previousSpread > 0 ? spread(after) / previousSpread : 1;
		setView(
			zoomAt({ ...view, x: view.x + to.x - from.x, y: view.y + to.y - from.y }, to, factor)
		);
	}

	function endPointer(event: PointerEvent) {
		pointers.delete(event.pointerId);
	}

	function wheel(event: WheelEvent) {
		if (!view) return;
		event.preventDefault();
		const delta =
			event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
		setView(zoomAt(view, localPoint(event), Math.exp(-delta * 0.002)));
	}
</script>

<figure class="min-w-0 space-y-2">
	<figcaption class="break-words text-sm font-medium">{title}</figcaption>
	<div class="flex flex-wrap items-center gap-2">
		<div class="join">
			<button
				type="button"
				class="btn btn-square btn-sm join-item"
				aria-label="Zoom in"
				title="Zoom in"
				disabled={!view}
				onclick={() => zoomFromCenter(zoomStep)}
			>
				<MagnifyingGlassPlus size={16} />
			</button>
			<button
				type="button"
				class="btn btn-square btn-sm join-item"
				aria-label="Zoom out"
				title="Zoom out"
				disabled={!view}
				onclick={() => zoomFromCenter(1 / zoomStep)}
			>
				<MagnifyingGlassMinus size={16} />
			</button>
			<button
				type="button"
				class="btn btn-square btn-sm join-item"
				aria-label="Fit to view"
				title="Fit to view"
				disabled={!view}
				onclick={() => (adjusted = null)}
			>
				<CornersOut size={16} />
			</button>
		</div>
		<button
			type="button"
			class="btn btn-sm"
			disabled={!graph}
			onclick={() =>
				graph &&
				downloadBlob(
					`${filenameBase}.svg`,
					new Blob([graph.svg], { type: 'image/svg+xml' })
				)}
		>
			Download SVG
		</button>
		<button
			type="button"
			class="btn btn-sm"
			onclick={() =>
				downloadBlob(`${filenameBase}.dot`, new Blob([dot], { type: 'text/vnd.graphviz' }))}
		>
			Download DOT
		</button>
	</div>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={viewport}
		bind:clientWidth={viewportWidth}
		bind:clientHeight={viewportHeight}
		class={[
			'relative h-[min(70vh,40rem)] min-h-64 w-full touch-none select-none overflow-hidden rounded-box border border-base-300 bg-base-200',
			view && 'cursor-grab active:cursor-grabbing',
		]}
		onpointerdown={startPointer}
		onpointermove={movePointer}
		onpointerup={endPointer}
		onpointercancel={endPointer}
		onwheel={wheel}
	>
		{#if graph && view}
			<div
				class="absolute left-0 top-0 origin-top-left"
				style:width="{graph.width}px"
				style:height="{graph.height}px"
				style:transform="translate({view.x}px, {view.y}px) scale({view.scale})"
			>
				{@html graph.markup}
			</div>
		{:else if current?.error}
			<div class="alert alert-error m-3 text-sm" role="alert">{current.error}</div>
		{:else}
			<p class="flex h-full items-center justify-center gap-2 text-sm text-base-content/60">
				<span class="loading loading-spinner loading-sm"></span>
				Drawing the graph...
			</p>
		{/if}
	</div>
</figure>
