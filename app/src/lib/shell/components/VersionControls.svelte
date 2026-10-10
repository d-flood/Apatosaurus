<script lang="ts" module>
	import type { VersionSummary } from '$lib/db/repositories/revisions';
	import type { ComparePart } from '$lib/shell/version-compare';

	export interface VersionActions {
		list: () => Promise<VersionSummary[]>;
		name: (label: string, note: string | null) => Promise<string[]>;
		restore: (versionId: string) => Promise<() => Promise<void>>;
		editNote: (versionId: string, note: string | null) => Promise<void>;
		compare: (leftVersionId: string, rightVersionId: string | null) => Promise<ComparePart[]>;
		formatPart: (value: unknown) => string;
	}
</script>

<script lang="ts">
	import BookmarkSimple from 'phosphor-svelte/lib/BookmarkSimple';
	import ClockCounterClockwise from 'phosphor-svelte/lib/ClockCounterClockwise';
	import VersionHistoryDrawer from './VersionHistoryDrawer.svelte';

	let {
		actions,
		basedOnVersionId,
		changedSinceBase,
		disabledReason = '',
	}: {
		actions: VersionActions;
		basedOnVersionId: string | null;
		changedSinceBase: boolean;
		disabledReason?: string;
	} = $props();

	let versions = $state<VersionSummary[]>([]);
	let nameDialog = $state<HTMLDialogElement | null>(null);
	let isHistoryOpen = $state(false);
	let label = $state('');
	let note = $state('');
	let inFlight = $state(false);
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);

	async function refresh() {
		versions = await actions.list();
	}

	async function openNameForm() {
		error = null;
		success = null;
		await refresh();
		label = `Version ${versions.length + 1}`;
		note = '';
		nameDialog?.showModal();
	}

	function closeNameForm() {
		if (inFlight) return;
		nameDialog?.close();
		error = null;
	}

	async function openHistory() {
		await refresh();
		isHistoryOpen = true;
	}

	async function nameVersion(event: SubmitEvent) {
		event.preventDefault();
		inFlight = true;
		error = null;
		try {
			const name = label.trim() || `Version ${versions.length + 1}`;
			const warnings = await actions.name(name, note.trim() || null);
			nameDialog?.close();
			success = [`Named ${name}`, ...warnings].join('. ');
			await refresh();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to name this version';
		} finally {
			inFlight = false;
		}
	}

	async function restore(versionId: string) {
		success = null;
		const undo = await actions.restore(versionId);
		await refresh();
		return async () => {
			await undo();
			await refresh();
		};
	}

	async function editNote(versionId: string, nextNote: string | null) {
		await actions.editNote(versionId, nextNote);
		await refresh();
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	<button
		type="button"
		class="btn btn-sm btn-secondary"
		disabled={!!disabledReason || inFlight}
		title={disabledReason}
		onclick={openNameForm}
	>
		<BookmarkSimple size={14} />
		{inFlight ? 'Naming...' : 'Name this version'}
	</button>
	<button
		type="button"
		class="btn btn-sm btn-ghost"
		disabled={!!disabledReason}
		title={disabledReason}
		onclick={openHistory}
	>
		<ClockCounterClockwise size={14} />
		History
	</button>
	{#if success}
		<span class="text-sm text-success" role="status">{success}</span>
	{/if}
</div>

<dialog
	bind:this={nameDialog}
	class="modal"
	aria-label="Name this version"
	oncancel={event => inFlight && event.preventDefault()}
>
	<form class="modal-box w-full max-w-md space-y-3" onsubmit={nameVersion}>
		<h3 class="font-serif text-lg font-bold">Name this version</h3>
		<label class="fieldset p-0">
			<span class="fieldset-legend text-xs uppercase tracking-[0.14em] opacity-70">
				Label
			</span>
			<input bind:value={label} class="input input-sm w-full" disabled={inFlight} />
		</label>
		<label class="fieldset p-0">
			<span class="fieldset-legend text-xs uppercase tracking-[0.14em] opacity-70">
				Note
			</span>
			<textarea
				bind:value={note}
				class="textarea textarea-sm min-h-20 w-full"
				placeholder="Describe this version"
				disabled={inFlight}
			></textarea>
			<span class="label text-xs">Optional.</span>
		</label>
		{#if error}
			<p class="text-sm text-error" role="alert">{error}</p>
		{/if}
		<div class="modal-action mt-2">
			<button
				type="button"
				class="btn btn-sm btn-ghost"
				disabled={inFlight}
				onclick={closeNameForm}
			>
				Cancel
			</button>
			<button type="submit" class="btn btn-sm btn-primary" disabled={inFlight}>
				{inFlight ? 'Naming...' : 'Name this version'}
			</button>
		</div>
	</form>
</dialog>

<VersionHistoryDrawer
	open={isHistoryOpen}
	{versions}
	{basedOnVersionId}
	{changedSinceBase}
	onClose={() => (isHistoryOpen = false)}
	onRestore={restore}
	onEditNote={editNote}
	onCompare={actions.compare}
	formatPart={actions.formatPart}
/>
