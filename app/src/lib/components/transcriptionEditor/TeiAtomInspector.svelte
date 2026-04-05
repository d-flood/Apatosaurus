<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';
	import { summarizeTeiAtomAttrs } from './editorCommands';
	import { extractTextChildren, syncTeiNode } from './tei-inspector-utils';

	interface Props {
		attrs: Record<string, any>;
		onApply: (attrs: Record<string, any>) => void;
	}

	let { attrs, onApply }: Props = $props();

	let textDraft = $state('');
	let noteType = $state('');
	let lastSnapshot = $state('');

	const tag = $derived(String(attrs?.tag || 'tei'));
	const textContent = $derived(extractTextChildren(attrs?.teiNode));
	const canEditText = $derived(tag === 'note' && textContent !== null);
	const isNote = $derived(tag === 'note');

	const noteTypeOptions = ['editorial', 'local'];

	$effect(() => {
		const snapshot = JSON.stringify(attrs || {});
		if (snapshot === lastSnapshot) return;
		lastSnapshot = snapshot;
		textDraft = textContent ?? String(attrs?.text || '');
		noteType = String(attrs?.teiAttrs?.type || '');
	});

	function apply() {
		const teiAttrs = { ...(attrs?.teiAttrs || {}) };
		if (isNote && noteType.trim()) {
			teiAttrs.type = noteType.trim();
		} else if (isNote && !noteType.trim()) {
			delete teiAttrs.type;
		}
		const nextText = canEditText ? textDraft : attrs?.text;
		onApply({
			...attrs,
			summary: summarizeTeiAtomAttrs(tag, teiAttrs, String(nextText || '')),
			teiAttrs,
			text: nextText,
			teiNode: syncTeiNode(attrs?.teiNode, teiAttrs, canEditText ? textDraft : undefined),
		});
	}
</script>

<div class="space-y-3">
	{#if isNote}
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Note Type</span>
			<input
				class="input input-bordered input-sm"
				bind:value={noteType}
				list="tei-note-type-options"
				placeholder="e.g. editorial, local"
			/>
			<datalist id="tei-note-type-options">
				{#each noteTypeOptions as opt}
					<option value={opt}></option>
				{/each}
			</datalist>
		</label>
	{/if}

	{#if canEditText}
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Text Content</span>
			<textarea class="textarea textarea-bordered min-h-24" bind:value={textDraft}></textarea>
		</label>
	{:else if textContent === null}
		<div class="rounded bg-base-200 p-3 text-xs text-base-content/70">
			This element contains nested structure. Attributes are editable here; nested content stays structured.
		</div>
	{/if}

	<div class="flex justify-end">
		<button type="button" class="btn btn-primary btn-sm" onclick={apply}>
			<Check size={16} />
			Apply
		</button>
	</div>
</div>
