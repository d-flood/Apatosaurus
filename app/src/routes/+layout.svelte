<script lang="ts">
	import favicon from '$lib/assets/favicon.ico';
	import { ensureLocalDbRuntime } from '$lib/client/db/runtime';
	import { registerServiceWorker } from '$lib/client/sw-registration';
	import Navbar from '$lib/components/Navbar.svelte';
	import { onMount } from 'svelte';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		ensureLocalDbRuntime().catch((err: unknown) => {
			console.error('Failed to initialize local runtime:', err);
		});
		registerServiceWorker();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<Navbar />

<div class="bg-transparent rounded-lg">
	{@render children?.()}
</div>
