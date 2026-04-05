
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ensureDjazzkitRuntime } from '$lib/client/djazzkit-runtime';
	import { getVerseIndexRows, type VerseIndexRow } from '$lib/client/transcription/verse-index';
	import type { TranscriptionRecord } from '$lib/client/transcription/model';
	import IiifWorkspace from '$lib/components/transcriptionEditor/IiifWorkspace.svelte';
	import type { TranscriptionSelectionQuote } from '$lib/client/iiif/types';
	import type { PageEditorMetadata } from '$lib/components/transcriptionEditor/pageFormwork';
	import TranscriptionEditor from '$lib/components/transcriptionEditor/TranscriptionEditor.svelte';
	import CheckCircle from 'phosphor-svelte/lib/CheckCircle';
	import { onMount, tick } from 'svelte';
	import { Transcription } from '../../../generated/models/Transcription';

	let { data } = $props();
	const transcriptionIdValue = page.params.id;

	if (!transcriptionIdValue) {
		throw new Error('Transcription ID is required');
	}
	const transcriptionId: string = transcriptionIdValue;

	type IiifWorkspaceSelection = string | 'composite';
	type IiifWorkspaceSyncState = {
		selection: IiifWorkspaceSelection | null;
		canvasId: string | null;
		sidebarOpen: boolean;
		activeTab: 'sources' | 'linking';
	};
	type IiifSyncMessage =
		| {
				type: 'main-state';
				pages: PageEditorMetadata[];
				activePageId: string | null;
				selectionQuote: TranscriptionSelectionQuote | null;
				viewerState: IiifWorkspaceSyncState | null;
		  }
		| { type: 'popup-ready' }
		| { type: 'popup-viewer-state'; viewerState: IiifWorkspaceSyncState | null }
		| { type: 'popup-page-jump'; pageId: string }
		| { type: 'popup-closed' };
	type IiifSyncEnvelope = {
		source: 'apatopwa-iiif-sync';
		transcriptionId: string;
		sessionId: string;
		message: IiifSyncMessage;
	};
	type ScrollToVerseRequest = {
		book: string;
		chapter: string;
		verse: string;
		token: string;
	};

	let transcription = $state<TranscriptionRecord | null>(null);
	let loadError = $state<string | null>(null);
	let unsubscribe: (() => void) | null = null;
	let nowMs = $state(Date.now());
	let hasUnsavedChanges = $state(false);
	let iiifWorkspaceOpen = $state(false);
	let iiifPopupOpen = $state(false);
	let editorPages = $state<PageEditorMetadata[]>([]);
	let activePageId = $state<string | null>(null);
	let selectedTranscriptionQuote = $state<TranscriptionSelectionQuote | null>(null);
	let iiifWorkspaceLastState = $state<IiifWorkspaceSyncState | null>(null);
	let iiifWorkspaceRestoreState = $state<IiifWorkspaceSyncState | null>(null);
	let scrollToPageRequest = $state<{ pageId: string; token: number } | null>(null);
	let toolbarHost = $state<HTMLElement | null>(null);
	let statusBarHost = $state<HTMLElement | null>(null);
	let scrollContainer = $state<HTMLElement | null>(null);
	let topScrollbar = $state<HTMLElement | null>(null);
	let topScrollInner = $state<HTMLElement | null>(null);
	let syncingScroll = false;
	let iiifPopupWindow: Window | null = null;
	let iiifPopupSessionId = $state<string | null>(null);
	let lastPostedIiifStateKey = $state('');
	let sendPopupRestoreState = $state(false);
	let verseIndexOptions = $state<VerseIndexRow[]>([]);
	let goToVerseIdentifier = $state('');
	let forcedVerseKey = $state('');
	let forcedVerseNonce = $state(0);

	const scrollToVerseRequest = $derived.by<ScrollToVerseRequest | null>(() => {
		const book = page.url.searchParams.get('book')?.trim() ?? '';
		const chapter = page.url.searchParams.get('chapter')?.trim() ?? '';
		const verse = page.url.searchParams.get('verse')?.trim() ?? '';
		if (!book || !chapter || !verse) return null;
		const key = `${book}\u0001${chapter}\u0001${verse}`;

		return {
			book,
			chapter,
			verse,
			token: key === forcedVerseKey ? `${key}\u0001${forcedVerseNonce}` : key,
		};
	});

	const currentVerseIdentifier = $derived.by(() => {
		const request = scrollToVerseRequest;
		if (!request) return '';
		if (!request.chapter) return [request.book, request.verse].filter(Boolean).join(' ');
		return `${request.book} ${request.chapter}:${request.verse}`;
	});

	const normalizedVerseIndexLookup = $derived.by(() => {
		const entries = verseIndexOptions.map(row => [row.verse_identifier.trim().toLowerCase(), row] as const);
		return new Map(entries);
	});

	function cloneForMessage<T>(value: T): T {
		return JSON.parse(JSON.stringify(value)) as T;
	}

	function sanitizeInlineRestoreState(
		nextState: IiifWorkspaceSyncState | null
	): IiifWorkspaceSyncState | null {
		if (!nextState) return null;
		if (nextState.selection === 'composite') return nextState;
		return {
			...nextState,
			selection: null,
			canvasId: null,
		};
	}

	function isIiifSyncEnvelope(value: unknown): value is IiifSyncEnvelope {
		if (!value || typeof value !== 'object') return false;
		const candidate = value as Record<string, unknown>;
		return (
			candidate.source === 'apatopwa-iiif-sync' &&
			typeof candidate.transcriptionId === 'string' &&
			typeof candidate.sessionId === 'string' &&
			typeof candidate.message === 'object' &&
			candidate.message !== null
		);
	}

	function syncTopToContent() {
		if (syncingScroll || !scrollContainer || !topScrollbar) return;
		syncingScroll = true;
		topScrollbar.scrollLeft = scrollContainer.scrollLeft;
		syncingScroll = false;
	}

	function syncContentToTop() {
		if (syncingScroll || !scrollContainer || !topScrollbar) return;
		syncingScroll = true;
		scrollContainer.scrollLeft = topScrollbar.scrollLeft;
		syncingScroll = false;
	}

	$effect(() => {
		if (!scrollContainer || !topScrollInner) return;
		const observer = new ResizeObserver(() => {
			if (topScrollInner && scrollContainer) {
				topScrollInner.style.width = `${scrollContainer.scrollWidth}px`;
			}
		});
		observer.observe(scrollContainer);
		for (const child of scrollContainer.children) {
			observer.observe(child);
		}
		return () => observer.disconnect();
	});

	const iiifLayoutStorageKey = `transcription:${transcriptionId}:iiif-layout`;

	const transcriptionTitle = $derived(
		typeof transcription?.title === 'string' ? transcription.title : 'Untitled transcription'
	);

	const lastSavedText = $derived.by(() => {
		const value = transcription?.updated_at || transcription?._djazzkit_updated_at;
		if (!value) return 'Saved time unavailable';
		const savedMs = new Date(value).getTime();
		if (!Number.isFinite(savedMs)) return 'Saved time unavailable';
		const diffSeconds = Math.max(0, Math.floor((nowMs - savedMs) / 1000));
		if (diffSeconds < 5) return 'Saved just now';
		if (diffSeconds < 60) return `Saved ${diffSeconds}s ago`;
		const diffMinutes = Math.floor(diffSeconds / 60);
		if (diffMinutes < 60) return `Saved ${diffMinutes}m ago`;
		const diffHours = Math.floor(diffMinutes / 60);
		if (diffHours < 24) return `Saved ${diffHours}h ago`;
		const diffDays = Math.floor(diffHours / 24);
		return `Saved ${diffDays}d ago`;
	});

	function handleSaveStateChange(saved: boolean) {
		hasUnsavedChanges = !saved;
		if (saved) {
			nowMs = Date.now();
		}
	}

	function handleRequestPageJump(pageId: string) {
		scrollToPageRequest = {
			pageId,
			token: Date.now(),
		};
	}

	function buildVerseHref(book: string, chapter: string, verse: string): string {
		const url = new URL(page.url);
		url.searchParams.set('book', book);
		url.searchParams.set('chapter', chapter);
		url.searchParams.set('verse', verse);
		return `${url.pathname}${url.search}`;
	}

	async function handleGoToVerse(event: SubmitEvent) {
		event.preventDefault();

		const selectedVerse = normalizedVerseIndexLookup.get(goToVerseIdentifier.trim().toLowerCase());
		if (!selectedVerse) return;

		const { book, chapter, verse } = selectedVerse;
		goToVerseIdentifier = selectedVerse.verse_identifier;

		const key = `${book}\u0001${chapter}\u0001${verse}`;
		forcedVerseKey = key;
		forcedVerseNonce += 1;

		await goto(buildVerseHref(book, chapter, verse), {
			keepFocus: true,
			noScroll: true,
			replaceState: false,
		});
	}

	function postMainIiifState(message: Extract<IiifSyncMessage, { type: 'main-state' }>) {
		if (!iiifPopupOpen || !iiifPopupWindow || iiifPopupWindow.closed || !iiifPopupSessionId) return;
		const sessionId = iiifPopupSessionId;
		const envelope: IiifSyncEnvelope = {
			source: 'apatopwa-iiif-sync',
			transcriptionId,
			sessionId,
			message: cloneForMessage(message),
		};
		iiifPopupWindow.postMessage(envelope, window.location.origin);
	}

	function handlePopupClosed() {
		if (!iiifPopupOpen) return;
		iiifPopupOpen = false;
		iiifPopupWindow = null;
		iiifPopupSessionId = null;
		iiifWorkspaceRestoreState = sanitizeInlineRestoreState(iiifWorkspaceLastState);
		iiifWorkspaceOpen = true;
	}

	function toggleInlineIiifWorkspace() {
		if (iiifPopupOpen) {
			if (iiifPopupWindow && !iiifPopupWindow.closed) {
				iiifPopupWindow.focus();
				sendPopupRestoreState = true;
				lastPostedIiifStateKey = '';
				return;
			}
			handlePopupClosed();
		}
		iiifWorkspaceOpen = !iiifWorkspaceOpen;
	}

	function handlePopOutViewer(manifestSourceId: string | null) {
		if (iiifPopupWindow && !iiifPopupWindow.closed) {
			iiifPopupOpen = true;
			iiifPopupWindow.focus();
			sendPopupRestoreState = true;
			lastPostedIiifStateKey = '';
			return;
		}
		const popupUrl = new URL(`/transcription/${transcriptionId}/iiif`, window.location.origin);
		const popupSessionId = crypto.randomUUID();
		if (manifestSourceId) {
			popupUrl.searchParams.set('manifestSourceId', manifestSourceId);
		}
		popupUrl.searchParams.set('session', popupSessionId);
		const popupWindow = window.open(
			popupUrl.toString(),
			'_blank',
			'popup=yes,width=1440,height=960'
		);
		if (!popupWindow || popupWindow.closed) {
			return;
		}
		iiifPopupWindow = popupWindow;
		iiifPopupSessionId = popupSessionId;
		iiifPopupOpen = true;
		iiifWorkspaceOpen = false;
		sendPopupRestoreState = true;
		lastPostedIiifStateKey = '';
	}

	function handleWindowMessage(event: MessageEvent) {
		if (event.origin !== window.location.origin) return;
		if (!isIiifSyncEnvelope(event.data)) return;
		if (event.data.transcriptionId !== transcriptionId) return;
		if (event.data.sessionId !== iiifPopupSessionId) return;
		if (iiifPopupWindow && event.source !== iiifPopupWindow) return;

		const { message } = event.data;
		if (message.type === 'popup-ready') {
			if (event.source instanceof Window) {
				iiifPopupWindow = event.source;
			}
			sendPopupRestoreState = true;
			lastPostedIiifStateKey = '';
			return;
		}
		if (message.type === 'popup-viewer-state') {
			iiifWorkspaceLastState = message.viewerState;
			return;
		}
		if (message.type === 'popup-page-jump') {
			handleRequestPageJump(message.pageId);
			return;
		}
		if (message.type === 'popup-closed') {
			handlePopupClosed();
		}
	}

	onMount(() => {
		window.addEventListener('message', handleWindowMessage);

		try {
			const rawLayout = window.localStorage.getItem(iiifLayoutStorageKey);
			if (rawLayout) {
				const parsed = JSON.parse(rawLayout) as { open?: boolean };
				iiifWorkspaceOpen = parsed.open ?? iiifWorkspaceOpen;
			}
		} catch {
			// ignore invalid saved layout
		}

		const timer = window.setInterval(() => {
			nowMs = Date.now();
		}, 60000);

		return () => {
			window.removeEventListener('message', handleWindowMessage);
			iiifPopupWindow = null;
			window.clearInterval(timer);
		};
	});

	$effect(() => {
		goToVerseIdentifier = currentVerseIdentifier;
	});

	$effect(() => {
		if (!iiifPopupOpen) return;
		const interval = window.setInterval(() => {
			if (iiifPopupWindow?.closed) {
				handlePopupClosed();
			}
		}, 500);
		return () => window.clearInterval(interval);
	});

	$effect(() => {
		if (!transcriptionId) return;

		let cancelled = false;
		verseIndexOptions = [];
		goToVerseIdentifier = currentVerseIdentifier;
		unsubscribe?.();
		unsubscribe = null;
		transcription = null;
		loadError = null;

		void ensureDjazzkitRuntime()
			.then(async () => {
				if (cancelled) return;
				const queryset = Transcription.objects
					.filter(f => f._djazzkit_id.eq(transcriptionId))
					.filter(f => f._djazzkit_deleted.eq(false));
				const nextTranscription = await queryset.first();
				if (cancelled) return;
				transcription = nextTranscription;
				loadError = nextTranscription ? null : 'Failed to load transcription';
				unsubscribe = queryset.subscribe(rows => {
					transcription = rows[0] ?? null;
				});
			})
			.catch(err => {
				if (cancelled) return;
				loadError = err instanceof Error ? err.message : 'Failed to load transcription';
				console.error('Failed to load transcription:', err);
			});

		void ensureDjazzkitRuntime()
			.then(() => getVerseIndexRows())
			.then(rows => {
				if (cancelled) return;
				verseIndexOptions = rows
					.filter(row => row.transcription_id === transcriptionId && !row._djazzkit_deleted)
					.sort((a, b) =>
						a.verse_identifier.localeCompare(b.verse_identifier, undefined, {
							numeric: true,
							sensitivity: 'base',
						})
					);
			})
			.catch(err => {
				if (cancelled) return;
				console.error('Failed to load verse index:', err);
			});

		return () => {
			cancelled = true;
			unsubscribe?.();
			unsubscribe = null;
		};
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		window.localStorage.setItem(
			iiifLayoutStorageKey,
			JSON.stringify({ open: iiifWorkspaceOpen })
		);
	});

	$effect(() => {
		if (!iiifPopupOpen) return;
		const message = {
			type: 'main-state',
			pages: editorPages,
			activePageId,
			selectionQuote: selectedTranscriptionQuote,
			viewerState: sendPopupRestoreState ? iiifWorkspaceLastState : null,
		} satisfies Extract<IiifSyncMessage, { type: 'main-state' }>;
		const nextKey = JSON.stringify(message);
		if (nextKey === lastPostedIiifStateKey) return;
		lastPostedIiifStateKey = nextKey;
		postMainIiifState(message);
		if (sendPopupRestoreState) {
			sendPopupRestoreState = false;
		}
	});

	$effect(() => {
		if (!iiifWorkspaceOpen || !iiifWorkspaceRestoreState) return;
		void tick().then(() => {
			iiifWorkspaceRestoreState = null;
		});
	});
</script>

{#if loadError}
	<div class="container mx-auto max-w-2xl p-4">
		<div class="alert alert-error">
			<span>Error loading transcription: {loadError}</span>
		</div>
	</div>
{:else if !transcription}
	<div class="container mx-auto max-w-2xl p-4">
		<div class="alert alert-info">
			<span>Loading transcription...</span>
		</div>
	</div>
{:else}
	<div class="mx-auto max-w-450 px-4 pb-28">
		<div class="my-4 text-center">
			<h1 class="font-serif text-3xl">{transcription.title}</h1>
			<div class="font-sans text-sm opacity-75 mt-1 inline-flex items-center gap-1">
				<span
					class="inline-flex h-4 w-4 items-center justify-center"
					class:invisible={hasUnsavedChanges}
					aria-hidden="true"
				>
					<CheckCircle size={16} weight="fill" />
				</span>
				<span>{hasUnsavedChanges ? 'Unsaved changes' : lastSavedText}</span>
			</div>
		</div>

			<div class={['gap-4', iiifWorkspaceOpen ? 'flex items-start' : '']}>
				<div class={['min-w-0', iiifWorkspaceOpen ? 'flex-1' : '']}>
					<div
						class="sticky top-0 z-20 mb-4 rounded-box border border-base-300 bg-base-100/95 p-3 shadow-sm backdrop-blur"
					>
						<div bind:this={toolbarHost}></div>
						<form
							class="mt-3 flex flex-wrap items-end justify-end gap-2 border-t border-base-300/70 pt-3"
							onsubmit={handleGoToVerse}
						>
							<label class="form-control min-w-72 flex-1">
								<span class="label pb-1">
									<span class="label-text text-xs uppercase tracking-[0.14em] opacity-70">Go To Verse</span>
								</span>
								<input
									bind:value={goToVerseIdentifier}
									class="input input-sm w-full"
									list="transcription-verse-index"
									placeholder="Select or type a verse"
								/>
								<datalist id="transcription-verse-index">
									{#each verseIndexOptions as row (row._djazzkit_id)}
										<option value={row.verse_identifier}></option>
									{/each}
								</datalist>
							</label>
							<button
								type="submit"
								class="btn btn-sm btn-primary"
								disabled={!normalizedVerseIndexLookup.has(goToVerseIdentifier.trim().toLowerCase())}
							>
								Go To
							</button>
						</form>
					</div>
					<div
						bind:this={topScrollbar}
					class="sticky top-12 z-10 overflow-x-auto"
					style="overflow-y: clip;"
					onscroll={syncContentToTop}
				>
					<div bind:this={topScrollInner} class="h-px"></div>
				</div>
				<div
					bind:this={scrollContainer}
					class="overflow-x-auto"
					style="overflow-y: clip;"
					onscroll={syncTopToContent}
					data-transcription-scroll-container
				>
					<TranscriptionEditor
						{transcription}
						{data}
						onSaveStateChange={handleSaveStateChange}
						onPagesChange={pages => (editorPages = pages)}
						onActivePageChange={page => (activePageId = page?.pageId || null)}
						onTextSelectionChange={selection => (selectedTranscriptionQuote = selection)}
						onToggleIiifWorkspace={toggleInlineIiifWorkspace}
						{iiifWorkspaceOpen}
						toolbarTarget={toolbarHost}
						statusBarTarget={statusBarHost}
						{scrollToPageRequest}
						{scrollToVerseRequest}
					/>
				</div>
				<div class="sticky bottom-0 z-30 pointer-events-none">
					<div class="pointer-events-auto">
						<div bind:this={statusBarHost}></div>
					</div>
				</div>
			</div>

			{#if iiifWorkspaceOpen}
				<div class="sticky top-16 h-[calc(100vh-5rem)] w-[46%] shrink-0">
					<IiifWorkspace
						transcriptionId={transcription._djazzkit_id}
						{transcriptionTitle}
						pages={editorPages}
						{activePageId}
						selectionQuote={selectedTranscriptionQuote}
						restoreState={iiifWorkspaceRestoreState}
						onRequestPageJump={handleRequestPageJump}
						onViewerStateChange={state => (iiifWorkspaceLastState = state)}
						onPopOut={handlePopOutViewer}
					/>
				</div>
			{/if}
		</div>
	</div>
{/if}
