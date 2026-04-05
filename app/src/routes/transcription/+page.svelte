<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { ensureDjazzkitRuntime } from '$lib/client/djazzkit-runtime';
	import {
		createTranscriptionRecords,
		formatTranscriptionFieldList,
		listMissingRequiredTranscriptionFields,
		type CreateTranscriptionInput,
	} from '$lib/client/transcription/create-transcription';
	import { getSyncClient, DjazzkitDatabase } from '@djazzkit/core';
	import {
		externalSyncService,
		type ExternalSyncState,
	} from '$lib/client/transcription/external-sync-service';
	import { fetchAndPrepareIgntpImport } from '$lib/client/transcription/igntp-import';
	import IgntpImportPanel from '$lib/components/IgntpImportPanel.svelte';
	import { buildTranscriptionDuplicateKey } from '$lib/igntp/duplicate-key';
	import { flattenIgntpCatalogEntries, igntpCatalog } from '$lib/igntp/catalog';
	import type { TranscriptionRecord } from '$lib/client/transcription/model';
	import Plus from 'phosphor-svelte/lib/Plus';
	import { Transcription } from '../../generated/models/Transcription';

	type IgntpImportResultStatus = 'created' | 'duplicate' | 'failed';

	interface IgntpImportResult {
		fileName: string;
		status: IgntpImportResultStatus;
		message: string;
	}

	interface IgntpImportProgress {
		completed: number;
		total: number;
		currentFile: string | null;
	}

	type TranscriptionTab = 'listing' | 'igntp';

	const IGntp_FETCH_TIMEOUT_MS = 20000;
	const TRANSCRIPTION_ROUTE_LOG_PREFIX = '[transcription-route]';
	const DEFAULT_TRANSCRIPTION_TAB: TranscriptionTab = 'listing';

	let transcriptions = $state<TranscriptionRecord[]>([]);
	let deleting = $state<string | null>(null);
	let externalSyncBusy = $state(false);
	let igntpImportBusy = $state(false);
	let igntpImportResults = $state<IgntpImportResult[]>([]);
	let loadError = $state<string | null>(null);
	let igntpImportProgress = $state<IgntpImportProgress>({
		completed: 0,
		total: 0,
		currentFile: null,
	});
	let externalSyncState = $state<ExternalSyncState>({
		supported: false,
		enabled: false,
		status: 'unsupported',
		directoryName: null,
		lastError: null,
		lastJsonPath: null,
		lastTeiPath: null,
	});
	let isLoading = $state(true);
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

	const igntpEntries = flattenIgntpCatalogEntries(igntpCatalog);
	const igntpEntryByPath = new Map(igntpEntries.map(entry => [entry.path, entry]));

	function normalizeTranscriptionTab(value: string | null): TranscriptionTab {
		return value === 'igntp' || value === 'listing' ? value : DEFAULT_TRANSCRIPTION_TAB;
	}

	const activeTab = $derived(normalizeTranscriptionTab(page.url.searchParams.get('tab')));

	function buildTabUrl(tab: TranscriptionTab): URL {
		const nextUrl = new URL(page.url);
		nextUrl.searchParams.set('tab', tab);
		return nextUrl;
	}

	async function setActiveTab(tab: TranscriptionTab) {
		if (page.url.searchParams.get('tab') === tab) {
			return;
		}
		await goto(buildTabUrl(tab), {
			replaceState: true,
			noScroll: true,
			keepFocus: true,
		});
	}

	$effect(() => {
		const requestedTab = page.url.searchParams.get('tab');
		const normalizedTab = normalizeTranscriptionTab(requestedTab);
		if (requestedTab === normalizedTab) {
			return;
		}
		void goto(buildTabUrl(normalizedTab), {
			replaceState: true,
			noScroll: true,
			keepFocus: true,
		});
	});

	const existingDuplicateKeys = $derived(
		transcriptions
			.map(transcription =>
				buildTranscriptionDuplicateKey({
					siglum: transcription.siglum,
					title: transcription.title,
				}),
			)
			.filter((key): key is string => !!key),
	);
	const igntpImportSummary = $derived.by(() => {
		if (igntpImportResults.length === 0) return null;
		const created = igntpImportResults.filter(result => result.status === 'created').length;
		const duplicates = igntpImportResults.filter(result => result.status === 'duplicate').length;
		const failed = igntpImportResults.filter(result => result.status === 'failed').length;
		return { created, duplicates, failed };
	});

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
			await ensureDjazzkitRuntime();
			await Transcription.objects.delete(id);
		} catch (err) {
			console.error('Failed to delete transcription:', err);
		} finally {
			deleting = null;
		}
	}

	$effect(() => {
		logTranscriptionRoute('debug', 'transcription list effect start', {});
		void runLoggedStep('ensureDjazzkitRuntime', () => ensureDjazzkitRuntime(), {})
			.then(async () => {
				logTranscriptionRoute('debug', 'ensureDjazzkitRuntime resolved for transcription list', {});
				const queryset = Transcription.objects
					.filter(f => f._djazzkit_deleted.eq(false))
					.orderBy(f => f.updated_at, 'desc')
					.only('_djazzkit_id', 'title', 'siglum', 'created_at', 'updated_at');
				unsubscribe = queryset.subscribe(rows => {
					transcriptions = rows;
					if (isLoading) {
						loadError = null;
						isLoading = false;
						logTranscriptionRoute('debug', 'transcription list initial load from subscribe', {
							rowCount: rows.length,
						});
					}
				});
				logTranscriptionRoute('debug', 'transcription list subscription attached', {});
			})
			.catch(err => {
				logTranscriptionRoute('error', 'transcription list bootstrap failed', {
					error: err instanceof Error ? err.message : String(err),
				});
				console.error('Failed to load transcriptions:', err);
				loadError =
					err instanceof Error ? err.message : 'Failed to load transcriptions.';
				isLoading = false;
			});
		void externalSyncService
			.init()
			.then(() => {
				unsubscribeExternalSync = externalSyncService.subscribe(state => {
					externalSyncState = state;
				});
			})
			.catch(err => {
				console.error('Failed to initialize external sync service:', err);
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

	async function handleIgntpImport(paths: string[]) {
		igntpImportBusy = true;
		igntpImportResults = [];
		igntpImportProgress = {
			completed: 0,
			total: paths.length,
			currentFile: null,
		};
		const knownDuplicateKeys = new Set(existingDuplicateKeys);
		const createdThisRun = new Set<string>();
		const results: IgntpImportResult[] = [];

		// Phase 1: Fetch, parse, and validate all TEI files
		const pendingCreates: { input: CreateTranscriptionInput; fileName: string; duplicateKey: string }[] = [];

		try {
			await ensureDjazzkitRuntime();

			for (const requestedPath of paths) {
				const entry = igntpEntryByPath.get(requestedPath);
				igntpImportProgress = {
					completed: results.length,
					total: paths.length,
					currentFile: entry?.fileName || requestedPath,
				};
				await tick();

				if (!entry) {
					results.push({
						fileName: requestedPath,
						status: 'failed',
						message: 'Catalog entry was not found.',
					});
					igntpImportResults = [...results];
					await tick();
					continue;
				}

				if (knownDuplicateKeys.has(entry.duplicateKey) || createdThisRun.has(entry.duplicateKey)) {
					results.push({
						fileName: entry.fileName,
						status: 'duplicate',
						message: 'Already imported.',
					});
					igntpImportResults = [...results];
					await tick();
					continue;
				}

				try {
					const fetchController = new AbortController();
					const prepared = await withTimeout(
						fetchAndPrepareIgntpImport(entry, { signal: fetchController.signal }),
						IGntp_FETCH_TIMEOUT_MS,
						`Timed out while loading ${entry.fileName}.`,
						() => fetchController.abort()
					);
					if (
						knownDuplicateKeys.has(prepared.duplicateKey) ||
						createdThisRun.has(prepared.duplicateKey)
					) {
						results.push({
							fileName: entry.fileName,
							status: 'duplicate',
							message: 'Already imported.',
						});
						igntpImportResults = [...results];
						await tick();
						continue;
					}

					const missingFields = listMissingRequiredTranscriptionFields(prepared.metadata);
					if (missingFields.length > 0) {
						results.push({
							fileName: entry.fileName,
							status: 'failed',
							message: `Missing required metadata: ${formatTranscriptionFieldList(missingFields)}`,
						});
						igntpImportResults = [...results];
						await tick();
						continue;
					}

					createdThisRun.add(prepared.duplicateKey);
					pendingCreates.push({
						input: {
							...prepared.metadata,
							document: prepared.document,
							description: '',
							isPublic: false,
							tags: [],
						},
						fileName: entry.fileName,
						duplicateKey: prepared.duplicateKey,
					});
				} catch (error) {
					console.error('IGNTP bulk import failed for entry:', entry.fileName, error);
					results.push({
						fileName: entry.fileName,
						status: 'failed',
						message: error instanceof Error ? error.message : 'Import failed.',
					});
				}

				igntpImportResults = [...results];
				igntpImportProgress = {
					completed: results.length,
					total: paths.length,
					currentFile: entry.fileName,
				};
				await tick();
			}

			// Phase 2: Bulk create all prepared transcriptions in chunked batches
			if (pendingCreates.length > 0) {
				igntpImportProgress = {
					completed: results.length,
					total: paths.length,
					currentFile: `Saving ${pendingCreates.length} transcriptions...`,
				};
				await tick();

				// Unsubscribe the list store during import to prevent refresh() from
				// running SELECT * (with large content_json) after each chunk.
				unsubscribe?.();
				unsubscribe = null;

				const syncClient = getSyncClient();
				syncClient?.setUploadsPaused(true);
				let savedCount = 0;
				try {
					await createTranscriptionRecords(
						pendingCreates.map(p => p.input),
						async (completedSoFar) => {
							// Mark items from the completed chunk as created
							while (savedCount < completedSoFar) {
								const pending = pendingCreates[savedCount];
								results.push({
									fileName: pending.fileName,
									status: 'created',
									message: `Imported ${pending.input.title}.`,
								});
								savedCount++;
							}
							igntpImportResults = [...results];
							igntpImportProgress = {
								completed: results.length,
								total: paths.length,
								currentFile: `Saving transcriptions (${completedSoFar}/${pendingCreates.length})...`,
							};
							await tick();
						}
					);

					// Mark any remaining (in case callback count didn't perfectly align)
					while (savedCount < pendingCreates.length) {
						const pending = pendingCreates[savedCount];
						results.push({
							fileName: pending.fileName,
							status: 'created',
							message: `Imported ${pending.input.title}.`,
						});
						savedCount++;
					}
				} catch (error) {
					console.error('IGNTP bulk create failed:', error);
					// Earlier chunks succeeded (already in results); remaining items failed
					for (let i = savedCount; i < pendingCreates.length; i++) {
						results.push({
							fileName: pendingCreates[i].fileName,
							status: 'failed',
							message: error instanceof Error ? error.message : 'Bulk save failed.',
						});
					}
				} finally {
					syncClient?.setUploadsPaused(false);
				}

				// Checkpoint before reloading to flush WAL after bulk writes.
				// Without this, the reload query can hang waiting on a large WAL.
				try {
					await DjazzkitDatabase.getInstance().checkpoint();
				} catch {
					// Non-critical: checkpoint failure doesn't affect data integrity
				}

				// Reload the transcription list and resubscribe
				try {
					const queryset = Transcription.objects
						.filter(f => f._djazzkit_deleted.eq(false))
						.orderBy(f => f.updated_at, 'desc')
						.only('_djazzkit_id', 'title', 'siglum', 'created_at', 'updated_at');
					unsubscribe = queryset.subscribe(rows => {
						transcriptions = rows;
					});
				} catch (reloadError) {
					console.error('Failed to reload transcription list after import:', reloadError);
				}
			}
		} finally {
			igntpImportResults = results;
			igntpImportProgress = {
				completed: results.length,
				total: paths.length,
				currentFile: null,
			};
			igntpImportBusy = false;
		}
	}

	function withTimeout<T>(
		promise: Promise<T>,
		timeoutMs: number,
		message: string,
		onTimeout?: () => void
	): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				onTimeout?.();
				reject(new Error(message));
			}, timeoutMs);

			promise.then(
				value => {
					clearTimeout(timeoutId);
					resolve(value);
				},
				error => {
					clearTimeout(timeoutId);
					reject(error);
				}
			);
		});
	}
</script>

<div class="container mx-auto max-w-4xl p-4 h-[calc(100dvh-5rem)] flex flex-col">
	<div class="flex justify-between items-center mb-6 shrink-0">
		<h1 class="text-2xl font-bold">Transcriptions</h1>
		<a href={resolve('/transcription/new')} class="btn btn-success">
			<Plus size="24px" class="mr-2" />
			New Transcription
		</a>
	</div>

	<div class="tabs tabs-box bg-base-200 mb-6 shrink-0">
		<button
			type="button"
			class="tab"
			class:tab-active={activeTab === 'listing'}
			onclick={() => void setActiveTab('listing')}
		>
			Transcriptions
		</button>
		<button
			type="button"
			class="tab"
			class:tab-active={activeTab === 'igntp'}
			onclick={() => void setActiveTab('igntp')}
		>
			IGNTP Import
		</button>
	</div>

	{#if activeTab === 'listing'}
		<div class="flex-1 min-h-0 flex flex-col">
			<div class="rounded-box border border-base-300 bg-base-100 p-4 mb-6 space-y-3 shrink-0">
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
					<p class="text-sm text-warning">
						Folder permission was revoked. Choose folder again.
					</p>
				{/if}
				{#if externalSyncState.lastError}
					<p class="text-sm text-error">{externalSyncState.lastError}</p>
				{/if}
			{/if}
		</div>

		{#if isLoading}
			<div class="text-center py-12 text-gray-500">
				<p>Loading transcriptions...</p>
			</div>
		{:else if loadError}
			<div class="alert alert-error mb-6">
				<span>Failed to load transcriptions: {loadError}</span>
			</div>
		{:else if transcriptions.length === 0}
			<div class="text-center py-12 text-gray-500">
				<p class="mb-4">No transcriptions yet</p>
				<a href={resolve('/transcription/new')} class="text-primary underline hover:underline-offset-2">
					Create your first transcription
				</a>
			</div>
		{:else}
			<ul class="list bg-base-300 rounded-lg overflow-y-auto flex-1 min-h-0">
				{#each transcriptions as transcription}
					<li class="list-row items-center flex flex-row align-center">
						<a href={resolve('/transcription/[id]', { id: transcription._djazzkit_id })} class="underline flex-1">
							<h2 class="text-lg font-semibold">{transcription.title}</h2>
						</a>
						<div class="text-sm text-base-content/80">
							Created: {new Date(transcription.created_at).toLocaleDateString()}
						</div>
						<button
							type="button"
							onclick={e => handleDelete(transcription._djazzkit_id, e)}
							disabled={deleting === transcription._djazzkit_id}
							class="btn btn-error"
						>
							{deleting === transcription._djazzkit_id ? 'Deleting...' : 'Delete'}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		</div>
	{:else}
		<div class="mb-6 space-y-4 flex-1 min-h-0 flex flex-col">
			<IgntpImportPanel
				catalog={igntpCatalog}
				importedKeys={existingDuplicateKeys}
				isImporting={igntpImportBusy}
				onImport={handleIgntpImport}
			/>

			{#if igntpImportBusy && igntpImportResults.length === 0}
				<div class="rounded-3xl border border-base-300/80 bg-base-100 p-4">
					<p class="text-sm text-base-content/75">
						Processing {igntpImportProgress.completed} of {igntpImportProgress.total}
						{#if igntpImportProgress.currentFile}
							: {igntpImportProgress.currentFile}
						{/if}
					</p>
				</div>
			{/if}

			{#if igntpImportSummary}
				<div
					class="rounded-3xl border p-4 {igntpImportSummary.failed > 0 ? 'border-warning/50 bg-warning/10' : 'border-success/40 bg-success/10'}"
				>
					{#if igntpImportBusy && igntpImportProgress.total > 0}
						<p class="mb-2 text-sm text-base-content/75">
							Processing {igntpImportProgress.completed} of {igntpImportProgress.total}
							{#if igntpImportProgress.currentFile}
								: {igntpImportProgress.currentFile}
							{/if}
						</p>
					{/if}
					<p class="font-semibold">
						Imported {igntpImportSummary.created}, skipped {igntpImportSummary.duplicates}, failed {igntpImportSummary.failed}.
					</p>
					{#if igntpImportResults.length > 0}
						<ul class="mt-3 space-y-2 text-sm">
							{#each igntpImportResults as result (result.fileName)}
								<li class="flex flex-wrap items-center gap-2">
									<span
										class="badge badge-sm {result.status === 'created' ? 'badge-success' : result.status === 'duplicate' ? 'badge-neutral' : 'badge-warning'}"
									>
										{result.status}
									</span>
									<span class="font-semibold">{result.fileName}</span>
									<span class="text-base-content/70">{result.message}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
