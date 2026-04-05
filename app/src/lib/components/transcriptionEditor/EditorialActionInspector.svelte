<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';
	import { editorialActionLabel } from './tei-inspector-utils';

	interface Props {
		attrs: Record<string, any>;
		onApply: (attrs: Record<string, any>) => void;
	}

	let { attrs, onApply }: Props = $props();

	let targetsDraft = $state('');
	let itemsDraft = $state('[]');
	let lastSnapshot = $state('');

	const structure = $derived(
		attrs?.structure && typeof attrs.structure === 'object' ? attrs.structure : null
	);
	const isListTranspose = $derived(structure?.kind === 'listTranspose');
	const kindLabel = $derived(editorialActionLabel(structure?.kind));

	$effect(() => {
		const snapshot = JSON.stringify(attrs || {});
		if (snapshot === lastSnapshot) return;
		lastSnapshot = snapshot;
		targetsDraft = Array.isArray(structure?.targets) ? structure.targets.join(' ') : '';
		itemsDraft = JSON.stringify(structure?.items || [], null, 2);
	});

	function apply() {
		if (!structure) return;
		const existingAttrs = (structure?.attrs as Record<string, any>) || attrs?.teiAttrs || {};
		const nextStructure =
			structure.kind === 'listTranspose'
				? {
						...structure,
						attrs: existingAttrs,
						items: JSON.parse(itemsDraft),
					}
				: {
						...structure,
						attrs: existingAttrs,
						targets: targetsDraft
							.split(/\s+/)
							.map(token => token.trim())
							.filter(Boolean),
					};

		onApply({
			...attrs,
			teiAttrs: existingAttrs,
			structure: nextStructure,
		});
	}
</script>

{#if structure}
	<div class="space-y-3">
		<div class="text-xs text-base-content/70">{kindLabel}</div>

		{#if isListTranspose}
			<label class="form-control">
				<span class="label-text text-xs font-semibold">Transpose Items</span>
				<textarea
					class="textarea textarea-bordered min-h-32 font-mono text-xs"
					bind:value={itemsDraft}
					spellcheck="false"
				></textarea>
			</label>
		{:else}
			<label class="form-control">
				<span class="label-text text-xs font-semibold">Targets</span>
				<input
					class="input input-bordered input-sm font-mono"
					bind:value={targetsDraft}
					placeholder="#id1 #id2"
				/>
			</label>
		{/if}

		<div class="flex justify-end">
			<button type="button" class="btn btn-primary btn-sm" onclick={apply}>
				<Check size={16} />
				Apply
			</button>
		</div>
	</div>
{/if}
