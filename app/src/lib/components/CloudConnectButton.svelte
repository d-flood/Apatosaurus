<svelte:options runes={true} />

<script lang="ts">
	import { onMount } from 'svelte';
	import { ensureLocalDbRuntime } from '$lib/client/db/runtime';
	import { waitForBrowserIdle } from '$lib/client/defer';
	import {
		connectLocalFolder,
		getBackupConnections,
		handleDropboxPkceCallback,
		isDropboxAuthConfigured,
		isLocalFolderProviderSupported,
		startDropboxPkceFlow,
	} from '$lib/client/sync/cloud-auth';

	type BackupConnections = Awaited<ReturnType<typeof getBackupConnections>>;
	type DropboxConnection = BackupConnections['dropboxConnection'];
	type LocalFolderConnection = BackupConnections['localFolderConnection'];
	const initiallyConfigured = isDropboxAuthConfigured();
	const initiallyLocalFolderSupported = isLocalFolderProviderSupported();

	let configured = $state(initiallyConfigured);
	let localFolderSupported = $state(initiallyLocalFolderSupported);
	let dropboxConnection = $state<DropboxConnection>(null);
	let localFolderConnection = $state<LocalFolderConnection>(null);
	let busy = $state(false);
	let busyProvider = $state<'dropbox' | 'local-folder' | null>(null);
	let errorMessage = $state('');

	let connected = $derived(dropboxConnection !== null || localFolderConnection !== null);
	let dropboxDisabled = $derived(busy || !configured);
	let localFolderDisabled = $derived(busy || !localFolderSupported);
	let label = $derived.by(() => {
		if (busy) return 'Connecting...';
		if (connected) return 'Backup connected';
		return 'Connect backup';
	});
	let compactLabel = $derived.by(() => {
		if (busy) return 'Connecting...';
		if (dropboxConnection && localFolderConnection) return '2 backups';
		if (dropboxConnection) return 'Dropbox';
		if (localFolderConnection) return 'Local folder';
		return 'Backup';
	});
	let title = $derived.by(() => {
		if (errorMessage) return errorMessage;
		if (busy) return 'Completing backup connection...';
		if (dropboxConnection && localFolderConnection) return 'Dropbox and local folder connected';
		if (dropboxConnection?.accountEmail) return `Dropbox connected to ${dropboxConnection.accountEmail}`;
		if (localFolderConnection?.accountEmail)
			return `Local folder connected to ${localFolderConnection.accountEmail}`;
		return 'Connect backup storage';
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
		configured = isDropboxAuthConfigured();
		localFolderSupported = isLocalFolderProviderSupported();
		errorMessage = '';
		let callbackConnection: DropboxConnection = null;

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
			callbackConnection = await handleDropboxPkceCallback();
			if (isCancelled()) return;
		} catch (error) {
			if (isCancelled()) return;
			errorMessage = messageFrom(error);
		}

		try {
			const connections = await getBackupConnections();
			if (isCancelled()) return;
			dropboxConnection = callbackConnection ?? connections.dropboxConnection;
			localFolderConnection = connections.localFolderConnection;
		} catch (error) {
			if (!errorMessage) errorMessage = messageFrom(error);
		} finally {
			if (!isCancelled()) busy = false;
		}
	}

	async function connectDropbox() {
		if (dropboxDisabled) return;

		busy = true;
		busyProvider = 'dropbox';
		errorMessage = '';

		try {
			await startDropboxPkceFlow();
		} catch (error) {
			errorMessage = messageFrom(error);
			busy = false;
			busyProvider = null;
		}
	}

	async function connectLocalFolderBackup() {
		if (localFolderDisabled) return;

		busy = true;
		busyProvider = 'local-folder';
		errorMessage = '';

		try {
			localFolderConnection = await connectLocalFolder();
		} catch (error) {
			errorMessage = messageFrom(error);
		} finally {
			busy = false;
			busyProvider = null;
		}
	}

	function messageFrom(error: unknown): string {
		return error instanceof Error ? error.message : 'Backup connection failed.';
	}
</script>

<div class="dropdown dropdown-end inline-flex items-center" {title}>
	<button
		type="button"
		class={buttonClass}
		tabindex="0"
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
	<div class="dropdown-content card card-compact bg-base-100 rounded-box z-30 mt-2 w-72 shadow-xl">
		<div class="card-body gap-2 p-3">
			<div class="text-xs font-semibold uppercase tracking-wide text-base-content/60">
				Backup storage
			</div>
			<button
				type="button"
				class="btn btn-sm justify-between"
				onclick={connectDropbox}
				disabled={dropboxDisabled}
				title={configured ? undefined : 'Set PUBLIC_DROPBOX_CLIENT_ID to connect Dropbox.'}
			>
				<span>{dropboxConnection ? 'Dropbox connected' : 'Connect Dropbox'}</span>
				{#if busyProvider === 'dropbox'}
					<span class="loading loading-spinner loading-xs"></span>
				{:else if dropboxConnection}
					<span class="badge badge-success badge-xs">ready</span>
				{:else if !configured}
					<span class="badge badge-warning badge-xs">unavailable</span>
				{/if}
			</button>
			<button
				type="button"
				class="btn btn-sm justify-between"
				onclick={connectLocalFolderBackup}
				disabled={localFolderDisabled}
				title={localFolderSupported
					? undefined
					: 'Local folder backup is not supported in this browser.'}
			>
				<span>{localFolderConnection ? 'Local folder connected' : 'Connect local folder'}</span>
				{#if busyProvider === 'local-folder'}
					<span class="loading loading-spinner loading-xs"></span>
				{:else if localFolderConnection}
					<span class="badge badge-success badge-xs">ready</span>
				{:else if !localFolderSupported}
					<span class="badge badge-warning badge-xs">unsupported</span>
				{/if}
			</button>
			{#if errorMessage}
				<p class="text-xs text-error">{errorMessage}</p>
			{/if}
		</div>
	</div>
</div>
