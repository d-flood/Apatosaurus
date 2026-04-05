<script lang="ts">
	import favicon from '$lib/assets/favicon.ico';
	import { registerServiceWorker } from '$lib/client/sw-registration';
	import { syncService } from '$lib/client/sync/sync-service.svelte';
	import Navbar from '$lib/components/Navbar.svelte';
	import SchemaMigrationModal from '$lib/components/SchemaMigrationModal.svelte';
	import { onMount } from 'svelte';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		syncService.initLocalDB('local').catch((err: unknown) => {
			console.error('Failed to initialize local runtime:', err);
		});
		registerServiceWorker();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<Navbar />
<SchemaMigrationModal />

<div class="bg-transparent rounded-lg">
	{@render children?.()}
</div>
