<script lang="ts">
	import { asset, resolve } from '$app/paths';
	import StorageSignInButtons from '$lib/backup/components/StorageSignInButtons.svelte';
	import { recordWelcomeSkipped } from '$lib/shell/welcome-gate';
</script>

<svelte:head><title>Welcome to Apatosaurus</title></svelte:head>

<main class="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-12">
	<section class="w-full rounded-box border border-base-300/60 bg-base-100 p-6 shadow-md sm:p-12">
		<img src={asset('/icons/icon-96x96.png')} alt="" class="h-14 w-14" />
		<p class="mt-4 text-sm font-semibold uppercase tracking-[0.18em] text-primary">
			Welcome to Apatosaurus
		</p>
		<h1 class="mt-3 font-serif text-4xl font-bold tracking-tight sm:text-5xl">
			Keep your work safe on every device
		</h1>
		<p class="mt-4 leading-relaxed text-base-content/65">
			Sign in to save your projects to Google Drive or Dropbox. They back up as you work and
			open on any computer you sign in from.
		</p>
		<div class="mt-7">
			<StorageSignInButtons returnTo="/projects" />
		</div>
		<p class="mt-4 text-sm leading-relaxed text-base-content/55">
			Your projects are saved in an Apatosaurus folder in your account, as standard files you
			can open without the app.
		</p>
		<a
			href={resolve('/projects')}
			class="link link-hover mt-8 inline-block text-sm text-base-content/55"
			onclick={recordWelcomeSkipped}>Continue without signing in</a
		>
	</section>
</main>
