<script lang="ts">
	import { onMount } from 'svelte';

	let isOnline = $state(false);

	onMount(() => {
		isOnline = navigator.onLine;

		const handleOnline = () => {
			isOnline = true;
			window.location.reload();
		};

		const handleOffline = () => {
			isOnline = false;
		};

		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);

		return () => {
			window.removeEventListener('online', handleOnline);
			window.removeEventListener('offline', handleOffline);
		};
	});
</script>

<div class="hero min-h-screen bg-base-200">
	<div class="hero-content text-center">
		<div class="max-w-md">
			<h1 class="text-5xl font-bold">You're Offline</h1>
			<p class="py-6">
				Apatopwa works offline! However, this page hasn't been cached yet.
				Please connect to the internet to load this page for the first time.
			</p>

			{#if isOnline}
				<div class="alert alert-success">
					<span>Back online! Reloading...</span>
				</div>
			{:else}
				<div class="alert alert-info">
					<span>Waiting for connection...</span>
				</div>
			{/if}

			<button
				class="btn btn-primary mt-4"
				onclick={() => window.location.reload()}
			>
				Try Again
			</button>
		</div>
	</div>
</div>
