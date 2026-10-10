<script lang="ts">
	import type { VersionSummary } from '$lib/db/repositories/revisions';
	import type { ComparePart } from '$lib/shell/version-compare';
	import X from 'phosphor-svelte/lib/X';
	import VersionCompare from './VersionCompare.svelte';

	let {
		open,
		versions,
		basedOnVersionId,
		changedSinceBase,
		onClose,
		onRestore,
		onEditNote,
		onCompare,
		formatPart,
	}: {
		open: boolean;
		versions: VersionSummary[];
		basedOnVersionId: string | null;
		changedSinceBase: boolean;
		onClose: () => void;
		onRestore: (versionId: string) => Promise<() => Promise<void>>;
		onEditNote: (versionId: string, note: string | null) => Promise<void>;
		onCompare: (leftVersionId: string, rightVersionId: string | null) => Promise<ComparePart[]>;
		formatPart: (value: unknown) => string;
	} = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);
	let editingId = $state<string | null>(null);
	let noteDraft = $state('');
	let toast = $state<{ message: string; undo: (() => Promise<void>) | null } | null>(null);
	let toastTimeout: ReturnType<typeof setTimeout> | null = null;

	let compareDialog = $state<HTMLDialogElement | null>(null);
	let compareLeft = $state<VersionSummary | null>(null);
	let compareRightId = $state('');
	let compareParts = $state<ComparePart[] | null>(null);
	const compareRightLabel = $derived(
		versions.find(version => version.id === compareRightId)?.label ?? 'Current'
	);

	const basedOn = $derived(versions.find(version => version.id === basedOnVersionId) ?? null);
	const statusText = $derived.by(() => {
		if (basedOn) {
			return changedSinceBase ? `Changed since ${basedOn.label}` : `Matches ${basedOn.label}`;
		}
		return versions.length ? 'Not based on a version' : 'No versions yet';
	});

	function showPopover(element: HTMLElement) {
		element.showPopover();
	}

	function formatDate(value: string): string {
		const date = new Date(value);
		return Number.isFinite(date.getTime())
			? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
			: value;
	}

	function showToast(message: string, undo: (() => Promise<void>) | null) {
		if (toastTimeout) clearTimeout(toastTimeout);
		toast = { message, undo };
		toastTimeout = setTimeout(() => {
			toast = null;
			toastTimeout = null;
		}, 10_000);
	}

	async function run(action: () => Promise<void>) {
		busy = true;
		error = null;
		try {
			await action();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}

	function restore(version: VersionSummary) {
		void run(async () => {
			const undo = await onRestore(version.id);
			showToast(`Restored ${version.label}`, undo);
		});
	}

	function undoRestore() {
		const undo = toast?.undo;
		if (!undo) return;
		void run(async () => {
			await undo();
			showToast('Restore undone', null);
		});
	}

	function loadCompare() {
		const left = compareLeft;
		if (!left) return;
		compareParts = null;
		void run(async () => {
			compareParts = await onCompare(left.id, compareRightId || null);
		});
	}

	function openCompare(version: VersionSummary) {
		compareLeft = version;
		compareRightId = '';
		compareDialog?.showModal();
		loadCompare();
	}

	function startEditing(version: VersionSummary) {
		editingId = version.id;
		noteDraft = version.note ?? '';
	}

	function saveNote(event: SubmitEvent, versionId: string) {
		event.preventDefault();
		void run(async () => {
			await onEditNote(versionId, noteDraft.trim() || null);
			editingId = null;
		});
	}
</script>

{#if open}
	<aside
		popover="manual"
		{@attach showPopover}
		class="fixed inset-y-0 right-0 left-auto m-0 flex h-full max-h-none w-full flex-col border-0 border-l border-base-300 bg-base-100 p-0 text-base-content shadow-xl sm:w-96"
		aria-label="History"
		data-testid="version-history"
	>
		<header class="flex items-center justify-between gap-2 border-b border-base-300 p-4">
			<div>
				<h2 class="font-serif text-lg font-bold">History</h2>
				<p class="text-sm text-base-content/60" data-testid="version-history-status">
					{statusText}
				</p>
			</div>
			<button
				type="button"
				class="btn btn-ghost btn-sm btn-square"
				aria-label="Close history"
				onclick={onClose}
			>
				<X size={16} />
			</button>
		</header>
		{#if error}
			<p class="px-4 pt-3 text-sm text-error" role="alert">{error}</p>
		{/if}
		<ol class="flex-1 space-y-3 overflow-y-auto p-4">
			{#each versions as version (version.id)}
				<li class="rounded-box border border-base-300 p-3" data-testid="version-entry">
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0">
							<p class="font-semibold">{version.label}</p>
							<p class="text-xs text-base-content/60">
								{formatDate(version.createdAt)}{version.authorName
									? ` · ${version.authorName}`
									: ''}
							</p>
						</div>
						<div class="flex shrink-0 gap-1">
							<button
								type="button"
								class="btn btn-ghost btn-xs"
								disabled={busy}
								onclick={() => openCompare(version)}
							>
								Compare
							</button>
							<button
								type="button"
								class="btn btn-outline btn-xs"
								disabled={busy}
								onclick={() => restore(version)}
							>
								Restore
							</button>
						</div>
					</div>
					{#if editingId === version.id}
						<form
							class="mt-2 space-y-2"
							onsubmit={event => saveNote(event, version.id)}
						>
							<textarea
								bind:value={noteDraft}
								class="textarea textarea-sm w-full"
								aria-label="Version note"
								disabled={busy}
							></textarea>
							<div class="flex justify-end gap-2">
								<button
									type="button"
									class="btn btn-ghost btn-xs"
									disabled={busy}
									onclick={() => (editingId = null)}
								>
									Cancel
								</button>
								<button
									type="submit"
									class="btn btn-primary btn-xs"
									disabled={busy}
								>
									Save note
								</button>
							</div>
						</form>
					{:else}
						{#if version.note}
							<p class="mt-2 whitespace-pre-wrap text-sm">{version.note}</p>
						{/if}
						<button
							type="button"
							class="btn btn-link btn-xs mt-1 px-0"
							disabled={busy}
							onclick={() => startEditing(version)}
						>
							{version.note ? 'Edit note' : 'Add note'}
						</button>
					{/if}
				</li>
			{:else}
				<li class="text-sm text-base-content/60">Name a version to start its history.</li>
			{/each}
		</ol>
	</aside>
	<dialog
		bind:this={compareDialog}
		class="modal"
		aria-label="Compare versions"
		onclose={() => (compareParts = null)}
	>
		<div class="modal-box flex max-h-[90vh] w-full max-w-5xl flex-col gap-3">
			<header class="flex flex-wrap items-center justify-between gap-2">
				<h3 class="font-serif text-lg font-bold">Compare {compareLeft?.label}</h3>
				<div class="flex items-center gap-2">
					<label class="flex items-center gap-2 text-sm">
						with
						<select
							bind:value={compareRightId}
							class="select select-sm"
							aria-label="Compare with"
							disabled={busy}
							onchange={loadCompare}
						>
							<option value="">Current</option>
							{#each versions.filter(version => version.id !== compareLeft?.id) as version (version.id)}
								<option value={version.id}>{version.label}</option>
							{/each}
						</select>
					</label>
					<button
						type="button"
						class="btn btn-ghost btn-sm btn-square"
						aria-label="Close compare"
						onclick={() => compareDialog?.close()}
					>
						<X size={16} />
					</button>
				</div>
			</header>
			{#if error}
				<p class="text-sm text-error" role="alert">{error}</p>
			{/if}
			<div class="min-h-0 flex-1 overflow-y-auto">
				{#if compareParts && compareLeft}
					<VersionCompare
						parts={compareParts}
						leftLabel={compareLeft.label}
						rightLabel={compareRightLabel}
						format={formatPart}
					/>
				{:else if !error}
					<p class="text-sm text-base-content/60">Loading…</p>
				{/if}
			</div>
		</div>
	</dialog>
{/if}

{#if toast}
	<div
		popover="manual"
		{@attach showPopover}
		class="toast toast-end top-auto left-auto m-0 border-0 bg-transparent"
	>
		<div class="alert" role="status">
			<span>{toast.message}</span>
			{#if toast.undo}
				<button
					type="button"
					class="btn btn-sm btn-primary"
					disabled={busy}
					onclick={undoRestore}
				>
					Undo
				</button>
			{/if}
		</div>
	</div>
{/if}
