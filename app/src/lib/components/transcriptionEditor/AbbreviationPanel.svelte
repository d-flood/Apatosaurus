<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';
	import Trash from 'phosphor-svelte/lib/Trash';
	import { COMMON_ABBREVIATION_TYPES } from './editorCommands';

	interface Props {
		title?: string;
		description?: string;
		abbrType?: string;
		abbrExpansion?: string;
		abbrRend?: string;
		onApply: () => void;
		onRemove: () => void;
	}

	let {
		title = 'Abbreviation',
		description = '',
		abbrType = $bindable('nomSac'),
		abbrExpansion = $bindable(''),
		abbrRend = $bindable('¯'),
		onApply,
		onRemove,
	}: Props = $props();

</script>

<div class="space-y-3">
	<div>
		<h4 class="text-sm font-semibold">{title}</h4>
		{#if description}
			<p class="text-xs text-base-content/70">{description}</p>
		{/if}
	</div>
	<label class="form-control">
		<span class="label-text text-xs font-semibold">Type</span>
		<input
			class="input input-bordered input-sm"
			bind:value={abbrType}
			placeholder="e.g. nomSac, ligature"
			list="shared-abbr-types"
		/>
		<datalist id="shared-abbr-types">
			{#each COMMON_ABBREVIATION_TYPES as option}
				<option value={option}></option>
			{/each}
		</datalist>
	</label>
	<label class="form-control">
		<span class="label-text text-xs font-semibold">Expansion</span>
		<input class="input input-bordered input-sm" bind:value={abbrExpansion} placeholder="e.g. and" />
	</label>
	{#if abbrType === 'ligature'}
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Rendering Character</span>
			<input class="input input-bordered input-sm" bind:value={abbrRend} maxlength="2" />
		</label>
	{/if}
	<div class="flex gap-2 justify-end">
		<button class="btn btn-sm btn-primary" onclick={onApply}>
			<Check size={16} />
			Apply
		</button>
		<button class="btn btn-sm btn-error btn-outline" onclick={onRemove}>
			<Trash size={16} />
			Remove
		</button>
	</div>
</div>
