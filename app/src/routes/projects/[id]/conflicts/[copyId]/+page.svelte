<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	import { loadConflictCopyContents, reconcileConflictCopy } from '$lib/db/client';
	import type { ConflictCopyContents } from '$lib/backup/conflicts';
	import type { CollationDocument } from '$lib/collation/collation-document';
	import VersionCompare from '$lib/shell/components/VersionCompare.svelte';
	import { formatConflictCopyTitle } from '$lib/shell/source-labels';
	import {
		compareCollations,
		compareTranscriptions,
		formatCollationPart,
		formatTranscriptionPart,
		type CompareChoices,
	} from '$lib/shell/version-compare';
	import type { ProjectRecord } from '$lib/db/repositories/projects';

	let { data } = $props<{ data: { project: ProjectRecord } }>();

	const copyId = $derived(page.params.copyId ?? '');
	let contents = $state.raw<ConflictCopyContents | null>(null);
	let error = $state<string | null>(null);
	let applying = $state(false);

	const parts = $derived.by(() => {
		if (!contents) return [];
		return contents.copy.kind === 'transcription'
			? compareTranscriptions(contents.mine, contents.theirs)
			: compareCollations(
					contents.mine as CollationDocument,
					contents.theirs as CollationDocument
				);
	});

	$effect(() => {
		const id = copyId;
		contents = null;
		error = null;
		loadConflictCopyContents(id)
			.then(loaded => {
				if (id === copyId) contents = loaded;
			})
			.catch((cause: unknown) => {
				if (id === copyId)
					error = cause instanceof Error ? cause.message : 'Conflict copy not found.';
			});
	});

	async function apply(choices: CompareChoices) {
		if (!contents) return;
		applying = true;
		error = null;
		try {
			await reconcileConflictCopy(copyId, choices);
			const params = { id: data.project.id };
			await goto(
				contents.copy.kind === 'transcription'
					? resolve('/projects/[id]/transcriptions', params)
					: resolve('/projects/[id]/collations', params)
			);
		} catch (cause) {
			error =
				cause instanceof Error ? cause.message : 'Could not reconcile the conflict copy.';
		} finally {
			applying = false;
		}
	}
</script>

<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	{#if error}
		<div class="alert alert-error mb-3 text-sm">{error}</div>
	{/if}
	{#if contents}
		<div class="mb-3">
			<h2 class="font-serif text-lg font-semibold">
				{formatConflictCopyTitle(contents.copy)}
			</h2>
			<p class="text-xs text-base-content/50">
				Keep yours or theirs for each {contents.copy.kind === 'transcription'
					? 'verse'
					: 'variation unit'}. Applying updates the document and removes the conflict
				copy.
			</p>
		</div>
		<fieldset disabled={applying}>
			<VersionCompare
				{parts}
				leftLabel="Mine"
				rightLabel="Theirs"
				format={contents.copy.kind === 'transcription'
					? formatTranscriptionPart
					: formatCollationPart}
				mode="choose"
				onChoose={apply}
			/>
		</fieldset>
	{:else if !error}
		<div
			class="flex items-center gap-2 rounded-box bg-base-200/70 p-4 text-sm text-base-content/60"
		>
			<span class="loading loading-spinner loading-sm"></span>
			Loading conflict copy...
		</div>
	{/if}
</div>
