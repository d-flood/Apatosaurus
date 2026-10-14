<script lang="ts">
	import aptosaurusAnimated from '$lib/assets/apatosaurus_animated.gif';
	import OnboardingGuidance from '$lib/shell/components/OnboardingGuidance.svelte';
</script>

<svelte:head>
	<title>About Apatosaurus</title>
</svelte:head>

<main class="mx-auto max-w-5xl px-4 py-8">
	<div class="mb-8 flex flex-col items-center text-center">
		<img src={aptosaurusAnimated} alt="Apatosaurus Logo" class="h-40 w-40 -ml-16" />
		<p class="text-sm font-semibold uppercase tracking-wide text-primary">About</p>
		<h1 class="font-serif text-4xl font-bold">Apatosaurus</h1>
		<p class="mt-3 max-w-3xl leading-relaxed text-base-content/70">
			Apatosaurus is a local-first progressive web application for New Testament textual
			criticism, offering tools for transcription, collation, and manuscript analysis.
		</p>
	</div>

	<section class="rounded-box border border-base-300 bg-base-100 p-6 shadow-sm">
		<h2 class="font-serif text-2xl font-bold">Transcription Editor</h2>
		<ul
			class="mt-3 list-inside list-disc space-y-1 text-sm leading-relaxed text-base-content/70"
		>
			<li>
				Import and export TEI, with over a hundred IGNTP transcriptions available for
				testing.
			</li>
			<li>Support for framed catena and commentary transcriptions.</li>
			<li>Rich-text editing with IIIF image integration.</li>
			<li>
				A flat transcription format that avoids TEI's deeply nested and unpredictable
				element structure while retaining round-trip TEI compatibility.
			</li>
		</ul>
		<h2 class="mt-6 font-serif text-2xl font-bold">Collation</h2>
		<ul
			class="mt-3 list-inside list-disc space-y-1 text-sm leading-relaxed text-base-content/70"
		>
			<li>Automated alignment with interactive fine-tuning.</li>
			<li>Multi-phase workflow: setup, alignment, regularization, readings, and stemma.</li>
			<li>Powered by a TypeScript port of the CollateX algorithm.</li>
		</ul>
		<h2 class="mt-6 font-serif text-2xl font-bold">Local and Offline First</h2>
		<p class="mt-3 text-sm leading-relaxed text-base-content/70">
			Your data is stored locally on your device. Work offline, close your browser, pick up
			right where you left off. Installable as a PWA from your browser's address bar.
		</p>
	</section>

	<div class="mb-6 mt-10">
		<p class="text-sm font-semibold uppercase tracking-wide text-primary">Data ownership</p>
		<h2 class="font-serif text-3xl font-bold">Your Apatosaurus data</h2>
		<p class="mt-3 max-w-3xl leading-relaxed text-base-content/70">
			Your projects save automatically as files you own. Keep a copy in your Google Drive or
			Dropbox account, or export a project to take your work with you.
		</p>
	</div>

	<OnboardingGuidance variant="about" />

	<section class="mt-6 grid gap-4 md:grid-cols-2" aria-label="How Apatosaurus stores your work">
		<div class="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
			<h2 class="font-serif text-xl font-semibold">A working copy on this device</h2>
			<p class="mt-2 text-sm leading-relaxed text-base-content/70">
				Apatosaurus keeps a working copy of your projects on this device, including your
				transcriptions, collations and named versions. Every edit saves automatically, so
				you can work offline. Projects in a cloud location also sync your changes to your
				account when you reconnect.
			</p>
		</div>
		<div class="rounded-box border border-base-300 bg-base-100 p-5 shadow-sm">
			<h2 class="font-serif text-xl font-semibold">Taking your work elsewhere</h2>
			<p class="mt-2 text-sm leading-relaxed text-base-content/70">
				Projects in Google Drive or Dropbox live in an Apatosaurus folder in your account.
				You can also export any project as a zip. Transcriptions and collations include
				standard TEI files you can open outside Apatosaurus.
			</p>
		</div>
	</section>
</main>
