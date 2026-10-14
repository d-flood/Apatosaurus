<svelte:options runes={true} />

<script lang="ts">
	import { resolve } from '$app/paths';
	import { ONBOARDING_GUIDANCE } from '$lib/shell/onboarding-guidance';

	let { variant = 'card' }: { variant?: 'card' | 'about' } = $props();
</script>

<section
	class={variant === 'about'
		? 'rounded-box border border-base-300 bg-base-100 p-6 shadow-sm'
		: 'rounded-box border border-primary/20 bg-primary/5 p-4'}
	data-testid="onboarding-guidance"
>
	<div class="flex items-baseline justify-between gap-3">
		<h2 class="font-serif text-xl font-semibold">{ONBOARDING_GUIDANCE.heading}</h2>
		{#if variant === 'card'}
			<a href={resolve('/about')} class="link link-primary text-sm">About your data</a>
		{/if}
	</div>
	<p class="mt-1 text-sm text-base-content/65">{ONBOARDING_GUIDANCE.intro}</p>

	<ol class="mt-3 grid gap-3">
		{#each ONBOARDING_GUIDANCE.steps as step}
			<li class="rounded-box border border-base-300/70 bg-base-100 p-3 font-semibold">
				{step}
			</li>
		{/each}
	</ol>

	{#if variant === 'about'}
		<div class="mt-4 rounded-box bg-base-200/60 p-4" data-testid="data-ownership">
			<h3 class="font-serif text-lg font-semibold">You own the files</h3>
			<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-base-content/70">
				{#each ONBOARDING_GUIDANCE.dataOwnership as item}
					<li>{item}</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>
