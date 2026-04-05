<script lang="ts">
	import { Project } from '$generated/models/Project';
	import {
		createProjectRecord,
		getProject,
		getProjectTranscriptionIds,
		listProjects,
		listTranscriptions,
		syncProjectTranscriptionIds,
		updateProjectMetadata,
		type ProjectOption,
		type ProjectRecord,
		type ProjectTranscriptionOption,
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
	import ProjectUserManagementStub from '$lib/components/projects/ProjectUserManagementStub.svelte';
	import { ensureDjazzkitRuntime } from '$lib/client/djazzkit-runtime';
	import FolderOpen from 'phosphor-svelte/lib/FolderOpen';
	import Plus from 'phosphor-svelte/lib/Plus';
	import { onMount } from 'svelte';

	const PROJECTS_LOG_PREFIX = '[projects-route]';

	let projects = $state<ProjectOption[]>([]);
	let allTranscriptions = $state<ProjectTranscriptionOption[]>([]);
	let currentProject = $state<ProjectRecord | null>(null);
	let selectedProjectId = $state<string | null>(null);
	let selectedTranscriptionIds = $state<string[]>([]);

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
	let isCreating = $state(false);
	let isSavingMetadata = $state(false);
	let isSavingSettings = $state(false);
	let isSavingTranscriptions = $state(false);
	let error = $state<string | null>(null);

	let createName = $state('');
	let nameDraft = $state('');
	let descriptionDraft = $state('');

	let metadataDirty = $derived(
		Boolean(
			currentProject &&
				(nameDraft.trim() !== currentProject.name || descriptionDraft.trim() !== currentProject.description),
		),
	);
	let projectCountLabel = $derived(`${projects.length} project${projects.length === 1 ? '' : 's'}`);
	let isBusy = $derived(
		isCreating || isLoadingProject || isSavingMetadata || isSavingSettings || isSavingTranscriptions,
	);

	function logProjects(
		level: 'debug' | 'warn' | 'error',
		message: string,
		details?: Record<string, unknown>,
	) {
		const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.debug;
		if (details && Object.keys(details).length > 0) {
			logger(`${PROJECTS_LOG_PREFIX} ${message}`, details);
			return;
		}
		logger(`${PROJECTS_LOG_PREFIX} ${message}`);
	}

	async function runLoggedStep<T>(
		label: string,
		step: () => Promise<T>,
		details?: Record<string, unknown>,
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
			Object.entries(settings.transcriptionWitnessTreatments ?? {}),
		);
		transcriptionWitnessExcludedHands = new Map(
			Object.entries(settings.transcriptionWitnessExcludedHands ?? {}).map(([transcriptionId, handIds]) => [
				transcriptionId,
				[...handIds],
			]),
		);
	}

	function touchProjectList(projectId: string, updates: Partial<ProjectOption>, updatedAt: string) {
		projects = [...projects]
			.map((project) =>
				project.id === projectId ? { ...project, ...updates, updatedAt } : project,
			)
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
		if (currentProject?.id === projectId) {
			currentProject = { ...currentProject, ...updates, updatedAt };
		}
	}

	async function loadProject(projectId: string) {
		isLoadingProject = true;
		error = null;
		try {
			logProjects('debug', 'loadProject start', { projectId });
			const [project, transcriptionIds] = await Promise.all([
				runLoggedStep('getProject', () => getProject(projectId), { projectId }),
				runLoggedStep('getProjectTranscriptionIds', () => getProjectTranscriptionIds(projectId), {
					projectId,
				}),
			]);
			if (!project) {
				projects = projects.filter((candidate) => candidate.id !== projectId);
				selectedProjectId = projects[0]?.id ?? null;
				currentProject = null;
				selectedTranscriptionIds = [];
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

	async function bootstrap(preferredProjectId: string | null = null) {
		isBooting = true;
		error = null;
		try {
			logProjects('debug', 'bootstrap start', {
				preferredProjectId,
				selectedProjectId,
			});
			await runLoggedStep('ensureDjazzkitRuntime', () => ensureDjazzkitRuntime(), {
				preferredProjectId,
			});
			const [projectRows, transcriptionRows] = await Promise.all([
				runLoggedStep('listProjects', () => listProjects(), {
					preferredProjectId,
				}),
				runLoggedStep('listTranscriptions', () => listTranscriptions(), {
					preferredProjectId,
				}),
			]);
			projects = projectRows;
			allTranscriptions = transcriptionRows;
			logProjects('debug', 'bootstrap query batch completed', {
				projectCount: projectRows.length,
				transcriptionCount: transcriptionRows.length,
			});
			if (projectRows.length === 0) {
				selectedProjectId = null;
				currentProject = null;
				selectedTranscriptionIds = [];
				applyProjectSettings(null);
				logProjects('warn', 'bootstrap completed with no projects', {});
				return;
			}
			const availableIds = new Set(projectRows.map((project) => project.id));
			const nextProjectId =
				(preferredProjectId && availableIds.has(preferredProjectId) && preferredProjectId) ||
				(selectedProjectId && availableIds.has(selectedProjectId) && selectedProjectId) ||
				projectRows[0]!.id;
			await loadProject(nextProjectId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load projects';
			logProjects('error', 'bootstrap failed', {
				preferredProjectId,
				error,
			});
		} finally {
			logProjects('debug', 'bootstrap finished', {
				preferredProjectId,
				isBooting: false,
				error,
			});
			isBooting = false;
		}
	}

	onMount(() => {
		void bootstrap();
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
			touchProjectList(
				selectedProjectId,
				{ name, description: descriptionDraft },
				now,
			);
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
		const nextTreatments = nextState?.transcriptionWitnessTreatments ?? transcriptionWitnessTreatments;
		const nextExcludedHands =
			nextState?.transcriptionWitnessExcludedHands ?? transcriptionWitnessExcludedHands;
		const now = new Date().toISOString();
		isSavingSettings = true;
		error = null;
		try {
			await Project.objects.update(selectedProjectId, {
				collation_settings: JSON.stringify(
					createProjectCollationSettings(nextRules, {
						ignoreWordBreaks: nextIgnoreWordBreaks,
						lowercase: nextLowercase,
						ignoreTokenWhitespace: true,
						ignorePunctuation: nextIgnorePunctuation,
						suppliedTextMode: nextSuppliedTextMode,
						segmentation: nextSegmentation,
						transcriptionWitnessTreatments: nextTreatments,
						transcriptionWitnessExcludedHands: nextExcludedHands,
					}),
				),
				_djazzkit_updated_at: now,
				updated_at: now,
			});
			touchProjectList(selectedProjectId, {}, now);
			if (currentProject?.id === selectedProjectId) {
				currentProject = {
					...currentProject,
					collationSettings: createProjectCollationSettings(nextRules, {
						ignoreWordBreaks: nextIgnoreWordBreaks,
						lowercase: nextLowercase,
						ignoreTokenWhitespace: true,
						ignorePunctuation: nextIgnorePunctuation,
						suppliedTextMode: nextSuppliedTextMode,
						segmentation: nextSegmentation,
						transcriptionWitnessTreatments: nextTreatments,
						transcriptionWitnessExcludedHands: nextExcludedHands,
					}),
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

	function setProjectTranscriptionTreatment(transcriptionId: string, treatment: WitnessTreatment) {
		const nextTreatments = new Map(transcriptionWitnessTreatments);
		nextTreatments.set(transcriptionId, treatment === 'full' ? 'full' : 'fragmentary');
		transcriptionWitnessTreatments = nextTreatments;
		void persistProjectSettings({ transcriptionWitnessTreatments: nextTreatments });
	}

	function setAllProjectTranscriptionTreatments(
		transcriptionIds: string[],
		treatment: WitnessTreatment,
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
		included: boolean,
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
		if (!selectedProjectId) return;
		isSavingTranscriptions = true;
		error = null;
		try {
			const nextIds = checked ? allTranscriptions.map((t) => t.id) : [];
			await syncProjectTranscriptionIds(selectedProjectId, nextIds);
			selectedTranscriptionIds = nextIds;
			touchProjectList(selectedProjectId, {}, new Date().toISOString());
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to update project transcriptions';
		} finally {
			isSavingTranscriptions = false;
		}
	}

	async function toggleProjectTranscription(transcriptionId: string) {
		if (!selectedProjectId) return;
		isSavingTranscriptions = true;
		error = null;
		try {
			const nextIds = selectedTranscriptionIds.includes(transcriptionId)
				? selectedTranscriptionIds.filter((id) => id !== transcriptionId)
				: [...selectedTranscriptionIds, transcriptionId];
			await syncProjectTranscriptionIds(selectedProjectId, nextIds);
			selectedTranscriptionIds = nextIds;
			touchProjectList(selectedProjectId, {}, new Date().toISOString());
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
		const nextRules = projectRules.filter((rule) => rule.id !== ruleId);
		projectRules = nextRules;
		void persistProjectSettings({ rules: nextRules });
	}

	function toggleRule(ruleId: string) {
		const nextRules = projectRules.map((rule) =>
			rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule,
		);
		projectRules = nextRules;
		void persistProjectSettings({ rules: nextRules });
	}

	function setRuleType(ruleId: string, type: RegularizationType) {
		const nextRules = projectRules.map((rule) =>
			rule.id === ruleId ? { ...rule, type } : rule,
		);
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
							onkeydown={(event) => {
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
						<div class="flex items-center gap-2 p-4 bg-base-200 rounded-box justify-center">
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
												void loadProject(project.id);
											}
										}}
									>
										<div class="font-serif font-medium text-sm">{project.name}</div>
										{#if project.description}
											<div class="text-xs text-base-content/50 mt-0.5 line-clamp-1">
												{project.description}
											</div>
										{/if}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
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
						Create your first project to start linking transcriptions and configuring collation settings.
					</p>
				</div>
			{:else if currentProject}
				<div class="space-y-6">
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
									<span class="label-text text-xs text-base-content/50">Name</span>
								</div>
								<input
									type="text"
									class="input input-bordered w-full"
									bind:value={nameDraft}
								/>
							</label>
							<label class="form-control">
								<div class="label pb-1">
									<span class="label-text text-xs text-base-content/50">Description</span>
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
						isLoading={isLoadingProject}
						isSaving={isSavingTranscriptions}
						getTreatment={getProjectTranscriptionTreatment}
						isHandIncluded={isProjectTranscriptionHandIncluded}
						setTreatment={setProjectTranscriptionTreatment}
						setHandIncluded={setProjectTranscriptionHandIncluded}
						setAllTreatments={setAllProjectTranscriptionTreatments}
						onToggleTranscription={toggleProjectTranscription}
						onToggleAllTranscriptions={toggleAllProjectTranscriptions}
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
</div>
