<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';
	import Plus from 'phosphor-svelte/lib/Plus';

	let { children }: { children: Snippet } = $props();

	const activeTab = $derived(
		page.url.pathname.endsWith('/transcription/igntp') ? 'igntp' : 'listing'
	);
</script>

<div class="container mx-auto flex h-[calc(100dvh-5rem)] max-w-6xl flex-col p-4">
	<div class="mb-6 flex shrink-0 items-center justify-between">
		<h1 class="text-2xl font-bold">Transcriptions</h1>
		<a href={resolve('/transcription/new')} class="btn btn-success">
			<Plus size="24px" class="mr-2" />
			New Transcription
		</a>
	</div>

	<div class="tabs tabs-box mb-6 shrink-0 bg-base-200">
		<a
			href={resolve('/transcription')}
			class={['tab', activeTab === 'listing' && 'tab-active']}
		>
			Transcriptions
		</a>
		<a
			href={resolve('/transcription/igntp')}
			class={['tab', activeTab === 'igntp' && 'tab-active']}
		>
			IGNTP Import
		</a>
	</div>

	{@render children()}
</div>
