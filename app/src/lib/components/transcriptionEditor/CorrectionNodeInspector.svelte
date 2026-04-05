<script lang="ts">
	import CorrectionWorkspace from './CorrectionWorkspace.svelte';

	interface Props {
		attrs: Record<string, any>;
		onApply: (attrs: Record<string, any>) => void;
	}

	let { attrs, onApply }: Props = $props();
</script>

<CorrectionWorkspace
	idPrefix="correction-node"
	title="Correction Readings"
	description="Manage correction readings for this element."
	initialCorrections={Array.isArray(attrs?.corrections) ? attrs.corrections : []}
	applyLabel="Apply to Node"
	onApply={corrections =>
		onApply({
			...attrs,
			corrections,
		})}
/>
