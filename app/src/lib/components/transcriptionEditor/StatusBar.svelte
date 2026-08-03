<script lang="ts">
	import LayerToggles from './LayerToggles.svelte';

	import BookmarkSimple from 'phosphor-svelte/lib/BookmarkSimple';
	import Paragraph from 'phosphor-svelte/lib/Paragraph';
	import Hash from 'phosphor-svelte/lib/Hash';
	import Scroll from 'phosphor-svelte/lib/Scroll';
	import Rows from 'phosphor-svelte/lib/Rows';
	import TextColumns from 'phosphor-svelte/lib/TextColumns';
	import { Columns2 } from 'lucide-svelte';
	import type { MarkVisibility } from './types';

	interface CursorPosition {
		pageName?: string;
		column?: number;
		line?: number;
		book?: string;
		chapter?: string;
		verse?: string;
	}

	interface Props {
		markVisibility: MarkVisibility;
		transcriptionMetadataDialog?: any;
		cursorPosition?: CursorPosition;
		stackColumns: boolean;
		sticky?: boolean;
	}

	let {
		markVisibility = $bindable(),
		transcriptionMetadataDialog = $bindable(),
		cursorPosition,
		stackColumns = $bindable(),
		sticky = true,
	}: Props = $props();

	function openModal() {
		// Try to use the bound dialog first, otherwise query the DOM
		const dialog =
			transcriptionMetadataDialog ||
			(document.getElementById('transcription-metadata-modal') as HTMLDialogElement);
		dialog?.showModal();
	}
</script>

<div
	id="status-bar"
	class={[
		'w-full rounded-box border border-base-300 bg-base-200/95 px-4 py-2 shadow-lg backdrop-blur',
		sticky ? 'sticky bottom-0 left-0 right-0' : '',
	]}
>
	<div class="flex flex-row items-center justify-between">
		<div class="flex flex-wrap gap-2 items-center">
			<LayerToggles {markVisibility}></LayerToggles>
			<div
				class="tooltip tooltip-top"
				data-tip={stackColumns ? 'Show columns inline' : 'Stack transcription columns'}
			>
				<button
					type="button"
					class="btn"
					class:btn-active={stackColumns}
					onclick={() => (stackColumns = !stackColumns)}
					aria-label={stackColumns
						? 'Show columns inline'
						: 'Stack transcription columns'}
					aria-pressed={stackColumns}
				>
					{#if stackColumns}
						<TextColumns size={16} />
					{:else}
						<Rows size={16} />
					{/if}
				</button>
			</div>
		</div>

		<div class="flex items-center flex-nowrap gap-2 text-xs font-semibold mr-2">
			{#if cursorPosition?.pageName}
				<span class="text-nowrap inline-flex items-center gap-1">
					<BookmarkSimple size={14} />
					{cursorPosition.pageName}
				</span>
			{/if}
			{#if cursorPosition?.column}
				<span class="text-nowrap inline-flex items-center gap-1">
					<Columns2 size={14} />
					Col {cursorPosition.column}
				</span>
			{/if}
			{#if cursorPosition?.line}
				<span class="text-nowrap inline-flex items-center gap-1">
					<Hash size={14} />
					Line {cursorPosition.line}
				</span>
			{/if}
			{#if cursorPosition?.book || cursorPosition?.chapter || cursorPosition?.verse}
				<span class="text-nowrap inline-flex items-center gap-1">
					<Paragraph size={14} />
					{cursorPosition?.book || '?'}
					{#if cursorPosition?.chapter}
						{cursorPosition.chapter}
					{/if}
					{#if cursorPosition?.verse}
						:{cursorPosition.verse}
					{/if}
				</span>
			{/if}
		</div>

		<div class="tooltip tooltip-left" data-tip="Open Transcription Metadata">
			<button
				type="button"
				onclick={openModal}
				class="btn px-2"
				aria-label="Open transcription metadata modal"
			>
				<Scroll size={28} />
			</button>
		</div>
	</div>
</div>
