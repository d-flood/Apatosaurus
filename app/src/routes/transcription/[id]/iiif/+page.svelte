<script lang="ts">
	import { page } from '$app/state';
	import { ensureDjazzkitRuntime } from '$lib/client/djazzkit-runtime';
	import type { TranscriptionSelectionQuote } from '$lib/client/iiif/types';
	import type { PageEditorMetadata } from '$lib/components/transcriptionEditor/pageFormwork';
	import type { TranscriptionRecord } from '$lib/client/transcription/model';
	import IiifWorkspace from '$lib/components/transcriptionEditor/IiifWorkspace.svelte';
	import { Transcription } from '../../../../generated/models/Transcription';
	import { onMount } from 'svelte';

	const transcriptionIdValue = page.params.id;
	const initialManifestSourceId = page.url.searchParams.get('manifestSourceId');
	const popupSessionIdValue = page.url.searchParams.get('session');

	if (!transcriptionIdValue) {
		throw new Error('Transcription ID is required');
	}
	const transcriptionId: string = transcriptionIdValue;
	const popupSessionId: string | null = popupSessionIdValue;

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

	let transcription = $state<TranscriptionRecord | null>(null);
	let loadError = $state<string | null>(null);
	let unsubscribe: (() => void) | null = null;
	let pages = $state<PageEditorMetadata[]>([]);
	let activePageId = $state<string | null>(null);
	let selectionQuote = $state<TranscriptionSelectionQuote | null>(null);
	let restoreState = $state<IiifWorkspaceSyncState | null>(null);
	const transcriptionTitle = $derived(
		typeof transcription?.title === 'string' ? transcription.title : 'Untitled transcription'
	);

	function cloneForMessage<T>(value: T): T {
		return JSON.parse(JSON.stringify(value)) as T;
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

	function postToOpener(message: IiifSyncMessage) {
		if (!popupSessionId || !window.opener) return;
		const sessionId = popupSessionId;
		const envelope: IiifSyncEnvelope = {
			source: 'apatopwa-iiif-sync',
			transcriptionId,
			sessionId,
			message: cloneForMessage(message),
		};
		window.opener.postMessage(envelope, window.location.origin);
	}

	function handleWindowUnload() {
		postToOpener({ type: 'popup-closed' });
	}

	function sanitizePopupRestoreState(
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

	function handleWindowMessage(event: MessageEvent) {
		if (event.origin !== window.location.origin) return;
		if (event.source !== window.opener) return;
		if (!isIiifSyncEnvelope(event.data)) return;
		if (event.data.transcriptionId !== transcriptionId) return;
		if (event.data.sessionId !== popupSessionId) return;
		const { message } = event.data;
		if (message.type !== 'main-state') return;
		pages = message.pages;
		activePageId = message.activePageId;
		selectionQuote = message.selectionQuote;
		restoreState = sanitizePopupRestoreState(message.viewerState);
	}

	onMount(() => {
		window.addEventListener('message', handleWindowMessage);
		postToOpener({ type: 'popup-ready' });

		void ensureDjazzkitRuntime()
			.then(async () => {
				const queryset = Transcription.objects
					.filter(f => f._djazzkit_id.eq(transcriptionId))
					.filter(f => f._djazzkit_deleted.eq(false));
				transcription = await queryset.first();
				loadError = transcription ? null : 'Failed to load transcription';
				unsubscribe = queryset.subscribe(rows => {
					transcription = rows[0] ?? null;
				});
			})
			.catch(err => {
				loadError = err instanceof Error ? err.message : 'Failed to load transcription';
			});

		return () => {
			handleWindowUnload();
			window.removeEventListener('message', handleWindowMessage);
			unsubscribe?.();
			unsubscribe = null;
		};
	});
</script>

<svelte:window onunload={handleWindowUnload} />

{#if loadError}
	<div class="container mx-auto max-w-2xl p-4">
		<div class="alert alert-error">
			<span>Error loading IIIF workspace: {loadError}</span>
		</div>
	</div>
{:else if !transcription}
	<div class="container mx-auto max-w-2xl p-4">
		<div class="alert alert-info">
			<span>Loading IIIF workspace...</span>
		</div>
	</div>
{:else}
	<div class="mx-auto flex h-[100vh] max-w-[1800px] flex-col p-4">
		<IiifWorkspace
			transcriptionId={transcription._djazzkit_id}
			{transcriptionTitle}
			initialManifestSourceId={initialManifestSourceId}
			{pages}
			{activePageId}
			{selectionQuote}
			restoreState={restoreState}
			onRequestPageJump={pageId => postToOpener({ type: 'popup-page-jump', pageId })}
			onViewerStateChange={viewerState =>
				postToOpener({
					type: 'popup-viewer-state',
					viewerState,
				})}
		/>
	</div>
{/if}
