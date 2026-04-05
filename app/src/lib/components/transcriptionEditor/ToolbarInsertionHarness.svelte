<script lang="ts">
	import { onMount } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import { NodeSelection, TextSelection } from '@tiptap/pm/state';
	import { fromProseMirror, parseTei, serializeTei, toProseMirror } from '@apatopwa/tei-transcription';

	import { getEditor } from '$lib/client/transcriptionEditorSchema';
	import {
		buildEditorNoteAttrs,
		buildCorrectionNodeAttrs,
		buildGapAttrs,
		buildHandShiftAttrs,
		buildSpaceAttrs,
		buildTeiMilestoneAttrs,
		insertMetamarkForSelection,
		insertSelectableCarrierNode,
		syncPageFormWorkToContainingPage,
		updateNodeAttrs,
	} from './editorCommands';
	import {
		DEFAULT_INSPECTOR_CARRIER_TYPES,
		getSelectedInspectorNode,
	} from './editorInteractions';
	import { createDefaultMarginaliaAttrs } from './marginalia';
	import EditorToolbar from './EditorToolbar.svelte';
	import TeiNodeInspector from './TeiNodeInspector.svelte';

	const INITIAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader></teiHeader>
  <text><body><pb n="1r"/><cb n="1"/><lb/><w>ab</w></body></text>
</TEI>`;

	let editorElement = $state<HTMLElement | null>(null);
	let bubbleMenuElement = $state<HTMLElement | null>(null);
	let editor = $state<Editor | null>(null);
	let selectedNode = $state<ReturnType<typeof getSelectedInspectorNode>>(null);
	let exportedXml = $state('');
	let hasPage = $state(true);
	let pageName = $state('');

	function refreshExport() {
		if (!editor) {
			exportedXml = '';
			return;
		}
		exportedXml = serializeTei(fromProseMirror(editor.getJSON() as any));
	}

	function updateSelectedNode() {
		selectedNode = getSelectedInspectorNode(editor, DEFAULT_INSPECTOR_CARRIER_TYPES);
	}

	function updateCarrierNodeAttrs(pos: number, attrs: Record<string, any>) {
		if (!updateNodeAttrs(editor, pos, attrs, syncPageFormWorkToContainingPage)) return;

		updateSelectedNode();
		refreshExport();
	}

	function insertGap(reason: string, unit: string, extent: string) {
		if (!insertSelectableCarrierNode(editor, 'gap', buildGapAttrs(reason, unit, extent))) return;
		updateSelectedNode();
		refreshExport();
	}

	function insertSpace(unit: string, extent: string) {
		if (!insertSelectableCarrierNode(editor, 'space', buildSpaceAttrs(unit, extent))) return;
		updateSelectedNode();
		refreshExport();
	}

	function insertHandShift(newHand: string, medium: string) {
		const attrs = buildHandShiftAttrs(newHand, medium);
		if (!attrs || !insertSelectableCarrierNode(editor, 'handShift', attrs)) return;
		updateSelectedNode();
		refreshExport();
	}

	function insertEditorNote(type: string, text: string) {
		const attrs = buildEditorNoteAttrs(type, text);
		if (!attrs || !insertSelectableCarrierNode(editor, 'teiAtom', attrs)) return;
		updateSelectedNode();
		refreshExport();
	}

	function insertMarginalia() {
		if (!insertSelectableCarrierNode(editor, 'fw', createDefaultMarginaliaAttrs('Marginal', []))) return;
		updateSelectedNode();
		refreshExport();
	}

	function insertStandaloneMetamark(functionValue: string) {
		if (!insertMetamarkForSelection(editor, functionValue)) return;
		updateSelectedNode();
		refreshExport();
	}

	function selectSampleText() {
		if (!editor) return;
		const activeEditor = editor;
		let selection: TextSelection | null = null;
		activeEditor.state.doc.descendants((node, pos) => {
			if (node.isText && (node.text || '').length > 0) {
				selection = TextSelection.create(
					activeEditor.state.doc,
					pos,
					pos + (node.text || '').length
				);
				return false;
			}
			return undefined;
		});
		if (!selection) return;
		activeEditor.view.dispatch(activeEditor.state.tr.setSelection(selection));
		updateSelectedNode();
	}

	function selectCarrier(type: string) {
		if (!editor) return;
		const activeEditor = editor;
		let matchPos: number | null = null;
		activeEditor.state.doc.descendants((node, pos) => {
			if (node.type.name === type && matchPos === null) {
				matchPos = pos;
				return false;
			}
			return undefined;
		});
		if (matchPos === null) return;
		activeEditor.view.dispatch(
			activeEditor.state.tr.setSelection(
				NodeSelection.create(activeEditor.state.doc, matchPos)
			)
		);
		updateSelectedNode();
	}

	function insertCorrectionNode() {
		if (!insertSelectableCarrierNode(editor, 'correctionNode', buildCorrectionNodeAttrs())) return;
		updateSelectedNode();
		refreshExport();
	}

	function insertGenericTeiMilestone(unit: string, value: string, ed: string) {
		const attrs = buildTeiMilestoneAttrs(unit, value, ed);
		if (!attrs || !attrs.teiAttrs?.unit) return;
		if (!insertSelectableCarrierNode(editor, 'teiMilestone', attrs)) return;
		updateSelectedNode();
		refreshExport();
	}

	onMount(() => {
		if (!editorElement || !bubbleMenuElement) return;
		const nextEditor = getEditor(editorElement, bubbleMenuElement);
		nextEditor.commands.setContent(toProseMirror(parseTei(INITIAL_XML)) as any, {
			emitUpdate: false,
		});
		nextEditor.commands.focus('end');
		nextEditor.commands.insertContent({
			type: 'editorialAction',
			attrs: {
				tag: 'undo',
				summary: 'undo: #mod1',
				structure: { kind: 'undo', targets: ['#mod1'] },
			},
		});
		editor = nextEditor;
		refreshExport();
		updateSelectedNode();

		nextEditor.on('selectionUpdate', updateSelectedNode);
		nextEditor.on('update', () => {
			refreshExport();
			updateSelectedNode();
		});

		return () => {
			nextEditor.destroy();
		};
	});
</script>

<div class="space-y-4">
	{#if editor}
		<EditorToolbar
			editor={editor}
			{pageName}
			{hasPage}
			exportLoading={false}
			cursorPosition={{}}
			onPageNameChange={value => (pageName = value)}
			onInsertPage={() => {}}
			onInsertColumn={() => {}}
			onToggleWordWrapped={() => {}}
			onInsertUntranscribed={() => {}}
			onInsertGap={insertGap}
			onInsertSpace={insertSpace}
			onInsertHandShift={insertHandShift}
			onInsertEditorNote={insertEditorNote}
			onInsertMarginalia={insertMarginalia}
			onInsertMetamark={insertStandaloneMetamark}
			onInsertCorrectionNode={insertCorrectionNode}
			onInsertGenericTeiMilestone={(unit, value, ed) => insertGenericTeiMilestone(unit, value, ed)}
			onInsertMilestoneNode={() => {}}
			onTEIExport={refreshExport}
		/>
	{/if}

	<div bind:this={bubbleMenuElement} class="hidden"></div>
	<div bind:this={editorElement}></div>
	<div class="flex gap-2">
		<button type="button" class="btn btn-xs btn-outline" data-testid="select-sample-text" onclick={selectSampleText}>
			Select sample text
		</button>
		<button
			type="button"
			class="btn btn-xs btn-outline"
			data-testid="select-editorial-action"
			onclick={() => selectCarrier('editorialAction')}
		>
			Select editorial action
		</button>
	</div>
	<div data-testid="selected-carrier">{selectedNode?.type || 'none'}</div>
	<TeiNodeInspector selectedNode={selectedNode} onUpdateNodeAttrs={updateCarrierNodeAttrs} />
	<pre
		data-testid="exported-xml"
		class="whitespace-pre-wrap break-all rounded border border-base-300 bg-base-100 p-3 text-xs"
	>{exportedXml}</pre>
</div>
