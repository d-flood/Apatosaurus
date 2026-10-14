<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { signInCompletion } from '$lib/backup/sign-in-completion.svelte';
	import { listProjects } from '$lib/db/client';
	import { ensureLocalDbRuntime } from '$lib/db/runtime';
	import { readWelcomeSkipped, shouldShowWelcome } from '$lib/shell/welcome-gate';
	import { listStorageAccounts } from '$lib/storage/project-locations';
	import { onMount, type Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	let decided = $state(false);

	async function decide() {
		try {
			await ensureLocalDbRuntime();
			const [accounts, projects] = await Promise.all([listStorageAccounts(), listProjects()]);
			// A sign-in returning here has not written its account record yet.
			if (
				!signInCompletion.completing &&
				!signInCompletion.error &&
				shouldShowWelcome({
					accountCount: accounts.length,
					projectCount: projects.length,
					skipped: readWelcomeSkipped(),
				})
			) {
				await goto(resolve('/welcome'), { replaceState: true });
				return;
			}
		} catch (error) {
			console.error('[welcome-gate] decision failed', error);
		}
		decided = true;
	}

	onMount(() => {
		void decide();
	});
</script>

{#if decided}
	{@render children()}
{:else}
	<main class="mx-auto flex min-h-[60vh] max-w-6xl items-center justify-center p-4">
		<span class="loading loading-spinner loading-md" aria-label="Loading"></span>
	</main>
{/if}
