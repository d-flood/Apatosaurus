<script lang="ts">
	import { onMount } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import { TextSelection } from '@tiptap/pm/state';

	import {
		addReferenceEditionUsed,
		getReferenceEditionsUsed,
	} from '$lib/client/transcription/content';
	import {
		fromProseMirror,
		parseTei,
		serializeTei,
		toProseMirror,
	} from '$lib/tei/tei-transcription';
	import type { ParsedReferenceEdition } from '$lib/reference-editions/source';
	import { insertReferenceEditionRange } from '$lib/reference-editions/insertion';
	import ReferenceEditionPicker from './ReferenceEditionPicker.svelte';
	import { getEditor } from '$lib/client/transcriptionEditorSchema';
	import { initializeEditorContent } from '$lib/client/editorContentInitialization';

	const INITIAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc><titleStmt><title type="document">Fixture transcription</title></titleStmt></fileDesc>
  </teiHeader>
  <text><body><pb n="1r"/><cb n="1"/><lb/><w>existing</w><lb/><w>second</w><pb n="2r"/><cb n="1"/><lb/><w>third</w></body></text>
</TEI>`;

	const FIXTURE_SOURCE: ParsedReferenceEdition = {
		units: [
			{
				position: 0,
				label: { book: 'B01', chapter: 'B01K1', verse: 'B01K1V1' },
				content: [
					{
						type: 'milestone',
						kind: 'book',
						attrs: { book: 'B01' },
						sourceLabel: 'B01',
					},
					{
						type: 'milestone',
						kind: 'chapter',
						attrs: { book: 'B01', chapter: 'B01K1' },
						sourceLabel: 'B01K1',
					},
					{
						type: 'milestone',
						kind: 'verse',
						attrs: { book: 'B01', chapter: 'B01K1', verse: 'B01K1V1' },
						sourceLabel: 'B01K1V1',
					},
					{ type: 'text', text: 'alpha', marks: [] },
					{ type: 'boundary', kind: 'word' },
					{ type: 'text', text: 'beta', marks: [] },
					{
						type: 'fw',
						attrs: { type: 'header', teiAttrs: { type: 'header' } },
						content: [
							{
								type: 'teiWrapper',
								tag: 'foreign',
								summary: 'foreign',
								attrs: { 'xml:lang': 'la' },
								children: [
									{
										type: 'element',
										tag: 'w',
										children: [{ type: 'text', text: 'locus' }],
									},
								],
								wordInline: false,
								text: 'locus',
							},
							{ type: 'boundary', kind: 'word' },
							{
								type: 'teiAtom',
								tag: 'note',
								summary: 'note:source',
								attrs: { place: 'margin' },
								node: {
									type: 'element',
									tag: 'note',
									attrs: { place: 'margin' },
									children: [{ type: 'text', text: 'source' }],
								},
								wordInline: false,
								text: 'source',
							},
						],
					},
				],
			},
			{
				position: 1,
				label: { book: 'B01', chapter: 'B01K1', verse: 'B01K1V2' },
				content: [
					{
						type: 'milestone',
						kind: 'verse',
						attrs: { book: 'B01', chapter: 'B01K1', verse: 'B01K1V2' },
						sourceLabel: 'B01K1V2',
					},
					{ type: 'text', text: 'gamma', marks: [] },
				],
			},
		],
	};

	let editorElement = $state<HTMLElement | null>(null);
	let bubbleMenuElement = $state<HTMLElement | null>(null);
	let editor = $state<Editor | null>(null);
	let pickerOpen = $state(false);
	let canonicalDocument = $state(parseTei(INITIAL_XML));
	let exportedXml = $state('');
	let structureCounts = $state('0/0/0');

	function refresh() {
		if (!editor) return;
		const editorDocument = fromProseMirror(editor.getJSON() as any);
		const nextDocument = {
			...canonicalDocument,
			pages: editorDocument.pages,
		};
		canonicalDocument = nextDocument;
		exportedXml = serializeTei(nextDocument);
		let pages = 0;
		let columns = 0;
		let lines = 0;
		for (const page of editorDocument.pages) {
			pages += 1;
			columns += page.columns.length;
			lines += page.columns.reduce((count, column) => count + column.lines.length, 0);
		}
		structureCounts = `${pages}/${columns}/${lines}`;
	}

	function insertSeed(
		_entry: { id: string },
		source: ParsedReferenceEdition,
		startPosition: number,
		endPosition: number
	) {
		if (!editor || !insertReferenceEditionRange(editor, source, startPosition, endPosition))
			return;
		canonicalDocument = addReferenceEditionUsed(canonicalDocument, 'robinson-pierpont');
		refresh();
	}

	function selectSeededText() {
		if (!editor) return;
		let selection: TextSelection | null = null;
		editor.state.doc.descendants((node, pos) => {
			if (selection || !node.isText || node.text !== 'alpha') return;
			selection = TextSelection.create(editor!.state.doc, pos, pos + node.nodeSize);
		});
		if (!selection) return;
		editor.view.dispatch(editor.state.tr.setSelection(selection));
		editor.commands.focus();
	}

	function selectStructureSpan() {
		if (!editor) return;
		let firstTextPosition: number | null = null;
		let lastTextEnd: number | null = null;
		editor.state.doc.descendants((node, pos) => {
			if (!node.isText || !node.text) return;
			if (firstTextPosition === null) firstTextPosition = pos;
			lastTextEnd = pos + node.nodeSize;
		});
		if (firstTextPosition === null || lastTextEnd === null) return;
		editor.view.dispatch(
			editor.state.tr.setSelection(
				TextSelection.create(editor.state.doc, firstTextPosition, lastTextEnd)
			)
		);
		editor.commands.focus();
	}

	onMount(() => {
		if (!editorElement || !bubbleMenuElement) return;
		const nextEditor = getEditor(editorElement, bubbleMenuElement);
		initializeEditorContent(nextEditor, toProseMirror(canonicalDocument) as any, {
			emitUpdate: false,
		});
		nextEditor.on('update', refresh);
		nextEditor.commands.focus('end');
		editor = nextEditor;
		refresh();
		return () => nextEditor.destroy();
	});
</script>

<div class="space-y-4">
	<div bind:this={bubbleMenuElement} class="hidden"></div>
	<div data-testid="editor-content" bind:this={editorElement}></div>
	<div class="flex flex-wrap gap-2">
		<button type="button" data-testid="open-seed-picker" onclick={() => (pickerOpen = true)}
			>Seed</button
		>
		<button type="button" data-testid="select-seeded-text" onclick={selectSeededText}
			>Select seeded text</button
		>
		<button type="button" data-testid="select-structure-span" onclick={selectStructureSpan}
			>Select structure span</button
		>
	</div>
	<ReferenceEditionPicker
		open={pickerOpen}
		onClose={() => (pickerOpen = false)}
		onInsert={insertSeed}
		loadSource={async () => FIXTURE_SOURCE}
	/>
	<pre data-testid="exported-xml">{exportedXml}</pre>
	<pre data-testid="structure-counts">{structureCounts}</pre>
	<pre data-testid="editions-used">{JSON.stringify(
			getReferenceEditionsUsed(canonicalDocument)
		)}</pre>
	<pre data-testid="metadata-snapshot">{JSON.stringify(canonicalDocument.metadata || {})}</pre>
</div>
