<script lang="ts">
	import { browser } from '$app/environment';
	import { asset, resolve } from '$app/paths';
	import { page } from '$app/state';
	import { listProjects, type ProjectOption } from '$lib/client/collation/project-collation';
	import { subscribeLocalDbInvalidations } from '$lib/client/db/client';
	import { resetLocalDb } from '$lib/client/db/runtime';
	import {
		buildNavbarProjectTargets,
		buildProjectSwitcherTarget,
		readLastOpenedProjectId,
		resolveLastOpenedProjectId,
		type ProjectSection,
	} from '$lib/client/navigation/last-opened-project';
	import { notificationCenter } from '$lib/client/notification-center.svelte';
	import SyncStatusIndicator from '$lib/components/SyncStatusIndicator.svelte';
	import Bell from 'phosphor-svelte/lib/Bell';
	import Moon from 'phosphor-svelte/lib/Moon';
	import Sun from 'phosphor-svelte/lib/Sun';
	import { onMount } from 'svelte';

	let theme = $state('');
	let resettingLocalDb = $state(false);
	let projects = $state.raw<ProjectOption[]>([]);
	let projectTargets = $derived.by(() => {
		return buildNavbarProjectTargets(navigationProjectId(), projects);
	});
	let openProjectName = $derived.by(() => {
		const projectId = resolveLastOpenedProjectId(navigationProjectId(), projects);
		return projects.find(project => project.id === projectId)?.name ?? 'Projects';
	});

	function toggleTheme() {
		if (browser) {
			const currentThemeInput = document.getElementById('activeTheme') as HTMLInputElement;
			theme = currentThemeInput.value === 'minuscule' ? 'majuscule' : 'minuscule';
			currentThemeInput.value = theme;
			localStorage.setItem('theme', theme);
			document.documentElement.setAttribute('data-theme', theme);
		}
	}

	onMount(() => {
		if (browser) {
			theme = localStorage.getItem('theme') || 'light';
		}
		void loadProjects();
		return subscribeLocalDbInvalidations(event => {
			if (event.domain === 'projects' || event.domain === 'all') void loadProjects();
		});
	});

	async function loadProjects() {
		try {
			projects = await listProjects();
		} catch (error) {
			console.error('Failed to load projects for navigation', error);
		}
	}

	function navigationProjectId(): string | null {
		const projectId = page.url.pathname.match(
			/^\/projects\/([^/]+)\/(?:transcriptions|collations|settings|backup)(?:\/|$)/
		)?.[1];
		return projectId ? decodeURIComponent(projectId) : readLastOpenedProjectId();
	}

	function currentProjectSection(): ProjectSection {
		const section = page.url.pathname.match(
			/^\/projects\/[^/]+\/(transcriptions|collations|settings|backup)(?:\/|$)/
		)?.[1];
		if (
			section === 'collations' ||
			section === 'settings' ||
			section === 'backup' ||
			section === 'transcriptions'
		) {
			return section;
		}
		return 'transcriptions';
	}

	function badgeClass(tone?: 'neutral' | 'warning' | 'error' | 'success'): string {
		if (tone === 'warning') return 'badge-warning';
		if (tone === 'error') return 'badge-error';
		if (tone === 'success') return 'badge-success';
		return 'badge-neutral';
	}

	function actionClass(
		variant?: 'primary' | 'secondary' | 'neutral' | 'error' | 'ghost'
	): string {
		if (variant === 'primary') return 'btn btn-xs btn-primary';
		if (variant === 'secondary') return 'btn btn-xs btn-secondary';
		if (variant === 'neutral') return 'btn btn-xs btn-neutral';
		if (variant === 'error') return 'btn btn-xs btn-error';
		return 'btn btn-xs btn-ghost';
	}

	async function resetDevelopmentDb() {
		if (resettingLocalDb) return;
		if (!window.confirm('Reset the local database? This clears local data and reloads.'))
			return;

		resettingLocalDb = true;
		try {
			await resetLocalDb();
		} catch (error) {
			resettingLocalDb = false;
			console.error('Failed to reset local DB', error);
		}
	}
</script>

<nav class="navbar bg-base-200 font-serif shadow-sm" aria-label="Primary">
	<div class="navbar-start flex-1 gap-2 lg:gap-4">
		<a href={resolve('/')} class="shrink-0 hover:brightness-90">
			<span class="sr-only">Apatosaurus - Home</span>
			<img src={asset('/icons/icon-96x96.png')} alt="Apatosaurus Logo" class="w-12 h-12" />
		</a>

		<div class="dropdown hidden lg:block">
			<button
				type="button"
				tabindex="0"
				class="btn btn-ghost max-w-56"
				aria-label={`Open project switcher: ${openProjectName}`}
			>
				<span class="truncate">{openProjectName}</span>
				<span aria-hidden="true">v</span>
			</button>
			<ul
				tabindex="-1"
				class="menu dropdown-content bg-base-100 rounded-box z-30 mt-3 w-64 p-2 shadow-lg"
			>
				{#each projects as project (project.id)}
					<li>
						<a href={buildProjectSwitcherTarget(currentProjectSection(), project.id)}>
							{project.name}
						</a>
					</li>
				{/each}
				{#if projects.length > 0}<li class="my-1 border-t border-base-300"></li>{/if}
				<li><a href={resolve('/projects')}>Manage projects…</a></li>
			</ul>
		</div>

		<div class="dropdown lg:hidden">
			<button
				type="button"
				tabindex="0"
				aria-label="Open navigation menu"
				class="btn btn-ghost btn-square"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M4 6h16M4 12h8m-8 6h16"
					/>
				</svg>
			</button>
			<ul
				tabindex="-1"
				class="menu menu-sm dropdown-content bg-base-100 rounded-box z-30 mt-3 w-64 p-2 shadow-lg"
			>
				<li><a href={projectTargets.transcriptions}>Transcriptions</a></li>
				<li><a href={projectTargets.collations}>Collations</a></li>
				<li class="menu-title">Switch project</li>
				{#each projects as project (project.id)}
					<li>
						<a href={buildProjectSwitcherTarget(currentProjectSection(), project.id)}>
							{project.name}
						</a>
					</li>
				{/each}
				<li><a href={resolve('/projects')}>Manage projects…</a></li>
			</ul>
		</div>

		<ul class="menu menu-horizontal hidden px-1 lg:flex">
			<li class="text-lg"><a href={projectTargets.transcriptions}>Transcriptions</a></li>
			<li class="text-lg"><a href={projectTargets.collations}>Collations</a></li>
		</ul>
	</div>
	<div class="navbar-end gap-2">
		<a href={resolve('/data')} aria-label="Data & Storage" class="rounded-field">
			<SyncStatusIndicator />
		</a>
		{#if import.meta.env.DEV}
			<button
				type="button"
				class="btn btn-xs btn-outline btn-error"
				onclick={resetDevelopmentDb}
				disabled={resettingLocalDb}
			>
				{resettingLocalDb ? 'Resetting...' : 'Reset DB'}
			</button>
		{/if}
		<div class="dropdown dropdown-end">
			<div tabindex="0" role="button" class="btn btn-ghost btn-circle">
				<div class="indicator">
					<Bell size={22} />
					{#if notificationCenter.count > 0}
						<span class="badge badge-sm badge-error indicator-item"
							>{notificationCenter.count}</span
						>
					{/if}
				</div>
			</div>
			<div
				class="dropdown-content card card-compact bg-base-100 rounded-box z-30 mt-3 w-96 max-w-[92vw] shadow-xl"
			>
				<div class="card-body p-3">
					<div class="flex items-center justify-between">
						<h3 class="font-semibold">Notifications</h3>
						{#if notificationCenter.count > 0}
							<span class="badge badge-outline">{notificationCenter.count}</span>
						{/if}
					</div>
					{#if notificationCenter.items.length === 0}
						<p class="text-sm text-base-content/70">No notifications.</p>
					{:else}
						<div class="space-y-2 max-h-80 overflow-y-auto pr-1">
							{#each notificationCenter.items as item (item.id)}
								<div
									class="rounded-box border border-base-300 bg-base-200/40 p-3 space-y-2"
								>
									<div class="flex items-center justify-between gap-2">
										<div class="font-medium text-sm">{item.title}</div>
										<span class={`badge badge-xs ${badgeClass(item.tone)}`}
											>{item.tone ?? 'notice'}</span
										>
									</div>
									<p class="text-xs text-base-content/80 leading-relaxed">
										{item.message}
									</p>
									{#if item.actions && item.actions.length > 0}
										<div class="flex flex-wrap gap-2">
											{#each item.actions as action (action.id)}
												<button
													class={actionClass(action.variant)}
													onclick={async () => {
														await action.onSelect?.();
													}}
												>
													{action.label}
												</button>
											{/each}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
		<label class="swap swap-rotate h-10 w-10" aria-label="Toggle Theme">
			<input type="checkbox" onchange={toggleTheme} checked={theme === 'dark'} />
			<Sun class="swap-on h-10 w-10 fill-current" />
			<Moon class="swap-off h-10 w-10 fill-current" />
		</label>
	</div>
</nav>
