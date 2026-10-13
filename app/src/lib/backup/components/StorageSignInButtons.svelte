<script lang="ts">
	import DropboxLogo from 'phosphor-svelte/lib/DropboxLogo';
	import GoogleDriveLogo from 'phosphor-svelte/lib/GoogleDriveLogo';
	import { signInCompletion } from '$lib/backup/sign-in-completion.svelte';
	import { beginSignIn } from '$lib/backup/storage-account-auth';
	import { networkStatus } from '$lib/shell/network-status.svelte';

	let { returnTo, size }: { returnTo?: string; size?: 'sm' } = $props();

	const disabled = $derived(!networkStatus.online || signInCompletion.completing);
</script>

<div class="grid gap-2 sm:grid-cols-2">
	<button
		type="button"
		class={['btn btn-outline', size === 'sm' && 'btn-sm']}
		{disabled}
		onclick={() => beginSignIn('google', { returnTo })}
	>
		<GoogleDriveLogo size={size === 'sm' ? 16 : 20} aria-hidden="true" />
		Sign in with Google Drive
	</button>
	<button
		type="button"
		class={['btn btn-outline', size === 'sm' && 'btn-sm']}
		{disabled}
		onclick={() => beginSignIn('dropbox', { returnTo })}
	>
		<DropboxLogo size={size === 'sm' ? 16 : 20} aria-hidden="true" />
		Sign in with Dropbox
	</button>
</div>
{#if !networkStatus.online}
	<p class="mt-2 text-sm text-base-content/60">Connect to the internet to sign in</p>
{/if}
