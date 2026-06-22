<script lang="ts">
	import favicon from '$lib/assets/favicon.ico';
	import { ensureLocalDbRuntime } from '$lib/client/db/runtime';
	import { syncService } from '$lib/client/sync/sync-service.svelte';
	import { registerServiceWorker } from '$lib/client/sw-registration';
	import Navbar from '$lib/components/Navbar.svelte';
	import { onMount } from 'svelte';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		void initializeApp();
		registerServiceWorker();
	});

	async function initializeApp() {
		try {
			await ensureLocalDbRuntime();
			await syncService.initLocalDB('local');
		} catch (err) {
			console.error('Failed to initialize local runtime:', err);
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<Navbar />

<div class="bg-transparent rounded-lg">
	{@render children?.()}
</div>
