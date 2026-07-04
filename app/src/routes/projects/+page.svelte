<script lang="ts">
	import {
		addProjectTranscriptionFromProject,
		createProjectRecord,
		getProject,
		getProjectTranscriptionIds,
		listProjects,
		listProjectTranscriptionSourceCandidates,
		listProjectTranscriptionStatuses,
		listTranscriptions,
		loadTranscriptionHands,
		promoteProjectTranscriptionToLibrary,
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
	import CloudProjectBrowser from '$lib/components/projects/CloudProjectBrowser.svelte';
	import ProjectTranscriptionRefreshDialog from '$lib/components/projects/ProjectTranscriptionRefreshDialog.svelte';
	import PromoteProjectTranscriptionDialog from '$lib/components/projects/PromoteProjectTranscriptionDialog.svelte';
	import AddProjectTranscriptionFromProjectDialog from '$lib/components/projects/AddProjectTranscriptionFromProjectDialog.svelte';
	import ProjectUserManagementStub from '$lib/components/projects/ProjectUserManagementStub.svelte';
	import { waitForBrowserIdle } from '$lib/client/defer';
	import { ensureLocalDbRuntime } from '$lib/client/db/runtime';
	import {
		deriveProjectBackupSummary,
		listCloudConnections,
		listCloudProjectFolders,
		subscribeLocalDbInvalidations,
	} from '$lib/client/db/client';
	import type { CloudConnectionRecord } from '$lib/client/db/repositories/cloud-connections';
	import type { ProjectBackupSummary } from '$lib/client/sync/sync-manager';
	import FolderOpen from 'phosphor-svelte/lib/FolderOpen';
	import Plus from 'phosphor-svelte/lib/Plus';
	import { onMount } from 'svelte';

	const PROJECTS_LOG_PREFIX = '[projects-route]';

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
	let isLoadingTranscriptions = $state(false);
	let isCreating = $state(false);
	let isSavingMetadata = $state(false);
	let isSavingSettings = $state(false);
	let isSavingTranscriptions = $state(false);
	let error = $state<string | null>(null);
	let bootstrapRunId = 0;
	let backupSummaryScheduleId = 0;
	let backupSummaryRunId = 0;

	let projectTranscriptionStatuses = $state.raw<ProjectTranscriptionStatus[]>([]);
	let isLoadingStatuses = $state(false);
	let refreshTarget = $state<ProjectTranscriptionStatus | null>(null);
	let isRefreshing = $state(false);
	let refreshError = $state<string | null>(null);
	let statusLoadRunId = 0;

	let promoteTarget = $state<ProjectTranscriptionStatus | null>(null);
	let isPromoting = $state(false);
	let promoteError = $state<string | null>(null);

	let showAddFromProject = $state(false);
	let addFromProjectCandidates = $state.raw<ProjectTranscriptionSourceCandidate[]>([]);
	let isLoadingCandidates = $state(false);
	let isAddingFromProject = $state(false);
	let addFromProjectError = $state<string | null>(null);

	let createName = $state('');
	let nameDraft = $state('');
	let descriptionDraft = $state('');

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
		const summaries = projects.map(project => projectBackupSummaries[project.id]).filter(Boolean);
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
	let isBusy = $derived(
		isCreating ||
			isLoadingProject ||
			isSavingMetadata ||
			isSavingSettings ||
			isSavingTranscriptions
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
			const connections = await listCloudConnections();
			const nextEntries = await Promise.all(
				projectRows.map(async project => {
					const folders = await listCloudProjectFolders(project.id);
					const folder = folders[0] ?? null;
					if (!folder) {
						return [
							project.id,
							{
								locationLabel: 'Local only',
								statusLabel: 'No backup target',
								badgeClass: 'badge-ghost',
								statusKey: 'local-only',
							},
						] as const;
					}
					const connection = connections.find(
						candidate => candidate.id === folder.connectionId
					);
					const summary = await deriveProjectBackupSummary(
						{
							projectId: project.id,
							connectionId: folder.connectionId,
							cloudFolderId: folder.cloudFolderId,
							cloudFolderPath: folder.cloudFolderPath,
						},
						folder
					);
					return [
						project.id,
						summarizeProjectBackup(connection, folder.cloudFolderPath, summary),
					] as const;
				})
			);
			if (runId !== backupSummaryRunId) return;
			projectBackupSummaries = Object.fromEntries(nextEntries);
		} catch (err) {
			if (runId !== backupSummaryRunId) return;
			logProjects('warn', 'project backup summary load failed', {
				error: err instanceof Error ? err.message : String(err),
			});
			projectBackupSummaries = Object.fromEntries(
				projectRows.map(project => [
					project.id,
					{
						locationLabel: 'Backup status unavailable',
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
		connection: CloudConnectionRecord | undefined,
		cloudFolderPath: string,
		summary: ProjectBackupSummary
	): ProjectListBackupSummary {
		const locationLabel = `${providerLabel(connection?.providerId ?? 'Cloud')}: ${cloudFolderPath}`;
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
				statusLabel: 'Commit changes before backup',
				badgeClass: 'badge-warning',
				statusKey: 'blocked',
			};
		}
		if (summary.pendingItems.length > 0 || summary.tombstones.length > 0) {
			return {
				locationLabel,
				statusLabel: 'Pending backup',
				badgeClass: 'badge-info',
				statusKey: 'pending-backup',
			};
		}
		return {
			locationLabel,
			statusLabel: 'Backed up',
			badgeClass: 'badge-success',
			statusKey: 'backed-up',
		};
	}

	function providerLabel(providerId: string): string {
		if (providerId === 'local-folder') return 'Local folder';
		if (providerId === 'mock') return 'Mock provider';
		return providerId;
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
		void bootstrap();
		const unsubscribe = subscribeLocalDbInvalidations(event => {
			if (
				event.domain === 'cloud-connections' ||
				event.domain === 'cloud-project-folders' ||
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
				event.domain === 'all'
			) {
				if (selectedProjectId) {
					void loadProjectTranscriptionStatuses(selectedProjectId);
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

	async function handleCloudProjectSelected(projectId: string) {
		await bootstrap(projectId);
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

	function handleRequestPromote(status: ProjectTranscriptionStatus) {
		promoteTarget = status;
		promoteError = null;
	}

	function closePromoteDialog() {
		if (isPromoting) return;
		promoteTarget = null;
		promoteError = null;
	}

	async function confirmPromoteTranscription(input: {
		title: string;
		siglum: string;
		description: string;
	}) {
		const target = promoteTarget;
		if (!target) return;
		isPromoting = true;
		promoteError = null;
		try {
			await promoteProjectTranscriptionToLibrary({
				projectTranscriptionId: target.projectTranscriptionId,
				title: input.title,
				siglum: input.siglum,
				description: input.description,
			});
			promoteTarget = null;
			if (selectedProjectId) {
				const runId = ++bootstrapRunId;
				await loadTranscriptionCatalog(runId, selectedProjectId);
			}
		} catch (err) {
			promoteError =
				err instanceof Error ? err.message : 'Failed to promote project transcription';
		} finally {
			isPromoting = false;
		}
	}

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
												{backupSummary?.statusLabel ?? 'Checking backup'}
											</span>
											<span
												class="max-w-full truncate text-[0.68rem] text-base-content/45"
											>
												{backupSummary?.locationLabel ??
													'Backup status loading'}
											</span>
										</div>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<CloudProjectBrowser
					{selectedProjectId}
					onOpenProject={handleCloudProjectSelected}
					onProjectImported={handleCloudProjectSelected}
				/>

				<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-sm">
					<div class="flex items-start justify-between gap-3">
						<div>
							<h2 class="font-serif text-base font-semibold">Local Storage</h2>
							<p class="mt-1 text-xs text-base-content/50">
								Project copies on this device and their backup readiness.
							</p>
						</div>
						{#if storageOverview.isLoading}
							<span class="loading loading-spinner loading-xs mt-1"></span>
						{/if}
					</div>

					<div class="mt-4 grid grid-cols-2 gap-2 text-sm">
						<div class="rounded-box bg-base-200/70 p-3">
							<div class="text-2xl font-semibold">{storageOverview.localProjectCount}</div>
							<div class="text-xs text-base-content/50">Local projects</div>
						</div>
						<div class="rounded-box bg-base-200/70 p-3">
							<div class="text-2xl font-semibold">{storageOverview.linkedCount}</div>
							<div class="text-xs text-base-content/50">Backup targets</div>
						</div>
						<div class="rounded-box bg-base-200/70 p-3">
							<div class="text-2xl font-semibold text-success">
								{storageOverview.backedUpCount}
							</div>
							<div class="text-xs text-base-content/50">Backed up</div>
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
							Verify a project backup before removing its local copy
						</span>
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
					<ProjectBackupPanel
						projectId={currentProject.id}
						onForked={handleProjectForked}
						onRemoved={handleProjectRemoved}
					/>

					<!-- Metadata -->
					<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
						<div class="flex items-center justify-between mb-3">
							<h2 class="font-serif text-lg font-semibold">Project Details</h2>
							{#if isSavingMetadata}
								<span class="loading loading-spinner loading-xs"></span>
							{/if}
						</div>

						<div class="grid gap-3">
							<label class="form-control">
								<div class="label pb-1">
									<span class="label-text text-xs text-base-content/50">Name</span
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
									Updated {new Date(currentProject.updatedAt).toLocaleString()}
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

					<!-- Transcriptions -->
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

					<!-- Project transcription versions and refresh -->
					<ProjectTranscriptionVersionsPanel
						projectId={selectedProjectId ?? ''}
						statuses={projectTranscriptionStatuses}
						isLoading={isLoadingStatuses || isLoadingProject}
						onRefreshTranscription={handleRequestRefresh}
						onPromoteTranscription={handleRequestPromote}
						onAddFromProject={handleRequestAddFromProject}
					/>

					<!-- Collation Settings -->
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

					<!-- Collaboration stub -->
					<ProjectUserManagementStub />
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

	{#if promoteTarget}
		<PromoteProjectTranscriptionDialog
			status={promoteTarget}
			isSubmitting={isPromoting}
			error={promoteError}
			onConfirm={confirmPromoteTranscription}
			onClose={closePromoteDialog}
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
