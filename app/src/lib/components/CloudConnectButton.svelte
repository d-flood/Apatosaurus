<svelte:options runes={true} />

<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getDropboxConnection,
		handleDropboxPkceCallback,
		isDropboxAuthConfigured,
		startDropboxPkceFlow,
	} from '$lib/client/sync/cloud-auth';

	type DropboxConnection = Awaited<ReturnType<typeof getDropboxConnection>>;
	const initiallyConfigured = isDropboxAuthConfigured();

	let configured = $state(initiallyConfigured);
	let connection = $state<DropboxConnection>(null);
	let busy = $state(initiallyConfigured);
	let errorMessage = $state('');

	let connected = $derived(connection !== null);
	let disabled = $derived(busy || !configured);
	let label = $derived.by(() => {
		if (busy) return 'Connecting...';
		if (connected) return 'Dropbox connected';
		return 'Connect Dropbox';
	});
	let compactLabel = $derived(connected && !busy ? 'Dropbox' : label);
	let title = $derived.by(() => {
		if (!configured) return 'Dropbox auth unavailable: set PUBLIC_DROPBOX_CLIENT_ID.';
		if (errorMessage) return errorMessage;
		if (busy) return 'Completing Dropbox connection...';
		if (connection?.accountEmail) return `Dropbox connected to ${connection.accountEmail}`;
		if (connected) return 'Dropbox connected';
		return 'Connect Dropbox';
	});
	let buttonClass = $derived([
		'btn btn-xs gap-1 whitespace-nowrap',
		connected ? 'btn-outline btn-success' : 'btn-outline btn-neutral',
		!configured && 'opacity-60',
	]);

	onMount(() => {
		void initialiseDropboxConnection();
	});

	async function initialiseDropboxConnection() {
		configured = isDropboxAuthConfigured();
		busy = true;
		errorMessage = '';
		let callbackConnection: DropboxConnection | undefined;

		try {
			callbackConnection = await handleDropboxPkceCallback();
		} catch (error) {
			errorMessage = messageFrom(error);
		}

		try {
			connection = callbackConnection ?? (await getDropboxConnection());
		} catch (error) {
			if (!errorMessage) errorMessage = messageFrom(error);
		} finally {
			busy = false;
		}
	}

	async function connectDropbox() {
		if (disabled) return;

		busy = true;
		errorMessage = '';

		try {
			await startDropboxPkceFlow();
		} catch (error) {
			errorMessage = messageFrom(error);
			busy = false;
		}
	}

	function messageFrom(error: unknown): string {
		return error instanceof Error ? error.message : 'Dropbox connection failed.';
	}
</script>

<span class="inline-flex items-center" {title}>
	<button
		type="button"
		class={buttonClass}
		onclick={connectDropbox}
		{disabled}
		aria-label={label}
	>
		{#if errorMessage}
			<span class="badge badge-xs badge-error px-1" aria-hidden="true">!</span>
		{/if}
		{#if connected && !busy}
			<span class="hidden xl:inline">{label}</span>
			<span class="xl:hidden">{compactLabel}</span>
		{:else}
			<span>{label}</span>
		{/if}
	</button>
</span>
