<script lang="ts">
	import { resolve } from '$app/paths';
	import ClassicCollationImportDialog from '$lib/collation/components/ClassicCollationImportDialog.svelte';

	import {
		deleteCollation,
		listConflictCopies,
		subscribeLocalDbInvalidations,
		listProjectCollationVersionStatuses,
	} from '$lib/db/client';
	import { onMount } from 'svelte';
	import type { ProjectRecord } from '$lib/db/repositories/projects';
	import type { CollationVersionStatus } from '$lib/db/repositories/collations';

	let { data } = $props<{ data: { project: ProjectRecord } }>();

	let projectCollationStatuses = $state.raw<CollationVersionStatus[]>([]);
	let conflictCopyIds = $state.raw(new Set<string>());
	let isLoadingCollations = $state(false);
	let deletingId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let loadRunId = 0;
	let importing = $state(false);
	const groups = $derived.by(() => {
		const byPath = new Map<string, CollationVersionStatus[]>();
		for (const status of projectCollationStatuses)
			byPath.set(status.groupPath, [...(byPath.get(status.groupPath) ?? []), status]);
		return [...byPath]
			.map(([path, statuses]) => ({
				path,
				statuses: path
					? statuses.toSorted(
							(a, b) => a.sortKey - b.sortKey || a.title.localeCompare(b.title)
						)
					: statuses,
			}))
			.sort(
				(a, b) =>
					Number(Boolean(a.path)) - Number(Boolean(b.path)) ||
					a.statuses[0].sortKey - b.statuses[0].sortKey
			);
	});

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
			const [statuses, copies] = await Promise.all([
				listProjectCollationVersionStatuses(projectId),
				listConflictCopies(projectId),
			]);
			if (runId !== loadRunId || data.project.id !== projectId) return;
			projectCollationStatuses = statuses;
			conflictCopyIds = new Set(copies.map(copy => copy.copyId));
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

{#snippet collationRow(status: CollationVersionStatus)}
	<li class="list-row gap-4 items-center">
		<div class="flex-1 min-w-0">
			<div class="font-serif font-medium">{status.title}</div>
			<div class="mt-0.5 flex items-center gap-2 text-xs text-base-content/50">
				<span class="font-mono">{status.verseIdentifier}</span>
			</div>
		</div>
		{#if conflictCopyIds.has(status.collationId)}
			<span class="badge badge-sm badge-warning">Conflict copy</span>
			<a
				href={resolve('/projects/[id]/conflicts/[copyId]', {
					id: data.project.id,
					copyId: status.collationId,
				})}
				class="btn btn-ghost btn-sm"
			>
				Reconcile
			</a>
		{:else}
			<span class="badge badge-sm {phaseBadge(status.workflowStatus)}">
				{phaseLabel(status.workflowStatus)}
			</span>
			<a
				href={resolve('/collation/[id]', { id: status.collationId })}
				class="btn btn-ghost btn-sm"
			>
				Open
			</a>
		{/if}
		<details class="dropdown dropdown-end">
			<summary
				class="btn btn-ghost btn-sm btn-circle list-none text-lg"
				aria-label={`More actions for ${status.title}`}
			>
				...
			</summary>
			<div class="dropdown-content z-20 mt-1 w-36 rounded-box bg-base-100 p-2 shadow-lg">
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
{/snippet}

<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 class="font-serif text-lg font-semibold">Project Collations</h2>
			<p class="text-xs text-base-content/50">Collations owned by {data.project.name}.</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<button type="button" class="btn btn-outline btn-sm" onclick={() => (importing = true)}
				>Import classic collation</button
			>
			<a
				href={resolve(`/collation/new?projectId=${encodeURIComponent(data.project.id)}`)}
				class="btn btn-primary btn-sm"
			>
				New Collation
			</a>
		</div>
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
		{#each groups as group (group.path)}
			{#if group.path}
				<details open class="mt-2">
					<summary class="cursor-pointer py-1 font-serif text-sm font-semibold">
						{group.path}
						<span class="text-xs font-normal text-base-content/50"
							>· {group.statuses.length}</span
						>
					</summary>
					<ul class="list rounded-box bg-base-100">
						{#each group.statuses as status (status.collationId)}
							{@render collationRow(status)}
						{/each}
					</ul>
				</details>
			{:else}
				<ul class="list rounded-box bg-base-100">
					{#each group.statuses as status (status.collationId)}
						{@render collationRow(status)}
					{/each}
				</ul>
			{/if}
		{/each}
	{/if}
</div>

{#if importing}
	<ClassicCollationImportDialog
		projectId={data.project.id}
		onclose={() => (importing = false)}
		onimported={() => {
			importing = false;
			void loadProjectCollationStatuses(data.project.id);
		}}
	/>
{/if}
