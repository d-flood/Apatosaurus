<script lang="ts">
	import { resolve } from '$app/paths';

	import {
		deleteTranscription,
		listConflictCopies,
		subscribeLocalDbInvalidations,
		listProjectTranscriptionStatuses,
	} from '$lib/db/client';
	import { onMount } from 'svelte';
	import type { ProjectRecord, ProjectTranscriptionStatus } from '$lib/db/repositories/projects';

	let { data } = $props<{ data: { project: ProjectRecord } }>();

	let rows = $state.raw<ProjectTranscriptionStatus[]>([]);
	let conflictCopyIds = $state.raw(new Set<string>());
	let isLoading = $state(true);
	let deletingId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let loadRunId = 0;

	$effect(() => {
		void loadRows(data.project.id);
	});

	onMount(() =>
		subscribeLocalDbInvalidations(event => {
			if (
				event.domain === 'projects' ||
				event.domain === 'transcriptions' ||
				event.domain === 'all'
			) {
				void loadRows(data.project.id);
			}
		})
	);

	async function loadRows(projectId: string) {
		const runId = ++loadRunId;
		isLoading = true;
		try {
			const [statuses, copies] = await Promise.all([
				listProjectTranscriptionStatuses(projectId),
				listConflictCopies(projectId),
			]);
			if (runId !== loadRunId || data.project.id !== projectId) return;
			rows = statuses;
			conflictCopyIds = new Set(copies.map(copy => copy.copyId));
			error = null;
		} catch (err) {
			if (runId !== loadRunId) return;
			error = err instanceof Error ? err.message : 'Failed to load project transcriptions';
			console.error('[projects-route] loadProjectTranscriptionLibrary failed', {
				projectId,
				error,
			});
		} finally {
			if (runId === loadRunId) isLoading = false;
		}
	}

	async function handleDelete(row: ProjectTranscriptionStatus) {
		if (
			!confirm(
				`Are you sure you want to delete "${row.title}"? This action cannot be undone.`
			)
		) {
			return;
		}
		deletingId = row.projectOwnedTranscriptionId;
		error = null;
		try {
			await deleteTranscription(row.projectOwnedTranscriptionId);
			await loadRows(data.project.id);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to delete transcription';
		} finally {
			deletingId = null;
		}
	}

	function formatDate(iso: string): string {
		return iso ? new Date(iso).toLocaleDateString() : 'Unknown';
	}
</script>

<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<div class="mb-3">
		<h2 class="font-serif text-lg font-semibold">Project Transcriptions</h2>
		<p class="text-xs text-base-content/50">Transcriptions owned by {data.project.name}.</p>
	</div>

	{#if error}
		<div class="alert alert-error mb-3 text-sm">{error}</div>
	{/if}

	{#if isLoading}
		<div
			class="flex items-center gap-2 rounded-box bg-base-200/70 p-4 text-sm text-base-content/60"
		>
			<span class="loading loading-spinner loading-sm"></span>
			Loading transcriptions...
		</div>
	{:else if rows.length === 0}
		<div
			class="rounded-box border border-dashed border-base-300/80 p-4 text-sm text-base-content/55"
		>
			No transcriptions in this project yet.
		</div>
	{:else}
		<ul class="list rounded-box bg-base-100" aria-label="Transcriptions">
			{#each rows as row (row.projectTranscriptionId)}
				<li class="list-row items-center gap-4">
					<div class="min-w-0 flex-1">
						<div class="font-serif font-medium">{row.title}</div>
						<div
							class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-base-content/50"
						>
							<span class="font-mono">{row.siglum}</span>
							<span class="text-base-content/20">|</span>
							<span>Updated {formatDate(row.updatedAt)}</span>
						</div>
					</div>
					{#if conflictCopyIds.has(row.projectOwnedTranscriptionId)}
						<span class="badge badge-sm badge-warning">Conflict copy</span>
						<a
							href={resolve('/projects/[id]/conflicts/[copyId]', {
								id: data.project.id,
								copyId: row.projectOwnedTranscriptionId,
							})}
							class="btn btn-ghost btn-sm"
						>
							Reconcile
						</a>
					{:else}
						<a
							href={resolve('/transcription/[id]', {
								id: row.projectOwnedTranscriptionId,
							})}
							class="btn btn-ghost btn-sm"
						>
							Open
						</a>
					{/if}
					<details class="dropdown dropdown-end">
						<summary
							class="btn btn-ghost btn-sm btn-circle list-none text-lg"
							aria-label={`More actions for ${row.title}`}
						>
							...
						</summary>
						<div
							class="dropdown-content z-20 mt-1 w-36 rounded-box bg-base-100 p-2 shadow-lg"
						>
							<button
								type="button"
								class="btn btn-ghost btn-sm w-full justify-start text-error"
								disabled={deletingId === row.projectOwnedTranscriptionId}
								onclick={() => handleDelete(row)}
							>
								{deletingId === row.projectOwnedTranscriptionId
									? 'Deleting...'
									: 'Delete'}
							</button>
						</div>
					</details>
				</li>
			{/each}
		</ul>
	{/if}
</div>
