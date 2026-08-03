<script lang="ts">
	import { onMount } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import { TextSelection } from '@tiptap/pm/state';
	import {
		fromProseMirror,
		parseTei,
		serializeTei,
		toProseMirror,
	} from '$lib/tei/tei-transcription';

	import { getEditor } from '$lib/client/transcriptionEditorSchema';
	import { initializeEditorContent } from '$lib/client/editorContentInitialization';

	const INITIAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader></teiHeader>
  <text><body><pb n="1r"/><cb n="1"/><lb/></body></text>
</TEI>`;

	let editorElement = $state<HTMLElement | null>(null);
	let bubbleMenuElement = $state<HTMLElement | null>(null);
	let editor = $state<Editor | null>(null);
	let exportedXml = $state('');

	function refreshExport() {
		exportedXml = editor ? serializeTei(fromProseMirror(editor.getJSON() as any)) : '';
	}

	function pasteSample() {
		if (!editor) return;
		editor.commands.focus('end');
		const clipboardData = new DataTransfer();
		clipboardData.setData('text/plain', 'alpha beta gamma');
		editor.view.dom.dispatchEvent(
			new ClipboardEvent('paste', {
				bubbles: true,
				cancelable: true,
				clipboardData,
			})
		);
	}

	function selectMiddleWord() {
		if (!editor) return;
		let selection: TextSelection | null = null;
		editor.state.doc.descendants((node, pos) => {
			if (selection || !node.isText || node.text !== 'alpha beta gamma') return;
			selection = TextSelection.create(editor!.state.doc, pos + 6, pos + 10);
		});
		if (!selection) return;
		editor.view.dispatch(editor.state.tr.setSelection(selection));
		editor.commands.focus();
	}

	onMount(() => {
		if (!editorElement || !bubbleMenuElement) return;
		const nextEditor = getEditor(editorElement, bubbleMenuElement);
		initializeEditorContent(nextEditor, toProseMirror(parseTei(INITIAL_XML)) as any, {
			emitUpdate: false,
		});
		nextEditor.on('update', refreshExport);
		nextEditor.commands.focus('end');
		editor = nextEditor;
		refreshExport();

		return () => nextEditor.destroy();
	});
</script>

<div class="space-y-4">
	<div bind:this={bubbleMenuElement} class="hidden"></div>
	<div data-testid="editor-content" bind:this={editorElement}></div>
	<div class="flex gap-2">
		<button type="button" data-testid="paste-sample" onclick={pasteSample}
			>Paste sample text</button
		>
		<button type="button" data-testid="select-middle-word" onclick={selectMiddleWord}>
			Select middle word
		</button>
	</div>
	<pre data-testid="exported-xml">{exportedXml}</pre>
</div>
