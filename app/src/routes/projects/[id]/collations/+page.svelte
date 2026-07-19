<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		listProjectCollationVersionStatuses,
		type CollationVersionStatus,
		type ProjectRecord,
	} from '$lib/client/collation/project-collation';
	import { deleteCollation, subscribeLocalDbInvalidations } from '$lib/client/db/client';
	import { onMount } from 'svelte';

	let { data } = $props<{ data: { project: ProjectRecord } }>();

	let projectCollationStatuses = $state.raw<CollationVersionStatus[]>([]);
	let isLoadingCollations = $state(false);
	let deletingId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let loadRunId = 0;

	$effect(() => {
		void loadProjectCollationStatuses(data.project.id);
	});

	onMount(() =>
		subscribeLocalDbInvalidations(event => {
			if (
				event.domain === 'projects' ||
				event.domain === 'collations' ||
				event.domain === 'all'
			) {
				void loadProjectCollationStatuses(data.project.id);
			}
		})
	);

	async function loadProjectCollationStatuses(projectId: string) {
		const runId = ++loadRunId;
		isLoadingCollations = true;
		try {
			const statuses = await listProjectCollationVersionStatuses(projectId);
			if (runId !== loadRunId || data.project.id !== projectId) return;
			projectCollationStatuses = statuses;
			error = null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load project collations';
			console.error('[projects-route] loadProjectCollationStatuses failed', {
				projectId,
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			if (runId === loadRunId) isLoadingCollations = false;
		}
	}

	async function handleDelete(status: CollationVersionStatus) {
		if (!confirm(`Delete "${status.title}"?`)) return;
		deletingId = status.collationId;
		error = null;
		try {
			await deleteCollation(status.collationId);
			await loadProjectCollationStatuses(data.project.id);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to delete collation';
		} finally {
			deletingId = null;
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
</script>

<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<div class="mb-3 flex items-center justify-between gap-3">
		<div>
			<h2 class="font-serif text-lg font-semibold">Project Collations</h2>
			<p class="text-xs text-base-content/50">Collations owned by {data.project.name}.</p>
		</div>
		<a
			href={resolve(`/collation/new?projectId=${encodeURIComponent(data.project.id)}`)}
			class="btn btn-primary btn-sm"
		>
			New Collation
		</a>
	</div>

	{#if error}
		<div class="alert alert-error mb-3 text-sm">{error}</div>
	{/if}

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
						<div class="font-serif font-medium">{status.title}</div>
						<div class="mt-0.5 flex items-center gap-2 text-xs text-base-content/50">
							<span class="font-mono">{status.verseIdentifier}</span>
							<span class="text-base-content/20">|</span>
							<span>
								{status.commitState === 'dirty'
									? 'Uncommitted changes'
									: 'Committed state current'}
							</span>
						</div>
					</div>
					<span class="badge badge-sm {phaseBadge(status.workflowStatus)}">
						{phaseLabel(status.workflowStatus)}
					</span>
					<a
						href={resolve('/collation/[id]', { id: status.collationId })}
						class="btn btn-ghost btn-sm"
					>
						Open
					</a>
					<details class="dropdown dropdown-end">
						<summary
							class="btn btn-ghost btn-sm btn-circle list-none text-lg"
							aria-label={`More actions for ${status.title}`}
						>
							...
						</summary>
						<div
							class="dropdown-content z-20 mt-1 w-36 rounded-box bg-base-100 p-2 shadow-lg"
						>
							<button
								type="button"
								class="btn btn-ghost btn-sm w-full justify-start text-error"
								disabled={deletingId === status.collationId}
								onclick={() => handleDelete(status)}
							>
								{deletingId === status.collationId ? 'Deleting...' : 'Delete'}
							</button>
						</div>
					</details>
				</li>
			{/each}
		</ul>
	{/if}
</div>
