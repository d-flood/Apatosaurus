<script lang="ts">
	import {
		checkStoragePersistence,
		getInstallCapabilityReport,
		isLocalFolderProviderSupported,
		type StoragePersistenceReport,
	} from '$lib/client/capabilities';
	import OnboardingGuidance from '$lib/components/OnboardingGuidance.svelte';
	import { onMount } from 'svelte';

	let persistenceReport = $state<StoragePersistenceReport | null>(null);
	let localFolderSupported = $state(false);
	let installSupported = $state(false);

	onMount(() => {
		localFolderSupported = isLocalFolderProviderSupported();
		installSupported = getInstallCapabilityReport().installSupported;
		void checkStoragePersistence().then(report => {
			persistenceReport = report;
		});
	});
</script>

<svelte:head>
	<title>About Apatosaurus Data</title>
</svelte:head>

<main class="mx-auto max-w-5xl px-4 py-8">
	<div class="mb-6">
		<p class="text-sm font-semibold uppercase tracking-wide text-primary">About</p>
		<h1 class="font-serif text-4xl font-bold">Your Apatosaurus data</h1>
		<p class="mt-3 max-w-3xl leading-relaxed text-base-content/70">
			Apatosaurus is local-first: project files are the durable record, and SQLite is a
			disposable index rebuilt from those files.
		</p>
	</div>

	<OnboardingGuidance
		variant="about"
		{localFolderSupported}
		persistenceStatus={persistenceReport?.status ?? 'unsupported'}
		{installSupported}
	/>
</main>
