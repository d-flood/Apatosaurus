<script lang="ts">
	import { indexRebuildProgress } from '$lib/db/index-rebuild-progress.svelte';

	const active = $derived(
		indexRebuildProgress.total > 0 && indexRebuildProgress.done < indexRebuildProgress.total
	);
	const converting = $derived(indexRebuildProgress.phase === 'conversion');
</script>

{#if active}
	<div class="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-center">
		<div
			class="pointer-events-auto w-full max-w-sm rounded-box border border-base-300/60 bg-base-100 p-4 shadow-lg"
			role="status"
			aria-live="polite"
		>
			<div class="flex items-center gap-3">
				<span class="loading loading-ring loading-md text-primary" aria-hidden="true"
				></span>
				<div class="min-w-0 flex-1">
					<p class="font-serif font-semibold">
						{converting ? 'Converting project to TEI' : 'Rebuilding local index'}
					</p>
					<p class="text-xs text-base-content/60">
						{indexRebuildProgress.done} of {indexRebuildProgress.total}
						{converting ? 'files' : 'steps'} · your files are safe
					</p>
				</div>
			</div>
			<progress
				class="progress progress-primary mt-3 w-full"
				value={indexRebuildProgress.done}
				max={indexRebuildProgress.total}
				aria-label={converting ? 'TEI conversion progress' : 'Index rebuild progress'}
			></progress>
		</div>
	</div>
{/if}
