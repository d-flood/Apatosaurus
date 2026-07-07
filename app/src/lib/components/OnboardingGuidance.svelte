<svelte:options runes={true} />

<script lang="ts">
	import { resolve } from '$app/paths';
	import type { StoragePersistenceStatus } from '$lib/client/capabilities';
	import { buildOnboardingGuidanceContent } from '$lib/onboarding-guidance';

	interface Props {
		localFolderSupported: boolean;
		persistenceStatus: StoragePersistenceStatus;
		installSupported: boolean;
		variant?: 'card' | 'about';
	}

	let {
		localFolderSupported,
		persistenceStatus,
		installSupported,
		variant = 'card',
	}: Props = $props();

	let content = $derived(
		buildOnboardingGuidanceContent({ localFolderSupported, persistenceStatus, installSupported })
	);

	function badgeClass(state: 'ready' | 'recommended' | 'unavailable') {
		if (state === 'ready') return 'badge-success';
		if (state === 'recommended') return 'badge-primary';
		return 'badge-warning';
	}
</script>

<section
	class={variant === 'about'
		? 'rounded-box border border-base-300 bg-base-100 p-6 shadow-sm'
		: 'rounded-box border border-primary/20 bg-primary/5 p-4'}
	data-testid="onboarding-guidance"
>
	<div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
		<div>
			<p class="text-xs font-semibold uppercase tracking-wide text-primary">Recommended setup</p>
			<h2 class="font-serif text-xl font-semibold">{content.heading}</h2>
		</div>
		<a href={resolve('/about')} class="link link-primary text-sm">About your data</a>
	</div>
	<p class="mt-2 text-sm leading-relaxed text-base-content/70">{content.intro}</p>

	<div class="mt-4 rounded-box bg-base-100 p-4 shadow-sm" data-testid="onboarding-primary-path">
		<div class={`badge badge-sm ${badgeClass(content.primaryPath.state)}`}>Best next step</div>
		<h3 class="mt-2 font-serif text-lg font-semibold">{content.primaryPath.title}</h3>
		<p class="mt-1 text-sm leading-relaxed text-base-content/70">{content.primaryPath.body}</p>
	</div>

	<div class="mt-4 grid gap-3 sm:grid-cols-2">
		{#each content.actions as action}
			<div class="rounded-box border border-base-300/70 bg-base-100 p-3">
				<div class="flex items-start justify-between gap-3">
					<h3 class="font-semibold">{action.title}</h3>
					<span class={`badge badge-xs ${badgeClass(action.state)}`}>{action.state}</span>
				</div>
				<p class="mt-1 text-sm leading-relaxed text-base-content/65">{action.body}</p>
			</div>
		{/each}
	</div>

	<div class="mt-4 rounded-box bg-base-200/60 p-4" data-testid="data-ownership">
		<h3 class="font-serif text-lg font-semibold">You own the files</h3>
		<ul class="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-base-content/70">
			{#each content.dataOwnership as item}
				<li>{item}</li>
			{/each}
		</ul>
	</div>
</section>
