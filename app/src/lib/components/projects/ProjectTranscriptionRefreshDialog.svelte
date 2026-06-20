<script lang="ts">
	import ArrowsClockwise from 'phosphor-svelte/lib/ArrowsClockwise';
	import Warning from 'phosphor-svelte/lib/Warning';
	import X from 'phosphor-svelte/lib/X';
	import type { ProjectTranscriptionStatus } from '$lib/client/collation/project-collation';

	interface Props {
		status: ProjectTranscriptionStatus;
		sourceCheckpointId: string;
		isSubmitting: boolean;
		error: string | null;
		onConfirm: (allowReplaceDirty: boolean) => Promise<void> | void;
		onClose: () => void;
	}

	let { status, sourceCheckpointId, isSubmitting, error, onConfirm, onClose }: Props = $props();

	let confirmReplaceDirty = $state(false);

	let targetIsDirty = $derived(status.dirtyToCheckpoint);
	let sourceLabel = $derived(
		status.canonicalSource?.title || status.canonicalSource?.siglum || ''
	);
	let shortRevisionId = $derived(
		sourceCheckpointId.length <= 12
			? sourceCheckpointId
			: `${sourceCheckpointId.slice(0, 8)}...`
	);

	function close() {
		if (isSubmitting) return;
		onClose();
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (isSubmitting) return;
		if (targetIsDirty && !confirmReplaceDirty) return;
		await onConfirm(targetIsDirty ? confirmReplaceDirty : false);
	}
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
	<div
		class="absolute inset-0 bg-black/40"
		role="button"
		tabindex="-1"
		aria-label="Close refresh dialog"
		onclick={close}
		onkeydown={event => {
			if (event.key === 'Escape') close();
		}}
	></div>
	<div
		class="relative z-10 w-full max-w-lg rounded-box border border-base-300/60 bg-base-100 p-5 shadow-xl"
	>
		<div class="flex items-start justify-between gap-3">
			<div class="flex items-start gap-3">
				<div class="rounded-box bg-secondary/10 p-2 text-secondary">
					<ArrowsClockwise size={20} />
				</div>
				<div>
					<h2 class="font-serif text-lg font-semibold leading-tight">
						Refresh project transcription from source
					</h2>
					<p class="text-xs text-base-content/50">
						{status.title || status.siglum}
					</p>
				</div>
			</div>
			<button
				type="button"
				class="btn btn-sm btn-circle btn-ghost"
				aria-label="Close refresh dialog"
				disabled={isSubmitting}
				onclick={close}
			>
				<X size={16} />
			</button>
		</div>

		<div class="mt-4 space-y-3 text-sm">
			<p class="text-base-content/80">
				This replaces the project transcription's working content with the selected
				committed source version.
			</p>
			{#if sourceLabel}
				<p class="text-xs text-base-content/60">
					Source: <span class="font-medium text-base-content/80">{sourceLabel}</span>
					{#if shortRevisionId}
						<span class="ml-1 font-mono text-base-content/45">({shortRevisionId})</span>
					{/if}
				</p>
			{/if}
			<div
				class="flex items-start gap-2 rounded-box border border-warning/40 bg-warning/10 p-3 text-xs text-base-content/80"
			>
				<Warning size={16} class="mt-0.5 shrink-0 text-warning" />
				<span>
					Collations that already use this transcription remain pinned to their current
					witness versions.
				</span>
			</div>
			{#if targetIsDirty}
				<label
					class="flex items-start gap-2 rounded-box border border-error/40 bg-error/10 p-3 text-xs text-base-content/90"
				>
					<input
						type="checkbox"
						class="checkbox checkbox-sm checkbox-error mt-0.5"
						bind:checked={confirmReplaceDirty}
						disabled={isSubmitting}
					/>
					<span> Replace uncommitted changes in this project transcription. </span>
				</label>
			{/if}
			{#if error}
				<p class="text-sm text-error" role="alert">{error}</p>
			{/if}
		</div>

		<div class="mt-5 flex items-center justify-end gap-2">
			<button
				type="button"
				class="btn btn-sm btn-ghost"
				disabled={isSubmitting}
				onclick={close}
			>
				Cancel
			</button>
			<form onsubmit={handleSubmit}>
				<button
					type="submit"
					class="btn btn-sm btn-secondary gap-1"
					disabled={isSubmitting || (targetIsDirty && !confirmReplaceDirty)}
				>
					{#if isSubmitting}
						<span class="loading loading-spinner loading-xs"></span>
						Refreshing...
					{:else}
						<ArrowsClockwise size={14} />
						Refresh transcription
					{/if}
				</button>
			</form>
		</div>
	</div>
</div>
