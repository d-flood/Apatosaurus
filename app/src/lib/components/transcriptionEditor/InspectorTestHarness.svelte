<script lang="ts">
	import { onMount } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import { NodeSelection } from '@tiptap/pm/state';
	import { fromProseMirror, parseTei, serializeTei, toProseMirror } from '@apatopwa/tei-transcription';

	import { getEditor } from '$lib/client/transcriptionEditorSchema';
	import {
		syncPageFormWorkToContainingPage,
		updateNodeAttrs,
	} from './editorCommands';
	import {
		DEFAULT_INSPECTOR_CARRIER_TYPES,
		getSelectedInspectorNode,
	} from './editorInteractions';
	import TeiNodeInspector from './TeiNodeInspector.svelte';

	interface Props {
		xml: string;
		seedNodes?: Array<{ type: string; attrs?: Record<string, any> }>;
	}

	let { xml, seedNodes = [] }: Props = $props();

	let editorElement = $state<HTMLElement | null>(null);
	let bubbleMenuElement = $state<HTMLElement | null>(null);
	let editor = $state<Editor | null>(null);
	let selectedNode = $state<ReturnType<typeof getSelectedInspectorNode>>(null);
	let exportedXml = $state('');
	let availableCarrierTypes = $state<string[]>([]);

	function refreshExport() {
		if (!editor) {
			exportedXml = '';
			return;
		}
		exportedXml = serializeTei(fromProseMirror(editor.getJSON() as any));
	}

	function refreshAvailableCarrierTypes() {
		if (!editor) {
			availableCarrierTypes = [];
			return;
		}

		const discovered = new Set<string>();
		editor.state.doc.descendants(node => {
			if (DEFAULT_INSPECTOR_CARRIER_TYPES.includes(node.type.name as (typeof DEFAULT_INSPECTOR_CARRIER_TYPES)[number])) {
				discovered.add(node.type.name);
			}
		});
		availableCarrierTypes = Array.from(discovered);
	}

	function updateSelectedNode() {
		selectedNode = getSelectedInspectorNode(editor, DEFAULT_INSPECTOR_CARRIER_TYPES);
	}

	function findNodePosition(type: string): number | null {
		if (!editor) return null;
		let matchPos: number | null = null;
		editor.state.doc.descendants((node, pos) => {
			if (node.type.name === type && matchPos === null) {
				matchPos = pos;
				return false;
			}
		});
		return matchPos;
	}

	function selectCarrier(type: string) {
		if (!editor) return;
		const pos = findNodePosition(type);
		if (pos === null) return;
		const selection = NodeSelection.create(editor.state.doc, pos);
		editor.view.dispatch(editor.state.tr.setSelection(selection));
		updateSelectedNode();
	}

	function updateCarrierNodeAttrs(pos: number, attrs: Record<string, any>) {
		if (!updateNodeAttrs(editor, pos, attrs, syncPageFormWorkToContainingPage)) return;

		updateSelectedNode();
		refreshExport();
		refreshAvailableCarrierTypes();
	}

	onMount(() => {
		if (!editorElement || !bubbleMenuElement) return;
		const nextEditor = getEditor(editorElement, bubbleMenuElement);
		const pm = toProseMirror(parseTei(xml)) as any;
		nextEditor.commands.setContent(pm, { emitUpdate: false });
		if (seedNodes.length > 0) {
			nextEditor.commands.focus('end');
			for (const node of seedNodes) {
				nextEditor.commands.insertContent({
					type: node.type,
					attrs: node.attrs || {},
				});
			}
		}
		editor = nextEditor;
		refreshAvailableCarrierTypes();
		refreshExport();
		updateSelectedNode();

		nextEditor.on('selectionUpdate', updateSelectedNode);
		nextEditor.on('update', () => {
			refreshExport();
			refreshAvailableCarrierTypes();
			updateSelectedNode();
		});

		return () => {
			nextEditor.destroy();
		};
	});
</script>

<div class="space-y-4">
	<div bind:this={bubbleMenuElement} class="hidden"></div>
	<div bind:this={editorElement}></div>

	<div class="flex flex-wrap gap-2">
		{#each availableCarrierTypes as carrierType}
			<button
				type="button"
				class="btn btn-xs btn-outline"
				data-testid={`select-${carrierType}`}
				onclick={() => selectCarrier(carrierType)}
			>
				Select {carrierType}
			</button>
		{/each}
	</div>

	<div data-testid="selected-carrier">{selectedNode?.type || 'none'}</div>

	<TeiNodeInspector selectedNode={selectedNode} onUpdateNodeAttrs={updateCarrierNodeAttrs} />

	<pre
		data-testid="exported-xml"
		class="whitespace-pre-wrap break-all rounded border border-base-300 bg-base-100 p-3 text-xs"
	>{exportedXml}</pre>
</div>
