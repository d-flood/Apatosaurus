<script lang="ts">
	import CorrectionWorkspace from './CorrectionWorkspace.svelte';
	import type { Editor } from '@tiptap/core';
	import type { Correction } from './types';

	interface Props {
		id: string;
		editor: Editor | null;
	}

	let { id, editor }: Props = $props();
	let tempCorrections = $state<Correction[]>([]);

	function handlePopoverToggle(event: Event) {
		const toggleEvent = event as ToggleEvent;

		if (toggleEvent.newState === 'open') {
			if (editor) {
				const { state } = editor;
				const { from, to } = state.selection;

				// Check if selection has correction mark
				const marks = state.doc.rangeHasMark(from, to, state.schema.marks.correction);

				if (marks) {
					// Find the correction mark to get existing corrections
					let existingCorrections: Correction[] = [];
					state.doc.nodesBetween(from, to, node => {
						if (node.marks) {
							const correctionMark = node.marks.find(
								m => m.type.name === 'correction'
							);
							if (correctionMark && correctionMark.attrs.corrections) {
								existingCorrections = correctionMark.attrs.corrections;
								return false;
							}
						}
					});
					tempCorrections = [...existingCorrections];
				} else {
					tempCorrections = [];
				}
			}
		} else if (toggleEvent.newState === 'closed') {
			tempCorrections = [];
		}
	}

	function handleRemove() {
		if (!editor) return;

		editor.chain().focus().unsetMark('correction').run();

		const popoverEl = document.getElementById(id) as HTMLElement & { hidePopover: () => void };
		if (popoverEl?.hidePopover) popoverEl.hidePopover();
	}
</script>

<div
	popover
	{id}
	style="position-anchor: --anchor-bubble-correction"
	class="dropdown rounded-box p-3 bg-primary shadow-lg w-80"
	ontoggle={handlePopoverToggle}
>
	<CorrectionWorkspace
		idPrefix={id}
		title="Correction(s)"
		description="Edit single-witness correction readings for the current selection."
		initialCorrections={tempCorrections}
		applyLabel="Apply"
		variant="popover"
		onApply={corrections => {
			if (!editor || corrections.length === 0) return;
			editor.chain().focus().setMark('correction', { corrections }).run();
			const popoverEl = document.getElementById(id) as HTMLElement & { hidePopover: () => void };
			if (popoverEl?.hidePopover) popoverEl.hidePopover();
		}}
		onRemoveAll={handleRemove}
	/>
</div>
