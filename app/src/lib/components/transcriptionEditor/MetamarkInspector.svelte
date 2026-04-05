<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';
	import { describeMetamarkTarget } from './editorCommands';
	import { METAMARK_FUNCTION_OPTIONS } from './metamarkOptions';
	import { omitKeys } from './tei-inspector-utils';

	interface Props {
		attrs: Record<string, any>;
		onApply: (attrs: Record<string, any>) => void;
	}

	let { attrs, onApply }: Props = $props();

	let functionValue = $state('');
	let lastSnapshot = $state('');
	const targetDescription = $derived(describeMetamarkTarget(attrs));

	$effect(() => {
		const snapshot = JSON.stringify(attrs || {});
		if (snapshot === lastSnapshot) return;
		lastSnapshot = snapshot;
		functionValue = String(attrs?.teiAttrs?.function || '');
	});

	function apply() {
		const normalizedFunction = functionValue.trim();
		const extras = omitKeys(attrs?.teiAttrs, ['function', 'target']);
		const teiAttrs = {
			...extras,
			...(normalizedFunction ? { function: normalizedFunction } : {}),
			...(attrs?.teiAttrs?.target ? { target: attrs.teiAttrs.target } : {}),
		};
		onApply({
			...attrs,
			summary: normalizedFunction ? `metamark:${normalizedFunction}` : attrs?.summary || 'metamark',
			teiAttrs,
		});
	}
</script>

<div class="space-y-3">
	<div class="grid gap-3 md:grid-cols-2">
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Mark Meaning</span>
			<select
				class="select select-bordered select-sm"
				bind:value={functionValue}
				aria-label="Function"
			>
				<option value="">Select metamark meaning</option>
				{#each METAMARK_FUNCTION_OPTIONS as option}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>
		</label>
		<div class="form-control">
			<span class="label-text text-xs font-semibold">Applies To</span>
			<div class="rounded border border-base-300 bg-base-200 px-3 py-2 text-sm" aria-label="Linked Target">
				{targetDescription}
			</div>
		</div>
	</div>

	<div class="flex justify-end">
		<button type="button" class="btn btn-primary btn-sm" onclick={apply}>
			<Check size={16} />
			Apply
		</button>
	</div>
</div>
