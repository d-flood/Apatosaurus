<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		checkStoragePersistence,
		formatStorageBytes,
		getInstallCapabilityReport,
		getStorageEstimate,
		isLocalFolderProviderSupported,
		isOpfsSupported,
		requestPersistentStorageForMeaningfulWrite,
		shouldShowDurabilityWarning,
		type StorageEstimateReport,
		type StoragePersistenceReport,
	} from '$lib/client/capabilities';
	import { listProjects, type ProjectOption } from '$lib/client/collation/project-collation';
	import {
		deriveProjectBackupSummary,
		exportAllProjectsZip,
		rebuildLocalIndex,
		restoreOrphanPrimary,
		subscribeLocalDbInvalidations,
	} from '$lib/client/db/client';
	import { ensureLocalDbRuntime } from '$lib/client/db/runtime';
	import { downloadZipArchive } from '$lib/client/download-blob';
	import { listSyncTargets, recordProjectZipExport } from '$lib/client/store';
	import { LOCAL_FOLDER_ROOT_FOLDER_ID } from '$lib/client/sync/providers/local-folder-provider';
	import type { ProjectBackupSummary } from '$lib/client/sync/sync-manager';
	import {
		CORPUS_APPROXIMATE_BYTES,
		hasCorpusStorageHeadroom,
		type WarmProgress,
	} from '$lib/client/offline-cache-policy';
	import {
		getCorpusCacheEntryCount,
		getOfflineCacheSize,
		onCacheWarmProgress,
		releaseCorpusCache,
		requestCacheWarmNow,
	} from '$lib/client/sw-registration';
	import IndexRepairReport from '$lib/components/projects/IndexRepairReport.svelte';
	import OnboardingGuidance from '$lib/components/OnboardingGuidance.svelte';
	import type { IndexRebuildReport } from '$lib/client/db/repositories/index-rebuild';
	import { onMount } from 'svelte';

	type BackupStatusKey =
		| 'local-only'
		| 'backed-up'
		| 'pending-backup'
		| 'blocked'
		| 'remote-update'
		| 'conflict'
		| 'unavailable';

	interface ProjectListBackupSummary {
		statusLabel: string;
		badgeClass: string;
		statusKey: BackupStatusKey;
	}

	let projects = $state.raw<ProjectOption[]>([]);
	let projectBackupSummaries = $state.raw<Record<string, ProjectListBackupSummary>>({});
	let persistenceReport = $state<StoragePersistenceReport | null>(null);
	let storageEstimateReport = $state<StorageEstimateReport | null>(null);
	let installSupported = $state(false);
	let isLoading = $state(true);
	let isRequestingPersistence = $state(false);
	let persistenceRequestMessage = $state<string | null>(null);
	let persistenceRequestFailed = $state(false);
	let hasRequestedPersistence = $state(false);
	let isRepairingIndex = $state(false);
	let isExportingAllProjects = $state(false);
	let exportAllError = $state<string | null>(null);
	let lastAllProjectsExportedAt = $state<string | null>(null);
	let indexRepairError = $state<string | null>(null);
	let indexRepairReport = $state<IndexRebuildReport | null>(null);
	let restoringOrphanPath = $state<string | null>(null);
	let dismissedDurabilityMilestone = $state<string | null>(readDismissedDurabilityMilestone());
	let backupSummaryRunId = 0;
	let routesWarmProgress = $state<WarmProgress>({
		tier: 'routes',
		state: 'idle',
		completed: 0,
		total: 0,
		bytesCached: null,
	});
	let offlineCacheBytes = $state<number | null>(null);
	let corpusCacheEntryCount = $state(0);
	let corpusWarmProgress = $state<WarmProgress>({
		tier: 'corpus',
		state: 'idle',
		completed: 0,
		total: 0,
		bytesCached: null,
	});
	let corpusMessage = $state<string | null>(null);
	let isReleasingCorpus = $state(false);

	let storageOverview = $derived.by(() => {
		const summaries = projects
			.map(project => projectBackupSummaries[project.id])
			.filter(Boolean);
		return {
			linkedCount: summaries.filter(summary => summary.statusKey !== 'local-only').length,
			backedUpCount: summaries.filter(summary => summary.statusKey === 'backed-up').length,
			attentionCount: summaries.filter(summary =>
				['pending-backup', 'blocked', 'remote-update', 'conflict', 'unavailable'].includes(
					summary.statusKey
				)
			).length,
		};
	});
	let currentDurabilityMilestone = $derived(`projects:${projects.length}`);
	let showDurabilityWarning = $derived(
		shouldShowDurabilityWarning({
			hasUserData: projects.length > 0,
			persistenceStatus: persistenceReport?.status ?? 'unsupported',
			dismissedMilestone: dismissedDurabilityMilestone,
			currentMilestone: currentDurabilityMilestone,
		})
	);
	let storageUsageLabel = $derived(formatStorageBytes(storageEstimateReport?.usage ?? null));
	let storageQuotaLabel = $derived(formatStorageBytes(storageEstimateReport?.quota ?? null));
	let storageUsagePercentLabel = $derived(
		storageEstimateReport?.usageRatio == null
			? 'Unavailable'
			: `${Math.round(storageEstimateReport.usageRatio * 100)}%`
	);
	let offlineCacheSizeLabel = $derived(formatStorageBytes(offlineCacheBytes));
	let corpusApproximateSizeLabel = $derived(formatStorageBytes(CORPUS_APPROXIMATE_BYTES));
	let corpusCached = $derived(corpusCacheEntryCount > 0);

	async function bootstrap() {
		isLoading = true;
		try {
			await ensureLocalDbRuntime();
			projects = await listProjects();
			await Promise.all([refreshStorageCapabilities(), loadProjectBackupSummaries(projects)]);
		} finally {
			isLoading = false;
		}
	}

	async function refreshStorageCapabilities() {
		[persistenceReport, storageEstimateReport] = await Promise.all([
			checkStoragePersistence(),
			getStorageEstimate(),
		]);
	}

	async function refreshOfflineCacheSize() {
		offlineCacheBytes = await getOfflineCacheSize();
	}

	async function refreshCorpusCacheState() {
		corpusCacheEntryCount = await getCorpusCacheEntryCount();
	}

	async function prepareForOffline() {
		await requestCacheWarmNow('routes');
	}

	async function prepareCorpusForOffline() {
		corpusMessage = null;
		const estimate = await getStorageEstimate();
		if (!hasCorpusStorageHeadroom(estimate)) {
			corpusMessage = `There is not enough browser storage for the approximately ${corpusApproximateSizeLabel} reference edition download.`;
			return;
		}
		await requestCacheWarmNow('corpus');
	}

	async function releaseReferenceEditions() {
		isReleasingCorpus = true;
		try {
			await releaseCorpusCache();
			corpusWarmProgress = {
				tier: 'corpus',
				state: 'idle',
				completed: 0,
				total: 0,
				bytesCached: null,
			};
			corpusMessage = null;
			await Promise.all([refreshCorpusCacheState(), refreshOfflineCacheSize()]);
		} finally {
			isReleasingCorpus = false;
		}
	}

	function corpusWarmStatus(): string {
		if (corpusWarmProgress.state === 'warming') {
			return `Downloading: ${corpusWarmProgress.completed} of ${corpusWarmProgress.total}`;
		}
		if (corpusWarmProgress.state === 'ready') return 'Available offline';
		if (corpusWarmProgress.state === 'partial') {
			return `Download incomplete: ${corpusWarmProgress.completed} of ${corpusWarmProgress.total}`;
		}
		if (corpusWarmProgress.state === 'failed') return 'Download failed';
		if (corpusWarmProgress.state === 'skipped')
			return warmSkipReason(corpusWarmProgress.reason);
		return corpusCached ? 'Cached for offline use' : 'Not downloaded';
	}

	function routeWarmStatus(progress: WarmProgress): string {
		if (progress.state === 'warming') {
			return `Warming now: ${progress.completed} of ${progress.total}`;
		}
		if (progress.state === 'ready') return 'Fully warmed';
		if (progress.state === 'partial') {
			return `Offline preparation incomplete: ${progress.completed} of ${progress.total}`;
		}
		if (progress.state === 'failed') return 'Offline preparation failed';
		if (progress.state === 'skipped') return `Shell only; ${warmSkipReason(progress.reason)}`;
		return 'Shell only';
	}

	function warmSkipReason(reason: WarmProgress['reason']): string {
		if (reason === 'save-data') return 'skipped on a metered connection';
		if (reason === 'slow-network') return 'skipped on a slow connection';
		if (reason === 'quota') return 'skipped because browser storage is nearly full';
		return 'background preparation was skipped';
	}

	async function requestPersistentStorage() {
		isRequestingPersistence = true;
		persistenceRequestMessage = null;
		persistenceRequestFailed = false;
		try {
			persistenceReport = await requestPersistentStorageForMeaningfulWrite();
			hasRequestedPersistence = true;
			persistenceRequestMessage =
				persistenceReport.status === 'granted'
					? 'Persistent storage granted. Local project files are protected from automatic browser eviction.'
					: 'This browser did not grant persistent storage. Installing the app and using it regularly may improve eligibility; keep external backups in the meantime.';
		} catch (cause) {
			persistenceRequestFailed = true;
			persistenceRequestMessage =
				cause instanceof Error
					? `Persistent storage could not be requested: ${cause.message}`
					: 'Persistent storage could not be requested.';
		} finally {
			isRequestingPersistence = false;
		}
	}

	async function loadProjectBackupSummaries(projectRows: ProjectOption[] = projects) {
		const runId = ++backupSummaryRunId;
		try {
			const entries = await Promise.all(
				projectRows.map(async project => {
					const targets = await listSyncTargets(project.id);
					const target =
						targets.find(candidate => candidate.enabled) ?? targets[0] ?? null;
					if (!target) {
						return [
							project.id,
							{
								statusLabel: 'Local only',
								badgeClass: 'badge-ghost',
								statusKey: 'local-only',
							},
						] as const;
					}
					const summary = await deriveProjectBackupSummary({
						projectId: project.id,
						connectionId: target.targetId,
						cloudFolderId: LOCAL_FOLDER_ROOT_FOLDER_ID,
						cloudFolderPath: '',
					});
					return [project.id, summarizeProjectBackup(summary)] as const;
				})
			);
			if (runId === backupSummaryRunId) projectBackupSummaries = Object.fromEntries(entries);
		} catch (cause) {
			if (runId !== backupSummaryRunId) return;
			console.warn('[data-route] project backup summary load failed', {
				error: cause instanceof Error ? cause.message : String(cause),
			});
			projectBackupSummaries = Object.fromEntries(
				projectRows.map(project => [
					project.id,
					{
						statusLabel: 'Sync unavailable',
						badgeClass: 'badge-warning',
						statusKey: 'unavailable',
					},
				])
			);
		}
	}

	function summarizeProjectBackup(summary: ProjectBackupSummary): ProjectListBackupSummary {
		if (summary.remoteManifestState === 'remote-update-available') {
			return {
				statusLabel: 'Remote update available',
				badgeClass: 'badge-warning',
				statusKey: 'remote-update',
			};
		}
		if (summary.remoteManifestState === 'diverged') {
			return {
				statusLabel: 'Sync conflict',
				badgeClass: 'badge-error',
				statusKey: 'conflict',
			};
		}
		if (summary.remoteManifestState === 'unavailable') {
			return {
				statusLabel: 'Sync unavailable',
				badgeClass: 'badge-warning',
				statusKey: 'unavailable',
			};
		}
		if (summary.blockingItems.length > 0) {
			return {
				statusLabel: 'Commit before sync',
				badgeClass: 'badge-warning',
				statusKey: 'blocked',
			};
		}
		if (summary.pendingItems.length > 0 || summary.tombstones.length > 0) {
			return {
				statusLabel: 'Pending sync',
				badgeClass: 'badge-info',
				statusKey: 'pending-backup',
			};
		}
		return { statusLabel: 'Synced', badgeClass: 'badge-success', statusKey: 'backed-up' };
	}

	async function exportAllProjectArchives() {
		if (isExportingAllProjects) return;
		isExportingAllProjects = true;
		exportAllError = null;
		try {
			const result = await exportAllProjectsZip(false);
			for (const archive of result.archives)
				downloadZipArchive(archive.fileName, archive.bytes);
			await Promise.all(
				projects
					.filter(project =>
						result.archives.some(archive => archive.storageSlug === project.storageSlug)
					)
					.map(project => recordProjectZipExport(project.id, result.exportedAt))
			);
			lastAllProjectsExportedAt = result.exportedAt;
			if (result.invalidProjects.length > 0) {
				exportAllError = result.invalidProjects
					.map(project => `${project.storageSlug}: ${project.message}`)
					.join(' ');
			}
		} catch (cause) {
			exportAllError =
				cause instanceof Error ? cause.message : 'Failed to export all projects.';
		} finally {
			isExportingAllProjects = false;
		}
	}

	async function repairLocalIndex() {
		if (isRepairingIndex) return;
		isRepairingIndex = true;
		indexRepairError = null;
		try {
			indexRepairReport = await rebuildLocalIndex();
			await bootstrap();
		} catch (cause) {
			indexRepairError = cause instanceof Error ? cause.message : 'Failed to repair database';
		} finally {
			isRepairingIndex = false;
		}
	}

	async function restoreIndexOrphan(path: string) {
		if (restoringOrphanPath) return;
		restoringOrphanPath = path;
		indexRepairError = null;
		try {
			indexRepairReport = await restoreOrphanPrimary(path);
			await bootstrap();
		} catch (cause) {
			indexRepairError =
				cause instanceof Error ? cause.message : 'Failed to restore orphaned file';
		} finally {
			restoringOrphanPath = null;
		}
	}

	function dismissDurabilityWarning() {
		dismissedDurabilityMilestone = currentDurabilityMilestone;
		try {
			localStorage.setItem(
				'apatosaurus:durability-warning-dismissed-milestone',
				currentDurabilityMilestone
			);
		} catch {
			// The warning can return on the next load when localStorage is unavailable.
		}
	}

	function readDismissedDurabilityMilestone(): string | null {
		try {
			return (
				globalThis.localStorage?.getItem(
					'apatosaurus:durability-warning-dismissed-milestone'
				) ?? null
			);
		} catch {
			return null;
		}
	}

	function persistenceStatusLabel(report: StoragePersistenceReport | null): string {
		if (!report) return 'Checking';
		if (report.status === 'granted') return 'Protected from browser eviction';
		if (report.status === 'denied')
			return report.canRequest ? 'Not yet granted' : 'Not granted';
		return 'Unsupported by this browser';
	}

	function formatDate(value: string): string {
		return new Date(value).toLocaleString();
	}

	onMount(() => {
		installSupported = getInstallCapabilityReport().installSupported;
		void bootstrap();
		void refreshOfflineCacheSize();
		void refreshCorpusCacheState();
		const refreshCacheState = () => {
			void refreshCorpusCacheState();
			void refreshOfflineCacheSize();
		};
		window.addEventListener('focus', refreshCacheState);
		const unsubscribeWarmProgress = onCacheWarmProgress(progress => {
			if (progress.tier === 'routes') routesWarmProgress = progress;
			if (progress.tier === 'corpus') {
				corpusWarmProgress = progress;
				corpusCacheEntryCount = progress.completed;
			}
			if (progress.state !== 'warming') void refreshOfflineCacheSize();
		});
		const unsubscribeDb = subscribeLocalDbInvalidations(event => {
			if (event.domain === 'projects' || event.domain === 'all') void bootstrap();
			else if (event.domain === 'sync-targets') void loadProjectBackupSummaries();
		});
		return () => {
			window.removeEventListener('focus', refreshCacheState);
			unsubscribeWarmProgress();
			unsubscribeDb();
		};
	});
</script>

<svelte:head><title>Data & Storage</title></svelte:head>

<main class="container mx-auto max-w-5xl p-4">
	<header class="mb-6">
		<p class="text-sm font-semibold uppercase tracking-wide text-primary">
			App-wide data tools
		</p>
		<h1 class="font-serif text-3xl font-bold tracking-tight">Data & Storage</h1>
		<p class="mt-2 max-w-3xl text-sm leading-relaxed text-base-content/65">
			Review local durability, export all project files, and repair the rebuildable database
			index.
		</p>
	</header>

	<OnboardingGuidance
		localFolderSupported={isLocalFolderProviderSupported()}
		persistenceStatus={persistenceReport?.status ?? 'unsupported'}
		{installSupported}
	/>

	{#if showDurabilityWarning}
		<div class="alert alert-warning mt-6 items-start text-sm">
			<div>
				<div class="font-semibold">Browser storage is not persistent yet</div>
				<div>Your browser may evict local project files under storage pressure.</div>
			</div>
			<button type="button" class="btn btn-ghost btn-xs" onclick={dismissDurabilityWarning}
				>Dismiss</button
			>
		</div>
	{/if}

	<div class="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
		<div class="space-y-6">
			<section class="rounded-box border border-base-300/60 bg-base-100 p-5 shadow-sm">
				<h2 class="font-serif text-xl font-semibold">Offline Readiness</h2>
				<p class="mt-1 text-sm text-base-content/55">
					Prepare the application itself for use without a network connection. Project
					data is stored separately.
				</p>
				<div class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
					<div class="rounded-box bg-base-200/60 p-3">
						<div class="text-base-content/55">App shell</div>
						<div class="mt-1 font-medium text-success">Ready for offline startup</div>
					</div>
					<div class="rounded-box bg-base-200/60 p-3" aria-live="polite">
						<div class="text-base-content/55">All app pages</div>
						<div
							class="mt-1 font-medium"
							class:text-error={routesWarmProgress.state === 'failed'}
							class:text-warning={routesWarmProgress.state === 'partial' ||
								routesWarmProgress.reason === 'quota'}
							class:text-success={routesWarmProgress.state === 'ready'}
						>
							{routeWarmStatus(routesWarmProgress)}
						</div>
					</div>
				</div>
				<div class="mt-3 flex items-center justify-between gap-3 text-sm">
					<span class="text-base-content/55">Offline cache size</span>
					<span class="font-medium">{offlineCacheSizeLabel}</span>
				</div>
				<button
					type="button"
					class="btn btn-outline btn-sm mt-4 w-full"
					disabled={routesWarmProgress.state === 'warming'}
					onclick={prepareForOffline}
				>
					{routesWarmProgress.state === 'warming'
						? 'Preparing for offline...'
						: 'Prepare for offline now'}
				</button>

				<div class="divider my-4"></div>
				<div class="rounded-box bg-base-200/60 p-4 text-sm" aria-live="polite">
					<div class="flex items-start justify-between gap-4">
						<div>
							<h3 class="font-semibold">Reference editions</h3>
							<p class="mt-1 text-base-content/55">
								Opt in to use the bundled reference corpus without a network
								connection. Approximately {corpusApproximateSizeLabel}.
							</p>
						</div>
						<span class="badge badge-ghost shrink-0">Optional</span>
					</div>
					<div
						class="mt-3 font-medium"
						class:text-success={corpusWarmProgress.state === 'ready'}
						class:text-warning={corpusWarmProgress.state === 'partial' ||
							corpusWarmProgress.reason === 'quota'}
						class:text-error={corpusWarmProgress.state === 'failed'}
					>
						{corpusWarmStatus()}
					</div>
					{#if corpusWarmProgress.total > 0 && corpusWarmProgress.state === 'warming'}
						<progress
							class="progress progress-primary mt-2 w-full"
							value={corpusWarmProgress.completed}
							max={corpusWarmProgress.total}
						></progress>
					{/if}
					{#if corpusMessage}
						<div class="alert alert-warning mt-3 py-2 text-sm" role="status">
							{corpusMessage}
						</div>
					{/if}
					<div class="mt-3 flex flex-wrap gap-2">
						{#if !corpusCached || corpusWarmProgress.state === 'partial' || corpusWarmProgress.state === 'failed'}
							<button
								type="button"
								class="btn btn-primary btn-sm"
								disabled={corpusWarmProgress.state === 'warming'}
								onclick={prepareCorpusForOffline}
							>
								{corpusWarmProgress.state === 'partial' ||
								corpusWarmProgress.state === 'failed'
									? 'Retry reference edition download'
									: corpusWarmProgress.state === 'warming'
										? 'Downloading reference editions...'
										: 'Download reference editions'}
							</button>
						{/if}
						{#if corpusCached}
							<button
								type="button"
								class="btn btn-ghost btn-sm"
								disabled={isReleasingCorpus ||
									corpusWarmProgress.state === 'warming'}
								onclick={releaseReferenceEditions}
							>
								{isReleasingCorpus ? 'Releasing...' : 'Release reference editions'}
							</button>
						{/if}
					</div>
				</div>
			</section>

			<section class="rounded-box border border-base-300/60 bg-base-100 p-5 shadow-sm">
				<h2 class="font-serif text-xl font-semibold">Storage Durability</h2>
				<div class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
					<div class="rounded-box bg-base-200/60 p-3">
						<div class="text-base-content/55">Persistent storage</div>
						<div class="mt-1 font-medium">
							{persistenceStatusLabel(persistenceReport)}
						</div>
					</div>
					<div class="rounded-box bg-base-200/60 p-3">
						<div class="text-base-content/55">Origin private file system</div>
						<div class="mt-1 font-medium">
							{isOpfsSupported() ? 'Supported' : 'Unsupported'}
						</div>
					</div>
					<div class="rounded-box bg-base-200/60 p-3">
						<div class="text-base-content/55">Folder sync capability</div>
						<div class="mt-1 font-medium">
							{isLocalFolderProviderSupported() ? 'Supported' : 'Unavailable'}
						</div>
					</div>
					<div class="rounded-box bg-base-200/60 p-3">
						<div class="text-base-content/55">Storage used</div>
						<div class="mt-1 font-medium">
							{storageUsageLabel} of {storageQuotaLabel} ({storageUsagePercentLabel})
						</div>
					</div>
				</div>
				{#if persistenceReport?.status === 'denied' && persistenceReport.canRequest && !hasRequestedPersistence}
					<button
						type="button"
						class="btn btn-outline btn-sm mt-4"
						disabled={isRequestingPersistence}
						onclick={requestPersistentStorage}
					>
						{isRequestingPersistence ? 'Requesting...' : 'Request persistent storage'}
					</button>
				{/if}
				{#if persistenceRequestMessage}
					<div
						class="alert mt-4 text-sm {persistenceRequestFailed ||
						persistenceReport?.status !== 'granted'
							? 'alert-warning'
							: 'alert-success'}"
						role="status"
					>
						{persistenceRequestMessage}
					</div>
				{/if}
				{#if storageEstimateReport?.isNearQuota}
					<div class="alert alert-warning mt-4 text-sm">
						Storage is near this browser's reported quota. Export a backup before adding
						large batches.
					</div>
				{/if}
			</section>

			<section class="rounded-box border border-base-300/60 bg-base-100 p-5 shadow-sm">
				<h2 class="font-serif text-xl font-semibold">Project Backup Status</h2>
				<p class="mt-1 text-sm text-base-content/55">
					Open a project's backup page to configure or run folder sync.
				</p>
				{#if isLoading}
					<div class="mt-4 flex items-center gap-2 text-sm text-base-content/55">
						<span class="loading loading-spinner loading-sm"></span>Loading status...
					</div>
				{:else if projects.length === 0}
					<p class="mt-4 text-sm text-base-content/55">No projects yet.</p>
				{:else}
					<ul class="mt-4 divide-y divide-base-300/60">
						{#each projects as project (project.id)}
							{@const summary = projectBackupSummaries[project.id]}
							<li>
								<a
									href={resolve('/projects/[id]/backup', { id: project.id })}
									class="flex items-center justify-between gap-3 py-3 hover:text-primary"
								>
									<span class="font-medium">{project.name}</span>
									<span
										class="badge badge-sm {summary?.badgeClass ??
											'badge-ghost'}"
										>{summary?.statusLabel ?? 'Checking sync'}</span
									>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>

		<div class="space-y-6">
			<section class="rounded-box border border-base-300/60 bg-base-100 p-5 shadow-sm">
				<h2 class="font-serif text-xl font-semibold">Local Storage</h2>
				<div class="mt-4 grid grid-cols-2 gap-3 text-sm">
					<div class="rounded-box bg-base-200/60 p-3">
						<div class="text-2xl font-semibold">{projects.length}</div>
						<div class="text-xs text-base-content/55">Local projects</div>
					</div>
					<div class="rounded-box bg-base-200/60 p-3">
						<div class="text-2xl font-semibold">{storageOverview.linkedCount}</div>
						<div class="text-xs text-base-content/55">Sync folders</div>
					</div>
					<div class="rounded-box bg-base-200/60 p-3">
						<div class="text-2xl font-semibold text-success">
							{storageOverview.backedUpCount}
						</div>
						<div class="text-xs text-base-content/55">Synced</div>
					</div>
					<div class="rounded-box bg-base-200/60 p-3">
						<div
							class="text-2xl font-semibold"
							class:text-warning={storageOverview.attentionCount > 0}
						>
							{storageOverview.attentionCount}
						</div>
						<div class="text-xs text-base-content/55">Need attention</div>
					</div>
				</div>
			</section>

			<section class="rounded-box border border-base-300/60 bg-base-100 p-5 shadow-sm">
				<h2 class="font-serif text-xl font-semibold">Whole-Account Export</h2>
				<p class="mt-1 text-sm text-base-content/55">
					Download one independently restorable zip per project. Draft files stay local.
				</p>
				<button
					type="button"
					class="btn btn-outline btn-sm mt-4 w-full"
					disabled={isExportingAllProjects || projects.length === 0}
					onclick={exportAllProjectArchives}
				>
					{isExportingAllProjects ? 'Exporting...' : 'Export all projects'}
				</button>
				{#if exportAllError}<div class="alert alert-error mt-3 py-2 text-xs">
						{exportAllError}
					</div>{/if}
				{#if lastAllProjectsExportedAt}<p class="mt-2 text-xs text-base-content/50">
						Last exported {formatDate(lastAllProjectsExportedAt)}
					</p>{/if}
			</section>

			<section class="rounded-box border border-base-300/60 bg-base-100 p-5 shadow-sm">
				<h2 class="font-serif text-xl font-semibold">Repair Database</h2>
				<p class="mt-1 text-sm text-base-content/55">
					Rebuild the disposable SQLite index from project files. This does not delete
					canonical documents.
				</p>
				<button
					type="button"
					class="btn btn-outline btn-sm mt-4 w-full"
					disabled={isRepairingIndex}
					onclick={repairLocalIndex}
					>{isRepairingIndex ? 'Repairing...' : 'Repair database'}</button
				>
				{#if indexRepairError}<div class="alert alert-error mt-3 py-2 text-xs">
						{indexRepairError}
					</div>{/if}
				{#if indexRepairReport}
					<div class="mt-4">
						<IndexRepairReport
							report={indexRepairReport}
							restoringPath={restoringOrphanPath}
							onRestore={restoreIndexOrphan}
						/>
					</div>
				{/if}
			</section>
		</div>
	</div>
</main>
