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
			Apatosaurus is local-first: your versioned project files are the durable record. The
			browser database only accelerates the interface and can be rebuilt from those files.
		</p>
	</div>

	<OnboardingGuidance
		variant="about"
		{localFolderSupported}
		persistenceStatus={persistenceReport?.status ?? 'unsupported'}
		{installSupported}
	/>

	<section class="mt-6 grid gap-4 md:grid-cols-2" aria-label="How Apatosaurus stores your work">
		<div class="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
			<h2 class="font-serif text-xl font-semibold">The durable record</h2>
			<p class="mt-2 text-sm leading-relaxed text-base-content/70">
				Apatosaurus stores each project in the browser's Origin Private File System as
				hash-validated JSON documents. Committed transcriptions, collations, and checkpoint
				history live there; autosaved working files preserve uncommitted changes locally.
				The SQLite index is disposable and can be repaired from the project files.
			</p>
		</div>
		<div class="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
			<h2 class="font-serif text-xl font-semibold">Taking your work elsewhere</h2>
			<p class="mt-2 text-sm leading-relaxed text-base-content/70">
				Use folder sync to maintain a readable mirror of committed project files, or export
				a project zip in any supported browser. Every committed transcription and collation
				includes a regenerated TEI sibling, so an archival, interoperable copy remains
				available outside Apatosaurus.
			</p>
		</div>
	</section>
</main>
