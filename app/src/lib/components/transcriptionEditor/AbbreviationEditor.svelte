<script lang="ts">
	import type { Editor } from '@tiptap/core';
	import { COMMON_ABBREVIATION_TYPES } from './editorCommands';
	import {
		applyAbbreviationMark,
		DEFAULT_ABBREVIATION_DRAFT,
		readAbbreviationDraft,
		removeAbbreviationMark,
	} from './editorInteractions';

	interface Props {
		id: string;
		editor: Editor | null;
	}

	let { id, editor }: Props = $props();

	let type = $state('nomSac');
	let expansion = $state('');
	let rend = $state('¯');

	function handlePopoverToggle(event: Event) {
		const toggleEvent = event as ToggleEvent;

		if (toggleEvent.newState === 'open') {
			const draft = readAbbreviationDraft(editor);
			if (!draft) return;
			type = draft.type;
			expansion = draft.expansion;
			rend = draft.rend;
		} else if (toggleEvent.newState === 'closed') {
			type = DEFAULT_ABBREVIATION_DRAFT.type;
			expansion = DEFAULT_ABBREVIATION_DRAFT.expansion;
			rend = DEFAULT_ABBREVIATION_DRAFT.rend;
		}
	}

	function handleApply() {
		if (!applyAbbreviationMark(editor, { type, expansion, rend })) return;

		const popoverEl = document.getElementById(id) as HTMLElement & { hidePopover: () => void };
		if (popoverEl?.hidePopover) popoverEl.hidePopover();
	}

	function handleRemove() {
		if (!removeAbbreviationMark(editor)) return;

		const popoverEl = document.getElementById(id) as HTMLElement & { hidePopover: () => void };
		if (popoverEl?.hidePopover) popoverEl.hidePopover();
	}
</script>

<div
	popover
	{id}
	style="position-anchor: --anchor-bubble-abbreviation"
	class="dropdown rounded-box p-4 bg-primary shadow-lg w-80"
	ontoggle={handlePopoverToggle}
>
	<div class="space-y-3">
		<h3 class="font-bold text-primary-content mb-2">Abbreviation</h3>

		<!-- Abbreviation Type -->
		<label class="label" for="{id}-type">
			<span class="label-text text-primary-content text-sm">Type</span>
		</label>
		<input
			id="{id}-type"
			type="text"
			bind:value={type}
			placeholder="e.g., nomSac, ligature, symbol"
			list="{id}-type-list"
			class="input input-sm input-bordered"
		/>
		<datalist id="{id}-type-list">
			{#each COMMON_ABBREVIATION_TYPES as typeOption}
				<option value={typeOption}></option>
			{/each}
		</datalist>

		<!-- Expansion -->
		<label class="label" for="{id}-expansion">
			<span class="label-text text-primary-content text-sm">Expansion</span>
		</label>
		<input
			id="{id}-expansion"
			type="text"
			bind:value={expansion}
			placeholder="e.g., and, that, -ment"
			class="input input-sm input-bordered"
		/>

		<!-- Rend Character (only for ligature type) -->
		{#if type === 'ligature'}
			<label class="label" for="{id}-rend">
				<span class="label-text text-primary-content text-sm">Rendering Character</span>
			</label>
			<input
				id="{id}-rend"
				type="text"
				bind:value={rend}
				placeholder="e.g., ¯"
				class="input input-sm input-bordered"
				maxlength="2"
			/>
		{/if}

		<!-- Current Metadata Display -->
		{#if type || expansion}
			<div class="divider my-2"></div>
			<div class="bg-base-200 p-3 rounded text-sm">
				<span class="font-bold text-base-content">Current:</span>
				<div class="text-base-content mt-1">
					{#if type}
						<div><span class="font-semibold">Type:</span> {type}</div>
					{/if}
					{#if expansion}
						<div><span class="font-semibold">Expansion:</span> {expansion}</div>
					{/if}
					{#if type === 'ligature' && rend}
						<div><span class="font-semibold">Rend:</span> {rend}</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Action Buttons -->
		<div class="flex gap-2 mt-4">
			<button onclick={handleApply} class="btn btn-sm btn-success flex-1"> Apply </button>
			<button onclick={handleRemove} class="btn btn-sm btn-error flex-1"> Remove </button>
		</div>
	</div>
</div>
