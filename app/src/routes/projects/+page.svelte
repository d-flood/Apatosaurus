<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		addProjectTranscriptionFromProject,
		createProjectRecord,
		getProject,
		getProjectTranscriptionIds,
		listProjectCollationVersionStatuses,
		listProjects,
		listProjectTranscriptionSourceCandidates,
		listProjectTranscriptionStatuses,
		listTranscriptions,
		loadTranscriptionHands,
		refreshProjectTranscription,
		syncProjectTranscriptionIds,
		updateProjectMetadata,
		type ProjectOption,
		type ProjectRecord,
		type ProjectTranscriptionOption,
		type ProjectTranscriptionSourceCandidate,
		type ProjectTranscriptionStatus,
		type ProjectTranscriptionSourceState,
	} from '$lib/client/collation/project-collation';
	import {
		createProjectCollationSettings,
		parseProjectCollationSettings,
	} from '$lib/client/collation/project-settings';
	import type {
		RegularizationRule,
		RegularizationType,
		SuppliedTextMode,
		WitnessTreatment,
	} from '$lib/client/collation/collation-types';
	import ProjectCollationSettingsEditor from '$lib/components/projects/ProjectCollationSettingsEditor.svelte';
	import ProjectTranscriptionsEditor from '$lib/components/projects/ProjectTranscriptionsEditor.svelte';
	import ProjectTranscriptionVersionsPanel from '$lib/components/projects/ProjectTranscriptionVersionsPanel.svelte';
	import ProjectBackupPanel from '$lib/components/projects/ProjectBackupPanel.svelte';
	import ProjectZipImportPanel from '$lib/components/projects/ProjectZipImportPanel.svelte';
	import OnboardingGuidance from '$lib/components/OnboardingGuidance.svelte';
	import ProjectTranscriptionRefreshDialog from '$lib/components/projects/ProjectTranscriptionRefreshDialog.svelte';
	import AddProjectTranscriptionFromProjectDialog from '$lib/components/projects/AddProjectTranscriptionFromProjectDialog.svelte';
	import ProjectUserManagementStub from '$lib/components/projects/ProjectUserManagementStub.svelte';
	import IndexRepairReport from '$lib/components/projects/IndexRepairReport.svelte';
	import { waitForBrowserIdle } from '$lib/client/defer';
	import { ensureLocalDbRuntime } from '$lib/client/db/runtime';
	import {
		checkStoragePersistence,
		formatStorageBytes,
		getInstallCapabilityReport,
		getStorageEstimate,
		shouldShowDurabilityWarning,
		type StorageEstimateReport,
		type StoragePersistenceReport,
		isLocalFolderProviderSupported,
		isOpfsSupported,
	} from '$lib/client/capabilities';
	import {
		deriveProjectBackupSummary,
		exportAllProjectsZip,
		rebuildLocalIndex,
		restoreOrphanPrimary,
		subscribeLocalDbInvalidations,
	} from '$lib/client/db/client';
	import type { CollationVersionStatus } from '$lib/client/db/repositories/collations';
	import type { IndexRebuildReport } from '$lib/client/db/repositories/index-rebuild';
	import type { ProjectBackupSummary } from '$lib/client/sync/sync-manager';
	import { listSyncTargets, recordProjectZipExport } from '$lib/client/store';
	import { LOCAL_FOLDER_ROOT_FOLDER_ID } from '$lib/client/sync/providers/local-folder-provider';
	import { downloadZipArchive } from '$lib/client/download-blob';
	import FolderOpen from 'phosphor-svelte/lib/FolderOpen';
	import Plus from 'phosphor-svelte/lib/Plus';
	import { onMount } from 'svelte';

	const PROJECTS_LOG_PREFIX = '[projects-route]';
	type ProjectSection = 'transcriptions' | 'collations' | 'settings' | 'backup';

	interface ProjectListBackupSummary {
		locationLabel: string;
		statusLabel: string;
		badgeClass: string;
		statusKey:
			| 'local-only'
			| 'backed-up'
			| 'pending-backup'
			| 'blocked'
			| 'remote-update'
			| 'conflict'
			| 'unavailable';
	}

	let projects = $state.raw<ProjectOption[]>([]);
	let projectBackupSummaries = $state.raw<Record<string, ProjectListBackupSummary>>({});
	let allTranscriptions = $state.raw<ProjectTranscriptionOption[]>([]);
	let currentProject = $state<ProjectRecord | null>(null);
	let selectedProjectId = $state<string | null>(null);
	let selectedTranscriptionIds = $state.raw<string[]>([]);
	let activeSection = $state<ProjectSection>('transcriptions');

	let projectRules = $state<RegularizationRule[]>([]);
	let lowercase = $state(false);
	let ignoreWordBreaks = $state(false);
	let ignorePunctuation = $state(false);
	let suppliedTextMode = $state<SuppliedTextMode>('clear');
	let segmentation = $state(true);
	let transcriptionWitnessTreatments = $state<Map<string, WitnessTreatment>>(new Map());
	let transcriptionWitnessExcludedHands = $state<Map<string, string[]>>(new Map());

	let isBooting = $state(true);
	let isLoadingProject = $state(false);
	let isLoadingCollations = $state(false);
	let isLoadingTranscriptions = $state(false);
	let isCreating = $state(false);
	let isSavingMetadata = $state(false);
	let isSavingSettings = $state(false);
	let isSavingTranscriptions = $state(false);
	let isRepairingIndex = $state(false);
	let isExportingAllProjects = $state(false);
	let error = $state<string | null>(null);
	let exportAllError = $state<string | null>(null);
	let lastAllProjectsExportedAt = $state<string | null>(null);
	let indexRepairError = $state<string | null>(null);
	let indexRepairReport = $state<IndexRebuildReport | null>(null);
	let restoringOrphanPath = $state<string | null>(null);
	let persistenceReport = $state<StoragePersistenceReport | null>(null);
	let storageEstimateReport = $state<StorageEstimateReport | null>(null);
	let installSupported = $state(false);
	let dismissedDurabilityMilestone = $state<string | null>(readDismissedDurabilityMilestone());
	let bootstrapRunId = 0;
	let backupSummaryScheduleId = 0;
	let backupSummaryRunId = 0;

	let projectTranscriptionStatuses = $state.raw<ProjectTranscriptionStatus[]>([]);
	let projectCollationStatuses = $state.raw<CollationVersionStatus[]>([]);
	let isLoadingStatuses = $state(false);
	let refreshTarget = $state<ProjectTranscriptionStatus | null>(null);
	let isRefreshing = $state(false);
	let refreshError = $state<string | null>(null);
	let statusLoadRunId = 0;

	let showAddFromProject = $state(false);
	let addFromProjectCandidates = $state.raw<ProjectTranscriptionSourceCandidate[]>([]);
	let isLoadingCandidates = $state(false);
	let isAddingFromProject = $state(false);
	let addFromProjectError = $state<string | null>(null);

	let createName = $state('');
	let nameDraft = $state('');
	let descriptionDraft = $state('');
	let selectedProjectActionQuery = $derived(
		selectedProjectId ? `?projectId=${encodeURIComponent(selectedProjectId)}` : ''
	);

	let metadataDirty = $derived(
		Boolean(
			currentProject &&
			(nameDraft.trim() !== currentProject.name ||
				descriptionDraft.trim() !== currentProject.description)
		)
	);
	let projectCountLabel = $derived(
		`${projects.length} project${projects.length === 1 ? '' : 's'}`
	);
	let storageOverview = $derived.by(() => {
		const summaries = projects
			.map(project => projectBackupSummaries[project.id])
			.filter(Boolean);
		const linkedCount = summaries.filter(summary => summary.statusKey !== 'local-only').length;
		const backedUpCount = summaries.filter(summary => summary.statusKey === 'backed-up').length;
		const attentionCount = summaries.filter(summary =>
			['pending-backup', 'blocked', 'remote-update', 'conflict', 'unavailable'].includes(
				summary.statusKey
			)
		).length;
		return {
			localProjectCount: projects.length,
			linkedCount,
			localOnlyCount: Math.max(projects.length - linkedCount, 0),
			backedUpCount,
			attentionCount,
			isLoading: projects.length > 0 && summaries.length < projects.length,
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
		storageEstimateReport?.usageRatio === null ||
			storageEstimateReport?.usageRatio === undefined
			? 'Unavailable'
			: `${Math.round(storageEstimateReport.usageRatio * 100)}%`
	);
	let isBusy = $derived(
		isCreating ||
			isLoadingProject ||
			isLoadingCollations ||
			isSavingMetadata ||
			isSavingSettings ||
			isSavingTranscriptions ||
			isRepairingIndex ||
			isExportingAllProjects
	);

	function logProjects(
		level: 'debug' | 'warn' | 'error',
		message: string,
		details?: Record<string, unknown>
	) {
		const logger =
			level === 'error' ? console.error : level === 'warn' ? console.warn : console.debug;
		if (details && Object.keys(details).length > 0) {
			logger(`${PROJECTS_LOG_PREFIX} ${message}`, details);
			return;
		}
		logger(`${PROJECTS_LOG_PREFIX} ${message}`);
	}

	async function runLoggedStep<T>(
		label: string,
		step: () => Promise<T>,
		details?: Record<string, unknown>
	): Promise<T> {
		const startedAt = Date.now();
		logProjects('debug', `${label} start`, details);
		try {
			const result = await step();
			logProjects('debug', `${label} completed`, {
				...details,
				elapsedMs: Date.now() - startedAt,
			});
			return result;
		} catch (error) {
			logProjects('error', `${label} failed`, {
				...details,
				elapsedMs: Date.now() - startedAt,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	function applyProjectSettings(record: ProjectRecord | null) {
		const settings = parseProjectCollationSettings(record?.collationSettings ?? {});
		projectRules = settings.regularizationRules ?? [];
		lowercase = settings.lowercase ?? false;
		ignoreWordBreaks = settings.ignoreWordBreaks ?? false;
		ignorePunctuation = settings.ignorePunctuation ?? false;
		suppliedTextMode = settings.suppliedTextMode ?? 'clear';
		segmentation = settings.segmentation ?? true;
		transcriptionWitnessTreatments = new Map(
			Object.entries(settings.transcriptionWitnessTreatments ?? {})
		);
		transcriptionWitnessExcludedHands = new Map(
			Object.entries(settings.transcriptionWitnessExcludedHands ?? {}).map(
				([transcriptionId, handIds]) => [transcriptionId, [...handIds]]
			)
		);
	}

	function touchProjectList(
		projectId: string,
		updates: Partial<ProjectOption>,
		updatedAt: string
	) {
		projects = [...projects]
			.map(project =>
				project.id === projectId ? { ...project, ...updates, updatedAt } : project
			)
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
		if (currentProject?.id === projectId) {
			currentProject = { ...currentProject, ...updates, updatedAt };
		}
	}

	async function loadProjectListBackupSummaries(projectRows: ProjectOption[] = projects) {
		const runId = ++backupSummaryRunId;
		if (projectRows.length === 0) {
			projectBackupSummaries = {};
			return;
		}
		try {
			const nextEntries = await Promise.all(
				projectRows.map(async project => {
					const targets = await listSyncTargets(project.id);
					const target =
						targets.find(candidate => candidate.enabled) ?? targets[0] ?? null;
					if (!target) {
						return [
							project.id,
							{
								locationLabel: 'Local only',
								statusLabel: 'No sync folder',
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
					return [
						project.id,
						summarizeProjectBackup(target.folderDisplayPath, summary),
					] as const;
				})
			);
			if (runId !== backupSummaryRunId) return;
			projectBackupSummaries = Object.fromEntries(nextEntries);
		} catch (err) {
			if (runId !== backupSummaryRunId) return;
			logProjects('warn', 'project folder sync summary load failed', {
				error: err instanceof Error ? err.message : String(err),
			});
			projectBackupSummaries = Object.fromEntries(
				projectRows.map(project => [
					project.id,
					{
						locationLabel: 'Folder sync unavailable',
						statusLabel: 'Provider unavailable',
						badgeClass: 'badge-warning',
						statusKey: 'unavailable',
					},
				])
			);
		}
	}

	function queueProjectListBackupSummaries(projectRows: ProjectOption[] = projects) {
		const scheduleId = ++backupSummaryScheduleId;
		void (async () => {
			await waitForBrowserIdle(2_000);
			if (scheduleId !== backupSummaryScheduleId) return;
			await loadProjectListBackupSummaries(projectRows);
		})();
	}

	function summarizeProjectBackup(
		folderDisplayPath: string,
		summary: ProjectBackupSummary
	): ProjectListBackupSummary {
		const locationLabel = `Folder: ${folderDisplayPath}`;
		if (summary.remoteManifestState === 'remote-update-available') {
			return {
				locationLabel,
				statusLabel: 'Remote update available',
				badgeClass: 'badge-warning',
				statusKey: 'remote-update',
			};
		}
		if (summary.remoteManifestState === 'diverged') {
			return {
				locationLabel,
				statusLabel: 'Conflict requires resolution',
				badgeClass: 'badge-error',
				statusKey: 'conflict',
			};
		}
		if (summary.remoteManifestState === 'unavailable') {
			return {
				locationLabel,
				statusLabel: 'Provider unavailable',
				badgeClass: 'badge-warning',
				statusKey: 'unavailable',
			};
		}
		if (summary.blockingItems.length > 0) {
			return {
				locationLabel,
				statusLabel: 'Commit changes before sync',
				badgeClass: 'badge-warning',
				statusKey: 'blocked',
			};
		}
		if (summary.pendingItems.length > 0 || summary.tombstones.length > 0) {
			return {
				locationLabel,
				statusLabel: 'Pending sync',
				badgeClass: 'badge-info',
				statusKey: 'pending-backup',
			};
		}
		return {
			locationLabel,
			statusLabel: 'Synced',
			badgeClass: 'badge-success',
			statusKey: 'backed-up',
		};
	}

	function pluralize(count: number, singular: string): string {
		return `${count} ${singular}${count === 1 ? '' : 's'}`;
	}

	function persistenceStatusLabel(report: StoragePersistenceReport | null): string {
		if (!report) return 'Checking';
		if (report.status === 'granted') return 'Protected from browser eviction';
		if (report.status === 'denied')
			return report.canRequest ? 'Not yet granted' : 'Not granted';
		return 'Unsupported by this browser';
	}

	async function refreshStorageCapabilities() {
		const [persistence, estimate] = await Promise.all([
			checkStoragePersistence(),
			getStorageEstimate(),
		]);
		persistenceReport = persistence;
		storageEstimateReport = estimate;
	}

	function dismissDurabilityWarning() {
		dismissedDurabilityMilestone = currentDurabilityMilestone;
		try {
			globalThis.localStorage?.setItem(
				'apatosaurus:durability-warning-dismissed-milestone',
				currentDurabilityMilestone
			);
		} catch {
			// If localStorage is unavailable, the warning can return next load.
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

	async function loadProject(projectId: string) {
		isLoadingProject = true;
		error = null;
		try {
			logProjects('debug', 'loadProject start', { projectId });
			const [project, transcriptionIds] = await Promise.all([
				runLoggedStep('getProject', () => getProject(projectId), { projectId }),
				runLoggedStep(
					'getProjectTranscriptionIds',
					() => getProjectTranscriptionIds(projectId),
					{
						projectId,
					}
				),
			]);
			if (!project) {
				projects = projects.filter(candidate => candidate.id !== projectId);
				selectedProjectId = projects[0]?.id ?? null;
				currentProject = null;
				selectedTranscriptionIds = [];
				projectTranscriptionStatuses = [];
				applyProjectSettings(null);
				logProjects('warn', 'loadProject resolved with missing project row', { projectId });
				return;
			}
			selectedProjectId = projectId;
			currentProject = project;
			selectedTranscriptionIds = transcriptionIds;
			nameDraft = project.name;
			descriptionDraft = project.description;
			applyProjectSettings(project);
			void loadProjectTranscriptionStatuses(projectId);
			void loadProjectCollationStatuses(projectId);
			logProjects('debug', 'loadProject completed', {
				projectId,
				transcriptionCount: transcriptionIds.length,
			});
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load project';
			logProjects('error', 'loadProject failed', {
				projectId,
				error,
			});
		} finally {
			isLoadingProject = false;
		}
	}

	async function loadProjectCollationStatuses(projectId: string) {
		isLoadingCollations = true;
		try {
			const statuses = await listProjectCollationVersionStatuses(projectId);
			if (selectedProjectId !== projectId) return;
			projectCollationStatuses = statuses;
		} catch (err) {
			logProjects('error', 'loadProjectCollationStatuses failed', {
				projectId,
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			if (selectedProjectId === projectId) {
				isLoadingCollations = false;
			}
		}
	}

	function readInitialProjectSection(): ProjectSection {
		const hash = globalThis.location?.hash.replace(/^#/, '') ?? '';
		if (hash === 'collations' || hash === 'settings' || hash === 'backup') return hash;
		return 'transcriptions';
	}

	function selectSection(section: ProjectSection) {
		activeSection = section;
		if (globalThis.history?.replaceState) {
			globalThis.history.replaceState(null, '', `${globalThis.location.pathname}#${section}`);
		}
	}

	function phaseLabel(status: string): string {
		const labels: Record<string, string> = {
			setup: 'Setup',
			regularization: 'Alignment',
			alignment: 'Alignment',
			readings: 'Readings',
			stemma: 'Stemma',
			complete: 'Complete',
		};
		return labels[status] ?? status ?? 'Setup';
	}

	function phaseBadge(status: string): string {
		if (status === 'complete') return 'badge-success';
		if (status === 'stemma') return 'badge-info';
		if (status === 'readings') return 'badge-secondary';
		if (status === 'alignment') return 'badge-warning';
		return 'badge-ghost';
	}

	async function loadProjectTranscriptionStatuses(projectId: string) {
		const runId = ++statusLoadRunId;
		isLoadingStatuses = true;
		try {
			const statuses = await runLoggedStep(
				'listProjectTranscriptionStatuses',
				() => listProjectTranscriptionStatuses(projectId),
				{ projectId, runId }
			);
			if (runId !== statusLoadRunId || selectedProjectId !== projectId) return;
			projectTranscriptionStatuses = statuses;
		} catch (err) {
			if (runId !== statusLoadRunId) return;
			logProjects('error', 'loadProjectTranscriptionStatuses failed', {
				projectId,
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			if (runId === statusLoadRunId) {
				isLoadingStatuses = false;
			}
		}
	}

	async function loadTranscriptionCatalog(runId: number, projectId: string | null) {
		isLoadingTranscriptions = true;
		try {
			const transcriptionRows = await runLoggedStep(
				'listTranscriptions',
				() => listTranscriptions(projectId ?? undefined),
				{
					projectId,
					runId,
				}
			);
			if (runId !== bootstrapRunId) {
				logProjects('warn', 'discarded stale transcription catalog load', {
					projectId,
					runId,
					activeRunId: bootstrapRunId,
				});
				return;
			}
			allTranscriptions = transcriptionRows;
			logProjects('debug', 'transcription catalog loaded', {
				projectId,
				runId,
				transcriptionCount: transcriptionRows.length,
			});
			void loadHandsForSelectedTranscriptions();
		} catch (err) {
			if (runId !== bootstrapRunId) {
				return;
			}
			error = err instanceof Error ? err.message : 'Failed to load transcriptions';
			logProjects('error', 'transcription catalog failed', {
				projectId,
				runId,
				error,
			});
		} finally {
			if (runId === bootstrapRunId) {
				isLoadingTranscriptions = false;
			}
		}
	}

	async function selectProject(projectId: string) {
		const runId = ++bootstrapRunId;
		await loadProject(projectId);
		if (runId !== bootstrapRunId || selectedProjectId !== projectId) {
			return;
		}
		void loadTranscriptionCatalog(runId, projectId);
	}

	async function bootstrap(preferredProjectId: string | null = null) {
		const runId = ++bootstrapRunId;
		const bootstrapStartedAt = Date.now();
		isBooting = true;
		error = null;
		try {
			logProjects('debug', 'bootstrap start', {
				preferredProjectId,
				selectedProjectId,
				runId,
			});
			await runLoggedStep('ensureLocalDbRuntime', () => ensureLocalDbRuntime(), {
				preferredProjectId,
				runId,
			});
			const projectRows = await runLoggedStep('listProjects', () => listProjects(), {
				preferredProjectId,
				runId,
			});
			if (runId !== bootstrapRunId) {
				logProjects('warn', 'bootstrap aborted after stale project list load', {
					preferredProjectId,
					runId,
					activeRunId: bootstrapRunId,
				});
				return;
			}
			projects = projectRows;
			void refreshStorageCapabilities();
			logProjects('debug', 'bootstrap project list loaded', {
				projectCount: projectRows.length,
				preferredProjectId,
				runId,
			});
			if (projectRows.length === 0) {
				projectBackupSummaries = {};
				selectedProjectId = null;
				currentProject = null;
				selectedTranscriptionIds = [];
				allTranscriptions = [];
				isLoadingTranscriptions = false;
				applyProjectSettings(null);
				logProjects('warn', 'bootstrap completed with no projects', {});
				return;
			}
			const availableIds = new Set(projectRows.map(project => project.id));
			const nextProjectId =
				(preferredProjectId &&
					availableIds.has(preferredProjectId) &&
					preferredProjectId) ||
				(selectedProjectId && availableIds.has(selectedProjectId) && selectedProjectId) ||
				projectRows[0]!.id;
			await runLoggedStep('loadProject', () => loadProject(nextProjectId), {
				preferredProjectId,
				projectId: nextProjectId,
				runId,
			});
			if (runId !== bootstrapRunId) {
				return;
			}
			void loadTranscriptionCatalog(runId, nextProjectId);
			queueProjectListBackupSummaries(projectRows);
			logProjects('debug', 'bootstrap critical path completed', {
				preferredProjectId,
				projectId: nextProjectId,
				runId,
				elapsedMs: Date.now() - bootstrapStartedAt,
			});
		} catch (err) {
			if (runId !== bootstrapRunId) {
				return;
			}
			error = err instanceof Error ? err.message : 'Failed to load projects';
			logProjects('error', 'bootstrap failed', {
				preferredProjectId,
				runId,
				error,
			});
		} finally {
			if (runId === bootstrapRunId) {
				logProjects('debug', 'bootstrap finished', {
					preferredProjectId,
					runId,
					isBooting: false,
					elapsedMs: Date.now() - bootstrapStartedAt,
					error,
				});
				isBooting = false;
			}
		}
	}

	onMount(() => {
		activeSection = readInitialProjectSection();
		installSupported = getInstallCapabilityReport().installSupported;
		void refreshStorageCapabilities();
		void bootstrap();
		const unsubscribe = subscribeLocalDbInvalidations(event => {
			if (
				event.domain === 'sync-targets' ||
				event.domain === 'collations' ||
				event.domain === 'projects' ||
				event.domain === 'transcriptions' ||
				event.domain === 'all'
			) {
				queueProjectListBackupSummaries();
			}
			if (
				event.domain === 'projects' ||
				event.domain === 'transcriptions' ||
				event.domain === 'collations' ||
				event.domain === 'all'
			) {
				void refreshStorageCapabilities();
				if (selectedProjectId) {
					void loadProjectTranscriptionStatuses(selectedProjectId);
					void loadProjectCollationStatuses(selectedProjectId);
				}
			}
		});
		return unsubscribe;
	});

	async function createProject() {
		const name = createName.trim();
		if (!name) return;
		isCreating = true;
		error = null;
		try {
			const projectId = await createProjectRecord({ name });
			createName = '';
			await bootstrap(projectId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create project';
		} finally {
			isCreating = false;
		}
	}

	async function handleProjectForked(projectId: string) {
		await bootstrap(projectId);
	}

	async function handleProjectRemoved() {
		await bootstrap(null);
	}

	async function repairLocalIndex() {
		if (isRepairingIndex) return;
		const preferredProjectId = selectedProjectId;
		isRepairingIndex = true;
		indexRepairError = null;
		try {
			const report = await rebuildLocalIndex();
			indexRepairReport = report;
			await bootstrap(preferredProjectId);
		} catch (err) {
			indexRepairError = err instanceof Error ? err.message : 'Failed to repair database';
		} finally {
			isRepairingIndex = false;
		}
	}

	async function restoreIndexOrphan(path: string) {
		if (restoringOrphanPath) return;
		const preferredProjectId = selectedProjectId;
		restoringOrphanPath = path;
		indexRepairError = null;
		try {
			indexRepairReport = await restoreOrphanPrimary(path);
			await bootstrap(preferredProjectId);
		} catch (err) {
			indexRepairError =
				err instanceof Error ? err.message : 'Failed to restore orphaned file';
		} finally {
			restoringOrphanPath = null;
		}
	}

	async function exportAllProjectArchives() {
		if (isExportingAllProjects) return;
		isExportingAllProjects = true;
		exportAllError = null;
		try {
			const result = await exportAllProjectsZip(false);
			for (const archive of result.archives) {
				downloadZipArchive(archive.fileName, archive.bytes);
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
		} catch (err) {
			exportAllError = err instanceof Error ? err.message : 'Failed to export all projects.';
		} finally {
			isExportingAllProjects = false;
		}
	}

	function formatDate(value: string): string {
		return new Date(value).toLocaleString();
	}

	async function saveMetadata() {
		if (!selectedProjectId) return;
		const name = nameDraft.trim();
		if (!name) {
			error = 'Project name is required';
			return;
		}
		isSavingMetadata = true;
		error = null;
		try {
			await updateProjectMetadata(selectedProjectId, {
				name,
				description: descriptionDraft,
			});
			const now = new Date().toISOString();
			descriptionDraft = descriptionDraft.trim();
			touchProjectList(selectedProjectId, { name, description: descriptionDraft }, now);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to save project details';
		} finally {
			isSavingMetadata = false;
		}
	}

	async function persistProjectSettings(nextState?: {
		rules?: RegularizationRule[];
		lowercase?: boolean;
		ignoreWordBreaks?: boolean;
		ignorePunctuation?: boolean;
		suppliedTextMode?: SuppliedTextMode;
		segmentation?: boolean;
		transcriptionWitnessTreatments?: Map<string, WitnessTreatment>;
		transcriptionWitnessExcludedHands?: Map<string, string[]>;
	}) {
		if (!selectedProjectId) return;
		const nextRules = nextState?.rules ?? projectRules;
		const nextLowercase = nextState?.lowercase ?? lowercase;
		const nextIgnoreWordBreaks = nextState?.ignoreWordBreaks ?? ignoreWordBreaks;
		const nextIgnorePunctuation = nextState?.ignorePunctuation ?? ignorePunctuation;
		const nextSuppliedTextMode = nextState?.suppliedTextMode ?? suppliedTextMode;
		const nextSegmentation = nextState?.segmentation ?? segmentation;
		const nextTreatments =
			nextState?.transcriptionWitnessTreatments ?? transcriptionWitnessTreatments;
		const nextExcludedHands =
			nextState?.transcriptionWitnessExcludedHands ?? transcriptionWitnessExcludedHands;
		const now = new Date().toISOString();
		isSavingSettings = true;
		error = null;
		try {
			const collationSettings = createProjectCollationSettings(nextRules, {
				ignoreWordBreaks: nextIgnoreWordBreaks,
				lowercase: nextLowercase,
				ignoreTokenWhitespace: true,
				ignorePunctuation: nextIgnorePunctuation,
				suppliedTextMode: nextSuppliedTextMode,
				segmentation: nextSegmentation,
				transcriptionWitnessTreatments: nextTreatments,
				transcriptionWitnessExcludedHands: nextExcludedHands,
			});
			await updateProjectMetadata(selectedProjectId, {
				collationSettings,
				updatedAt: now,
			});
			touchProjectList(selectedProjectId, {}, now);
			if (currentProject?.id === selectedProjectId) {
				currentProject = {
					...currentProject,
					collationSettings,
					updatedAt: now,
				};
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to save project settings';
		} finally {
			isSavingSettings = false;
		}
	}

	function getProjectTranscriptionTreatment(transcriptionId: string): WitnessTreatment {
		return transcriptionWitnessTreatments.get(transcriptionId) ?? 'fragmentary';
	}

	function setProjectTranscriptionTreatment(
		transcriptionId: string,
		treatment: WitnessTreatment
	) {
		const nextTreatments = new Map(transcriptionWitnessTreatments);
		nextTreatments.set(transcriptionId, treatment === 'full' ? 'full' : 'fragmentary');
		transcriptionWitnessTreatments = nextTreatments;
		void persistProjectSettings({ transcriptionWitnessTreatments: nextTreatments });
	}

	function setAllProjectTranscriptionTreatments(
		transcriptionIds: string[],
		treatment: WitnessTreatment
	) {
		const normalized = treatment === 'full' ? 'full' : 'fragmentary';
		const nextTreatments = new Map(transcriptionWitnessTreatments);
		for (const transcriptionId of transcriptionIds) {
			nextTreatments.set(transcriptionId, normalized);
		}
		transcriptionWitnessTreatments = nextTreatments;
		void persistProjectSettings({ transcriptionWitnessTreatments: nextTreatments });
	}

	function getExcludedHandsForTranscription(transcriptionId: string): string[] {
		return transcriptionWitnessExcludedHands.get(transcriptionId) ?? [];
	}

	function isProjectTranscriptionHandIncluded(transcriptionId: string, handId: string): boolean {
		return !getExcludedHandsForTranscription(transcriptionId).includes(handId);
	}

	function setProjectTranscriptionHandIncluded(
		transcriptionId: string,
		handId: string,
		included: boolean
	) {
		const normalizedHandId = handId.trim();
		if (!normalizedHandId) return;
		const nextExcludedHands = new Map(transcriptionWitnessExcludedHands);
		const handIds = new Set(getExcludedHandsForTranscription(transcriptionId));
		if (included) {
			handIds.delete(normalizedHandId);
		} else {
			handIds.add(normalizedHandId);
		}
		if (handIds.size === 0) {
			nextExcludedHands.delete(transcriptionId);
		} else {
			nextExcludedHands.set(transcriptionId, [...handIds].sort());
		}
		transcriptionWitnessExcludedHands = nextExcludedHands;
		void persistProjectSettings({ transcriptionWitnessExcludedHands: nextExcludedHands });
	}

	async function toggleAllProjectTranscriptions(checked: boolean) {
		const projectId = selectedProjectId;
		if (!projectId) return;
		isSavingTranscriptions = true;
		error = null;
		try {
			const nextIds = checked ? allTranscriptions.map(t => t.id) : [];
			const syncedIds = await syncProjectTranscriptionIds(projectId, nextIds);
			touchProjectList(projectId, {}, new Date().toISOString());
			if (selectedProjectId !== projectId) return;
			const runId = ++bootstrapRunId;
			selectedTranscriptionIds = syncedIds;
			await loadTranscriptionCatalog(runId, projectId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to update project transcriptions';
		} finally {
			isSavingTranscriptions = false;
		}
	}

	async function ensureTranscriptionHands(transcriptionId: string) {
		const idx = allTranscriptions.findIndex(t => t.id === transcriptionId);
		if (idx === -1 || allTranscriptions[idx]!.hands.length > 0) return;
		const hands = await loadTranscriptionHands(transcriptionId);
		allTranscriptions = allTranscriptions.map(t =>
			t.id === transcriptionId ? { ...t, hands } : t
		);
	}

	async function loadHandsForSelectedTranscriptions() {
		const idsNeedingHands = selectedTranscriptionIds.filter(id => {
			const t = allTranscriptions.find(candidate => candidate.id === id);
			return t && t.hands.length === 0;
		});
		for (const id of idsNeedingHands) {
			await ensureTranscriptionHands(id);
		}
	}

	async function toggleProjectTranscription(transcriptionId: string) {
		const projectId = selectedProjectId;
		if (!projectId) return;
		isSavingTranscriptions = true;
		error = null;
		try {
			const nextIds = selectedTranscriptionIds.includes(transcriptionId)
				? selectedTranscriptionIds.filter(id => id !== transcriptionId)
				: [...selectedTranscriptionIds, transcriptionId];
			const syncedIds = await syncProjectTranscriptionIds(projectId, nextIds);
			touchProjectList(projectId, {}, new Date().toISOString());
			if (selectedProjectId !== projectId) return;
			const runId = ++bootstrapRunId;
			selectedTranscriptionIds = syncedIds;
			await loadTranscriptionCatalog(runId, projectId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to update project transcriptions';
		} finally {
			isSavingTranscriptions = false;
		}
	}

	function addRule(rule: RegularizationRule) {
		const nextRules = [...projectRules, rule];
		projectRules = nextRules;
		void persistProjectSettings({ rules: nextRules });
	}

	function removeRule(ruleId: string) {
		const nextRules = projectRules.filter(rule => rule.id !== ruleId);
		projectRules = nextRules;
		void persistProjectSettings({ rules: nextRules });
	}

	function toggleRule(ruleId: string) {
		const nextRules = projectRules.map(rule =>
			rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule
		);
		projectRules = nextRules;
		void persistProjectSettings({ rules: nextRules });
	}

	function setRuleType(ruleId: string, type: RegularizationType) {
		const nextRules = projectRules.map(rule => (rule.id === ruleId ? { ...rule, type } : rule));
		projectRules = nextRules;
		void persistProjectSettings({ rules: nextRules });
	}

	function setLowercase(nextValue: boolean) {
		lowercase = nextValue;
		void persistProjectSettings({ lowercase: nextValue });
	}

	function setIgnoreWordBreaks(nextValue: boolean) {
		ignoreWordBreaks = nextValue;
		void persistProjectSettings({ ignoreWordBreaks: nextValue });
	}

	function setIgnorePunctuation(nextValue: boolean) {
		ignorePunctuation = nextValue;
		void persistProjectSettings({ ignorePunctuation: nextValue });
	}

	function setSuppliedTextMode(nextValue: SuppliedTextMode) {
		suppliedTextMode = nextValue;
		void persistProjectSettings({ suppliedTextMode: nextValue });
	}

	function setSegmentation(nextValue: boolean) {
		segmentation = nextValue;
		void persistProjectSettings({ segmentation: nextValue });
	}

	function resolveRefreshSource(status: ProjectTranscriptionStatus) {
		const state: ProjectTranscriptionSourceState = status.sourceState;
		if (state.kind === 'up-to-date' || state.kind === 'newer-source-available') {
			return {
				sourceTranscriptionId: state.sourceTranscriptionId,
				sourceCheckpointId: state.sourceRevisionId,
			};
		}
		if (state.kind === 'source-has-uncommitted-changes' && state.sourceRevisionId) {
			return {
				sourceTranscriptionId: state.sourceTranscriptionId,
				sourceCheckpointId: state.sourceRevisionId,
			};
		}
		return null;
	}

	function handleRequestRefresh(status: ProjectTranscriptionStatus) {
		refreshTarget = status;
		refreshError = null;
	}

	function closeRefreshDialog() {
		if (isRefreshing) return;
		refreshTarget = null;
		refreshError = null;
	}

	async function confirmRefreshTranscription(allowReplaceDirty: boolean) {
		const target = refreshTarget;
		if (!target) return;
		const source = resolveRefreshSource(target);
		if (!source) {
			refreshError = 'No committed source version available for this project transcription.';
			return;
		}
		isRefreshing = true;
		refreshError = null;
		try {
			await refreshProjectTranscription({
				projectTranscriptionId: target.projectTranscriptionId,
				sourceTranscriptionId: source.sourceTranscriptionId,
				sourceCheckpointId: source.sourceCheckpointId,
				allowReplaceDirty,
			});
			refreshTarget = null;
			if (selectedProjectId) {
				await loadProjectTranscriptionStatuses(selectedProjectId);
			}
		} catch (err) {
			refreshError =
				err instanceof Error ? err.message : 'Failed to refresh project transcription';
		} finally {
			isRefreshing = false;
		}
	}

	let refreshSourceCheckpointId = $derived(
		refreshTarget ? (resolveRefreshSource(refreshTarget)?.sourceCheckpointId ?? '') : ''
	);

	async function handleRequestAddFromProject() {
		const projectId = selectedProjectId;
		if (!projectId) return;
		showAddFromProject = true;
		addFromProjectError = null;
		isLoadingCandidates = true;
		try {
			const candidates = await listProjectTranscriptionSourceCandidates(projectId);
			addFromProjectCandidates = candidates;
		} catch (err) {
			addFromProjectError =
				err instanceof Error ? err.message : 'Failed to load source candidates';
			addFromProjectCandidates = [];
		} finally {
			isLoadingCandidates = false;
		}
	}

	function closeAddFromProjectDialog() {
		if (isAddingFromProject) return;
		showAddFromProject = false;
		addFromProjectError = null;
		addFromProjectCandidates = [];
	}

	async function confirmAddFromProject(candidate: ProjectTranscriptionSourceCandidate) {
		const projectId = selectedProjectId;
		if (!projectId) return;
		isAddingFromProject = true;
		addFromProjectError = null;
		try {
			await addProjectTranscriptionFromProject({
				targetProjectId: projectId,
				sourceProjectTranscriptionId: candidate.projectTranscriptionId,
			});
			showAddFromProject = false;
			addFromProjectCandidates = [];
			await loadProjectTranscriptionStatuses(projectId);
			const runId = ++bootstrapRunId;
			await loadTranscriptionCatalog(runId, projectId);
		} catch (err) {
			addFromProjectError =
				err instanceof Error ? err.message : 'Failed to add project transcription';
		} finally {
			isAddingFromProject = false;
		}
	}
</script>

<div class="container mx-auto max-w-6xl p-4">
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl font-serif font-bold tracking-tight">Projects</h1>
			<p class="text-sm text-base-content/50 mt-1">
				Manage project metadata, linked transcriptions, and collation settings.
			</p>
		</div>
		<div class="flex items-center gap-3">
			{#if isBusy}
				<span class="loading loading-spinner loading-sm text-base-content/40"></span>
			{/if}
			<span class="badge badge-outline text-xs">{projectCountLabel}</span>
		</div>
	</div>

	{#if error}
		<div class="alert alert-error mb-4 text-sm">{error}</div>
	{/if}

	<div class="mb-6">
		<OnboardingGuidance
			localFolderSupported={isLocalFolderProviderSupported()}
			persistenceStatus={persistenceReport?.status ?? 'unsupported'}
			{installSupported}
		/>
	</div>

	<div class="flex flex-col gap-6 lg:flex-row">
		<!-- Sidebar: project list + create -->
		<div class="shrink-0 lg:w-72">
			<div class="sticky top-4 space-y-4">
				<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
					<h2 class="font-serif text-lg font-semibold mb-3">Project Library</h2>

					<div class="flex gap-2 mb-4">
						<input
							type="text"
							class="input input-bordered input-sm flex-1"
							placeholder="New project name"
							bind:value={createName}
							onkeydown={event => {
								if (event.key === 'Enter') {
									event.preventDefault();
									void createProject();
								}
							}}
						/>
						<button
							type="button"
							class="btn btn-primary btn-sm gap-1"
							disabled={isCreating || !createName.trim()}
							onclick={createProject}
						>
							{#if isCreating}
								<span class="loading loading-spinner loading-xs"></span>
							{:else}
								<Plus size={14} />
							{/if}
						</button>
					</div>

					{#if isBooting}
						<div
							class="flex items-center gap-2 p-4 bg-base-200 rounded-box justify-center"
						>
							<span class="loading loading-spinner loading-sm"></span>
							<span class="text-sm text-base-content/50">Loading...</span>
						</div>
					{:else if projects.length === 0}
						<div class="text-center py-6">
							<FolderOpen size={24} class="mx-auto text-base-content/30 mb-2" />
							<div class="text-sm text-base-content/40">No projects yet</div>
						</div>
					{:else}
						<ul class="space-y-1 max-h-[28rem] overflow-y-auto">
							{#each projects as project (project.id)}
								{@const backupSummary = projectBackupSummaries[project.id]}
								<li>
									<button
										type="button"
										class={`w-full rounded-box border px-3 py-2.5 text-left transition-colors ${
											project.id === selectedProjectId
												? 'border-primary/40 bg-primary/10'
												: 'border-transparent hover:bg-base-200/60'
										}`}
										onclick={() => {
											if (project.id !== selectedProjectId) {
												void selectProject(project.id);
											}
										}}
									>
										<div class="font-serif font-medium text-sm">
											{project.name}
										</div>
										{#if project.description}
											<div
												class="text-xs text-base-content/50 mt-0.5 line-clamp-1"
											>
												{project.description}
											</div>
										{/if}
										<div class="mt-2 flex flex-wrap items-center gap-1.5">
											<span
												class="badge badge-xs {backupSummary?.badgeClass ??
													'badge-ghost'}"
											>
												{backupSummary?.statusLabel ?? 'Checking sync'}
											</span>
											<span
												class="max-w-full truncate text-[0.68rem] text-base-content/45"
											>
												{backupSummary?.locationLabel ??
													'Folder sync status loading'}
											</span>
										</div>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-sm">
					<div class="flex items-start justify-between gap-3">
						<div>
							<h2 class="font-serif text-base font-semibold">Local Storage</h2>
							<p class="mt-1 text-xs text-base-content/50">
								Project copies on this device and their folder sync readiness.
							</p>
						</div>
						{#if storageOverview.isLoading}
							<span class="loading loading-spinner loading-xs mt-1"></span>
						{/if}
					</div>

					<div class="mt-4 grid grid-cols-2 gap-2 text-sm">
						<div class="rounded-box bg-base-200/70 p-3">
							<div class="text-2xl font-semibold">
								{storageOverview.localProjectCount}
							</div>
							<div class="text-xs text-base-content/50">Local projects</div>
						</div>
						<div class="rounded-box bg-base-200/70 p-3">
							<div class="text-2xl font-semibold">{storageOverview.linkedCount}</div>
							<div class="text-xs text-base-content/50">Sync folders</div>
						</div>
						<div class="rounded-box bg-base-200/70 p-3">
							<div class="text-2xl font-semibold text-success">
								{storageOverview.backedUpCount}
							</div>
							<div class="text-xs text-base-content/50">Synced</div>
						</div>
						<div class="rounded-box bg-base-200/70 p-3">
							<div
								class={`text-2xl font-semibold ${
									storageOverview.attentionCount > 0 ? 'text-warning' : ''
								}`}
							>
								{storageOverview.attentionCount}
							</div>
							<div class="text-xs text-base-content/50">Need attention</div>
						</div>
					</div>

					<div class="mt-3 flex flex-wrap gap-2 text-xs text-base-content/55">
						<span class="badge badge-ghost badge-sm">
							{storageOverview.localOnlyCount} local only
						</span>
						<span class="badge badge-ghost badge-sm">
							Folder sync mirrors committed files only
						</span>
					</div>

					{#if showDurabilityWarning}
						<div class="alert alert-warning mt-4 items-start text-xs leading-relaxed">
							<div>
								<div class="font-semibold">
									Browser storage is not persistent yet
								</div>
								<div>
									Your browser may evict local project files under storage
									pressure. Install the app, connect a sync folder, or export
									backups to protect this work.
								</div>
							</div>
							<button
								type="button"
								class="btn btn-ghost btn-xs"
								onclick={dismissDurabilityWarning}
							>
								Dismiss
							</button>
						</div>
					{/if}

					<div
						class="mt-4 rounded-box border border-base-300/60 bg-base-200/40 p-3 text-xs"
					>
						<div class="font-serif text-sm font-semibold">Storage Durability</div>
						<div class="mt-2 grid gap-2 text-base-content/65">
							<div class="flex items-center justify-between gap-3">
								<span>Persistent storage</span>
								<span class="font-medium text-base-content">
									{persistenceStatusLabel(persistenceReport)}
								</span>
							</div>
							<div class="flex items-center justify-between gap-3">
								<span>Origin private file system</span>
								<span class="font-medium text-base-content">
									{isOpfsSupported() ? 'Supported' : 'Unsupported'}
								</span>
							</div>
							<div class="flex items-center justify-between gap-3">
								<span>Folder sync capability</span>
								<span class="font-medium text-base-content">
									{isLocalFolderProviderSupported() ? 'Supported' : 'Unavailable'}
								</span>
							</div>
							<div class="flex items-center justify-between gap-3">
								<span>Storage used</span>
								<span class="font-medium text-base-content">
									{storageUsageLabel} of {storageQuotaLabel} ({storageUsagePercentLabel})
								</span>
							</div>
						</div>
						{#if storageEstimateReport?.isNearQuota}
							<div class="alert alert-warning mt-3 py-2">
								Storage is near this browser's reported quota. Export a backup
								before adding large image or transcription batches.
							</div>
						{/if}
					</div>

					<div class="mt-4 rounded-box border border-base-300/60 bg-base-200/40 p-3">
						<h3 class="font-serif text-sm font-semibold">Whole-Account Export</h3>
						<p class="mt-1 text-xs leading-relaxed text-base-content/55">
							Download one independently restorable zip per project. Draft files stay
							local.
						</p>
						<button
							type="button"
							class="btn btn-outline btn-sm mt-3 w-full"
							disabled={isExportingAllProjects || projects.length === 0}
							onclick={exportAllProjectArchives}
						>
							{#if isExportingAllProjects}
								<span class="loading loading-spinner loading-xs"></span>
								Exporting...
							{:else}
								Export all projects
							{/if}
						</button>
						{#if exportAllError}
							<div class="alert alert-error mt-3 py-2 text-xs">{exportAllError}</div>
						{/if}
						{#if lastAllProjectsExportedAt}
							<div class="mt-2 text-xs text-base-content/50">
								Last exported {formatDate(lastAllProjectsExportedAt)}
							</div>
						{/if}
					</div>

					<div class="mt-4">
						<ProjectZipImportPanel />
					</div>

					<div class="divider my-4"></div>

					<div class="space-y-3">
						<div>
							<h3 class="font-serif text-sm font-semibold">Repair Database</h3>
							<p class="mt-1 text-xs leading-relaxed text-base-content/55">
								Rebuild the disposable SQLite index from project files. This does
								not delete canonical documents.
							</p>
						</div>
						<button
							type="button"
							class="btn btn-outline btn-sm w-full"
							disabled={isRepairingIndex}
							onclick={repairLocalIndex}
						>
							{#if isRepairingIndex}
								<span class="loading loading-spinner loading-xs"></span>
								Repairing...
							{:else}
								Repair database
							{/if}
						</button>

						{#if indexRepairError}
							<div class="alert alert-error py-2 text-xs">{indexRepairError}</div>
						{/if}

						{#if indexRepairReport}
							<IndexRepairReport
								report={indexRepairReport}
								restoringPath={restoringOrphanPath}
								onRestore={restoreIndexOrphan}
							/>
						{/if}
					</div>
				</div>
			</div>
		</div>

		<!-- Main content -->
		<div class="flex-1 min-w-0">
			{#if !currentProject && !isBooting}
				<div class="text-center py-16 space-y-4">
					<FolderOpen size={32} class="mx-auto text-base-content/30" />
					<div class="text-base-content/30 text-lg">No project selected</div>
					<p class="text-sm text-base-content/50 max-w-md mx-auto">
						Create your first project to start linking transcriptions and configuring
						collation settings.
					</p>
				</div>
			{:else if currentProject}
				<div class="space-y-6">
					<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
						<div
							class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
						>
							<div>
								<div
									class="text-xs font-semibold uppercase tracking-wide text-base-content/40"
								>
									Current Project
								</div>
								<h2 class="font-serif text-xl font-semibold">
									{currentProject.name}
								</h2>
								{#if currentProject.description}
									<p class="mt-1 text-sm text-base-content/55">
										{currentProject.description}
									</p>
								{/if}
							</div>
							<div class="flex flex-wrap gap-2">
								<a
									href={resolve(
										`/transcription/new${selectedProjectActionQuery}`
									)}
									class="btn btn-primary btn-sm"
								>
									New Transcription
								</a>
								<a
									href={resolve(
										`/transcription/igntp${selectedProjectActionQuery}`
									)}
									class="btn btn-outline btn-sm"
								>
									Import IGNTP
								</a>
								<a
									href={resolve(`/collation/new${selectedProjectActionQuery}`)}
									class="btn btn-outline btn-sm"
								>
									New Collation
								</a>
							</div>
						</div>

						<div class="tabs tabs-box mt-4 bg-base-200">
							<button
								type="button"
								class={['tab', activeSection === 'transcriptions' && 'tab-active']}
								onclick={() => selectSection('transcriptions')}
							>
								Transcriptions
							</button>
							<button
								type="button"
								class={['tab', activeSection === 'collations' && 'tab-active']}
								onclick={() => selectSection('collations')}
							>
								Collations
							</button>
							<button
								type="button"
								class={['tab', activeSection === 'settings' && 'tab-active']}
								onclick={() => selectSection('settings')}
							>
								Settings
							</button>
							<button
								type="button"
								class={['tab', activeSection === 'backup' && 'tab-active']}
								onclick={() => selectSection('backup')}
							>
								Backup and Sync
							</button>
						</div>
					</div>

					{#if activeSection === 'backup'}
						<ProjectBackupPanel
							projectId={currentProject.id}
							onForked={handleProjectForked}
							onRemoved={handleProjectRemoved}
						/>
					{:else if activeSection === 'settings'}
						<div
							class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md"
						>
							<div class="flex items-center justify-between mb-3">
								<h2 class="font-serif text-lg font-semibold">Project Details</h2>
								{#if isSavingMetadata}
									<span class="loading loading-spinner loading-xs"></span>
								{/if}
							</div>

							<div class="grid gap-3">
								<label class="form-control">
									<div class="label pb-1">
										<span class="label-text text-xs text-base-content/50"
											>Name</span
										>
									</div>
									<input
										type="text"
										class="input input-bordered w-full"
										bind:value={nameDraft}
									/>
								</label>
								<label class="form-control">
									<div class="label pb-1">
										<span class="label-text text-xs text-base-content/50"
											>Description</span
										>
									</div>
									<textarea
										class="textarea textarea-bordered min-h-24 w-full"
										placeholder="Add a description for this project."
										bind:value={descriptionDraft}
									></textarea>
								</label>
								<div class="flex items-center justify-between gap-3">
									<span class="text-xs text-base-content/40">
										Updated {new Date(
											currentProject.updatedAt
										).toLocaleString()}
									</span>
									<button
										type="button"
										class="btn btn-primary btn-sm"
										disabled={isSavingMetadata || !metadataDirty}
										onclick={saveMetadata}
									>
										Save Details
									</button>
								</div>
							</div>
						</div>

						<ProjectCollationSettingsEditor
							rules={projectRules}
							{lowercase}
							{ignoreWordBreaks}
							{ignorePunctuation}
							{suppliedTextMode}
							{segmentation}
							onAddRule={addRule}
							onRemoveRule={removeRule}
							onToggleRule={toggleRule}
							onSetRuleType={setRuleType}
							onSetLowercase={setLowercase}
							onSetIgnoreWordBreaks={setIgnoreWordBreaks}
							onSetIgnorePunctuation={setIgnorePunctuation}
							onSetSuppliedTextMode={setSuppliedTextMode}
							onSetSegmentation={setSegmentation}
						/>

						<ProjectUserManagementStub />
					{:else if activeSection === 'collations'}
						<div
							class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md"
						>
							<div class="mb-3 flex items-center justify-between gap-3">
								<div>
									<h2 class="font-serif text-lg font-semibold">
										Project Collations
									</h2>
									<p class="text-xs text-base-content/50">
										Collations owned by {currentProject.name}.
									</p>
								</div>
								<a
									href={resolve(`/collation/new${selectedProjectActionQuery}`)}
									class="btn btn-primary btn-sm"
								>
									New Collation
								</a>
							</div>

							{#if isLoadingCollations}
								<div
									class="flex items-center gap-2 rounded-box bg-base-200/70 p-4 text-sm text-base-content/60"
								>
									<span class="loading loading-spinner loading-sm"></span>
									Loading collations...
								</div>
							{:else if projectCollationStatuses.length === 0}
								<div
									class="rounded-box border border-dashed border-base-300/80 p-4 text-sm text-base-content/55"
								>
									No collations in this project yet.
								</div>
							{:else}
								<ul class="list rounded-box bg-base-100">
									{#each projectCollationStatuses as status (status.collationId)}
										<li class="list-row gap-4 items-center">
											<div class="flex-1 min-w-0">
												<div class="font-serif font-medium">
													{status.title}
												</div>
												<div
													class="mt-0.5 flex items-center gap-2 text-xs text-base-content/50"
												>
													<span class="font-mono"
														>{status.verseIdentifier}</span
													>
													<span class="text-base-content/20">|</span>
													<span
														>{status.commitState === 'dirty'
															? 'Uncommitted changes'
															: 'Committed state current'}</span
													>
												</div>
											</div>
											<span
												class="badge badge-sm {phaseBadge(
													status.workflowStatus
												)}"
											>
												{phaseLabel(status.workflowStatus)}
											</span>
											<a
												href={resolve('/collation/[id]', {
													id: status.collationId,
												})}
												class="btn btn-ghost btn-sm"
											>
												Open
											</a>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{:else}
						<ProjectTranscriptionsEditor
							{allTranscriptions}
							{selectedTranscriptionIds}
							isLoading={isLoadingProject || isLoadingTranscriptions}
							isSaving={isSavingTranscriptions}
							getTreatment={getProjectTranscriptionTreatment}
							isHandIncluded={isProjectTranscriptionHandIncluded}
							setTreatment={setProjectTranscriptionTreatment}
							setHandIncluded={setProjectTranscriptionHandIncluded}
							setAllTreatments={setAllProjectTranscriptionTreatments}
							onToggleTranscription={toggleProjectTranscription}
							onToggleAllTranscriptions={toggleAllProjectTranscriptions}
						/>

						<ProjectTranscriptionVersionsPanel
							projectId={selectedProjectId ?? ''}
							statuses={projectTranscriptionStatuses}
							isLoading={isLoadingStatuses || isLoadingProject}
							onRefreshTranscription={handleRequestRefresh}
							onAddFromProject={handleRequestAddFromProject}
						/>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	{#if refreshTarget}
		<ProjectTranscriptionRefreshDialog
			status={refreshTarget}
			sourceCheckpointId={refreshSourceCheckpointId}
			isSubmitting={isRefreshing}
			error={refreshError}
			onConfirm={confirmRefreshTranscription}
			onClose={closeRefreshDialog}
		/>
	{/if}

	{#if showAddFromProject}
		<AddProjectTranscriptionFromProjectDialog
			candidates={addFromProjectCandidates}
			{isLoadingCandidates}
			isSubmitting={isAddingFromProject}
			error={addFromProjectError}
			onConfirm={confirmAddFromProject}
			onClose={closeAddFromProjectDialog}
		/>
	{/if}
</div>
