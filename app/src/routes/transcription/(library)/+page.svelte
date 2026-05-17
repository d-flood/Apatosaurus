<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount, tick } from 'svelte';
	import { ensureLocalDbRuntime } from '$lib/client/db/runtime';
	import {
		deleteTranscription,
		listTranscriptionSummaries,
		subscribeLocalDbInvalidations,
	} from '$lib/client/db/client';
	import type { TranscriptionSummary } from '$lib/client/db/repositories/transcriptions';
	import {
		externalSyncService,
		type ExternalSyncState,
	} from '$lib/client/transcription/external-sync-service';

	const TRANSCRIPTION_ROUTE_LOG_PREFIX = '[transcription-route]';

	let transcriptions = $state<TranscriptionSummary[]>([]);
	let deleting = $state<string | null>(null);
	let externalSyncBusy = $state(false);
	let loadError = $state<string | null>(null);
	let externalSyncState = $state<ExternalSyncState>(externalSyncService.getState());
	let isLoading = $state(true);
	let renderCount = 0;
	let unsubscribe: (() => void) | null = null;
	let unsubscribeExternalSync: (() => void) | null = null;

	function logTranscriptionRoute(
		level: 'debug' | 'warn' | 'error',
		message: string,
		details?: Record<string, unknown>
	) {
		const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.debug;
		if (details && Object.keys(details).length > 0) {
			logger(`${TRANSCRIPTION_ROUTE_LOG_PREFIX} ${message}`, details);
			return;
		}
		logger(`${TRANSCRIPTION_ROUTE_LOG_PREFIX} ${message}`);
	}

	async function runLoggedStep<T>(
		label: string,
		step: () => Promise<T>,
		details?: Record<string, unknown>
	): Promise<T> {
		const startedAt = Date.now();
		logTranscriptionRoute('debug', `${label} start`, details);
		try {
			const result = await step();
			logTranscriptionRoute('debug', `${label} completed`, {
				...details,
				elapsedMs: Date.now() - startedAt,
			});
			return result;
		} catch (error) {
			logTranscriptionRoute('error', `${label} failed`, {
				...details,
				elapsedMs: Date.now() - startedAt,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	async function loadTranscriptionSummaries() {
		const listStartedAt = Date.now();
		const rows = await listTranscriptionSummaries();
		logTranscriptionRoute('debug', 'listTranscriptionSummaries round trip completed', {
			rowCount: rows.length,
			elapsedMs: Date.now() - listStartedAt,
		});
		const assignStartedAt = Date.now();
		transcriptions = rows;
		loadError = null;
		isLoading = false;
		renderCount += 1;
		await tick();
		logTranscriptionRoute('debug', 'transcription list assignment/render completed', {
			rowCount: rows.length,
			renderCount,
			elapsedMs: Date.now() - assignStartedAt,
		});
	}

	async function initExternalSync() {
		try {
			await externalSyncService.init();
			unsubscribeExternalSync = externalSyncService.subscribe(state => {
				externalSyncState = state;
			});
		} catch (err) {
			console.error('Failed to initialize external sync service:', err);
		}
	}

	async function handleDelete(id: string, event: Event) {
		event.preventDefault();
		event.stopPropagation();

		if (
			!confirm(
				'Are you sure you want to delete this transcription? This action cannot be undone.'
			)
		) {
			return;
		}

		deleting = id;

		try {
			await ensureLocalDbRuntime();
			await deleteTranscription(id);
			await loadTranscriptionSummaries();
		} catch (err) {
			console.error('Failed to delete transcription:', err);
		} finally {
			deleting = null;
		}
	}

	onMount(() => {
		logTranscriptionRoute('debug', 'transcription list effect start', {});
		unsubscribe = subscribeLocalDbInvalidations(event => {
			if (event.domain !== 'transcriptions' && event.domain !== 'all') return;
			void loadTranscriptionSummaries().catch(err => {
				console.error('Failed to reload transcriptions:', err);
				loadError = err instanceof Error ? err.message : 'Failed to load transcriptions.';
				isLoading = false;
			});
		});
		logTranscriptionRoute('debug', 'transcription list invalidation listener attached', {});

		const routeStartedAt = Date.now();
		void runLoggedStep('transcription list route load', async () => {
			await runLoggedStep('ensureLocalDbRuntime', () => ensureLocalDbRuntime());
			await loadTranscriptionSummaries();
		}, {})
			.then(() => {
				logTranscriptionRoute('debug', 'transcription list initial load completed', {
					rowCount: transcriptions.length,
					elapsedMs: Date.now() - routeStartedAt,
				});
				void initExternalSync();
			})
			.catch(err => {
				logTranscriptionRoute('error', 'transcription list bootstrap failed', {
					error: err instanceof Error ? err.message : String(err),
				});
				console.error('Failed to load transcriptions:', err);
				loadError =
					err instanceof Error ? err.message : 'Failed to load transcriptions.';
				isLoading = false;
				void initExternalSync();
			});

		return () => {
			unsubscribe?.();
			unsubscribeExternalSync?.();
			unsubscribe = null;
			unsubscribeExternalSync = null;
		};
	});

	async function handleChooseExternalDirectory() {
		externalSyncBusy = true;
		try {
			await externalSyncService.chooseDirectory();
		} catch (error) {
			console.error('Failed to choose external directory:', error);
		} finally {
			externalSyncBusy = false;
		}
	}

	async function handleDisableExternalDirectory() {
		externalSyncBusy = true;
		try {
			await externalSyncService.clear();
		} catch (error) {
			console.error('Failed to clear external directory:', error);
		} finally {
			externalSyncBusy = false;
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="rounded-box mb-6 shrink-0 space-y-3 border border-base-300 bg-base-100 p-4">
		<h2 class="text-lg font-semibold">External Folder Sync</h2>
		{#if !externalSyncState.supported}
			<p class="text-sm opacity-75">This browser does not support local directory access.</p>
		{:else}
			<p class="text-sm opacity-75">
				{#if externalSyncState.enabled}
					Enabled{externalSyncState.directoryName
						? `: ${externalSyncState.directoryName}`
						: ''}.
				{:else}
					Disabled.
				{/if}
			</p>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="btn btn-primary btn-sm"
					disabled={externalSyncBusy}
					onclick={handleChooseExternalDirectory}
				>
					{externalSyncBusy
						? 'Selecting...'
						: externalSyncState.enabled
							? 'Change Folder'
							: 'Choose Folder'}
				</button>
				<button
					type="button"
					class="btn btn-sm"
					disabled={!externalSyncState.enabled || externalSyncBusy}
					onclick={handleDisableExternalDirectory}
				>
					Disable
				</button>
			</div>
			{#if externalSyncState.status === 'processing'}
				<p class="text-sm opacity-75">Background mirror write in progress.</p>
			{:else if externalSyncState.status === 'permission_required'}
				<p class="text-sm text-warning">Folder permission was revoked. Choose folder again.</p>
			{/if}
			{#if externalSyncState.lastError}
				<p class="text-sm text-error">{externalSyncState.lastError}</p>
			{/if}
		{/if}
	</div>

	{#if isLoading}
		<div class="py-12 text-center text-gray-500">
			<p>Loading transcriptions...</p>
		</div>
	{:else if loadError}
		<div class="alert alert-error mb-6">
			<span>Failed to load transcriptions: {loadError}</span>
		</div>
	{:else if transcriptions.length === 0}
		<div class="py-12 text-center text-gray-500">
			<p class="mb-4">No transcriptions yet</p>
			<a href={resolve('/transcription/new')} class="text-primary underline hover:underline-offset-2">
				Create your first transcription
			</a>
		</div>
	{:else}
		<ul class="list min-h-0 flex-1 overflow-y-auto rounded-lg bg-base-300">
			{#each transcriptions as transcription (transcription.id)}
				<li class="list-row flex flex-row items-center align-center">
					<a href={resolve('/transcription/[id]', { id: transcription.id })} class="flex-1 underline">
						<h2 class="text-lg font-semibold">{transcription.title}</h2>
					</a>
					<div class="text-sm text-base-content/80">
						Created: {new Date(transcription.created_at).toLocaleDateString()}
					</div>
					<button
						type="button"
						onclick={e => handleDelete(transcription.id, e)}
						disabled={deleting === transcription.id}
						class="btn btn-error"
					>
						{deleting === transcription.id ? 'Deleting...' : 'Delete'}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
