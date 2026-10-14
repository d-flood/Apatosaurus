<script lang="ts">
	import type { ProjectLocation } from '$lib/storage/project-locations';

	let { locations, value = $bindable() }: { locations: ProjectLocation[]; value: string } =
		$props();
</script>

{#if locations.length === 0}
	<p class="text-sm text-base-content/60">
		Saves only in this browser · Sign in with Google Drive or Dropbox to back up
	</p>
{:else if locations.length === 1}
	<p class="text-sm text-base-content/60">
		Saves to {locations[0].displayPath.replace('/', ' · ')}
	</p>
{:else}
	<div class="flex items-center gap-2 text-sm text-base-content/60">
		Saves to
		<select class="select select-bordered select-sm" aria-label="Location" bind:value>
			{#each locations as location (location.id)}
				<option value={location.id}>{location.displayPath}</option>
			{/each}
		</select>
	</div>
{/if}
