<script lang="ts">
	import {
		addProjectTranscriptionFromProject,
		getProjectTranscriptionIds,
		listProjectTranscriptionSourceCandidates,
		listProjectTranscriptionStatuses,
		listTranscriptions,
		loadTranscriptionHands,
		refreshProjectTranscription,
		syncProjectTranscriptionIds,
		updateProjectMetadata,
		type ProjectRecord,
		type ProjectTranscriptionOption,
		type ProjectTranscriptionSourceCandidate,
		type ProjectTranscriptionSourceState,
		type ProjectTranscriptionStatus,
	} from '$lib/client/collation/project-collation';
	import type { WitnessTreatment } from '$lib/client/collation/collation-types';
	import {
		createProjectCollationSettings,
		parseProjectCollationSettings,
	} from '$lib/client/collation/project-settings';
	import { subscribeLocalDbInvalidations } from '$lib/client/db/client';
	import AddProjectTranscriptionFromProjectDialog from '$lib/components/projects/AddProjectTranscriptionFromProjectDialog.svelte';
	import ProjectTranscriptionRefreshDialog from '$lib/components/projects/ProjectTranscriptionRefreshDialog.svelte';
	import ProjectTranscriptionsEditor from '$lib/components/projects/ProjectTranscriptionsEditor.svelte';
	import ProjectTranscriptionVersionsPanel from '$lib/components/projects/ProjectTranscriptionVersionsPanel.svelte';
	import { onMount } from 'svelte';

	const PROJECTS_LOG_PREFIX = '[projects-route]';

	let { data } = $props<{ data: { project: ProjectRecord } }>();

	let currentProject = $derived(data.project);
	let projectCollationSettings = $state<unknown>(null);
	let allTranscriptions = $state.raw<ProjectTranscriptionOption[]>([]);
	let selectedTranscriptionIds = $state.raw<string[]>([]);
	let transcriptionWitnessTreatments = $state<Map<string, WitnessTreatment>>(new Map());
	let transcriptionWitnessExcludedHands = $state<Map<string, string[]>>(new Map());
	let isLoadingProject = $state(true);
	let isLoadingTranscriptions = $state(false);
	let isSavingSettings = $state(false);
	let isSavingTranscriptions = $state(false);
	let error = $state<string | null>(null);
	let bootstrapRunId = 0;

	let projectTranscriptionStatuses = $state.raw<ProjectTranscriptionStatus[]>([]);
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

	let refreshSourceCheckpointId = $derived(
		refreshTarget ? (resolveRefreshSource(refreshTarget)?.sourceCheckpointId ?? '') : ''
	);

	$effect(() => {
		void bootstrap(data.project);
	});

	onMount(() =>
		subscribeLocalDbInvalidations(event => {
			if (
				event.domain === 'projects' ||
				event.domain === 'transcriptions' ||
				event.domain === 'collations' ||
				event.domain === 'all'
			) {
				void loadProjectTranscriptionStatuses(currentProject.id);
			}
		})
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

	function applyProjectSettings(record: ProjectRecord) {
		projectCollationSettings = record.collationSettings;
		const settings = parseProjectCollationSettings(record.collationSettings);
		transcriptionWitnessTreatments = new Map(
			Object.entries(settings.transcriptionWitnessTreatments ?? {})
		);
		transcriptionWitnessExcludedHands = new Map(
			Object.entries(settings.transcriptionWitnessExcludedHands ?? {}).map(
				([transcriptionId, handIds]) => [transcriptionId, [...handIds]]
			)
		);
	}

	async function bootstrap(project: ProjectRecord) {
		const runId = ++bootstrapRunId;
		const projectId = project.id;
		isLoadingProject = true;
		error = null;
		applyProjectSettings(project);
		try {
			selectedTranscriptionIds = await runLoggedStep(
				'getProjectTranscriptionIds',
				() => getProjectTranscriptionIds(projectId),
				{ projectId, runId }
			);
			if (runId !== bootstrapRunId || currentProject.id !== projectId) return;
			void loadProjectTranscriptionStatuses(projectId);
			void loadTranscriptionCatalog(runId, projectId);
		} catch (err) {
			if (runId !== bootstrapRunId) return;
			error = err instanceof Error ? err.message : 'Failed to load project';
			logProjects('error', 'project transcription workspace failed', {
				projectId,
				runId,
				error,
			});
		} finally {
			if (runId === bootstrapRunId) isLoadingProject = false;
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
			if (runId !== statusLoadRunId || currentProject.id !== projectId) return;
			projectTranscriptionStatuses = statuses;
		} catch (err) {
			if (runId !== statusLoadRunId) return;
			logProjects('error', 'loadProjectTranscriptionStatuses failed', {
				projectId,
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			if (runId === statusLoadRunId) isLoadingStatuses = false;
		}
	}

	async function loadTranscriptionCatalog(runId: number, projectId: string) {
		isLoadingTranscriptions = true;
		try {
			const transcriptionRows = await runLoggedStep(
				'listTranscriptions',
				() => listTranscriptions(projectId),
				{ projectId, runId }
			);
			if (runId !== bootstrapRunId || currentProject.id !== projectId) {
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
			if (runId !== bootstrapRunId) return;
			error = err instanceof Error ? err.message : 'Failed to load transcriptions';
			logProjects('error', 'transcription catalog failed', {
				projectId,
				runId,
				error,
			});
		} finally {
			if (runId === bootstrapRunId) isLoadingTranscriptions = false;
		}
	}

	async function persistProjectSettings(nextState?: {
		transcriptionWitnessTreatments?: Map<string, WitnessTreatment>;
		transcriptionWitnessExcludedHands?: Map<string, string[]>;
	}) {
		const settings = parseProjectCollationSettings(projectCollationSettings);
		const nextTreatments =
			nextState?.transcriptionWitnessTreatments ?? transcriptionWitnessTreatments;
		const nextExcludedHands =
			nextState?.transcriptionWitnessExcludedHands ?? transcriptionWitnessExcludedHands;
		const now = new Date().toISOString();
		isSavingSettings = true;
		error = null;
		try {
			const collationSettings = createProjectCollationSettings(
				settings.regularizationRules ?? [],
				{
					ignoreWordBreaks: settings.ignoreWordBreaks ?? false,
					lowercase: settings.lowercase ?? false,
					ignoreTokenWhitespace: true,
					ignorePunctuation: settings.ignorePunctuation ?? false,
					suppliedTextMode: settings.suppliedTextMode ?? 'clear',
					segmentation: settings.segmentation ?? true,
					transcriptionWitnessTreatments: nextTreatments,
					transcriptionWitnessExcludedHands: nextExcludedHands,
				}
			);
			await updateProjectMetadata(currentProject.id, {
				collationSettings,
				updatedAt: now,
			});
			projectCollationSettings = collationSettings;
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
		if (included) handIds.delete(normalizedHandId);
		else handIds.add(normalizedHandId);
		if (handIds.size === 0) nextExcludedHands.delete(transcriptionId);
		else nextExcludedHands.set(transcriptionId, [...handIds].sort());
		transcriptionWitnessExcludedHands = nextExcludedHands;
		void persistProjectSettings({ transcriptionWitnessExcludedHands: nextExcludedHands });
	}

	async function toggleAllProjectTranscriptions(checked: boolean) {
		const projectId = currentProject.id;
		isSavingTranscriptions = true;
		error = null;
		try {
			const nextIds = checked ? allTranscriptions.map(transcription => transcription.id) : [];
			const syncedIds = await syncProjectTranscriptionIds(projectId, nextIds);
			if (currentProject.id !== projectId) return;
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
		const index = allTranscriptions.findIndex(
			transcription => transcription.id === transcriptionId
		);
		if (index === -1 || allTranscriptions[index]!.hands.length > 0) return;
		const hands = await loadTranscriptionHands(transcriptionId);
		allTranscriptions = allTranscriptions.map(transcription =>
			transcription.id === transcriptionId ? { ...transcription, hands } : transcription
		);
	}

	async function loadHandsForSelectedTranscriptions() {
		const idsNeedingHands = selectedTranscriptionIds.filter(id => {
			const transcription = allTranscriptions.find(candidate => candidate.id === id);
			return transcription && transcription.hands.length === 0;
		});
		for (const id of idsNeedingHands) await ensureTranscriptionHands(id);
	}

	async function toggleProjectTranscription(transcriptionId: string) {
		const projectId = currentProject.id;
		isSavingTranscriptions = true;
		error = null;
		try {
			const nextIds = selectedTranscriptionIds.includes(transcriptionId)
				? selectedTranscriptionIds.filter(id => id !== transcriptionId)
				: [...selectedTranscriptionIds, transcriptionId];
			const syncedIds = await syncProjectTranscriptionIds(projectId, nextIds);
			if (currentProject.id !== projectId) return;
			const runId = ++bootstrapRunId;
			selectedTranscriptionIds = syncedIds;
			await loadTranscriptionCatalog(runId, projectId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to update project transcriptions';
		} finally {
			isSavingTranscriptions = false;
		}
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
			await loadProjectTranscriptionStatuses(currentProject.id);
		} catch (err) {
			refreshError =
				err instanceof Error ? err.message : 'Failed to refresh project transcription';
		} finally {
			isRefreshing = false;
		}
	}

	async function handleRequestAddFromProject() {
		showAddFromProject = true;
		addFromProjectError = null;
		isLoadingCandidates = true;
		try {
			addFromProjectCandidates = await listProjectTranscriptionSourceCandidates(
				currentProject.id
			);
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
		const projectId = currentProject.id;
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

{#if error}
	<div class="alert alert-error text-sm">{error}</div>
{/if}

<ProjectTranscriptionsEditor
	{allTranscriptions}
	{selectedTranscriptionIds}
	isLoading={isLoadingProject || isLoadingTranscriptions}
	isSaving={isSavingTranscriptions || isSavingSettings}
	getTreatment={getProjectTranscriptionTreatment}
	isHandIncluded={isProjectTranscriptionHandIncluded}
	setTreatment={setProjectTranscriptionTreatment}
	setHandIncluded={setProjectTranscriptionHandIncluded}
	setAllTreatments={setAllProjectTranscriptionTreatments}
	onToggleTranscription={toggleProjectTranscription}
	onToggleAllTranscriptions={toggleAllProjectTranscriptions}
/>

<ProjectTranscriptionVersionsPanel
	projectId={currentProject.id}
	statuses={projectTranscriptionStatuses}
	isLoading={isLoadingStatuses || isLoadingProject}
	onRefreshTranscription={handleRequestRefresh}
	onAddFromProject={handleRequestAddFromProject}
/>

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
