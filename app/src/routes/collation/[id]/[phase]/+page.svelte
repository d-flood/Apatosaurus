<script lang="ts">
	import { goto } from '$app/navigation';
	import { collationState, type CollationPhase } from '$lib/client/collation/collation-state.svelte';
	import CollationWorkspace from '$lib/components/collation/CollationWorkspace.svelte';

const phaseOrder: CollationPhase[] = ['setup', 'alignment', 'readings', 'stemma'];

	let { params } = $props();

function parsePhase(value: string): CollationPhase | null {
	if (value === 'regularization') return 'alignment';
	return phaseOrder.includes(value as CollationPhase) ? (value as CollationPhase) : null;
}

	$effect(() => {
		if (collationState.isLoading || !collationState.collationId) return;
		if (params.phase === 'regularization') {
			void goto(`/collation/${params.id}/alignment`, { replaceState: true });
			return;
		}

		const requestedPhase = parsePhase(params.phase);
		if (!requestedPhase) {
			void goto(`/collation/${params.id}/${collationState.phase}`, { replaceState: true });
			return;
		}

		if (requestedPhase !== 'setup' && !collationState.canNavigateTo(requestedPhase)) {
			void goto(`/collation/${params.id}/${collationState.furthestPhase}`, { replaceState: true });
			return;
		}

		if (collationState.phase !== requestedPhase) {
			collationState.setPhase(requestedPhase);
		}
	});

	$effect(() => {
		if (collationState.isLoading || !collationState.collationId) return;
		const requestedPhase = parsePhase(params.phase);
		if (!requestedPhase) return;
		if (collationState.phase !== requestedPhase) {
			void goto(`/collation/${params.id}/${collationState.phase}`, { replaceState: true });
		}
	});
</script>

<CollationWorkspace />
