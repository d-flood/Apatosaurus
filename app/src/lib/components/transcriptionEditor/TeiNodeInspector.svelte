<script lang="ts" module>
	import { classifyFormWork } from './formworkConcepts';
	import {
		tagToConceptLabel,
		noteTypeLabel,
		editorialActionLabel,
	} from './tei-inspector-utils';

	export interface SelectedCarrierNode {
		pos: number;
		type: string;
		attrs: Record<string, any>;
	}

	export function getNodeLabel(node: SelectedCarrierNode): string {
		if (node.type === 'editorialAction') {
			return editorialActionLabel(node.attrs?.structure?.kind);
		}
		if (node.type === 'teiAtom') {
			const tag = node.attrs?.tag || 'tei';
			if (tag === 'note') return noteTypeLabel(node.attrs);
			return tagToConceptLabel(tag);
		}
		if (node.type === 'teiWrapper') {
			return tagToConceptLabel(node.attrs?.tag || 'seg');
		}
		if (node.type === 'metamark') {
			return 'Scribal Mark';
		}
		if (node.type === 'correctionNode') {
			return 'Scribal Corrections';
		}
		if (node.type === 'handShift') {
			return 'Change of Scribe';
		}
		if (node.type === 'teiMilestone') {
			return 'Reference Marker';
		}
		if (node.type === 'gap') {
			return 'Lacuna';
		}
		if (node.type === 'lineBreak') {
			return 'Line Break';
		}
		if (node.type === 'pageBreak') {
			return 'Page Break';
		}
		if (node.type === 'columnBreak') {
			return 'Column Break';
		}
		if (node.type === 'space') {
			return 'Blank Space';
		}
		if (node.type === 'untranscribed') {
			return 'Untranscribed Passage';
		}
		if (node.type === 'fw') {
			const classification = classifyFormWork(node.attrs || {});
			return classification.entryPoint === 'marginalia'
				? 'Marginalia'
				: classification.label;
		}
		return node.type;
	}

	export function isComplexType(node: SelectedCarrierNode | null): boolean {
		if (!node) return false;
		return ['fw', 'correctionNode', 'editorialAction'].includes(node.type);
	}
</script>

<script lang="ts">
	import CorrectionNodeInspector from './CorrectionNodeInspector.svelte';
	import EditorialActionInspector from './EditorialActionInspector.svelte';
	import FormWorkInspector from './FormWorkInspector.svelte';
	import MetamarkInspector from './MetamarkInspector.svelte';
	import SimpleCarrierInspector from './SimpleCarrierInspector.svelte';
	import TeiAtomInspector from './TeiAtomInspector.svelte';
	import TeiWrapperInspector from './TeiWrapperInspector.svelte';

	interface Props {
		selectedNode: SelectedCarrierNode | null;
		onUpdateNodeAttrs: (pos: number, attrs: Record<string, any>) => void;
	}

	let { selectedNode, onUpdateNodeAttrs }: Props = $props();

	function applyAttrs(attrs: Record<string, any>) {
		if (!selectedNode) return;
		onUpdateNodeAttrs(selectedNode.pos, attrs);
	}
</script>

{#if selectedNode}
	{#if selectedNode.type === 'correctionNode'}
		<CorrectionNodeInspector attrs={selectedNode.attrs} onApply={applyAttrs} />
	{:else if selectedNode.type === 'editorialAction'}
		<EditorialActionInspector attrs={selectedNode.attrs} onApply={applyAttrs} />
	{:else if selectedNode.type === 'metamark'}
		<MetamarkInspector attrs={selectedNode.attrs} onApply={applyAttrs} />
	{:else if selectedNode.type === 'teiAtom'}
		<TeiAtomInspector attrs={selectedNode.attrs} onApply={applyAttrs} />
	{:else if selectedNode.type === 'teiWrapper'}
		<TeiWrapperInspector attrs={selectedNode.attrs} onApply={applyAttrs} />
	{:else if selectedNode.type === 'fw'}
		<FormWorkInspector attrs={selectedNode.attrs} onApply={applyAttrs} />
	{:else if ['pageBreak', 'lineBreak', 'columnBreak', 'handShift', 'teiMilestone', 'gap', 'space', 'untranscribed'].includes(selectedNode.type)}
		<SimpleCarrierInspector type={selectedNode.type} attrs={selectedNode.attrs} onApply={applyAttrs} />
	{:else}
		<div class="rounded bg-base-200 p-3 text-xs text-base-content/70">
			No editable fields available for this element yet.
		</div>
	{/if}
{/if}
