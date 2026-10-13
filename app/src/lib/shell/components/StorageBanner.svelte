<script lang="ts">
	import CloudArrowUp from 'phosphor-svelte/lib/CloudArrowUp';
	import WarningCircle from 'phosphor-svelte/lib/WarningCircle';
	import X from 'phosphor-svelte/lib/X';
	import StorageSignInButtons from '$lib/backup/components/StorageSignInButtons.svelte';
	import { signInCompletion } from '$lib/backup/sign-in-completion.svelte';
	import { beginSignIn, providerLabel } from '$lib/backup/storage-account-auth';
	import { syncService } from '$lib/backup/sync-service.svelte';
	import { listProjects, subscribeLocalDbInvalidations } from '$lib/db/client';
	import { ensureLocalDbRuntime } from '$lib/db/runtime';
	import { networkStatus } from '$lib/shell/network-status.svelte';
	import {
		deriveStorageBanner,
		readStorageBannerDismissed,
		recordStorageBannerDismissed,
	} from '$lib/shell/storage-banner';
	import {
		listProjectLocations,
		listProjectPlacements,
		listStorageAccounts,
		type ProjectLocation,
		type ProjectPlacement,
		type StorageAccount,
	} from '$lib/storage/project-locations';
	import { onMount } from 'svelte';

	let projectIds = $state.raw<string[]>([]);
	let placements = $state.raw<ProjectPlacement[]>([]);
	let locations = $state.raw<ProjectLocation[]>([]);
	let accounts = $state.raw<StorageAccount[]>([]);
	let dismissed = $state(readStorageBannerDismissed());
	let sheet = $state<HTMLDialogElement>();
	let loadRunId = 0;

	const reconnectAccountIds = $derived(
		new Set(
			placements.flatMap(placement => {
				const status = syncService.projectStatus(placement.projectId, networkStatus.online);
				if (status.state !== 'needs-attention' || status.reason !== 'reconnect') return [];
				const accountId = locations.find(
					location => location.id === placement.locationId
				)?.accountId;
				return accountId ? [accountId] : [];
			})
		)
	);
	const banner = $derived(
		deriveStorageBanner({
			placements,
			projectIds,
			locations,
			accounts,
			reconnectAccountIds,
			dismissed,
		})
	);
	const signInDisabled = $derived(!networkStatus.online || signInCompletion.completing);

	async function load() {
		const runId = ++loadRunId;
		try {
			await ensureLocalDbRuntime();
			const [projects, nextPlacements, nextLocations, nextAccounts] = await Promise.all([
				listProjects(),
				listProjectPlacements(),
				listProjectLocations(),
				listStorageAccounts(),
			]);
			if (runId !== loadRunId) return;
			projectIds = projects.map(project => project.id);
			placements = nextPlacements;
			locations = nextLocations;
			accounts = nextAccounts;
		} catch (error) {
			console.error('[storage-banner] load failed', error);
		}
	}

	function dismiss() {
		recordStorageBannerDismissed();
		dismissed = true;
		sheet?.close();
	}

	onMount(() => {
		void load();
		return subscribeLocalDbInvalidations(event => {
			if (['projects', 'sync-targets', 'all'].includes(event.domain)) void load();
		});
	});
</script>

{#if banner}
	<section aria-label="Storage" class="border-b border-warning/40 bg-warning/10">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 text-sm">
			<WarningCircle
				size={18}
				weight="fill"
				class="shrink-0 text-warning"
				aria-hidden="true"
			/>
			{#if banner.kind === 'sign-in'}
				<p class="min-w-0 flex-1">
					<span class="font-medium">Not backed up</span>
					<span class="hidden opacity-70 sm:inline">
						· {banner.count === 1
							? '1 project is saved only in this browser'
							: `${banner.count} projects are saved only in this browser`}
					</span>
				</p>
				<div class="hidden sm:block"><StorageSignInButtons size="sm" /></div>
				<button
					type="button"
					class="btn btn-ghost btn-sm btn-square hidden sm:inline-flex"
					aria-label="Dismiss"
					onclick={dismiss}
				>
					<X size={16} aria-hidden="true" />
				</button>
				<button
					type="button"
					class="btn btn-warning btn-sm sm:hidden"
					onclick={() => sheet?.showModal()}
				>
					<CloudArrowUp size={16} aria-hidden="true" />
					Back up
				</button>
			{:else}
				{@const account = banner.account}
				<p class="min-w-0 flex-1">
					<span class="font-medium">
						{providerLabel(account.provider)}
						{banner.kind === 'signed-out' ? 'is signed out' : 'needs reconnecting'}
					</span>
					{#if banner.kind === 'signed-out'}
						<span class="opacity-70">· Changes stay here until you sign in</span>
					{/if}
				</p>
				<button
					type="button"
					class="btn btn-warning btn-sm"
					disabled={signInDisabled}
					onclick={() => beginSignIn(account.provider, { loginHint: account.email })}
				>
					{banner.kind === 'signed-out' ? 'Sign in' : 'Reconnect'}
				</button>
			{/if}
		</div>
	</section>
{/if}

<dialog bind:this={sheet} class="modal modal-bottom" aria-label="Back up your projects">
	<div class="modal-box space-y-3">
		<h2 class="font-serif text-lg font-bold">Back up your projects</h2>
		<p class="text-sm text-base-content/70">
			Sign in to save them to Google Drive or Dropbox as you work.
		</p>
		<StorageSignInButtons />
		<div class="modal-action mt-2">
			<button type="button" class="btn btn-ghost btn-sm" onclick={dismiss}>Not now</button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button aria-label="Close"></button>
	</form>
</dialog>
