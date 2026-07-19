<script module lang="ts">
	import type { ProjectOption } from '$lib/client/db/repositories/projects';
	import type { EntityCommitState } from '$lib/client/db/repositories/revisions';

	export interface DashboardDocument {
		id: string;
		type: 'Transcription' | 'Collation';
		title: string;
		projectName: string;
		commitState: EntityCommitState;
		updatedAt: string;
		href: string;
	}

	export interface DashboardAttentionItem {
		id: string;
		title: string;
		description: string;
		href: string;
		linkLabel: string;
	}

	export interface DashboardProps {
		projects: ProjectOption[];
		lastOpenedProject: ProjectOption | null;
		recentDocuments: DashboardDocument[];
		attentionItems: DashboardAttentionItem[];
		isLoading?: boolean;
		error?: string | null;
		appVersion?: string;
	}
</script>

<script lang="ts">
	import { resolve } from '$app/paths';

	let {
		projects,
		lastOpenedProject,
		recentDocuments,
		attentionItems,
		isLoading = false,
		error = null,
		appVersion = 'development',
	}: DashboardProps = $props();

	function commitStateLabel(state: DashboardDocument['commitState']): string {
		if (state === 'never-committed') return 'No committed version yet';
		if (state === 'dirty') return 'Uncommitted changes';
		return 'Committed';
	}

	function commitStateBadge(state: DashboardDocument['commitState']): string {
		if (state === 'dirty') return 'badge-warning';
		if (state === 'clean') return 'badge-success';
		return 'badge-ghost';
	}

	function formatRelativeTime(value: string): string {
		const elapsedSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
		const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
		if (Math.abs(elapsedSeconds) < 60) return 'just now';
		const elapsedMinutes = Math.round(elapsedSeconds / 60);
		if (Math.abs(elapsedMinutes) < 60) return formatter.format(elapsedMinutes, 'minute');
		const elapsedHours = Math.round(elapsedMinutes / 60);
		if (Math.abs(elapsedHours) < 24) return formatter.format(elapsedHours, 'hour');
		const elapsedDays = Math.round(elapsedHours / 24);
		if (Math.abs(elapsedDays) < 30) return formatter.format(elapsedDays, 'day');
		const elapsedMonths = Math.round(elapsedDays / 30);
		if (Math.abs(elapsedMonths) < 12) return formatter.format(elapsedMonths, 'month');
		return formatter.format(Math.round(elapsedMonths / 12), 'year');
	}
</script>

<svelte:head><title>Apatosaurus Dashboard</title></svelte:head>

{#if isLoading}
	<main class="mx-auto flex min-h-[60vh] max-w-6xl items-center justify-center p-4">
		<div class="flex items-center gap-3 text-sm text-base-content/55">
			<span class="loading loading-spinner loading-md"></span>
			Loading your workspace...
		</div>
	</main>
{:else if projects.length === 0}
	<main class="mx-auto flex min-h-[70vh] max-w-3xl items-center px-4 py-12">
		<section
			class="w-full rounded-box border border-base-300/60 bg-base-100 p-8 shadow-md sm:p-12"
		>
			<p class="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
				Welcome to Apatosaurus
			</p>
			<h1 class="mt-3 max-w-xl font-serif text-4xl font-bold tracking-tight sm:text-5xl">
				Begin with a project
			</h1>
			<p class="mt-4 max-w-2xl leading-relaxed text-base-content/65">
				Projects keep related transcriptions, collations, and scholarly decisions together.
				Create your first one to begin working.
			</p>
			<a href={resolve('/projects')} class="btn btn-primary mt-7">Create your first project</a
			>
		</section>
	</main>
{:else}
	<main class="container mx-auto max-w-6xl px-4 py-8">
		<header class="mb-8 border-b border-base-300/60 pb-6">
			<p class="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
				Workspace overview
			</p>
			<h1 class="mt-1 font-serif text-4xl font-bold tracking-tight">Dashboard</h1>
			<p class="mt-2 max-w-2xl text-sm leading-relaxed text-base-content/60">
				Return to recent scholarship or begin something new in {lastOpenedProject?.name ??
					'a project'}.
			</p>
		</header>

		{#if error}
			<div class="alert alert-error mb-6 text-sm">{error}</div>
		{/if}

		{#if recentDocuments.length > 0}
			<section class="mb-8" data-testid="dashboard-continue">
				<div class="mb-3 flex items-end justify-between gap-4">
					<div>
						<p
							class="text-xs font-semibold uppercase tracking-wide text-base-content/45"
						>
							Recent work
						</p>
						<h2 class="font-serif text-2xl font-semibold">
							Continue where you left off
						</h2>
					</div>
					<span class="text-xs text-base-content/45">Most recently changed</span>
				</div>
				<ul
					class="overflow-hidden rounded-box border border-base-300/60 bg-base-100 shadow-sm"
					aria-label="Recent documents"
				>
					{#each recentDocuments as document (document.type + document.id)}
						<li
							class="grid gap-3 border-b border-base-300/50 p-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
						>
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<span class="badge badge-outline badge-sm">{document.type}</span
									>
									<h3 class="truncate font-serif font-semibold">
										{document.title}
									</h3>
								</div>
								<p class="mt-1 text-xs text-base-content/50">
									{document.projectName} · Touched {formatRelativeTime(
										document.updatedAt
									)}
								</p>
							</div>
							<span class="badge badge-sm {commitStateBadge(document.commitState)}">
								{commitStateLabel(document.commitState)}
							</span>
							<a href={document.href} class="btn btn-ghost btn-sm">Open</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if recentDocuments.length === 0}
			{@render startSomething()}
		{/if}

		{#if attentionItems.length > 0}
			<section class="mb-8" data-testid="dashboard-attention">
				<p class="text-xs font-semibold uppercase tracking-wide text-warning">
					Action recommended
				</p>
				<h2 class="font-serif text-2xl font-semibold">Needs attention</h2>
				<div class="mt-3 grid gap-3 md:grid-cols-2">
					{#each attentionItems as item (item.id)}
						<article class="rounded-box border border-warning/30 bg-warning/8 p-4">
							<h3 class="font-semibold">{item.title}</h3>
							<p class="mt-1 text-sm leading-relaxed text-base-content/65">
								{item.description}
							</p>
							<a
								href={item.href}
								class="btn btn-ghost btn-sm mt-2 -ml-3 text-warning-content"
							>
								{item.linkLabel}
							</a>
						</article>
					{/each}
				</div>
			</section>
		{/if}

		{#if recentDocuments.length > 0}
			{@render startSomething()}
		{/if}

		<footer
			class="mt-10 flex items-center justify-between border-t border-base-300/60 py-5 text-xs text-base-content/45"
		>
			<a href={resolve('/about')} class="link link-hover">About Apatosaurus</a>
			<span>Version {appVersion}</span>
		</footer>
	</main>
{/if}

{#snippet startSomething()}
	<section class="mb-8 rounded-box bg-base-200/55 p-5" data-testid="dashboard-start">
		<p class="text-xs font-semibold uppercase tracking-wide text-base-content/45">Create</p>
		<h2 class="font-serif text-2xl font-semibold">Start something</h2>
		{#if lastOpenedProject}
			<p class="mt-1 text-sm text-base-content/55">
				New work will belong to {lastOpenedProject.name}.
			</p>
			<div class="mt-4 flex flex-wrap gap-2">
				<a
					href={resolve(
						`/transcription/new?projectId=${encodeURIComponent(lastOpenedProject.id)}`
					)}
					class="btn btn-primary btn-sm"
				>
					New Transcription in {lastOpenedProject.name}
				</a>
				<a
					href={resolve(
						`/transcription/igntp?projectId=${encodeURIComponent(lastOpenedProject.id)}`
					)}
					class="btn btn-outline btn-sm"
				>
					Import IGNTP in {lastOpenedProject.name}
				</a>
				<a
					href={resolve(
						`/collation/new?projectId=${encodeURIComponent(lastOpenedProject.id)}`
					)}
					class="btn btn-outline btn-sm"
				>
					New Collation in {lastOpenedProject.name}
				</a>
			</div>
		{:else}
			<a href={resolve('/projects')} class="btn btn-primary btn-sm mt-4">Choose a project</a>
		{/if}
	</section>
{/snippet}
