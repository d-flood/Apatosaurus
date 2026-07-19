<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		createProjectRecord,
		listProjects,
		type ProjectOption,
	} from '$lib/client/collation/project-collation';
	import { waitForBrowserIdle } from '$lib/client/defer';
	import {
		deriveProjectBackupSummary,
		subscribeLocalDbInvalidations,
	} from '$lib/client/db/client';
	import { ensureLocalDbRuntime } from '$lib/client/db/runtime';
	import { listSyncTargets } from '$lib/client/store';
	import { LOCAL_FOLDER_ROOT_FOLDER_ID } from '$lib/client/sync/providers/local-folder-provider';
	import type { ProjectBackupSummary } from '$lib/client/sync/sync-manager';
	import ProjectZipImportPanel from '$lib/components/projects/ProjectZipImportPanel.svelte';
	import FolderOpen from 'phosphor-svelte/lib/FolderOpen';
	import Plus from 'phosphor-svelte/lib/Plus';
	import { onMount } from 'svelte';

	const PROJECTS_LOG_PREFIX = '[projects-route]';

	interface ProjectListBackupSummary {
		statusLabel: string;
		badgeClass: string;
	}

	let projects = $state.raw<ProjectOption[]>([]);
	let projectBackupSummaries = $state.raw<Record<string, ProjectListBackupSummary>>({});
	let createName = $state('');
	let isBooting = $state(true);
	let isCreating = $state(false);
	let error = $state<string | null>(null);
	let backupSummaryScheduleId = 0;
	let backupSummaryRunId = 0;

	let projectCountLabel = $derived(
		`${projects.length} project${projects.length === 1 ? '' : 's'}`
	);

	function logProjects(
		level: 'debug' | 'warn' | 'error',
		message: string,
		details?: Record<string, unknown>
	) {
		const logger =
			level === 'error' ? console.error : level === 'warn' ? console.warn : console.debug;
		logger(`${PROJECTS_LOG_PREFIX} ${message}`, details ?? {});
	}

	async function loadProjects() {
		isBooting = true;
		error = null;
		try {
			await ensureLocalDbRuntime();
			projects = await listProjects();
			queueProjectBackupSummaries(projects);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to load projects';
			logProjects('error', 'project picker load failed', { error });
		} finally {
			isBooting = false;
		}
	}

	async function createProject() {
		const name = createName.trim();
		if (!name || isCreating) return;
		isCreating = true;
		error = null;
		try {
			const projectId = await createProjectRecord({ name });
			await openProject(projectId);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Failed to create project';
		} finally {
			isCreating = false;
		}
	}

	async function openProject(projectId: string) {
		await goto(resolve('/projects/[id]/transcriptions', { id: projectId }));
	}

	async function loadProjectBackupSummaries(projectRows: ProjectOption[] = projects) {
		const runId = ++backupSummaryRunId;
		if (projectRows.length === 0) {
			projectBackupSummaries = {};
			return;
		}
		try {
			const entries = await Promise.all(
				projectRows.map(async project => {
					const targets = await listSyncTargets(project.id);
					const target =
						targets.find(candidate => candidate.enabled) ?? targets[0] ?? null;
					if (!target) {
						return [
							project.id,
							{ statusLabel: 'Local only', badgeClass: 'badge-ghost' },
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
			logProjects('warn', 'project backup summary load failed', {
				error: cause instanceof Error ? cause.message : String(cause),
			});
			projectBackupSummaries = Object.fromEntries(
				projectRows.map(project => [
					project.id,
					{ statusLabel: 'Sync unavailable', badgeClass: 'badge-warning' },
				])
			);
		}
	}

	function queueProjectBackupSummaries(projectRows: ProjectOption[] = projects) {
		const scheduleId = ++backupSummaryScheduleId;
		void (async () => {
			await waitForBrowserIdle(2_000);
			if (scheduleId === backupSummaryScheduleId)
				await loadProjectBackupSummaries(projectRows);
		})();
	}

	function summarizeProjectBackup(summary: ProjectBackupSummary): ProjectListBackupSummary {
		if (summary.remoteManifestState === 'remote-update-available') {
			return { statusLabel: 'Remote update available', badgeClass: 'badge-warning' };
		}
		if (summary.remoteManifestState === 'diverged') {
			return { statusLabel: 'Sync conflict', badgeClass: 'badge-error' };
		}
		if (summary.remoteManifestState === 'unavailable') {
			return { statusLabel: 'Sync unavailable', badgeClass: 'badge-warning' };
		}
		if (summary.blockingItems.length > 0) {
			return { statusLabel: 'Commit before sync', badgeClass: 'badge-warning' };
		}
		if (summary.pendingItems.length > 0 || summary.tombstones.length > 0) {
			return { statusLabel: 'Pending sync', badgeClass: 'badge-info' };
		}
		return { statusLabel: 'Synced', badgeClass: 'badge-success' };
	}

	onMount(() => {
		void loadProjects();
		return subscribeLocalDbInvalidations(event => {
			if (event.domain === 'projects' || event.domain === 'all') void loadProjects();
			else if (event.domain === 'sync-targets') queueProjectBackupSummaries();
		});
	});
</script>

<main class="container mx-auto max-w-5xl p-4">
	<header class="mb-6 flex items-end justify-between gap-4">
		<div>
			<h1 class="font-serif text-3xl font-bold tracking-tight">Projects</h1>
			<p class="mt-1 text-sm text-base-content/55">
				Choose a project or start a new workspace.
			</p>
		</div>
		<span class="badge badge-outline text-xs">{projectCountLabel}</span>
	</header>

	{#if error}<div class="alert alert-error mb-4 text-sm">{error}</div>{/if}

	<section class="rounded-box border border-base-300/60 bg-base-100 p-5 shadow-sm">
		<h2 class="font-serif text-xl font-semibold">Create a project</h2>
		<div class="mt-3 flex max-w-xl gap-2">
			<input
				type="text"
				class="input input-bordered flex-1"
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
				class="btn btn-primary gap-2"
				disabled={isCreating || !createName.trim()}
				onclick={createProject}
			>
				{#if isCreating}<span class="loading loading-spinner loading-xs"></span>{:else}<Plus
						size={16}
					/>{/if}
				Create
			</button>
		</div>
	</section>

	<section class="mt-6" aria-labelledby="project-library-heading">
		<h2 id="project-library-heading" class="font-serif text-xl font-semibold">
			Project Library
		</h2>
		{#if isBooting}
			<div
				class="mt-3 flex items-center gap-2 rounded-box bg-base-200 p-5 text-sm text-base-content/55"
			>
				<span class="loading loading-spinner loading-sm"></span> Loading projects...
			</div>
		{:else if projects.length === 0}
			<div class="mt-3 rounded-box border border-dashed border-base-300 p-8 text-center">
				<FolderOpen size={28} class="mx-auto text-base-content/30" />
				<p class="mt-2 font-medium">No projects yet</p>
				<p class="mt-1 text-sm text-base-content/55">
					Name your first project above to begin.
				</p>
			</div>
		{:else}
			<div class="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each projects as project (project.id)}
					{@const backupSummary = projectBackupSummaries[project.id]}
					<article
						class="rounded-box border border-base-300/60 bg-base-100 p-5 shadow-sm"
					>
						<h3 class="font-serif text-lg font-semibold">{project.name}</h3>
						<p class="mt-1 min-h-10 text-sm text-base-content/55">
							{project.description || 'No description'}
						</p>
						<div class="mt-4 flex items-center justify-between gap-3">
							<span
								class="badge badge-sm {backupSummary?.badgeClass ?? 'badge-ghost'}"
							>
								{backupSummary?.statusLabel ?? 'Checking sync'}
							</span>
							<a
								href={resolve('/projects/[id]/transcriptions', { id: project.id })}
								class="btn btn-primary btn-sm">Open</a
							>
						</div>
					</article>
				{/each}
			</div>
		{/if}
	</section>

	<section class="mt-6 max-w-xl">
		<ProjectZipImportPanel onImported={openProject} />
	</section>
</main>
