<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		updateProjectMetadata,
		type ProjectRecord,
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
	import ProjectUserManagementStub from '$lib/components/projects/ProjectUserManagementStub.svelte';

	let { data } = $props<{ data: { project: ProjectRecord } }>();

	let currentProject = $derived(data.project);
	let nameDraft = $state('');
	let descriptionDraft = $state('');
	let projectRules = $state<RegularizationRule[]>([]);
	let lowercase = $state(false);
	let ignoreWordBreaks = $state(false);
	let ignorePunctuation = $state(false);
	let suppliedTextMode = $state<SuppliedTextMode>('clear');
	let segmentation = $state(true);
	let transcriptionWitnessTreatments = $state<Map<string, WitnessTreatment>>(new Map());
	let transcriptionWitnessExcludedHands = $state<Map<string, string[]>>(new Map());
	let isSavingMetadata = $state(false);
	let isSavingSettings = $state(false);
	let error = $state<string | null>(null);

	let metadataDirty = $derived(
		nameDraft.trim() !== currentProject.name ||
			descriptionDraft.trim() !== currentProject.description
	);

	$effect(() => {
		const project = data.project;
		nameDraft = project.name;
		descriptionDraft = project.description;
		applyProjectSettings(project);
	});

	function applyProjectSettings(project: ProjectRecord) {
		const settings = parseProjectCollationSettings(project.collationSettings);
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

	async function saveMetadata() {
		const projectId = currentProject.id;
		const name = nameDraft.trim();
		if (!name) {
			error = 'Project name is required';
			return;
		}
		isSavingMetadata = true;
		error = null;
		try {
			await updateProjectMetadata(projectId, {
				name,
				description: descriptionDraft,
			});
			descriptionDraft = descriptionDraft.trim();
			await invalidateAll();
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
	}) {
		const nextRules = nextState?.rules ?? projectRules;
		const nextLowercase = nextState?.lowercase ?? lowercase;
		const nextIgnoreWordBreaks = nextState?.ignoreWordBreaks ?? ignoreWordBreaks;
		const nextIgnorePunctuation = nextState?.ignorePunctuation ?? ignorePunctuation;
		const nextSuppliedTextMode = nextState?.suppliedTextMode ?? suppliedTextMode;
		const nextSegmentation = nextState?.segmentation ?? segmentation;
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
				transcriptionWitnessTreatments,
				transcriptionWitnessExcludedHands,
			});
			await updateProjectMetadata(currentProject.id, {
				collationSettings,
				updatedAt: now,
			});
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to save project settings';
		} finally {
			isSavingSettings = false;
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
</script>

{#if error}
	<div class="alert alert-error text-sm">{error}</div>
{/if}

<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<div class="mb-3 flex items-center justify-between">
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
			<input type="text" class="input input-bordered w-full" bind:value={nameDraft} />
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

{#if isSavingSettings}
	<span class="sr-only">Saving project settings</span>
{/if}
