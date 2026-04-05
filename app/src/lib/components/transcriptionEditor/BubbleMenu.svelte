<script lang="ts">
	import { Editor } from '@tiptap/core';
	import BracketsRound from 'phosphor-svelte/lib/BracketsRound';
	import BracketsSquare from 'phosphor-svelte/lib/BracketsSquare';
	import Quotes from 'phosphor-svelte/lib/Quotes';
	import { FilePenLine } from 'lucide-svelte';
	import { Uncertain } from '$lib/icons';
	import { toggleEditorMark } from './editorCommands';

	interface Props {
		editor: Editor | null;
		bubbleMenu?: HTMLElement | null;
		onOpenCorrection?: () => void;
		onOpenAbbreviation?: () => void;
	}

	let {
		editor = $bindable(),
		bubbleMenu = $bindable<HTMLElement | null>(null),
		onOpenCorrection,
		onOpenAbbreviation,
	}: Props = $props();
</script>

<div
	class="floating-menu join"
	bind:this={bubbleMenu}
	role="toolbar"
	aria-label="Selection formatting"
	tabindex="-1"
	onmousedown={event => event.preventDefault()}
>
	<div class="tooltip tooltip-primary" data-tip="Mark as Supplied Text">
		<button
			onclick={() => toggleEditorMark(editor, 'lacunose')}
			class="btn btn-primary btn-sm join-item"
			aria-label="Mark as Supplied Text"
		>
			<BracketsSquare class="inline-block" size={24} />
		</button>
	</div>
	<div class="tooltip tooltip-primary" data-tip="Mark as Uncertain Reading">
		<button
			onclick={() => toggleEditorMark(editor, 'unclear')}
			class="btn btn-primary btn-sm join-item"
			aria-label="Mark as Uncertain Reading"
		>
			<Uncertain class="inline-block" size={24} />
		</button>
	</div>
	<div class="tooltip tooltip-primary" data-tip="Mark Selection as Corrected">
		<button
			onclick={() => onOpenCorrection?.()}
			class="btn btn-primary btn-sm join-item"
			aria-label="Mark Selection as Corrected"
		>
			<FilePenLine class="inline-block" size={20} />
		</button>
	</div>
	<div class="tooltip tooltip-primary" data-tip="Mark Selection as Abbreviation">
		<button
			onclick={() => onOpenAbbreviation?.()}
			class="btn btn-primary btn-sm join-item"
			aria-label="Mark Selection as Abbreviation"
		>
			<BracketsRound class="inline-block" size={24} />
		</button>
	</div>
	<div class="tooltip tooltip-primary" data-tip="Mark Selection as Punctuation">
		<button
			onclick={() => toggleEditorMark(editor, 'punctuation')}
			class="btn btn-primary btn-sm join-item"
			aria-label="Mark Selection as Punctuation"
		>
			<Quotes size={24} />
		</button>
	</div>
</div>
