<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		deleteCollation as deleteLocalCollation,
		listCollationsWithProjectNames,
	} from '$lib/client/db/client';
	import type { CollationListItem } from '$lib/client/db/repositories/collations';
	import Plus from 'phosphor-svelte/lib/Plus';
	import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
	import Trash from 'phosphor-svelte/lib/Trash';
	import { onMount } from 'svelte';

	let collations = $state<CollationListItem[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let deletingId = $state<string | null>(null);

	onMount(async () => {
		try {
			collations = await listCollationsWithProjectNames();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load collations';
		} finally {
			isLoading = false;
		}
	});

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

	async function deleteCollation(id: string) {
		deletingId = id;
		try {
			await deleteLocalCollation(id);
			collations = collations.filter((c) => c.id !== id);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to delete collation';
		} finally {
			deletingId = null;
		}
	}

	function formatDate(iso: string): string {
		if (!iso) return '';
		try {
			return new Date(iso).toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			});
		} catch {
			return iso;
		}
	}
</script>

<div class="container mx-auto max-w-3xl p-4">
	<div class="flex items-center justify-between mb-6">
		<h1 class="text-2xl font-serif font-bold tracking-tight">Collations</h1>
		<a href={resolve('/collation/new')} class="btn btn-primary gap-2">
			<Plus size={18} />
			New Collation
		</a>
	</div>

	{#if isLoading}
		<div class="flex items-center gap-2 p-6 bg-base-200 rounded-box justify-center">
			<span class="loading loading-spinner loading-md"></span>
			<span>Loading collations...</span>
		</div>
	{:else if error}
		<div class="alert alert-error mb-4 text-sm">{error}</div>
	{:else if collations.length === 0}
		<div class="text-center py-16 space-y-4">
			<div class="text-base-content/30 text-lg">No collations yet</div>
			<p class="text-sm text-base-content/50 max-w-md mx-auto">
				Create your first collation to begin comparing witnesses across your transcriptions.
			</p>
			<a href={resolve('/collation/new')} class="btn btn-primary btn-sm gap-2">
				<Plus size={16} />
				Start New Collation
			</a>
		</div>
	{:else}
		<ul class="list rounded-box shadow-md bg-base-100">
			{#each collations as c (c.id)}
				<li class="list-row gap-4 items-center">
					<div class="flex-1 min-w-0">
						<div class="font-serif font-medium">{c.title}</div>
						<div class="text-xs text-base-content/50 flex items-center gap-2 mt-0.5">
							<span>{c.projectName}</span>
							<span class="text-base-content/20">|</span>
							<span class="font-mono">{c.verseIdentifier}</span>
							<span class="text-base-content/20">|</span>
							<span>{formatDate(c.updatedAt)}</span>
						</div>
					</div>
					<span class="badge badge-sm {phaseBadge(c.status)}">
						{phaseLabel(c.status)}
					</span>
					<a href={resolve('/collation/[id]', { id: c.id })} class="btn btn-ghost btn-sm gap-1">
						{c.status === 'complete' ? 'View' : 'Resume'}
						<ArrowRight size={14} />
					</a>
					<button
						class="btn btn-ghost btn-sm text-error"
						disabled={deletingId === c.id}
						onclick={() => {
							if (confirm(`Delete "${c.title}"?`)) {
								deleteCollation(c.id);
							}
						}}
					>
						{#if deletingId === c.id}
							<span class="loading loading-spinner loading-xs"></span>
						{:else}
							<Trash size={16} />
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
