<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { TriiiceratopsViewer, type ViewerState } from 'triiiceratops';
	import {
		createAnnotationEditorPlugin,
		type AnnotationEditorExtension,
	} from 'triiiceratops/plugins/annotation-editor';

	import { AppAnnotationAdapter } from '$lib/client/iiif/AppAnnotationAdapter';
	import { canvasToRef } from '$lib/client/iiif/canvas';
	import {
		buildExternalImageManifest,
		buildSyntheticManifestUrl,
		createExternalImageImportMetadata,
		isExternalImageManifestSource,
		probeExternalImageUrls,
	} from '$lib/client/iiif/externalImageManifest';
	import { importIntfManuscript, isIntfManifestSource } from '$lib/client/iiif/intfManifest';
	import { createIntfAutoLinkPlan, createSmartLinkPlan } from '$lib/client/iiif/linking';
	import { createCompositeTranscriptionAnnotationExtension } from '$lib/client/iiif/createCompositeTranscriptionAnnotationExtension';
	import { buildLinkedManifest } from '$lib/client/iiif/manifestBuilder';
	import {
		getManifestSourceCategory,
		getManifestSourceCategoryLabel,
	} from '$lib/client/iiif/sourceClassification';
	import { resolveIiifWorkspaceSelection } from '$lib/client/iiif/selection';
	import {
		deleteAllPageCanvasLinks,
		deleteManifestSource,
		deletePageCanvasLink,
		deletePageCanvasLinksForPage,
		ensureManifestSource,
		findLinkedPageForCanvas,
		listManifestSources,
		listPageCanvasLinks,
		savePageCanvasLinks,
		upsertPageCanvasLink,
	} from '$lib/client/iiif/storage';
	import type {
		AnnotationAnchor,
		CanvasRef,
		CompositeCanvasSourceRef,
		IiifSourceCategory,
		IiifWorkspaceSelection,
		IntfAutoLinkCanvas,
		IntfAutoLinkPage,
		ManifestSourceSummary,
		PageCanvasLink,
		PageRef,
		TranscriptionSelectionQuote,
	} from '$lib/client/iiif/types';
	import IiifManifestLoader from './IiifManifestLoader.svelte';
	import { getPageLabelCandidates, type PageEditorMetadata } from './pageFormwork';
	import SmartLinkPreview from './SmartLinkPreview.svelte';

	const COMPOSITE_SELECTION = 'composite' as const satisfies IiifWorkspaceSelection;
	const SOURCE_CATEGORIES: IiifSourceCategory[] = ['iiif', 'intf', 'urls'];

	function isCompositeCanvasSourceRef(value: unknown): value is CompositeCanvasSourceRef {
		if (!value || typeof value !== 'object') return false;
		const candidate = value as Record<string, unknown>;
		return (
			typeof candidate.manifestSourceId === 'string' &&
			typeof candidate.sourceCanvasId === 'string' &&
			typeof candidate.pageId === 'string' &&
			typeof candidate.pageOrder === 'number'
		);
	}

	function getPageCanvasLinkKey(input: {
		manifestSourceId: string;
		pageId: string;
		canvasId: string;
	}): string {
		return [input.manifestSourceId, input.pageId, input.canvasId].join('::');
	}

	function sortPageCanvasLinks(a: PageCanvasLink, b: PageCanvasLink): number {
		return (
			a.pageOrder - b.pageOrder ||
			a.canvasOrder - b.canvasOrder ||
			a.manifestSourceId.localeCompare(b.manifestSourceId) ||
			a.id.localeCompare(b.id)
		);
	}

	function getViewerCanvasIdForLink(link: PageCanvasLink | null): string | null {
		if (!link) return null;
		if (!isCompositeSelected) return link.canvasId;
		return (
			compositeCanvasIdBySourceKey[
				getPageCanvasLinkKey({
					manifestSourceId: link.manifestSourceId,
					pageId: link.pageId,
					canvasId: link.canvasId,
				})
			] || null
		);
	}

	interface IiifWorkspaceSyncState {
		selection: IiifWorkspaceSelection | null;
		canvasId: string | null;
		sidebarOpen: boolean;
		activeTab: 'sources' | 'linking';
	}

	let {
		transcriptionId,
		transcriptionTitle,
		initialManifestSourceId = null,
		pages,
		activePageId,
		selectionQuote = null,
		restoreState = null,
		onRequestPageJump,
		onViewerStateChange,
		onPopOut,
	}: {
		transcriptionId: string;
		transcriptionTitle: string;
		initialManifestSourceId?: string | null;
		pages: PageEditorMetadata[];
		activePageId: string | null;
		selectionQuote?: TranscriptionSelectionQuote | null;
		restoreState?: IiifWorkspaceSyncState | null;
		onRequestPageJump?: (pageId: string) => void;
		onViewerStateChange?: (state: IiifWorkspaceSyncState) => void;
		onPopOut?: (manifestSourceId: string | null) => void;
	} = $props();

	let viewerState = $state<ViewerState | undefined>(undefined);
	let manifestSources = $state<ManifestSourceSummary[]>([]);
	let pageLinks = $state<PageCanvasLink[]>([]);
	let loaderMode = $state<'manifest' | 'images' | 'intf'>('manifest');
	let manifestInput = $state('');
	let imageUrlsInput = $state('');
	let intfJsonInput = $state('');
	let intfAutoAssociate = $state(true);
	let currentSelection = $state<IiifWorkspaceSelection | null>(null);
	let hasUserSelectedSource = $state(false);
	let startPageId = $state('');
	let endPageId = $state('');
	let startCanvasId = $state('');
	let endCanvasId = $state('');
	let loadingManifest = $state(false);
	let savingLink = $state(false);
	let applyingSmartLink = $state(false);
	let hydratingManifest = $state(false);
	let mutatingLinks = $state(false);
	let removingSourceId = $state<string | null>(null);
	let statusMessage = $state<string | null>(null);
	let intfImportStage = $state<string | null>(null);
	let pendingCanvasRequest = $state<string | null>(null);
	let lastPageNavigationInput = $state('');
	let lastRequestedJumpKey = $state('');
	let lastManifestSyncKey = $state('');
	let lastRestoreStateKey = $state('');
	let lastEmittedViewerStateKey = $state('');
	let activeTab = $state<'sources' | 'linking'>('sources');
	let sidebarOpen = $state(true);
	const annotationUser = { id: 'Apatopwa Editor', name: 'Apatopwa Editor' } as const;

	const annotationAdapter = new AppAnnotationAdapter(
		() => transcriptionId,
		(manifestId: string, canvasId: string) => {
			const context =
				currentCanvasPersistenceContext &&
				viewerManifestId === manifestId &&
				currentCanvasId === canvasId
					? currentCanvasPersistenceContext
					: null;
			if (!context) {
				return null;
			}
			return {
				manifestSourceId: context.manifestSourceId,
				sourceCanvasId: context.sourceCanvasId,
				pageId: context.pageId,
				anchor: {
					...context.anchor,
					quote:
						selectionQuote && selectionQuote.pageId === context.pageId
							? selectionQuote.text
							: context.anchor.quote || null,
				},
			};
		}
	);
	const annotationExtension = createCompositeTranscriptionAnnotationExtension(() => ({
		isCompositeSelected,
		persistenceContext: currentCanvasPersistenceContext,
		selectionQuote,
	})) as AnnotationEditorExtension;
	const compositeAnnotationPlugin = createAnnotationEditorPlugin({
		adapter: annotationAdapter,
		user: annotationUser,
		tools: ['rectangle', 'polygon', 'point'],
		defaultTool: 'rectangle',
		extension: annotationExtension,
	});
	const compositeAnnotationPlugins = [compositeAnnotationPlugin];

	onDestroy(() => {
		annotationAdapter.destroy();
	});

	const pageRefs: PageRef[] = $derived(
		pages.map(
			(page: PageEditorMetadata): PageRef => ({
				pageId: page.pageId,
				pageName: page.pageName,
				pageOrder: page.pageOrder,
			})
		)
	);

	const currentManifestSource: ManifestSourceSummary | null = $derived(
		currentSelection && currentSelection !== COMPOSITE_SELECTION
			? manifestSources.find(
					(source: ManifestSourceSummary) => source.id === currentSelection
				) || null
			: null
	);

	const isCompositeSelected = $derived(currentSelection === COMPOSITE_SELECTION);

	const linkedManifestJson = $derived.by(() =>
		buildLinkedManifest({
			transcriptionId,
			transcriptionTitle,
			manifestSources,
			pageLinks,
		})
	);

	const viewerManifestId = $derived.by(() => {
		if (isCompositeSelected && linkedManifestJson) {
			return String(
				linkedManifestJson.id ||
					`urn:apatopwa:transcription:${transcriptionId}:linked-manifest`
			);
		}
		return currentManifestSource?.id || null;
	});

	const viewerManifestJson = $derived.by(() => {
		if (isCompositeSelected) return linkedManifestJson;
		return currentManifestSource?.manifestJson || null;
	});

	const canvasRefs: CanvasRef[] = $derived.by(() => {
		const manifestId = viewerManifestId;
		if (!manifestId || !viewerState) return [] as CanvasRef[];
		return viewerState.canvases
			.map((canvas: any, index: number) => canvasToRef(canvas, index, manifestId))
			.filter((canvas: CanvasRef) => canvas.canvasId.length > 0);
	});

	const currentManifestLinks: PageCanvasLink[] = $derived(
		currentManifestSource
			? pageLinks.filter(
					(link: PageCanvasLink) => link.manifestSourceId === currentManifestSource.id
				)
			: []
	);

	const compositeCanvasIdBySourceKey = $derived.by(() => {
		const items = Array.isArray(linkedManifestJson?.items) ? linkedManifestJson.items : [];
		const nextMap: Record<string, string> = {};
		for (const item of items) {
			if (!isCompositeCanvasSourceRef(item?.apatopwaSource) || typeof item?.id !== 'string') {
				continue;
			}
			nextMap[
				getPageCanvasLinkKey({
					manifestSourceId: item.apatopwaSource.manifestSourceId,
					pageId: item.apatopwaSource.pageId,
					canvasId: item.apatopwaSource.sourceCanvasId,
				})
			] = item.id;
		}
		return nextMap;
	});

	const compositeVisibleLinks: PageCanvasLink[] = $derived.by(() =>
		pageLinks
			.filter((link: PageCanvasLink) =>
				Boolean(
					compositeCanvasIdBySourceKey[
						getPageCanvasLinkKey({
							manifestSourceId: link.manifestSourceId,
							pageId: link.pageId,
							canvasId: link.canvasId,
						})
					]
				)
			)
			.sort(sortPageCanvasLinks)
	);

	const selectedLinks: PageCanvasLink[] = $derived(
		isCompositeSelected ? compositeVisibleLinks : currentManifestLinks
	);
	const currentCanvasId: string | null = $derived(viewerState?.canvasId || null);
	const currentCompositeCanvasSource: CompositeCanvasSourceRef | null = $derived.by(() => {
		if (!isCompositeSelected || !currentCanvasId || !linkedManifestJson) return null;
		const items = Array.isArray(linkedManifestJson.items) ? linkedManifestJson.items : [];
		const currentCanvas = items.find(
			(canvas: Record<string, unknown>) => canvas?.id === currentCanvasId
		);
		return isCompositeCanvasSourceRef(currentCanvas?.apatopwaSource)
			? currentCanvas.apatopwaSource
			: null;
	});
	const currentCanvasRef: CanvasRef | null = $derived(
		currentCanvasId
			? canvasRefs.find((canvas: CanvasRef) => canvas.canvasId === currentCanvasId) || null
			: null
	);
	const activePageRef: PageEditorMetadata | null = $derived(
		activePageId
			? pages.find((page: PageEditorMetadata) => page.pageId === activePageId) || null
			: null
	);
	const activePageLinks: PageCanvasLink[] = $derived(
		activePageId ? pageLinks.filter((link: PageCanvasLink) => link.pageId === activePageId) : []
	);
	const selectedActivePageLinks: PageCanvasLink[] = $derived.by(() =>
		selectedLinks
			.filter((link: PageCanvasLink) => link.pageId === activePageId)
			.sort(sortPageCanvasLinks)
	);
	const activePageLink: PageCanvasLink | null = $derived.by(() => {
		if (!activePageId) return null;
		if (currentPageCanvasLink?.pageId === activePageId) {
			return currentPageCanvasLink;
		}
		if (!isCompositeSelected && currentCanvasId) {
			const matchingLink = selectedActivePageLinks.find(
				(link: PageCanvasLink) =>
					link.pageId === activePageId && link.canvasId === currentCanvasId
			);
			if (matchingLink) return matchingLink;
		}
		return selectedActivePageLinks[0] || null;
	});
	const activePageViewerCanvasId: string | null = $derived(getViewerCanvasIdForLink(activePageLink));
	const viewerCanvasPropId: string | null = $derived(pendingCanvasRequest || currentCanvasId || null);
	const isAwaitingActivePageCanvas = $derived(
		Boolean(pendingCanvasRequest && pendingCanvasRequest !== currentCanvasId)
	);
	const currentCanvasLinks: PageCanvasLink[] = $derived(
		currentCanvasId
			? selectedLinks.filter((link: PageCanvasLink) => {
					if (isCompositeSelected && currentCompositeCanvasSource) {
						return (
							link.manifestSourceId === currentCompositeCanvasSource.manifestSourceId &&
							link.canvasId === currentCompositeCanvasSource.sourceCanvasId &&
							link.pageId === currentCompositeCanvasSource.pageId
						);
					}
					return link.canvasId === currentCanvasId;
				})
			: []
	);
	const currentCanvasLinkedPage: PageCanvasLink | null = $derived(
		currentCanvasLinks.length === 0
			? null
			: activePageId
				? currentCanvasLinks.find((link: PageCanvasLink) => link.pageId === activePageId) ||
					currentCanvasLinks[0]
				: currentCanvasLinks[0]
	);
	const currentPageCanvasLink: PageCanvasLink | null = $derived(
		activePageId && currentCanvasId
			? selectedLinks.find(
					(link: PageCanvasLink) =>
						link.pageId === activePageId &&
						(isCompositeSelected && currentCompositeCanvasSource
							? link.manifestSourceId === currentCompositeCanvasSource.manifestSourceId &&
								link.canvasId === currentCompositeCanvasSource.sourceCanvasId &&
								link.pageId === currentCompositeCanvasSource.pageId
							: link.canvasId === currentCanvasId)
				) || null
			: null
	);
	const currentCanvasPersistenceContext: {
		manifestSourceId: string;
		sourceCanvasId: string;
		pageId: string;
		anchor: AnnotationAnchor;
	} | null = $derived.by(() => {
		if (!currentCanvasLinkedPage) return null;
		if (isCompositeSelected) {
			if (!currentCompositeCanvasSource) return null;
			return {
				manifestSourceId: currentCompositeCanvasSource.manifestSourceId,
				sourceCanvasId: currentCompositeCanvasSource.sourceCanvasId,
				pageId: currentCanvasLinkedPage.pageId,
				anchor: {
					role: 'page' as const,
					pageId: currentCanvasLinkedPage.pageId,
					pageName: currentCanvasLinkedPage.pageNameSnapshot,
					pageOrder: currentCanvasLinkedPage.pageOrder,
					canvasId: currentCompositeCanvasSource.sourceCanvasId,
					manifestSourceId: currentCompositeCanvasSource.manifestSourceId,
				},
			};
		}
		if (!currentManifestSource || !currentCanvasId) return null;
		return {
			manifestSourceId: currentManifestSource.id,
			sourceCanvasId: currentCanvasId,
			pageId: currentCanvasLinkedPage.pageId,
			anchor: {
				role: 'page' as const,
				pageId: currentCanvasLinkedPage.pageId,
				pageName: currentCanvasLinkedPage.pageNameSnapshot,
				pageOrder: currentCanvasLinkedPage.pageOrder,
				canvasId: currentCanvasId,
				manifestSourceId: currentManifestSource.id,
			},
		};
	});
	const annotationAvailabilityMessage = $derived(
		annotationExtension.getCreateDisabledReason?.({
			manifestId: viewerManifestId,
			canvasId: currentCanvasId,
			isEditing: false,
			selectedAnnotation: null,
			user: annotationUser,
			hostContext: annotationExtension.getContext?.() || null,
		}) || null
	);
	const smartLinkPlan = $derived(
		createSmartLinkPlan({
			pages: pageRefs,
			canvases: canvasRefs,
			startPageId,
			endPageId,
			startCanvasId,
			endCanvasId,
		})
	);

	const annotationPlugins = $derived(isCompositeSelected ? compositeAnnotationPlugins : []);
	const externalViewerState: IiifWorkspaceSyncState = $derived.by(() => ({
		selection: currentSelection,
		canvasId: currentCanvasId,
		sidebarOpen,
		activeTab,
	}));

	const groupedSources = $derived.by(() =>
		SOURCE_CATEGORIES.map((category: IiifSourceCategory) => ({
			category,
			label: getManifestSourceCategoryLabel(category),
			sources: manifestSources.filter(
				(source: ManifestSourceSummary) => getManifestSourceCategory(source) === category
			),
		}))
	);

	const viewerConfig = {
		toolbarOpen: true,
		toolbarPosition: 'left',
		toolbar: { showSearch: false },
		gallery: { open: true, dockPosition: 'bottom', fixedHeight: 92 },
		annotations: { open: false, visible: true, position: 'right', width: '20rem' },
	} as const;

	onMount(() => {
		void refreshStoredData();
	});

	$effect(() => {
		if (!restoreState) return;
		const restoreKey = JSON.stringify(restoreState);
		if (restoreKey === lastRestoreStateKey) return;
		lastRestoreStateKey = restoreKey;
		sidebarOpen = restoreState.sidebarOpen;
		activeTab = restoreState.activeTab;
		hasUserSelectedSource =
			Boolean(restoreState.selection) && restoreState.selection !== COMPOSITE_SELECTION;
		if (restoreState.selection !== currentSelection) {
			applySelection(restoreState.selection);
		}
		pendingCanvasRequest =
			restoreState.canvasId && restoreState.canvasId !== currentCanvasId
				? restoreState.canvasId
				: null;
	});

	$effect(() => {
		const nextViewerState = externalViewerState;
		const nextKey = JSON.stringify(nextViewerState);
		if (nextKey === lastEmittedViewerStateKey) return;
		lastEmittedViewerStateKey = nextKey;
		onViewerStateChange?.(nextViewerState);
	});

	$effect(() => {
		const nextSelection = resolveSelection(currentSelection);
		if (nextSelection !== currentSelection) {
			applySelection(nextSelection);
		}
	});

	$effect(() => {
		if (currentManifestSource && !currentManifestSource.manifestJson && !hydratingManifest) {
			void hydrateManifestSource(currentManifestSource);
		}
	});

	$effect(() => {
		if (
			startCanvasId &&
			!canvasRefs.some((canvas: CanvasRef) => canvas.canvasId === startCanvasId)
		) {
			startCanvasId = '';
		}
		if (
			endCanvasId &&
			!canvasRefs.some((canvas: CanvasRef) => canvas.canvasId === endCanvasId)
		) {
			endCanvasId = '';
		}
	});

	$effect(() => {
		const navigationInput = `${currentSelection || ''}:${activePageId || ''}:${activePageViewerCanvasId || ''}`;
		if (navigationInput === lastPageNavigationInput) return;
		lastPageNavigationInput = navigationInput;
		if (!activePageId || !activePageViewerCanvasId) {
			pendingCanvasRequest = null;
			return;
		}
		pendingCanvasRequest =
			activePageViewerCanvasId !== currentCanvasId ? activePageViewerCanvasId : null;
	});

	$effect(() => {
		if (pendingCanvasRequest && pendingCanvasRequest === currentCanvasId) {
			pendingCanvasRequest = null;
		}
	});

	$effect(() => {
		if (!currentCanvasLinkedPage || !currentCanvasId) return;
		if (isAwaitingActivePageCanvas) return;
		const nextJumpKey = `${currentSelection || ''}:${currentCanvasId}:${currentCanvasLinkedPage.pageId}`;
		if (nextJumpKey === lastRequestedJumpKey) return;
		lastRequestedJumpKey = nextJumpKey;
		if (currentCanvasLinkedPage.pageId !== activePageId) {
			onRequestPageJump?.(currentCanvasLinkedPage.pageId);
		}
	});

	$effect(() => {
		if (
			!viewerState?.manifest ||
			!currentManifestSource ||
			!viewerManifestJson ||
			isCompositeSelected
		) {
			return;
		}
		const manifest = viewerState.manifest as any;
		const label = getManifestLabel(manifest) || currentManifestSource.label;
		const defaultCanvas = currentManifestSource.defaultCanvasId || viewerState.canvasId;
		const syncKey = `${currentManifestSource.id}:${label}:${currentManifestSource.defaultCanvasId || ''}:${viewerState.canvases.length}`;
		if (syncKey === lastManifestSyncKey) return;
		lastManifestSyncKey = syncKey;
		void ensureManifestSource({
			transcriptionId,
			manifestUrl: currentManifestSource.manifestUrl,
			label,
			defaultCanvasId: defaultCanvas,
			manifestJson: viewerManifestJson,
			metadata: { canvasCount: viewerState.canvases.length },
		});
	});

	function resetSyncKeys() {
		pendingCanvasRequest = null;
		lastPageNavigationInput = '';
		lastRequestedJumpKey = '';
		lastManifestSyncKey = '';
	}

	function resolveSelection(
		selection: IiifWorkspaceSelection | null
	): IiifWorkspaceSelection | null {
		const resolvedInitialManifestSourceId =
			linkedManifestJson && initialManifestSourceId !== COMPOSITE_SELECTION
				? null
				: initialManifestSourceId;

		return resolveIiifWorkspaceSelection({
			selection,
			preserveCurrentSelection: hasUserSelectedSource,
			initialManifestSourceId: resolvedInitialManifestSourceId,
			manifestSources,
			hasCompositeManifest: Boolean(linkedManifestJson),
			compositeSelection: COMPOSITE_SELECTION,
		});
	}

	function syncInputsFromSource(source: ManifestSourceSummary | null) {
		loaderMode = source
			? isExternalImageManifestSource(source)
				? 'images'
				: isIntfManifestSource(source)
					? 'intf'
					: 'manifest'
			: 'manifest';
		manifestInput =
			source && !isExternalImageManifestSource(source) && !isIntfManifestSource(source)
				? source.manifestUrl
				: manifestInput;
		imageUrlsInput =
			source && isExternalImageManifestSource(source)
				? Array.isArray(source.metadata?.imageUrls)
					? source.metadata.imageUrls
							.filter((value): value is string => typeof value === 'string')
							.join('\n')
					: imageUrlsInput
				: imageUrlsInput;
	}

	function applySelection(selection: IiifWorkspaceSelection | null) {
		currentSelection = selection;
		resetSyncKeys();
		if (!selection || selection === COMPOSITE_SELECTION) return;
		const source =
			manifestSources.find(
				(candidate: ManifestSourceSummary) => candidate.id === selection
			) || null;
		syncInputsFromSource(source);
	}

	function selectManifestSource(manifestSourceId: string) {
		hasUserSelectedSource = true;
		applySelection(manifestSourceId);
		activeTab = 'linking';
	}

	function selectCompositeManifest() {
		hasUserSelectedSource = true;
		applySelection(COMPOSITE_SELECTION);
		activeTab = 'linking';
	}

	function updateIntfImportStage(stage: string | null) {
		intfImportStage = stage;
	}

	async function refreshStoredData() {
		manifestSources = await listManifestSources(transcriptionId);
		pageLinks = await listPageCanvasLinks(transcriptionId);
	}

	async function fetchManifestJson(manifestUrl: string): Promise<Record<string, any>> {
		const response = await fetch(manifestUrl);
		if (!response.ok) {
			throw new Error(`Failed to load manifest (${response.status})`);
		}
		return (await response.json()) as Record<string, any>;
	}

	async function hydrateManifestSource(source: ManifestSourceSummary) {
		if (source.manifestJson) return source;
		if (isExternalImageManifestSource(source) || isIntfManifestSource(source)) {
			statusMessage = 'Saved synthetic sources are missing their local manifest snapshot.';
			return source;
		}
		hydratingManifest = true;
		statusMessage = null;
		try {
			const manifestJson = await fetchManifestJson(source.manifestUrl);
			await ensureManifestSource({
				transcriptionId,
				manifestUrl: source.manifestUrl,
				label: source.label,
				defaultCanvasId: source.defaultCanvasId,
				defaultImageServiceUrl: source.defaultImageServiceUrl,
				manifestJson,
				metadata: { ...(source.metadata || {}), hydratedAt: new Date().toISOString() },
			});
			await refreshStoredData();
			statusMessage = 'Manifest snapshot stored locally for direct viewer loading.';
		} catch (error) {
			statusMessage =
				error instanceof Error ? error.message : 'Failed to hydrate manifest source.';
		} finally {
			hydratingManifest = false;
		}
	}

	async function loadManifest() {
		const manifestUrl = manifestInput.trim();
		if (!manifestUrl) return;
		loadingManifest = true;
		statusMessage = null;
		try {
			const manifestJson = await fetchManifestJson(manifestUrl);
			const saved = await ensureManifestSource({
				transcriptionId,
				manifestUrl,
				label: getManifestLabel(manifestJson) || manifestUrl,
				manifestJson,
				metadata: { loadedFromUrl: manifestUrl },
			});
			await refreshStoredData();
			selectManifestSource(saved.id);
			statusMessage =
				'Manifest loaded and saved locally. Choose pages and canvases to start linking.';
		} catch (error) {
			statusMessage = error instanceof Error ? error.message : 'Failed to load manifest.';
		} finally {
			loadingManifest = false;
		}
	}

	async function loadImageUrls() {
		const rawInput = imageUrlsInput.trim();
		if (!rawInput) return;
		loadingManifest = true;
		statusMessage = null;
		try {
			const images = await probeExternalImageUrls(rawInput);
			const imageUrls = images.map(image => image.url);
			const manifestUrl = buildSyntheticManifestUrl(imageUrls);
			const manifestJson = buildExternalImageManifest({
				manifestUrl,
				images,
			});
			const saved = await ensureManifestSource({
				transcriptionId,
				manifestUrl,
				label: getManifestLabel(manifestJson) || `External images (${images.length})`,
				manifestJson,
				metadata: {
					...createExternalImageImportMetadata(imageUrls),
					loadedFromImageUrls: imageUrls,
				},
			});
			await refreshStoredData();
			selectManifestSource(saved.id);
			statusMessage =
				images.length === 1
					? 'Image loaded as a synthetic IIIF canvas and saved locally.'
					: `${images.length} images loaded as a synthetic IIIF manifest and saved locally.`;
		} catch (error) {
			statusMessage =
				error instanceof Error ? error.message : 'Failed to load external image URLs.';
		} finally {
			loadingManifest = false;
		}
	}

	function buildIntfAutoLinkPages(inputPages: PageEditorMetadata[]): IntfAutoLinkPage[] {
		return inputPages.map(page => ({
			pageId: page.pageId,
			pageName: page.pageName,
			pageOrder: page.pageOrder,
			matchCandidates: getPageLabelCandidates(page),
		}));
	}

	function buildIntfAutoLinkCanvases(
		entries: Awaited<ReturnType<typeof importIntfManuscript>>['entries']
	): IntfAutoLinkCanvas[] {
		return entries.map((entry, index) => ({
			canvasId: entry.canvasId,
			canvasLabel: entry.label,
			canvasOrder: index + 1,
			imageServiceUrl: null,
			thumbnailUrl: entry.thumbnailUrl,
			folio: entry.folio,
			shelfFolioNums: entry.shelfFolioNums,
			sortOrder: entry.sortOrder,
		}));
	}

	async function loadIntfJson() {
		const rawInput = intfJsonInput.trim();
		if (!rawInput) return;
		loadingManifest = true;
		statusMessage = null;
		updateIntfImportStage('Parsing INTF JSON...');
		try {
			const imported = await importIntfManuscript(rawInput, {
				onStageChange: stage => {
					if (stage === 'parsing') {
						updateIntfImportStage('Parsing INTF JSON...');
						return;
					}
					if (stage === 'probing-images') {
						updateIntfImportStage('Probing image dimensions...');
						return;
					}
					updateIntfImportStage('Building local manifest...');
				},
			});
			updateIntfImportStage('Saving local source...');
			const saved = await ensureManifestSource({
				transcriptionId,
				manifestUrl: imported.manifestUrl,
				label: imported.label,
				manifestJson: imported.manifestJson,
				metadata: imported.metadata as unknown as Record<string, unknown>,
			});

			let autoLinkMessage = '';
			if (intfAutoAssociate) {
				updateIntfImportStage('Matching pages and canvases...');
				const autoLinkPlan = createIntfAutoLinkPlan({
					pages: buildIntfAutoLinkPages(pages),
					canvases: buildIntfAutoLinkCanvases(imported.entries),
				});
				if (autoLinkPlan.assignments.length > 0) {
					await savePageCanvasLinks(
						autoLinkPlan.assignments.map(({ page, canvas }) => ({
							transcriptionId,
							pageId: page.pageId,
							pageNameSnapshot: page.pageName || page.pageId,
							pageOrder: page.pageOrder,
							manifestSourceId: saved.id,
							manifestUrlSnapshot: saved.manifestUrl,
							canvasId: canvas.canvasId,
							canvasOrder: canvas.canvasOrder,
							canvasLabel: canvas.canvasLabel,
							imageServiceUrl: canvas.imageServiceUrl,
							thumbnailUrl: canvas.thumbnailUrl,
						}))
					);
				}
				autoLinkMessage = ` ${autoLinkPlan.message}`;
			}

			updateIntfImportStage('Refreshing workspace...');
			await refreshStoredData();
			selectManifestSource(saved.id);
			updateIntfImportStage(null);
			statusMessage = `Imported ${imported.entries.length} INTF image(s) into a local manifest.${autoLinkMessage}`;
		} catch (error) {
			updateIntfImportStage(null);
			statusMessage =
				error instanceof Error ? error.message : 'Failed to import INTF manuscript JSON.';
		} finally {
			updateIntfImportStage(null);
			loadingManifest = false;
		}
	}

	async function linkCurrentCanvasToPage() {
		if (!activePageRef || !currentCanvasRef || !currentManifestSource || isCompositeSelected) {
			return;
		}
		savingLink = true;
		statusMessage = null;
		try {
			await upsertPageCanvasLink({
				transcriptionId,
				pageId: activePageRef.pageId,
				pageNameSnapshot: activePageRef.pageName || activePageRef.pageId,
				pageOrder: activePageRef.pageOrder,
				manifestSourceId: currentManifestSource.id,
				manifestUrlSnapshot: currentManifestSource.manifestUrl,
				canvasId: currentCanvasRef.canvasId,
				canvasOrder: currentCanvasRef.canvasOrder,
				canvasLabel: currentCanvasRef.canvasLabel,
				imageServiceUrl: currentCanvasRef.imageServiceUrl,
				thumbnailUrl: currentCanvasRef.thumbnailUrl,
			});
			await refreshStoredData();
			statusMessage = `Linked ${activePageRef.pageName || activePageRef.pageId} to ${currentCanvasRef.canvasLabel}.`;
		} finally {
			savingLink = false;
		}
	}

	async function applySmartLink() {
		if (!currentManifestSource || smartLinkPlan.status !== 'ready' || isCompositeSelected)
			return;
		applyingSmartLink = true;
		statusMessage = null;
		try {
			await savePageCanvasLinks(
				smartLinkPlan.assignments.map(({ page, canvas }) => ({
					transcriptionId,
					pageId: page.pageId,
					pageNameSnapshot: page.pageName || page.pageId,
					pageOrder: page.pageOrder,
					manifestSourceId: currentManifestSource.id,
					manifestUrlSnapshot: currentManifestSource.manifestUrl,
					canvasId: canvas.canvasId,
					canvasOrder: canvas.canvasOrder,
					canvasLabel: canvas.canvasLabel,
					imageServiceUrl: canvas.imageServiceUrl,
					thumbnailUrl: canvas.thumbnailUrl,
				}))
			);
			await refreshStoredData();
			statusMessage = smartLinkPlan.message;
		} finally {
			applyingSmartLink = false;
		}
	}

	async function unlinkLink(link: PageCanvasLink) {
		mutatingLinks = true;
		statusMessage = null;
		try {
			const deletedCount = await deletePageCanvasLink({
				transcriptionId,
				pageId: link.pageId,
				manifestSourceId: link.manifestSourceId,
				canvasId: link.canvasId,
			});
			await refreshStoredData();
			statusMessage = deletedCount
				? `Unlinked ${link.pageNameSnapshot} from ${link.canvasLabel}.`
				: 'No link was removed.';
		} finally {
			mutatingLinks = false;
		}
	}

	async function unlinkCurrentCanvas() {
		const link = currentPageCanvasLink || currentCanvasLinkedPage;
		if (!link) return;
		await unlinkLink(link);
	}

	async function clearActivePageLinks() {
		if (!activePageRef) return;
		const shouldContinue = window.confirm(
			`Clear all image links for ${activePageRef.pageName || activePageRef.pageId}?`
		);
		if (!shouldContinue) return;
		mutatingLinks = true;
		statusMessage = null;
		try {
			const deletedCount = await deletePageCanvasLinksForPage({
				transcriptionId,
				pageId: activePageRef.pageId,
			});
			await refreshStoredData();
			statusMessage = deletedCount
				? `Cleared ${deletedCount} link${deletedCount === 1 ? '' : 's'} for ${activePageRef.pageName || activePageRef.pageId}.`
				: `No links found for ${activePageRef.pageName || activePageRef.pageId}.`;
		} finally {
			mutatingLinks = false;
		}
	}

	async function clearAllLinks() {
		if (pageLinks.length === 0) return;
		const shouldContinue = window.confirm('Clear every image link in this transcription?');
		if (!shouldContinue) return;
		mutatingLinks = true;
		statusMessage = null;
		try {
			const deletedCount = await deleteAllPageCanvasLinks(transcriptionId);
			await refreshStoredData();
			statusMessage = deletedCount
				? `Cleared ${deletedCount} link${deletedCount === 1 ? '' : 's'} from this transcription.`
				: 'No links were found to clear.';
		} finally {
			mutatingLinks = false;
		}
	}

	async function removeManifestSourceRecord(source: ManifestSourceSummary) {
		const shouldContinue = window.confirm(
			`Delete saved source "${source.label || source.manifestUrl}"? This also removes links created from this source.`
		);
		if (!shouldContinue) return;
		removingSourceId = source.id;
		statusMessage = null;
		try {
			const deleted = await deleteManifestSource({
				transcriptionId,
				manifestSourceId: source.id,
			});
			await refreshStoredData();
			statusMessage = deleted
				? `Deleted saved source ${source.label || source.manifestUrl}.`
				: 'Source was already removed.';
		} finally {
			removingSourceId = null;
		}
	}

	async function jumpToLinkedPage() {
		if (currentCanvasLinkedPage) {
			onRequestPageJump?.(currentCanvasLinkedPage.pageId);
			return;
		}
		if (!currentManifestSource || !currentCanvasId) return;
		const link = await findLinkedPageForCanvas({
			transcriptionId,
			manifestSourceId: currentManifestSource.id,
			canvasId: currentCanvasId,
		});
		if (link) {
			onRequestPageJump?.(link.pageId);
		}
	}

	function getManifestLabel(manifest: any): string | null {
		try {
			if (typeof manifest?.getLabel === 'function') {
				const label = manifest.getLabel();
				if (typeof label === 'string' && label.length > 0) return label;
				if (Array.isArray(label)) {
					const first = label[0];
					if (typeof first === 'string' && first.length > 0) return first;
					if (first && typeof first === 'object' && typeof first.value === 'string') {
						return first.value;
					}
				}
			}
			if (typeof manifest?.label === 'string' && manifest.label.length > 0) {
				return manifest.label;
			}
			const label = manifest?.label;
			if (label && typeof label === 'object') {
				const none = (label as Record<string, unknown>).none;
				if (Array.isArray(none) && typeof none[0] === 'string' && none[0].length > 0) {
					return none[0];
				}
			}
		} catch {
			return null;
		}
		return null;
	}
</script>

<div
	class="relative flex h-full min-h-0 min-w-0 overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm"
>
	<div class="min-h-0 min-w-0 flex-1">
		{#if viewerManifestId && viewerManifestJson}
			<TriiiceratopsViewer
				manifestId={viewerManifestId}
				manifestJson={viewerManifestJson || undefined}
				canvasId={viewerCanvasPropId || undefined}
				config={viewerConfig}
				plugins={annotationPlugins}
				bind:viewerState
			/>
		{:else}
			<div
				class="flex h-full items-center justify-center p-6 text-center text-sm text-base-content/70"
			>
				<p>
					{#if hydratingManifest}
						Preparing the saved manifest snapshot for direct viewer loading...
					{:else if isCompositeSelected}
						No linked images are available in the composite manifest yet.
					{:else}
						Load or select a source to open the viewer.
					{/if}
				</p>
			</div>
		{/if}
	</div>

	<div
		class={[
			'flex h-full shrink-0 flex-col overflow-hidden border-l border-base-300 bg-base-100 transition-[width] duration-200',
			sidebarOpen ? 'w-80' : 'w-0 border-l-0',
		]}
	>
		{#if sidebarOpen}
			<div class="flex w-80 items-center border-b border-base-300 px-1.5 py-1">
				<button
					class="btn btn-ghost btn-xs btn-square"
					onclick={() => (sidebarOpen = false)}
					title="Collapse sidebar"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="size-4"
					>
						<path
							fill-rule="evenodd"
							d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
				<span
					class="ml-1 text-xs font-semibold uppercase tracking-[0.14em] text-base-content/60"
					>IIIF workspace</span
				>
				<div class="ml-auto flex items-center gap-2">
					{#if onPopOut}
						<button
							class="btn btn-outline btn-xs"
							onclick={() =>
								onPopOut?.(
									isCompositeSelected
										? COMPOSITE_SELECTION
										: currentManifestSource?.id || null
								)}
						>
							Pop out
						</button>
					{/if}
				</div>
			</div>

			<div class="flex w-80 min-h-0 flex-1 flex-col overflow-y-auto p-3">
				<div class="space-y-3">
					{#if intfImportStage}
						<div class="alert alert-info py-2 text-xs">
							<span class="loading loading-spinner loading-xs shrink-0" aria-hidden="true"></span>
							<span>{intfImportStage}</span>
						</div>
					{/if}

					{#if statusMessage}
						<div class="alert alert-info py-2 text-xs">
							<span>{statusMessage}</span>
						</div>
					{/if}

					{#if annotationAvailabilityMessage}
						<div class="alert py-2 text-xs">
							<span>{annotationAvailabilityMessage}</span>
						</div>
					{/if}

					<div class="rounded-box border border-base-300 p-3">
						<p
							class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/60"
						>
							Source selector
						</p>
						<div class="mt-3 space-y-2">
							<label
								class="label cursor-pointer justify-start gap-3 rounded-box border border-base-300 px-3 py-2"
							>
								<input
									type="radio"
									name="iiif-linking-source"
									class="radio radio-sm"
									checked={isCompositeSelected}
									onchange={selectCompositeManifest}
									disabled={!linkedManifestJson}
								/>
								<div class="min-w-0 flex-1">
									<p class="text-sm font-medium wrap-break-word">
										Composite local manifest
									</p>
									{#if !linkedManifestJson}
										<p class="text-xs opacity-70 wrap-break-word">
											No linked images yet.
										</p>
									{/if}
								</div>
							</label>
							{#each manifestSources as source (source.id)}
								<label
									class="label cursor-pointer justify-start gap-3 rounded-box border border-base-300 px-3 py-2"
								>
									<input
										type="radio"
										name="iiif-linking-source"
										class="radio radio-sm"
										checked={currentManifestSource?.id === source.id &&
											!isCompositeSelected}
										onchange={() => selectManifestSource(source.id)}
									/>
									<div class="min-w-0 flex-1">
										<p class="text-sm font-medium wrap-break-word">
											{source.label || source.manifestUrl}
										</p>
										<p class="text-xs opacity-70 wrap-break-word">
											{getManifestSourceCategoryLabel(
												getManifestSourceCategory(source)
											)}
										</p>
									</div>
								</label>
							{/each}
						</div>
					</div>

					<div class="tabs tabs-box bg-base-200 p-1">
						<button
							class={[
								'tab tab-sm flex-1 whitespace-nowrap px-1 text-xs',
								activeTab === 'sources' && 'tab-active',
							]}
							onclick={() => (activeTab = 'sources')}
						>
							Sources
						</button>
						<button
							class={[
								'tab tab-sm flex-1 whitespace-nowrap px-1 text-xs',
								activeTab === 'linking' && 'tab-active',
							]}
							onclick={() => (activeTab = 'linking')}
						>
							Linking
						</button>
					</div>

					{#if activeTab === 'sources'}
						<div class="space-y-3">
							<div class="rounded-box border border-base-300 p-3">
								<p
									class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/60"
								>
									Add source
								</p>
								<div class="mt-3">
									<IiifManifestLoader
										{loaderMode}
										{manifestInput}
										{imageUrlsInput}
										{intfJsonInput}
										{intfAutoAssociate}
										busy={loadingManifest || hydratingManifest}
										intfBusyLabel={intfImportStage}
										onLoaderModeChange={(
											value: 'manifest' | 'images' | 'intf'
										) => (loaderMode = value)}
										onManifestInputChange={(value: string) =>
											(manifestInput = value)}
										onImageUrlsInputChange={(value: string) =>
											(imageUrlsInput = value)}
										onIntfJsonInputChange={(value: string) =>
											(intfJsonInput = value)}
										onIntfAutoAssociateChange={(value: boolean) =>
											(intfAutoAssociate = value)}
										onLoadManifest={loadManifest}
										onLoadImageUrls={loadImageUrls}
										onLoadIntfJson={loadIntfJson}
									/>
								</div>
							</div>

							<div class="rounded-box border border-base-300 p-3">
								<div class="flex items-center justify-between gap-2">
									<p
										class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/60"
									>
										Saved sources
									</p>
									<span class="text-xs opacity-60">{manifestSources.length}</span>
								</div>
								<div class="mt-3 space-y-3">
									{#each groupedSources as group (group.category)}
										<div class="space-y-2">
											<p class="text-xs font-medium text-base-content/70">
												{group.label}
											</p>
											{#if group.sources.length > 0}
												<div class="space-y-2">
													{#each group.sources as source (source.id)}
														<div
															class="rounded-box border border-base-300 bg-base-200/30 p-2 text-xs"
														>
															<div
																class="flex items-start justify-between gap-2"
															>
																<button
																	class={[
																		'btn btn-xs flex-1 justify-start px-2 h-auto py-1.5 text-left',
																		currentManifestSource?.id ===
																			source.id &&
																		!isCompositeSelected
																			? 'btn-secondary'
																			: 'btn-ghost border border-base-300',
																	]}
																	onclick={() =>
																		selectManifestSource(
																			source.id
																		)}
																>
																	<span
																		class="wrap-break-word line-clamp-3"
																		>{source.label ||
																			source.manifestUrl}</span
																	>
																</button>
																<button
																	class="btn btn-xs btn-error btn-outline shrink-0"
																	onclick={() =>
																		removeManifestSourceRecord(
																			source
																		)}
																	disabled={removingSourceId ===
																		source.id}
																>
																	{removingSourceId === source.id
																		? 'Deleting...'
																		: 'Delete'}
																</button>
															</div>
														</div>
													{/each}
												</div>
											{:else}
												<p class="text-xs opacity-60">
													No {group.label} sources yet.
												</p>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						</div>
					{:else}
						<div class="space-y-3">
							<div class="rounded-box border border-base-300 p-3 text-xs">
								<p class="font-medium">Current source</p>
								{#if isCompositeSelected}
									<p class="mt-1 opacity-80">
										The composite local manifest is for review and unlinking
										only. New links can only be created while a saved source is
										selected.
									</p>
								{:else if currentManifestSource}
									<p class="mt-1 opacity-80 wrap-break-word">
										{currentManifestSource.label ||
											currentManifestSource.manifestUrl}
									</p>
								{:else}
									<p class="mt-1 opacity-80">
										Choose a saved source to create or review links.
									</p>
								{/if}
							</div>

							<div class="space-y-2 rounded-box border border-base-300 p-3">
								<p class="text-xs font-semibold">Manual link</p>

								<div
									class="rounded-box border border-base-300 bg-base-50 p-2 text-xs"
								>
									<p class="font-medium">Active page</p>
									<div class="min-w-0">
										{#if activePageRef}
											<p class="wrap-break-words">
												{activePageRef.pageOrder}. {activePageRef.pageName ||
													activePageRef.pageId}
											</p>
										{:else if activePageId}
											<p class="wrap-break-words">{activePageId}</p>
										{:else if pages.length === 0}
											<p class="opacity-70">
												No active editor page in this view.
											</p>
										{:else}
											<p class="opacity-70">
												Move the cursor onto a page in the editor.
											</p>
										{/if}
									</div>
								</div>

								<div
									class="rounded-box border border-base-300 bg-base-50 p-2 text-xs"
								>
									<p class="font-medium">Current canvas</p>
									<div class="min-w-0">
										{#if currentCanvasRef}
											<p class="wrap-break-words">
												{currentCanvasRef.canvasOrder}. {currentCanvasRef.canvasLabel}
											</p>
										{:else}
											<p class="opacity-70">Choose a canvas in the viewer.</p>
										{/if}
									</div>
								</div>

								<button
									class="btn btn-primary btn-sm w-full"
									onclick={linkCurrentCanvasToPage}
									disabled={savingLink ||
										!activePageRef ||
										!currentCanvasRef ||
										!currentManifestSource ||
										isCompositeSelected}
								>
									{#if isCompositeSelected}
										Composite manifest is unlink-only
									{:else if savingLink}
										Saving...
									{:else}
										Link active page to current canvas
									{/if}
								</button>

								{#if currentCanvasLinkedPage}
									<div
										class="rounded-box border border-success/30 bg-success/10 p-2 text-xs"
									>
										<p class="font-medium">Canvas linked</p>
										<p>{currentCanvasLinkedPage.pageNameSnapshot}</p>
									</div>
								{/if}
							</div>

							{#if !isCompositeSelected}
								<SmartLinkPreview
									pages={pageRefs}
									canvases={canvasRefs}
									{startPageId}
									{endPageId}
									{startCanvasId}
									{endCanvasId}
									busy={applyingSmartLink}
									onStartPageChange={value => (startPageId = value)}
									onEndPageChange={value => (endPageId = value)}
									onStartCanvasChange={value => (startCanvasId = value)}
									onEndCanvasChange={value => (endCanvasId = value)}
									onUseCurrentStartPage={() => {
										if (activePageId) startPageId = activePageId;
									}}
									onUseCurrentEndPage={() => {
										if (activePageId) endPageId = activePageId;
									}}
									onUseCurrentStartCanvas={() => {
										if (currentCanvasId) startCanvasId = currentCanvasId;
									}}
									onUseCurrentEndCanvas={() => {
										if (currentCanvasId) endCanvasId = currentCanvasId;
									}}
									canUseCurrentPage={Boolean(activePageRef)}
									canUseCurrentCanvas={Boolean(currentCanvasRef)}
									currentPageLabel={activePageRef
										? `${activePageRef.pageOrder}. ${activePageRef.pageName || activePageRef.pageId}`
										: pages.length === 0
											? 'No active editor page in this view.'
											: 'Move the cursor onto a page in the editor.'}
									currentCanvasLabel={currentCanvasRef
										? `${currentCanvasRef.canvasOrder}. ${currentCanvasRef.canvasLabel}`
										: 'Choose a canvas in the viewer.'}
									onApply={applySmartLink}
								/>
							{/if}

							<div class="rounded-box border border-base-300 p-3">
								<p
									class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/60"
								>
									Actions
								</p>
								<div class="mt-3 grid grid-cols-1 gap-2">
									<button
										class="btn btn-sm btn-outline"
										onclick={unlinkCurrentCanvas}
										disabled={(!currentPageCanvasLink &&
											!currentCanvasLinkedPage) ||
											mutatingLinks}
									>
										{mutatingLinks
											? 'Working...'
											: 'Unlink current page/canvas'}
									</button>
									<button
										class="btn btn-sm btn-error btn-outline"
										onclick={clearActivePageLinks}
										disabled={!activePageRef ||
											activePageLinks.length === 0 ||
											mutatingLinks}
									>
										Clear all links for active page (all sources)
									</button>
									<button
										class="btn btn-sm btn-error"
										onclick={clearAllLinks}
										disabled={pageLinks.length === 0 || mutatingLinks}
									>
										Clear all links in transcription
									</button>
								</div>
							</div>

							<div class="rounded-box border border-base-300 p-3 text-xs">
								<p class="font-medium">Current canvas</p>
								<div class="min-w-0">
									{#if currentCanvasRef}
										<p class="mt-1 wrap-break-words">
											{currentCanvasRef.canvasOrder}. {currentCanvasRef.canvasLabel}
										</p>
										<p class="mt-1 opacity-70 wrap-break-words">
											{currentCanvasLinkedPage?.pageNameSnapshot ||
												'Not linked'}
										</p>
									{:else}
										<p class="mt-1 opacity-70">
											Choose a canvas in the viewer.
										</p>
									{/if}
								</div>
								<div class="mt-3 flex flex-wrap gap-2">
									<button
										class="btn btn-outline btn-xs"
										onclick={jumpToLinkedPage}
										disabled={!currentCanvasId}
									>
										Jump to page
									</button>
								</div>
							</div>

							<div class="space-y-2 rounded-box border border-base-300 p-3">
								<div class="flex items-center justify-between gap-2">
									<p
										class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/60"
									>
										Links
									</p>
									<span class="text-xs opacity-60">{selectedLinks.length}</span>
								</div>
								{#if selectedLinks.length > 0}
									<div class="space-y-1">
										{#each selectedLinks as link (link.id)}
											<div
												class="rounded-box border border-base-300 bg-base-200/50 px-2 py-1.5 text-xs"
											>
												<div class="flex items-start justify-between gap-2">
													<div class="min-w-0 flex-1">
														<p class="font-medium wrap-break-words">
															{link.pageNameSnapshot}
														</p>
														<p class="opacity-70 wrap-break-words">
															{link.canvasLabel}
														</p>
													</div>
													<div
														class="flex shrink-0 flex-col items-stretch gap-1"
													>
									<button
										class="btn btn-xs btn-ghost"
									onclick={() => {
										onRequestPageJump?.(link.pageId);
										const viewerCanvasId = getViewerCanvasIdForLink(link);
										if (viewerCanvasId) {
											pendingCanvasRequest = viewerCanvasId;
										}
									}}
								>
															Jump
														</button>
														<button
															class="btn btn-xs btn-error btn-outline"
															onclick={() => unlinkLink(link)}
															disabled={mutatingLinks}
														>
															Unlink
														</button>
													</div>
												</div>
											</div>
										{/each}
									</div>
								{:else}
									<p class="text-xs opacity-70">
										{#if isCompositeSelected}
											No linked images are in the composite manifest yet.
										{:else}
											No links yet for this source.
										{/if}
									</p>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	{#if !sidebarOpen}
		<button
			class="absolute top-2 right-2 z-10 btn btn-ghost btn-xs btn-square border border-base-300 bg-base-100/90 shadow-sm backdrop-blur hover:bg-base-300"
			onclick={() => (sidebarOpen = true)}
			title="Open sidebar"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 20 20"
				fill="currentColor"
				class="size-4"
			>
				<path
					fill-rule="evenodd"
					d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z"
					clip-rule="evenodd"
				/>
			</svg>
		</button>
	{/if}
</div>
