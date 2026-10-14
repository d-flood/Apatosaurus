<script lang="ts">
	import FilePicker from '$lib/shell/components/FilePicker.svelte';
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
	} from '$lib/shell/capabilities';

	import {
		exportAllProjectsZip,
		rebuildLocalIndex,
		restoreReferenceEditionsArchive,
		restoreOrphanPrimary,
		subscribeLocalDbInvalidations,
		listProjects,
	} from '$lib/db/client';
	import { ensureLocalDbRuntime } from '$lib/db/runtime';
	import { downloadZipArchive } from '$lib/shell/download-blob';
	import { inspectUserReferenceEditions } from '$lib/reference-editions/user-reference-editions';
	import { recordProjectZipExport } from '$lib/storage/backup-metadata';
	import {
		loadProjectBackupOverviews,
		type ProjectBackupOverview,
	} from '$lib/backup/project-backup-overview';
	import {
		addDeviceLocation,
		addTeamLocation,
		browseTeamFolders,
		inspectGoogleTeamFolder,
		reconnectDeviceLocation,
		signOutAccount,
		type GoogleTeamFolder,
	} from '$lib/backup/location-connections';
	import { beginSignIn, issueToken, providerLabel } from '$lib/backup/storage-account-auth';
	import { signInCompletion } from '$lib/backup/sign-in-completion.svelte';
	import StorageSignInButtons from '$lib/backup/components/StorageSignInButtons.svelte';
	import {
		hasDriveScope,
		pickGoogleFolder,
		requestDriveAccess,
		teamLocationAccounts,
	} from '$lib/backup/google-team-locations';
	import type { FolderListing } from '$lib/backup/folder-browser';
	import { LOCATION_ROOT_FOLDER_ID } from '$lib/backup/providers/provider';
	import { syncService } from '$lib/backup/sync-service.svelte';
	import {
		syncStatusLabel,
		syncStatusReason,
		type SyncStatusState,
	} from '$lib/backup/sync-status';
	import { networkStatus } from '$lib/shell/network-status.svelte';
	import {
		listProjectLocations,
		listStorageAccounts,
		type ProjectLocation,
		type StorageAccount,
	} from '$lib/storage/project-locations';
	import { readAppSettings, saveAppSettings } from '$lib/storage/app-settings';
	import { readDeviceIdentity, saveDeviceName } from '$lib/storage/device-identity';
	import {
		CORPUS_APPROXIMATE_BYTES,
		hasCorpusStorageHeadroom,
		type WarmProgress,
	} from '$lib/shell/offline-cache-policy';
	import {
		getCorpusCacheEntryCount,
		getOfflineCacheSize,
		onCacheWarmProgress,
		releaseCorpusCache,
		requestCacheWarmNow,
	} from '$lib/shell/sw-registration';
	import IndexRepairReport from '$lib/project/components/IndexRepairReport.svelte';
	import OnboardingGuidance from '$lib/shell/components/OnboardingGuidance.svelte';
	import type { IndexRebuildReport } from '$lib/db/repositories/index-rebuild';
	import { onMount } from 'svelte';
	import type { ProjectOption } from '$lib/db/repositories/projects';

	let projects = $state.raw<ProjectOption[]>([]);
	let userReferenceEditionCount = $state(0);
	let projectBackupOverviews = $state.raw<Record<string, ProjectBackupOverview>>({});
	let locations = $state.raw<ProjectLocation[]>([]);
	let accounts = $state.raw<StorageAccount[]>([]);
	let handledDriveAccess = signInCompletion.lastCompleted;
	let signOutDialog = $state<HTMLDialogElement>();
	let signingOutAccount = $state<StorageAccount | null>(null);
	let removeOnSignOut = $state(false);
	let isSigningOut = $state(false);
	let signOutError = $state<string | null>(null);
	let authorName = $state('');
	let authorNameMessage = $state<string | null>(null);
	let deviceName = $state('');
	let deviceNameMessage = $state<string | null>(null);
	let isAddingLocation = $state(false);
	let reconnectingLocationId = $state<string | null>(null);
	let locationError = $state<string | null>(null);
	let teamDialog = $state<HTMLDialogElement>();
	let teamAccountId = $state('');
	let teamFolderId = $state(LOCATION_ROOT_FOLDER_ID);
	let teamListing = $state.raw<FolderListing | null>(null);
	let isBrowsingTeam = $state(false);
	let isAddingTeam = $state(false);
	let teamError = $state<string | null>(null);
	let googleFolder = $state.raw<GoogleTeamFolder | null>(null);
	let isPickingGoogleFolder = $state(false);
	const teamAccounts = $derived(teamLocationAccounts(accounts));
	const teamAccount = $derived(teamAccounts.find(account => account.id === teamAccountId));
	const teamFolderSegments = $derived(
		teamFolderId === LOCATION_ROOT_FOLDER_ID ? [] : teamFolderId.split('/')
	);
	let persistenceReport = $state<StoragePersistenceReport | null>(null);
	let storageEstimateReport = $state<StorageEstimateReport | null>(null);
	let installSupported = $state(false);
	let isLoading = $state(true);
	let initialDataError = $state<string | null>(null);
	let isRequestingPersistence = $state(false);
	let persistenceRequestMessage = $state<string | null>(null);
	let persistenceRequestFailed = $state(false);
	let hasRequestedPersistence = $state(false);
	let isRepairingIndex = $state(false);
	let isExportingAllProjects = $state(false);
	let exportAllError = $state<string | null>(null);
	let isRestoringReferenceEditions = $state(false);
	let restoreReferenceEditionsMessage = $state<string | null>(null);
	let restoreReferenceEditionsError = $state<string | null>(null);
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
			.map(project => projectBackupOverviews[project.id])
			.filter(Boolean);
		return {
			linkedCount: summaries.filter(summary => summary.status !== 'local-only').length,
			backedUpCount: summaries.filter(summary => summary.status === 'backed-up').length,
			attentionCount: summaries.filter(summary =>
				['pending', 'unavailable'].includes(summary.status)
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
		initialDataError = null;
		try {
			await ensureLocalDbRuntime();
			projects = await listProjects();
			const inspection = await inspectUserReferenceEditions();
			userReferenceEditionCount = inspection.editions.length;
			if (inspection.invalidPaths.length > 0) {
				initialDataError = `${inspection.invalidPaths.length} stored reference edition${inspection.invalidPaths.length === 1 ? ' is' : 's are'} corrupt. Restore from a backup.`;
			}
			await Promise.all([
				refreshStorageCapabilities(),
				loadProjectBackupSummaries(projects),
				loadLocations(),
			]);
		} catch (cause) {
			initialDataError =
				cause instanceof Error
					? cause.message
					: 'Local storage status could not be loaded.';
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
			corpusMessage = `Not enough browser storage for the ${corpusApproximateSizeLabel} download.`;
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
					? 'Persistent storage granted.'
					: 'This browser did not grant persistent storage. Keep backups; installing the app may help.';
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

	async function loadLocations() {
		[locations, accounts] = await Promise.all([listProjectLocations(), listStorageAccounts()]);
	}

	function accountLabel(location: ProjectLocation): string {
		const account = accountFor(location);
		return account
			? `${providerLabel(account.provider)} · ${account.displayName}`
			: 'Signed-out account';
	}

	function accountFor(location: ProjectLocation): StorageAccount | undefined {
		return accounts.find(account => account.id === location.accountId);
	}

	function accountNeedsReconnect(accountId: string): boolean {
		return locations.some(
			location => location.accountId === accountId && locationNeedsReconnect(location.id)
		);
	}

	$effect(() => {
		const completed = signInCompletion.lastCompleted;
		if (completed?.driveAccess && completed !== handledDriveAccess) {
			handledDriveAccess = completed;
			void continueDriveAccess(completed.accountId);
		}
	});

	async function continueDriveAccess(accountId: string) {
		await loadLocations();
		const account = teamAccounts.find(candidate => candidate.id === accountId);
		if (account && hasDriveScope(account)) {
			openTeamLocation(account.id);
			void chooseGoogleFolder();
		}
	}

	function openSignOut(account: StorageAccount) {
		signingOutAccount = account;
		removeOnSignOut = false;
		signOutError = null;
		signOutDialog?.showModal();
	}

	async function confirmSignOut(event: SubmitEvent) {
		event.preventDefault();
		if (!signingOutAccount || isSigningOut) return;
		isSigningOut = true;
		signOutError = null;
		try {
			await signOutAccount(signingOutAccount.id, removeOnSignOut);
			signOutDialog?.close();
		} catch (cause) {
			signOutError = cause instanceof Error ? cause.message : 'Sign-out did not complete.';
		} finally {
			isSigningOut = false;
			await loadLocations();
		}
	}

	async function loadAuthorName() {
		authorName = (await readAppSettings()).authorName ?? '';
	}

	async function saveAuthorName(event: SubmitEvent) {
		event.preventDefault();
		await saveAppSettings({ authorName });
		authorNameMessage = 'Saved';
	}

	async function loadDeviceName() {
		deviceName = (await readDeviceIdentity()).deviceName;
	}

	async function submitDeviceName(event: SubmitEvent) {
		event.preventDefault();
		deviceName = (await saveDeviceName(deviceName)).deviceName;
		deviceNameMessage = 'Saved';
	}

	function locationNeedsReconnect(locationId: string): boolean {
		return Object.values(projectBackupOverviews).some(
			overview =>
				overview.placement?.locationId === locationId &&
				syncService.reconnectProjectIds.includes(overview.projectId)
		);
	}

	async function addFolderLocation() {
		isAddingLocation = true;
		locationError = null;
		try {
			await addDeviceLocation();
			await loadLocations();
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') return;
			locationError = cause instanceof Error ? cause.message : 'Failed to add the folder.';
		} finally {
			isAddingLocation = false;
		}
	}

	function openTeamLocation(accountId = teamAccounts[0]?.id ?? '') {
		teamAccountId = accountId;
		teamDialog?.showModal();
		selectTeamAccount();
	}

	function selectTeamAccount() {
		teamError = null;
		googleFolder = null;
		if (teamAccount?.provider === 'dropbox') void browseTeam(LOCATION_ROOT_FOLDER_ID);
	}

	async function chooseGoogleFolder() {
		const account = teamAccount;
		if (!account || isPickingGoogleFolder) return;
		if (!hasDriveScope(account)) {
			requestDriveAccess(account);
			return;
		}
		isPickingGoogleFolder = true;
		teamError = null;
		teamDialog?.close();
		try {
			const token = await issueToken(account.id, 'google', false);
			const folderId = await pickGoogleFolder(token.accessToken);
			if (folderId) googleFolder = await inspectGoogleTeamFolder(account.id, folderId);
		} catch (cause) {
			teamError = cause instanceof Error ? cause.message : 'The folder could not be opened.';
		} finally {
			isPickingGoogleFolder = false;
			teamDialog?.showModal();
		}
	}

	async function browseTeam(folderId: string) {
		teamFolderId = folderId;
		teamListing = null;
		teamError = null;
		isBrowsingTeam = true;
		try {
			teamListing = await browseTeamFolders(teamAccountId, folderId);
		} catch (cause) {
			teamError = cause instanceof Error ? cause.message : 'Folders could not be listed.';
		} finally {
			isBrowsingTeam = false;
		}
	}

	function browseTeamUp() {
		void browseTeam(teamFolderSegments.slice(0, -1).join('/') || LOCATION_ROOT_FOLDER_ID);
	}

	async function confirmTeamLocation(event: SubmitEvent) {
		event.preventDefault();
		const folderId =
			teamAccount?.provider === 'google'
				? googleFolder?.id
				: teamFolderId === LOCATION_ROOT_FOLDER_ID
					? undefined
					: teamFolderId;
		if (isAddingTeam || !folderId) return;
		isAddingTeam = true;
		teamError = null;
		try {
			await addTeamLocation(teamAccountId, folderId);
			teamDialog?.close();
			await loadLocations();
		} catch (cause) {
			teamError = cause instanceof Error ? cause.message : 'Failed to add the team location.';
		} finally {
			isAddingTeam = false;
		}
	}

	async function reconnectLocation(locationId: string) {
		reconnectingLocationId = locationId;
		locationError = null;
		try {
			await reconnectDeviceLocation(locationId);
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') return;
			locationError = cause instanceof Error ? cause.message : 'Failed to reconnect.';
		} finally {
			reconnectingLocationId = null;
		}
	}

	async function loadProjectBackupSummaries(projectRows: ProjectOption[] = projects) {
		const runId = ++backupSummaryRunId;
		try {
			const overviews = await loadProjectBackupOverviews(
				projectRows.map(project => project.id)
			);
			if (runId === backupSummaryRunId) projectBackupOverviews = overviews;
		} catch (cause) {
			if (runId !== backupSummaryRunId) return;
			console.warn('[data-route] project backup summary load failed', {
				error: cause instanceof Error ? cause.message : String(cause),
			});
			projectBackupOverviews = {};
		}
	}

	const statusBadgeClass: Record<SyncStatusState, string> = {
		synced: 'badge-success',
		'saved-on-device': 'badge-ghost',
		'needs-attention': 'badge-warning',
	};

	async function exportAllProjectArchives() {
		if (isExportingAllProjects) return;
		isExportingAllProjects = true;
		exportAllError = null;
		try {
			const result = await exportAllProjectsZip();
			for (const archive of result.archives)
				downloadZipArchive(archive.fileName, archive.bytes);
			if (result.referenceEditionsArchive) {
				downloadZipArchive(
					result.referenceEditionsArchive.fileName,
					result.referenceEditionsArchive.bytes
				);
			}
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

	async function restoreReferenceEditions(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || isRestoringReferenceEditions) return;
		isRestoringReferenceEditions = true;
		restoreReferenceEditionsMessage = null;
		restoreReferenceEditionsError = null;
		try {
			const result = await restoreReferenceEditionsArchive(
				new Uint8Array(await file.arrayBuffer())
			);
			userReferenceEditionCount = (await inspectUserReferenceEditions()).editions.length;
			restoreReferenceEditionsMessage = `Restored ${result.restored} reference edition${result.restored === 1 ? '' : 's'}; skipped ${result.skipped} already present. ${userReferenceEditionCount} available in the catalog.`;
		} catch (cause) {
			restoreReferenceEditionsError =
				cause instanceof Error ? cause.message : 'Failed to restore reference editions.';
		} finally {
			isRestoringReferenceEditions = false;
			input.value = '';
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
			// Warning reappears next load if localStorage is unavailable.
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
		if (report.status === 'granted') return 'Granted';
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
		void loadAuthorName();
		void loadDeviceName();
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
			else if (event.domain === 'sync-targets') {
				void loadProjectBackupSummaries();
				void loadLocations();
			}
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
		<h1 class="font-serif text-3xl font-bold tracking-tight">Data & Storage</h1>
	</header>
	{#if initialDataError}
		<div class="alert alert-error mb-6 text-sm" role="alert">{initialDataError}</div>
	{/if}

	<OnboardingGuidance
		localFolderSupported={isLocalFolderProviderSupported()}
		persistenceStatus={persistenceReport?.status ?? 'unsupported'}
		{installSupported}
	/>

	{#if showDurabilityWarning}
		<div class="alert alert-warning mt-6 items-start text-sm">
			<div>
				<div class="font-semibold">Storage isn't persistent</div>
				<div>The browser may delete local files when space runs low.</div>
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
				<p class="sr-only">Prepares the app to work without a network.</p>
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
								For offline use. Approximately {corpusApproximateSizeLabel}.
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
						Storage is nearly full. Export a backup before adding large batches.
					</div>
				{/if}
			</section>

			<section class="rounded-box border border-base-300/60 bg-base-100 p-5 shadow-sm">
				<h2 class="font-serif text-xl font-semibold">Storage accounts</h2>
				<p class="mt-1 text-sm text-base-content/55">
					Sync projects to an Apatosaurus folder in your cloud storage.
				</p>
				{#if signInCompletion.completing}
					<div class="mt-4 flex items-center gap-2 text-sm text-base-content/55">
						<span class="loading loading-spinner loading-sm"></span>Finishing sign-in...
					</div>
				{/if}
				{#if accounts.length > 0}
					<ul class="mt-4 divide-y divide-base-300/60">
						{#each accounts as account (account.id)}
							<li class="flex flex-wrap items-center justify-between gap-3 py-3">
								<div class="min-w-0">
									<div class="truncate font-medium">{account.displayName}</div>
									<div class="truncate text-xs text-base-content/55">
										{providerLabel(account.provider)} · {account.email}
									</div>
								</div>
								<div class="flex flex-wrap gap-2">
									{#if !account.signedIn}
										<span class="badge badge-ghost badge-sm self-center">
											Signed out
										</span>
										<button
											type="button"
											class="btn btn-outline btn-sm"
											onclick={() => beginSignIn(account.provider)}
										>
											Sign in
										</button>
									{:else}
										{#if accountNeedsReconnect(account.id)}
											<button
												type="button"
												class="btn btn-warning btn-sm"
												onclick={() => beginSignIn(account.provider)}
											>
												Reconnect
											</button>
										{/if}
										<button
											type="button"
											class="btn btn-ghost btn-sm"
											onclick={() => openSignOut(account)}
										>
											Sign out
										</button>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="mt-4">
					<StorageSignInButtons />
				</div>
				<form class="mt-5 space-y-2" onsubmit={saveAuthorName}>
					<label class="block text-sm font-medium" for="author-name"
						>Name on versions</label
					>
					<p id="author-name-hint" class="sr-only">
						Storage accounts use their own display name instead.
					</p>
					<div class="flex gap-2">
						<input
							id="author-name"
							aria-describedby="author-name-hint"
							class="input input-bordered input-sm min-w-0 flex-1"
							bind:value={authorName}
							oninput={() => (authorNameMessage = null)}
							autocomplete="name"
						/>
						<button type="submit" class="btn btn-sm">Save</button>
					</div>
					{#if authorNameMessage}
						<p class="text-xs text-success" role="status">{authorNameMessage}</p>
					{/if}
				</form>
			</section>

			<section class="rounded-box border border-base-300/60 bg-base-100 p-5 shadow-sm">
				<h2 class="font-serif text-xl font-semibold">Locations</h2>
				<p class="mt-1 text-sm text-base-content/55">Where projects live and sync.</p>
				<p class="sr-only">Projects already in a location download to this device.</p>
				{#if locationError}
					<div class="alert alert-error mt-3 py-2 text-sm" role="alert">
						{locationError}
					</div>
				{/if}
				{#if locations.length === 0}
					<p class="mt-4 text-sm text-base-content/55">No locations yet.</p>
				{:else}
					<ul class="mt-4 divide-y divide-base-300/60">
						{#each locations as location (location.id)}
							<li class="flex flex-wrap items-center justify-between gap-3 py-3">
								<div class="min-w-0">
									<div class="truncate font-medium">{location.displayPath}</div>
									<div class="text-xs text-base-content/55">
										{#if location.accountId}
											{location.kind === 'team'
												? 'Team · '
												: ''}{accountLabel(location)}
										{:else}
											Folder on this computer
										{/if}
									</div>
								</div>
								{#if !location.accountId && locationNeedsReconnect(location.id)}
									<button
										type="button"
										class="btn btn-warning btn-sm"
										disabled={reconnectingLocationId === location.id}
										onclick={() => reconnectLocation(location.id)}
									>
										Reconnect
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
				<div class="mt-4 grid gap-2 empty:hidden">
					{#if teamAccounts.length > 0}
						<button
							type="button"
							class="btn btn-outline btn-sm"
							onclick={() => openTeamLocation()}
						>
							Add team location
						</button>
					{/if}
					{#if isLocalFolderProviderSupported()}
						<button
							type="button"
							class="btn btn-outline btn-sm"
							disabled={isAddingLocation}
							onclick={addFolderLocation}
						>
							{isAddingLocation ? 'Adding folder...' : 'Add folder on this computer'}
						</button>
					{/if}
				</div>
			</section>

			<section class="rounded-box border border-base-300/60 bg-base-100 p-5 shadow-sm">
				<h2 class="font-serif text-xl font-semibold">This device</h2>
				<form class="mt-3 space-y-2" onsubmit={submitDeviceName}>
					<label class="block text-sm font-medium" for="device-name">Device name</label>
					<p id="device-name-hint" class="sr-only">
						Shown in editing notices when you edit on more than one device.
					</p>
					<div class="flex gap-2">
						<input
							id="device-name"
							aria-describedby="device-name-hint"
							class="input input-bordered input-sm min-w-0 flex-1"
							bind:value={deviceName}
							oninput={() => (deviceNameMessage = null)}
						/>
						<button type="submit" class="btn btn-sm">Save</button>
					</div>
					{#if deviceNameMessage}
						<p class="text-xs text-success" role="status">{deviceNameMessage}</p>
					{/if}
				</form>
			</section>

			<section class="rounded-box border border-base-300/60 bg-base-100 p-5 shadow-sm">
				<h2 class="font-serif text-xl font-semibold">Project Sync Status</h2>
				<p class="mt-1 text-sm text-base-content/55">
					Select a project to change its location.
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
							{@const projectStatus = syncService.projectStatus(
								project.id,
								networkStatus.online
							)}
							<li>
								<a
									href={resolve('/projects/[id]/location', { id: project.id })}
									class="flex items-center justify-between gap-3 py-3 hover:text-primary"
								>
									<span class="font-medium">{project.name}</span>
									<span
										class="badge badge-sm {statusBadgeClass[
											projectStatus.state
										]}"
										title={syncStatusReason(projectStatus)}
										>{syncStatusLabel(projectStatus)}</span
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
						<div class="text-xs text-base-content/55">In a location</div>
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
					One zip per project, plus your reference editions.
				</p>
				<p class="sr-only">Each zip restores on its own. Drafts are not included.</p>
				<button
					type="button"
					class="btn btn-outline btn-sm mt-4 w-full"
					disabled={isExportingAllProjects ||
						(projects.length === 0 && userReferenceEditionCount === 0)}
					onclick={exportAllProjectArchives}
				>
					{isExportingAllProjects ? 'Exporting...' : 'Export all projects'}
				</button>
				<div class="mt-2">
					<FilePicker
						label="Restore editions"
						accept=".zip,application/zip"
						disabled={isRestoringReferenceEditions}
						onchange={restoreReferenceEditions}
					/>
				</div>
				{#if exportAllError}<div class="alert alert-error mt-3 py-2 text-xs">
						{exportAllError}
					</div>{/if}
				{#if lastAllProjectsExportedAt}<p class="mt-2 text-xs text-base-content/50">
						Last exported {formatDate(lastAllProjectsExportedAt)}
					</p>{/if}
				{#if restoreReferenceEditionsError}<div class="alert alert-error mt-3 py-2 text-xs">
						{restoreReferenceEditionsError}
					</div>{/if}
				{#if restoreReferenceEditionsMessage}<p
						class="mt-2 text-xs text-success"
						role="status"
					>
						{restoreReferenceEditionsMessage}
					</p>{/if}
			</section>

			<section class="rounded-box border border-base-300/60 bg-base-100 p-5 shadow-sm">
				<h2 class="font-serif text-xl font-semibold">Repair Database</h2>
				<p class="mt-1 text-sm text-base-content/55">
					Rebuilds the app's index from your project files. Nothing is deleted.
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

<dialog
	bind:this={signOutDialog}
	class="modal"
	aria-label="Sign out"
	oncancel={event => isSigningOut && event.preventDefault()}
>
	<form class="modal-box w-full max-w-md space-y-3" onsubmit={confirmSignOut}>
		<h3 class="font-serif text-lg font-bold">Sign out of {signingOutAccount?.email}</h3>
		<p class="text-sm text-base-content/70">What should happen to this account's projects?</p>
		<label class="flex cursor-pointer items-start gap-3">
			<input
				type="radio"
				class="radio radio-sm mt-0.5"
				name="sign-out-projects"
				value={false}
				bind:group={removeOnSignOut}
				disabled={isSigningOut}
			/>
			<span>
				<span class="block text-sm font-medium">Keep on this device</span>
				<span class="block text-xs text-base-content/60">
					Stops syncing until you sign in again.
				</span>
			</span>
		</label>
		<label class="flex cursor-pointer items-start gap-3">
			<input
				type="radio"
				class="radio radio-sm mt-0.5"
				name="sign-out-projects"
				value={true}
				bind:group={removeOnSignOut}
				disabled={isSigningOut}
			/>
			<span>
				<span class="block text-sm font-medium">Remove from this device</span>
				<span class="block text-xs text-base-content/60">
					Deletes local copies only. Cloud copies are kept.
				</span>
			</span>
		</label>
		{#if signOutError}
			<p class="text-sm text-error" role="alert">{signOutError}</p>
		{/if}
		<div class="modal-action mt-2">
			<button
				type="button"
				class="btn btn-sm btn-ghost"
				disabled={isSigningOut}
				onclick={() => signOutDialog?.close()}
			>
				Cancel
			</button>
			<button type="submit" class="btn btn-sm btn-primary" disabled={isSigningOut}>
				{isSigningOut ? 'Signing out...' : 'Sign out'}
			</button>
		</div>
	</form>
</dialog>

<dialog
	bind:this={teamDialog}
	class="modal"
	aria-label="Add team location"
	oncancel={event => isAddingTeam && event.preventDefault()}
>
	<form class="modal-box w-full max-w-lg space-y-3" onsubmit={confirmTeamLocation}>
		<h3 class="font-serif text-lg font-bold">Add team location</h3>
		{#if teamAccounts.length > 1}
			<label class="block text-sm font-medium" for="team-account">Account</label>
			<select
				id="team-account"
				class="select select-bordered select-sm w-full"
				bind:value={teamAccountId}
				onchange={selectTeamAccount}
				disabled={isAddingTeam}
			>
				{#each teamAccounts as account (account.id)}
					<option value={account.id}>
						{providerLabel(account.provider)} · {account.displayName} · {account.email}
					</option>
				{/each}
			</select>
		{/if}
		{#if teamAccount?.provider === 'google'}
			<p class="text-sm text-base-content/70">Pick a shared Google Drive folder.</p>
			{#if !hasDriveScope(teamAccount)}
				<p class="text-sm text-base-content/70">
					Google will ask once for access to your Drive.
				</p>
			{/if}
			<div class="flex flex-wrap items-center gap-3">
				<button
					type="button"
					class="btn btn-outline btn-sm"
					disabled={isPickingGoogleFolder || isAddingTeam}
					onclick={chooseGoogleFolder}
				>
					{hasDriveScope(teamAccount) ? 'Choose folder' : 'Continue to Google'}
				</button>
				{#if googleFolder}
					<span class="min-w-0 truncate text-sm" aria-label="Chosen folder">
						{googleFolder.name}
					</span>
					{#if googleFolder.hasMarker}
						<span class="badge badge-primary badge-sm">Location</span>
					{/if}
				{/if}
			</div>
		{:else}
			<p class="text-sm text-base-content/70">Open a shared Dropbox folder.</p>
			<p class="sr-only">Folders marked Location already hold projects.</p>
			<div class="flex items-center gap-2">
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					disabled={teamFolderSegments.length === 0 || isBrowsingTeam || isAddingTeam}
					onclick={browseTeamUp}
				>
					Up
				</button>
				<span class="min-w-0 truncate font-mono text-sm" aria-label="Current folder">
					/{teamFolderSegments.join('/')}
				</span>
			</div>
			<ul
				class="max-h-72 divide-y divide-base-300/60 overflow-y-auto rounded-box border border-base-300/60"
				aria-label="Folders"
			>
				{#if isBrowsingTeam}
					<li class="flex items-center gap-2 p-3 text-sm text-base-content/55">
						<span class="loading loading-spinner loading-sm"></span>Loading folders...
					</li>
				{:else if teamListing && teamListing.folders.length === 0}
					<li class="p-3 text-sm text-base-content/55">No folders here.</li>
				{:else if teamListing}
					{#each teamListing.folders as folder (folder.id)}
						<li>
							<button
								type="button"
								class="flex w-full items-center justify-between gap-3 p-3 text-left text-sm hover:bg-base-200"
								disabled={isAddingTeam}
								onclick={() => browseTeam(folder.id)}
							>
								<span class="min-w-0 truncate">{folder.name}</span>
								{#if folder.hasMarker}
									<span class="badge badge-primary badge-sm">Location</span>
								{/if}
							</button>
						</li>
					{/each}
				{/if}
			</ul>
		{/if}
		{#if teamError}
			<p class="text-sm text-error" role="alert">{teamError}</p>
		{/if}
		<div class="modal-action mt-2 flex-wrap">
			<button
				type="button"
				class="btn btn-sm btn-ghost"
				disabled={isAddingTeam}
				onclick={() => teamDialog?.close()}
			>
				Cancel
			</button>
			<button
				type="submit"
				class="btn btn-sm btn-primary"
				disabled={isAddingTeam ||
					(teamAccount?.provider === 'google'
						? !googleFolder
						: !teamListing || teamFolderSegments.length === 0)}
			>
				{#if isAddingTeam}
					Adding...
				{:else if (teamAccount?.provider === 'google' ? googleFolder : teamListing)?.hasMarker}
					Add team location
				{:else}
					Make this a team location
				{/if}
			</button>
		</div>
	</form>
</dialog>
