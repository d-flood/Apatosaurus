<script lang="ts">
	import BracketsRound from 'phosphor-svelte/lib/BracketsRound';
	import BracketsSquare from 'phosphor-svelte/lib/BracketsSquare';
	import Eye from 'phosphor-svelte/lib/Eye';
	import EyeSlash from 'phosphor-svelte/lib/EyeSlash';
	import Paragraph from 'phosphor-svelte/lib/Paragraph';
	import Quotes from 'phosphor-svelte/lib/Quotes';
	import Stack from 'phosphor-svelte/lib/Stack';
	import { FilePenLine, FileQuestionMark } from 'lucide-svelte';
	import { Lacuna, Uncertain } from '$lib/icons';
	import type { MarkVisibility } from './types';

	interface Props {
		markVisibility: MarkVisibility;
	}

	let { markVisibility = $bindable() }: Props = $props();

	function toggleAllMarks(show: boolean) {
		Object.keys(markVisibility).forEach(key => {
			markVisibility[key as keyof typeof markVisibility] = show;
		});
	}

</script>

<button class="btn" popovertarget="layers" style="anchor-name:--layers-anchor">
	<Stack size={16} />
	Layers
</button>
<div
	class="dropdown dropdown-top w-52 rounded-box bg-base-100 shadow-sm p-2 space-y-1"
	popover
	id="layers"
	style="position-anchor:--layers-anchor"
>
	<label class="flex items-center gap-1 cursor-pointer">
		<input
			type="checkbox"
			bind:checked={markVisibility.lacunose}
			class="checkbox checkbox-xs"
		/>
		<BracketsSquare size={14} />
		<span class="text-xs">Supplied Text</span>
	</label>

	<label class="flex items-center gap-1 cursor-pointer">
		<input type="checkbox" bind:checked={markVisibility.unclear} class="checkbox checkbox-xs" />
		<Uncertain size={14} />
		<span class="text-xs">Uncertain Readings</span>
	</label>

	<label class="flex items-center gap-1 cursor-pointer">
		<input
			type="checkbox"
			bind:checked={markVisibility.correction}
			class="checkbox checkbox-xs"
		/>
		<FilePenLine size={14} />
		<span class="text-xs">Corrections</span>
	</label>

	<label class="flex items-center gap-1 cursor-pointer">
		<input
			type="checkbox"
			bind:checked={markVisibility.abbreviation}
			class="checkbox checkbox-xs"
		/>
		<BracketsRound size={14} />
		<span class="text-xs">Abbreviations</span>
	</label>

	<label class="flex items-center gap-1 cursor-pointer">
		<input
			type="checkbox"
			bind:checked={markVisibility.punctuation}
			class="checkbox checkbox-xs"
		/>
		<Quotes size={14} />
		<span class="text-xs">Punctuation</span>
	</label>

	<label class="flex items-center gap-1 cursor-pointer">
		<input
			type="checkbox"
			bind:checked={markVisibility.untranscribed}
			class="checkbox checkbox-xs"
		/>
		<FileQuestionMark size={14} />
		<span class="text-xs">Untranscribed</span>
	</label>

	<label class="flex items-center gap-1 cursor-pointer">
		<input type="checkbox" bind:checked={markVisibility.gap} class="checkbox checkbox-xs" />
		<Lacuna size={14} />
		<span class="text-xs">Lacunae</span>
	</label>

	<label class="flex items-center gap-1 cursor-pointer">
		<input type="checkbox" bind:checked={markVisibility.book} class="checkbox checkbox-xs" />
		<Paragraph size={14} />
		<span class="text-xs">Book Markers</span>
	</label>

	<label class="flex items-center gap-1 cursor-pointer">
		<input type="checkbox" bind:checked={markVisibility.verse} class="checkbox checkbox-xs" />
		<Paragraph size={14} />
		<span class="text-xs">Verse Markers</span>
	</label>

	<label class="flex items-center gap-1 cursor-pointer">
		<input
			type="checkbox"
			bind:checked={markVisibility.wrappedArrow}
			class="checkbox checkbox-xs"
		/>
		<span class="text-xs">Wrapped Words</span>
	</label>

	<label class="flex items-center gap-1 cursor-pointer">
		<input
			type="checkbox"
			bind:checked={markVisibility.paragraphStart}
			class="checkbox checkbox-xs"
		/>
		<span class="text-xs">Paragraph Start</span>
	</label>

	<div class="divider my-1"></div>

	<button onclick={() => toggleAllMarks(true)} class="btn btn-xs" title="Show all marks">
		<Eye size={14} />
		All
	</button>

	<button
		onclick={() => toggleAllMarks(false)}
		class="btn btn-xs btn-outline"
		title="Hide all marks"
	>
		<EyeSlash size={14} />
		None
	</button>
</div>
