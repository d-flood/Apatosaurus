<script lang="ts">
	import { browser } from '$app/environment';
	import { asset, resolve } from '$app/paths';
	import { notificationCenter } from '$lib/client/notification-center.svelte';
	import { isCollationEnabled } from '$lib/config/feature-flags';
	import Bell from 'phosphor-svelte/lib/Bell';
	import Moon from 'phosphor-svelte/lib/Moon';
	import Sun from 'phosphor-svelte/lib/Sun';
	import { onMount } from 'svelte';

	let theme = $state('');

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
	});

	function badgeClass(tone?: 'neutral' | 'warning' | 'error' | 'success'): string {
		if (tone === 'warning') return 'badge-warning';
		if (tone === 'error') return 'badge-error';
		if (tone === 'success') return 'badge-success';
		return 'badge-neutral';
	}

	function actionClass(variant?: 'primary' | 'secondary' | 'neutral' | 'error' | 'ghost'): string {
		if (variant === 'primary') return 'btn btn-xs btn-primary';
		if (variant === 'secondary') return 'btn btn-xs btn-secondary';
		if (variant === 'neutral') return 'btn btn-xs btn-neutral';
		if (variant === 'error') return 'btn btn-xs btn-error';
		return 'btn btn-xs btn-ghost';
	}
</script>

<div class="navbar bg-base-200 font-serif shadow-sm">
	<div class="navbar-start space-x-4">
		<div class="dropdown">
			<div tabindex="0" role="button" class="btn btn-ghost lg:hidden">
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
			</div>
			<ul
				class="menu menu-sm dropdown-content bg-base-100 rounded-box z-1 mt-3 w-52 p-2 shadow-lg"
			>
				<li><a href={resolve('/transcription')}>Transcriptions</a></li>
				<li><a href={resolve('/projects')}>Projects</a></li>
				{#if isCollationEnabled}
					<li><a href={resolve('/collation')}>Collations</a></li>
				{:else}
					<li>
						<span class="text-base-content/50 cursor-not-allowed" aria-disabled="true">
							Collations <span class="sr-only">(disabled)</span>
						</span>
					</li>
				{/if}
			</ul>
		</div>
		<a href={resolve('/')} class="hover:brightness-90">
			<span class="sr-only">Apatosaurus - Home</span>
			<img src={asset('/icons/icon-96x96.png')} alt="Apatosaurus Logo" class="w-12 h-12" />
		</a>
	</div>
	<div class="navbar-center hidden lg:flex">
		<ul class="menu menu-horizontal px-1">
			<li class="text-lg"><a href={resolve('/transcription')}>Transcriptions</a></li>
			<li class="text-lg"><a href={resolve('/projects')}>Projects</a></li>
			{#if isCollationEnabled}
				<li class="text-lg"><a href={resolve('/collation')}>Collations</a></li>
			{:else}
				<div
					class="tooltip tooltip-bottom"
					data-tip="Collation features will be enabled soon. Stay tuned!"
				>
					<li class="text-lg">
						<span class="text-base-content/50 cursor-not-allowed" aria-disabled="true">
							Collations <span class="sr-only">(disabled)</span>
						</span>
					</li>
				</div>
			{/if}
		</ul>
	</div>
	<div class="navbar-end gap-2">
		<div class="dropdown dropdown-end">
			<div tabindex="0" role="button" class="btn btn-ghost btn-circle">
				<div class="indicator">
					<Bell size={22} />
					{#if notificationCenter.count > 0}
						<span class="badge badge-sm badge-error indicator-item">{notificationCenter.count}</span>
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
								<div class="rounded-box border border-base-300 bg-base-200/40 p-3 space-y-2">
									<div class="flex items-center justify-between gap-2">
										<div class="font-medium text-sm">{item.title}</div>
										<span class={`badge badge-xs ${badgeClass(item.tone)}`}>{item.tone ?? 'notice'}</span>
									</div>
									<p class="text-xs text-base-content/80 leading-relaxed">{item.message}</p>
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
</div>
