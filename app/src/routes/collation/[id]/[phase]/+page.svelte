<script lang="ts">
	import { COLLATION_PHASES } from '$lib/collation/collation-types';
	import { page } from '$app/state';
	import { variationUnitId } from '$lib/collation/collation-unit-id';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { collationState, type CollationPhase } from '$lib/collation/collation-state.svelte';
	import CollationWorkspace from '$lib/collation/components/CollationWorkspace.svelte';

	let { params } = $props();

	function parsePhase(value: string): CollationPhase | null {
		return COLLATION_PHASES.includes(value as CollationPhase)
			? (value as CollationPhase)
			: null;
	}

	function syncPhaseFromRoute(id: string, phaseParam: string) {
		if (phaseParam === 'regularization') {
			void goto(`/collation/${id}/alignment`, { replaceState: true });
			return;
		}
		const requestedPhase = parsePhase(phaseParam);
		if (!requestedPhase) {
			void goto(`/collation/${id}/${collationState.phase}`, { replaceState: true });
			return;
		}
		if (requestedPhase !== 'setup' && !collationState.canNavigateTo(requestedPhase)) {
			void goto(`/collation/${id}/${collationState.furthestPhase}`, { replaceState: true });
			return;
		}
		collationState.showPhase(requestedPhase);
	}

	$effect(() => {
		const id = params.id;
		const phaseParam = params.phase;
		const unitId = page.url.searchParams.get('unit');
		if (collationState.isLoading || !collationState.collationId) return;
		untrack(() => {
			syncPhaseFromRoute(id, phaseParam);
			const span = collationState
				.getVariationUnitSpans()
				.find(span => variationUnitId(span.columnIds[0]) === unitId);
			if (span) collationState.selectedUnitIndex = span.startIndex;
		});
	});
</script>

<CollationWorkspace />
