<script lang="ts">
	import ArrowsLeftRight from 'phosphor-svelte/lib/ArrowsLeftRight';
	import Warning from 'phosphor-svelte/lib/Warning';
	import X from 'phosphor-svelte/lib/X';
	import type { ProjectTranscriptionSourceCandidate } from '$lib/db/repositories/projects';
	import SourceVersionPicker from '$lib/shell/components/SourceVersionPicker.svelte';

	interface Props {
		candidates: ProjectTranscriptionSourceCandidate[];
		isLoadingCandidates: boolean;
		isSubmitting: boolean;
		error: string | null;
		onConfirm: (
			candidate: ProjectTranscriptionSourceCandidate,
			versionId: string | null
		) => Promise<void> | void;
		onClose: () => void;
	}

	let { candidates, isLoadingCandidates, isSubmitting, error, onConfirm, onClose }: Props =
		$props();

	let selectedId = $state<string | null>(null);
	let selectedVersionId = $state<string | null>(null);

	let selectedCandidate = $derived(
		candidates.find(candidate => candidate.projectTranscriptionId === selectedId) ?? null
	);

	function versionCountLabel(candidate: ProjectTranscriptionSourceCandidate): string {
		const count = candidate.versions.length;
		if (count === 0) return 'No named versions';
		return `${count} named version${count === 1 ? '' : 's'}`;
	}

	function close() {
		if (isSubmitting) return;
		onClose();
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (isSubmitting || !selectedCandidate) return;
		await onConfirm(selectedCandidate, selectedVersionId);
	}
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
	<div
		class="absolute inset-0 bg-black/40"
		role="button"
		tabindex="-1"
		aria-label="Close add from project dialog"
		onclick={close}
		onkeydown={event => {
			if (event.key === 'Escape') close();
		}}
	></div>
	<div
		class="relative z-10 w-full max-w-xl rounded-box border border-base-300/60 bg-base-100 p-5 shadow-xl"
	>
		<div class="flex items-start justify-between gap-3">
			<div class="flex items-start gap-3">
				<div class="rounded-box bg-secondary/10 p-2 text-secondary">
					<ArrowsLeftRight size={20} />
				</div>
				<div>
					<h2 class="font-serif text-lg font-semibold leading-tight">
						Add transcription from another project
					</h2>
					<p class="text-xs text-base-content/50">
						Reuse a project transcription as new source material.
					</p>
				</div>
			</div>
			<button
				type="button"
				class="btn btn-sm btn-circle btn-ghost"
				aria-label="Close add from project dialog"
				disabled={isSubmitting}
				onclick={close}
			>
				<X size={16} />
			</button>
		</div>

		<div class="mt-4 space-y-3 text-sm">
			<p class="text-base-content/80">
				Select a project transcription from another local project, then its Current or a
				named version. This creates a new full project transcription in the current project.
				The source project is not changed.
			</p>
			<div
				class="flex items-start gap-2 rounded-box border border-warning/40 bg-warning/10 p-3 text-xs text-base-content/80"
			>
				<Warning size={16} class="mt-0.5 shrink-0 text-warning" />
				<span>
					Collations in the current project will not use the new transcription until you
					add it as a witness.
				</span>
			</div>

			{#if isLoadingCandidates}
				<div
					class="flex items-center gap-2 rounded-box bg-base-200/70 p-4 text-sm text-base-content/60"
				>
					<span class="loading loading-spinner loading-sm"></span>
					Loading source candidates...
				</div>
			{:else if candidates.length === 0}
				<div
					class="rounded-box border border-dashed border-base-300/80 p-4 text-sm text-base-content/55"
				>
					No project transcriptions from other projects yet.
				</div>
			{:else}
				<div class="max-h-80 space-y-1.5 overflow-y-auto">
					{#each candidates as candidate (candidate.projectTranscriptionId)}
						<button
							type="button"
							class={`flex w-full items-start gap-2 rounded-box border px-3 py-2 text-left transition-colors ${
								selectedId === candidate.projectTranscriptionId
									? 'border-secondary/50 bg-secondary/10'
									: 'border-base-300/50 hover:bg-base-200/60'
							}`}
							disabled={isSubmitting}
							onclick={() => {
								selectedId = candidate.projectTranscriptionId;
								selectedVersionId = null;
							}}
						>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="font-mono text-sm font-bold"
										>{candidate.siglum || candidate.title}</span
									>
								</div>
								<div class="mt-0.5 text-[11px] text-base-content/50">
									From <span class="text-base-content/70"
										>{candidate.projectName}</span
									>
									{#if candidate.title}
										<span class="ml-1">· {candidate.title}</span>
									{/if}
								</div>
							</div>
							<span class="badge badge-xs badge-ghost shrink-0">
								{versionCountLabel(candidate)}
							</span>
						</button>
					{/each}
				</div>
			{/if}

			{#if selectedCandidate}
				<SourceVersionPicker
					currentEditedAt={selectedCandidate.currentEditedAt}
					versions={selectedCandidate.versions}
					bind:value={selectedVersionId}
					disabled={isSubmitting}
				/>
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
					disabled={isSubmitting || !selectedCandidate}
				>
					{#if isSubmitting}
						<span class="loading loading-spinner loading-xs"></span>
						Adding...
					{:else}
						<ArrowsLeftRight size={14} />
						Add to project
					{/if}
				</button>
			</form>
		</div>
	</div>
</div>
