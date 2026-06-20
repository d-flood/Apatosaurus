<script lang="ts">
	import ArrowUp from 'phosphor-svelte/lib/ArrowUp';
	import Info from 'phosphor-svelte/lib/Info';
	import X from 'phosphor-svelte/lib/X';
	import { untrack } from 'svelte';
	import type { ProjectTranscriptionStatus } from '$lib/client/collation/project-collation';

	interface PromoteInput {
		title: string;
		siglum: string;
		description: string;
	}

	interface Props {
		status: ProjectTranscriptionStatus;
		isSubmitting: boolean;
		error: string | null;
		onConfirm: (input: PromoteInput) => Promise<void> | void;
		onClose: () => void;
	}

	let { status, isSubmitting, error, onConfirm, onClose }: Props = $props();

	let titleDraft = $state(untrack(() => status.title ?? ''));
	let siglumDraft = $state(untrack(() => status.siglum ?? ''));
	let descriptionDraft = $state(untrack(() => status.description ?? ''));

	let shortRevisionId = $derived(
		status.currentCheckpoint
			? status.currentCheckpoint.revisionId.length <= 12
				? status.currentCheckpoint.revisionId
				: `${status.currentCheckpoint.revisionId.slice(0, 8)}...`
			: ''
	);

	function close() {
		if (isSubmitting) return;
		onClose();
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (isSubmitting) return;
		const title = titleDraft.trim();
		const siglum = siglumDraft.trim();
		if (!title || !siglum) return;
		await onConfirm({
			title,
			siglum,
			description: descriptionDraft.trim(),
		});
	}
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
	<div
		class="absolute inset-0 bg-black/40"
		role="button"
		tabindex="-1"
		aria-label="Close promote dialog"
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
				<div class="rounded-box bg-primary/10 p-2 text-primary">
					<ArrowUp size={20} />
				</div>
				<div>
					<h2 class="font-serif text-lg font-semibold leading-tight">
						Promote project transcription to library
					</h2>
					<p class="text-xs text-base-content/50">
						{#if shortRevisionId}
							<span class="font-mono">Version {shortRevisionId}</span>
						{/if}
					</p>
				</div>
			</div>
			<button
				type="button"
				class="btn btn-sm btn-circle btn-ghost"
				aria-label="Close promote dialog"
				disabled={isSubmitting}
				onclick={close}
			>
				<X size={16} />
			</button>
		</div>

		<div class="mt-4 space-y-3 text-sm">
			<p class="text-base-content/80">
				This creates a new library transcription from the committed project transcription.
				The source project transcription is not changed.
			</p>
			<div
				class="flex items-start gap-2 rounded-box border border-info/40 bg-info/10 p-3 text-xs text-base-content/80"
			>
				<Info size={16} class="mt-0.5 shrink-0 text-info" />
				<span>
					The promoted library transcription becomes reusable source material. Other
					projects can add it without affecting this project.
				</span>
			</div>
			<div class="grid gap-3">
				<label class="form-control">
					<div class="label pb-1">
						<span class="label-text text-xs text-base-content/60">Siglum</span>
					</div>
					<input
						type="text"
						class="input input-bordered input-sm w-full"
						bind:value={siglumDraft}
						disabled={isSubmitting}
						placeholder="Short siglum"
					/>
				</label>
				<label class="form-control">
					<div class="label pb-1">
						<span class="label-text text-xs text-base-content/60">Title</span>
					</div>
					<input
						type="text"
						class="input input-bordered input-sm w-full"
						bind:value={titleDraft}
						disabled={isSubmitting}
						placeholder="Library transcription title"
					/>
				</label>
				<label class="form-control">
					<div class="label pb-1">
						<span class="label-text text-xs text-base-content/60">Description</span>
					</div>
					<textarea
						class="textarea textarea-bordered textarea-sm min-h-16 w-full"
						bind:value={descriptionDraft}
						disabled={isSubmitting}
						placeholder="Optional description"
					></textarea>
				</label>
			</div>
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
					class="btn btn-sm btn-primary gap-1"
					disabled={isSubmitting || !titleDraft.trim() || !siglumDraft.trim()}
				>
					{#if isSubmitting}
						<span class="loading loading-spinner loading-xs"></span>
						Promoting...
					{:else}
						<ArrowUp size={14} />
						Promote to library
					{/if}
				</button>
			</form>
		</div>
	</div>
</div>
