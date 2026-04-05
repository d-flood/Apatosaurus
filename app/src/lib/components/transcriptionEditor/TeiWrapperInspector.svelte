<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';
	import {
		applyTextLeafUpdates,
		collectTextLeaves,
		summarizeTeiChildren,
		type TeiTextLeaf,
	} from './tei-inspector-utils';

	interface Props {
		attrs: Record<string, any>;
		onApply: (attrs: Record<string, any>) => void;
	}

	interface TextLeafDraft extends TeiTextLeaf {
		label: string;
	}

	let { attrs, onApply }: Props = $props();

	let textLeafDrafts = $state<TextLeafDraft[]>([]);
	let languageValue = $state('');
	let lastSnapshot = $state('');

	const tag = $derived(String(attrs?.tag || 'seg'));
	const isForeign = $derived(tag === 'foreign');
	$effect(() => {
		const snapshot = JSON.stringify(attrs || {});
		if (snapshot === lastSnapshot) return;
		lastSnapshot = snapshot;
		languageValue = String(attrs?.teiAttrs?.['xml:lang'] || '');
		textLeafDrafts = collectTextLeaves(attrs?.children).map((leaf, index) => ({
			...leaf,
			label: `Text ${index + 1}`,
		}));
	});

	function apply() {
		const teiAttrs = { ...(attrs?.teiAttrs || {}) };
		if (isForeign && languageValue.trim()) {
			teiAttrs['xml:lang'] = languageValue.trim();
		}
		const textUpdates = Object.fromEntries(textLeafDrafts.map(leaf => [leaf.key, leaf.text]));
		const children = applyTextLeafUpdates(attrs?.children, textUpdates);
		onApply({
			...attrs,
			teiAttrs,
			children,
			text: summarizeTeiChildren(children),
		});
	}
</script>

<div class="space-y-3">
	{#if isForeign}
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Language</span>
			<input class="input input-bordered input-sm" bind:value={languageValue} placeholder="e.g. la, grc, he" />
		</label>
	{/if}

	{#if textLeafDrafts.length > 0}
		<div class="space-y-2">
			<div class="text-xs font-semibold text-base-content/60">
				Text Content
			</div>
			{#each textLeafDrafts as draft}
				<label class="form-control">
					<span class="label-text text-xs">{draft.label}</span>
					<textarea class="textarea textarea-bordered min-h-20" bind:value={draft.text}></textarea>
				</label>
			{/each}
		</div>
	{:else}
		<div class="rounded bg-base-200 p-3 text-xs text-base-content/70">
			This element has no direct text content that can be edited here.
		</div>
	{/if}

	<div class="flex justify-end">
		<button type="button" class="btn btn-primary btn-sm" onclick={apply}>
			<Check size={16} />
			Apply
		</button>
	</div>
</div>
