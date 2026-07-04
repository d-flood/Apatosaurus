<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		createTranscriptionRecords,
		formatTranscriptionFieldList,
		listMissingRequiredTranscriptionFields,
		type CreateTranscriptionInput,
	} from '$lib/client/transcription/create-transcription';
	import { checkpointLocalDb, ensureLocalDbRuntime } from '$lib/client/db/runtime';
	import {
		ensureDefaultProject,
		listProjects,
		listTranscriptionSummaries,
		subscribeLocalDbInvalidations,
	} from '$lib/client/db/client';
	import type { TranscriptionSummary } from '$lib/client/db/repositories/transcriptions';
	import type { ProjectOption } from '$lib/client/db/repositories/projects';
	import { fetchAndPrepareIgntpImport } from '$lib/client/transcription/igntp-import';
	import IgntpImportPanel from '$lib/components/IgntpImportPanel.svelte';
	import { buildTranscriptionDuplicateKey } from '$lib/igntp/duplicate-key';
	import { flattenIgntpCatalogEntries, igntpCatalog } from '$lib/igntp/catalog';

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

	const IGntp_FETCH_TIMEOUT_MS = 20000;

	let transcriptions = $state<TranscriptionSummary[]>([]);
	let projects = $state<ProjectOption[]>([]);
	let selectedProjectId = $state('');
	let igntpImportBusy = $state(false);
	let igntpImportResults = $state<IgntpImportResult[]>([]);
	let igntpImportProgress = $state<IgntpImportProgress>({
		completed: 0,
		total: 0,
		currentFile: null,
	});
	let unsubscribe: (() => void) | null = null;

	const igntpEntries = flattenIgntpCatalogEntries(igntpCatalog);
	const igntpEntryByPath = new Map(igntpEntries.map(entry => [entry.path, entry]));

	const existingDuplicateKeys = $derived(
		transcriptions
			.map(transcription =>
				buildTranscriptionDuplicateKey({
					siglum: transcription.siglum,
					title: transcription.title,
				})
			)
			.filter((key): key is string => !!key)
	);
	const igntpImportSummary = $derived.by(() => {
		if (igntpImportResults.length === 0) return null;
		const created = igntpImportResults.filter(result => result.status === 'created').length;
		const duplicates = igntpImportResults.filter(result => result.status === 'duplicate').length;
		const failed = igntpImportResults.filter(result => result.status === 'failed').length;
		return { created, duplicates, failed };
	});
	const hasIgntpImportStatus = $derived(
		(igntpImportBusy && igntpImportResults.length === 0) || !!igntpImportSummary
	);

	async function loadTranscriptionSummaries() {
		transcriptions = await listTranscriptionSummaries();
	}

	async function loadProjects() {
		const defaultProjectId = await ensureDefaultProject();
		projects = await listProjects();
		if (!selectedProjectId) selectedProjectId = defaultProjectId;
	}

	onMount(() => {
		unsubscribe = subscribeLocalDbInvalidations(event => {
			if (event.domain !== 'transcriptions' && event.domain !== 'all') return;
			void loadTranscriptionSummaries().catch(err => {
				console.error('Failed to reload transcriptions for IGNTP duplicate detection:', err);
			});
		});

		void ensureLocalDbRuntime()
			.then(async () => {
				await loadProjects();
				await loadTranscriptionSummaries();
			})
			.catch(err => {
				console.error('Failed to load transcriptions for IGNTP duplicate detection:', err);
			});

		return () => {
			unsubscribe?.();
			unsubscribe = null;
		};
	});

	async function handleIgntpImport(paths: string[]) {
		igntpImportBusy = true;
		igntpImportResults = [];
		igntpImportProgress = {
			completed: 0,
			total: paths.length,
			currentFile: null,
		};
		const knownDuplicateKeys = new Set(existingDuplicateKeys);
		const createdThisRun: string[] = [];
		const results: IgntpImportResult[] = [];

		const pendingCreates: {
			input: CreateTranscriptionInput;
			fileName: string;
			duplicateKey: string;
		}[] = [];

		try {
			await ensureLocalDbRuntime();
			if (!selectedProjectId) selectedProjectId = await ensureDefaultProject();

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

				if (knownDuplicateKeys.has(entry.duplicateKey) || createdThisRun.includes(entry.duplicateKey)) {
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
						createdThisRun.includes(prepared.duplicateKey)
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

					createdThisRun.push(prepared.duplicateKey);
					pendingCreates.push({
						input: {
							projectId: selectedProjectId,
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

			if (pendingCreates.length > 0) {
				igntpImportProgress = {
					completed: results.length,
					total: paths.length,
					currentFile: `Saving ${pendingCreates.length} transcriptions...`,
				};
				await tick();

				let savedCount = 0;
				try {
					await createTranscriptionRecords(
						pendingCreates.map(p => p.input),
						async completedSoFar => {
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
					for (let i = savedCount; i < pendingCreates.length; i++) {
						results.push({
							fileName: pendingCreates[i].fileName,
							status: 'failed',
							message: error instanceof Error ? error.message : 'Bulk save failed.',
						});
					}
				}

				try {
					await checkpointLocalDb();
				} catch {
					// Non-critical: checkpoint failure doesn't affect data integrity.
				}

				try {
					await loadTranscriptionSummaries();
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

{#snippet igntpImportStatus()}
	<div class="space-y-4">
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
{/snippet}

<div
	class="mb-6 flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:grid {hasIgntpImportStatus ? 'lg:grid-cols-[minmax(0,1fr)_22rem]' : 'lg:grid-cols-1'}"
>
	<div class="rounded-box border border-base-300 bg-base-100 p-4 lg:col-span-full">
		<label class="select w-full md:max-w-md">
			<span class="font-bold label">Import into project</span>
			<select bind:value={selectedProjectId} disabled={igntpImportBusy}>
				{#each projects as project (project.id)}
					<option value={project.id}>{project.name}</option>
				{/each}
			</select>
		</label>
	</div>

	{#if hasIgntpImportStatus}
		<div class="max-h-64 overflow-y-auto lg:hidden">
			{@render igntpImportStatus()}
		</div>
	{/if}

	<div class="min-h-0 flex-1 lg:h-full">
		<IgntpImportPanel
			catalog={igntpCatalog}
			importedKeys={existingDuplicateKeys}
			isImporting={igntpImportBusy}
			onImport={handleIgntpImport}
		/>
	</div>

	{#if hasIgntpImportStatus}
		<aside class="hidden min-h-0 overflow-y-auto lg:block">
			{@render igntpImportStatus()}
		</aside>
	{/if}
</div>
