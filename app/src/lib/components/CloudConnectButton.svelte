<svelte:options runes={true} />

<script lang="ts">
	import { onMount } from 'svelte';
	import { ensureLocalDbRuntime } from '$lib/client/db/runtime';
	import { waitForBrowserIdle } from '$lib/client/defer';
	import {
		connectLocalFolder,
		getBackupConnections,
		isLocalFolderProviderSupported,
	} from '$lib/client/sync/local-folder-connections';
	import { localFolderUnsupportedBackupMessage } from '$lib/onboarding-guidance';

	type BackupConnections = Awaited<ReturnType<typeof getBackupConnections>>;
	type LocalFolderConnection = BackupConnections['localFolderConnection'];

	const initiallyLocalFolderSupported = isLocalFolderProviderSupported();
	const unsupportedMessage = localFolderUnsupportedBackupMessage;

	let localFolderSupported = $state(initiallyLocalFolderSupported);
	let localFolderConnection = $state<LocalFolderConnection>(null);
	let busy = $state(false);
	let errorMessage = $state('');

	let connected = $derived(localFolderConnection !== null);
	let localFolderDisabled = $derived(busy || !localFolderSupported);
	let label = $derived.by(() => {
		if (busy) return 'Connecting...';
		if (connected) return 'Sync folder connected';
		return 'Choose sync folder';
	});
	let compactLabel = $derived.by(() => {
		if (busy) return 'Connecting...';
		if (connected) return 'Sync folder';
		return 'Sync folder';
	});
	let title = $derived.by(() => {
		if (errorMessage) return errorMessage;
		if (busy) return 'Connecting sync folder...';
		if (localFolderConnection?.accountEmail)
			return `Sync folder connected to ${localFolderConnection.accountEmail}`;
		if (!localFolderSupported) return unsupportedMessage;
		return 'Choose a folder for project sync';
	});
	let buttonClass = $derived([
		'btn btn-xs gap-1 whitespace-nowrap',
		connected ? 'btn-outline btn-success' : 'btn-outline btn-neutral',
	]);

	onMount(() => {
		let cancelled = false;
		void initialiseBackupConnections(() => cancelled);
		return () => {
			cancelled = true;
		};
	});

	async function initialiseBackupConnections(isCancelled: () => boolean) {
		localFolderSupported = isLocalFolderProviderSupported();
		errorMessage = '';

		try {
			await ensureLocalDbRuntime();
			await waitForBrowserIdle();
			if (isCancelled()) return;
			busy = true;
		} catch (error) {
			if (!isCancelled()) errorMessage = messageFrom(error);
			return;
		}

		try {
			const connections = await getBackupConnections();
			if (isCancelled()) return;
			localFolderConnection = connections.localFolderConnection;
		} catch (error) {
			if (!errorMessage) errorMessage = messageFrom(error);
		} finally {
			if (!isCancelled()) busy = false;
		}
	}

	async function connectLocalFolderBackup() {
		if (localFolderDisabled) return;

		busy = true;
		errorMessage = '';

		try {
			localFolderConnection = await connectLocalFolder();
		} catch (error) {
			errorMessage = messageFrom(error);
		} finally {
			busy = false;
		}
	}

	function messageFrom(error: unknown): string {
		return error instanceof Error ? error.message : 'Sync folder connection failed.';
	}
</script>

<div class="dropdown dropdown-end inline-flex items-center" {title}>
	<button type="button" class={buttonClass} tabindex="0" aria-label={label}>
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
	<div class="dropdown-content card card-compact bg-base-100 rounded-box z-30 mt-2 w-72 shadow-xl">
		<div class="card-body gap-2 p-3">
			<div class="text-xs font-semibold uppercase tracking-wide text-base-content/60">
				Project sync folder
			</div>
			<button
				type="button"
				class="btn btn-sm justify-between"
				onclick={connectLocalFolderBackup}
				disabled={localFolderDisabled}
				title={localFolderSupported ? undefined : unsupportedMessage}
			>
				<span>{localFolderConnection ? 'Sync folder connected' : 'Choose sync folder'}</span>
				{#if busy}
					<span class="loading loading-spinner loading-xs"></span>
				{:else if localFolderConnection}
					<span class="badge badge-success badge-xs">ready</span>
				{:else if !localFolderSupported}
					<span class="badge badge-warning badge-xs">unsupported</span>
				{/if}
			</button>
			{#if !localFolderSupported}
				<p class="text-xs text-base-content/60">{unsupportedMessage}</p>
			{/if}
			{#if errorMessage}
				<p class="text-xs text-error">{errorMessage}</p>
			{/if}
		</div>
	</div>
</div>
