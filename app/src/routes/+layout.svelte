<script lang="ts">
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.ico';
	import { persistCbgmComputations, refreshCbgmPresence } from '$lib/cbgm/cbgm-analysis-runs';
	import { cbgmScheduler } from '$lib/cbgm/cbgm-scheduler.svelte';
	import { checkStoragePersistence } from '$lib/shell/capabilities';
	import { ensureLocalDbRuntime } from '$lib/db/runtime';
	import { signInCompletion } from '$lib/backup/sign-in-completion.svelte';
	import StorageSignInButtons from '$lib/backup/components/StorageSignInButtons.svelte';
	import { syncService } from '$lib/backup/sync-service.svelte';
	import { registerServiceWorker, scheduleCacheWarm } from '$lib/shell/sw-registration';
	import Navbar from '$lib/shell/components/Navbar.svelte';
	import StorageBanner from '$lib/shell/components/StorageBanner.svelte';
	import { onMount } from 'svelte';
	import 'triiiceratops/style.css';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		void initializeApp();
		void signInCompletion.completeFromRedirect();
		void registerServiceWorker().then(registration => {
			if (registration) scheduleCacheWarm(registration, 'routes');
		});
	});

	async function initializeApp() {
		try {
			void checkStoragePersistence();
			await ensureLocalDbRuntime();
			persistCbgmComputations(cbgmScheduler);
			refreshCbgmPresence(cbgmScheduler);
			cbgmScheduler
				.start()
				.catch(error => console.error('Failed to resume CBGM computations:', error));
			await syncService.initLocalDB('local');
		} catch (err) {
			console.error('Failed to initialize local runtime:', err);
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if page.url.pathname !== '/welcome'}
	<Navbar />
	<StorageBanner />
{/if}

{#if signInCompletion.error}
	<div class="mx-auto max-w-5xl px-4 pt-4">
		<div class="alert alert-error alert-vertical text-sm sm:alert-horizontal" role="alert">
			<div class="w-full flex-1 space-y-3">
				<p>{signInCompletion.error}</p>
				<div class="max-w-md"><StorageSignInButtons size="sm" /></div>
			</div>
			<button
				type="button"
				class="btn btn-ghost btn-xs"
				onclick={() => signInCompletion.dismissError()}>Dismiss</button
			>
		</div>
	</div>
{/if}

<div class="bg-transparent rounded-lg">
	{@render children?.()}
</div>
