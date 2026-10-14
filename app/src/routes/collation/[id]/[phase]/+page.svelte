<script lang="ts">
	import { COLLATION_PHASES } from '$lib/collation/collation-types';
	import { goto } from '$app/navigation';
	import { collationState, type CollationPhase } from '$lib/collation/collation-state.svelte';
	import CollationWorkspace from '$lib/collation/components/CollationWorkspace.svelte';

	let { params } = $props();

	function parsePhase(value: string): CollationPhase | null {
		return COLLATION_PHASES.includes(value as CollationPhase)
			? (value as CollationPhase)
			: null;
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
			void goto(`/collation/${params.id}/${collationState.furthestPhase}`, {
				replaceState: true,
			});
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
