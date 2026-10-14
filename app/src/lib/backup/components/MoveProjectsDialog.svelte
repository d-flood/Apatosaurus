<script lang="ts">
	import { syncService } from '$lib/backup/sync-service.svelte';
	import { recordLastUsedLocation } from '$lib/shell/last-used-location';
	import type { ProjectLocation } from '$lib/storage/project-locations';

	interface Props {
		projects: { id: string; name: string }[];
		locations: ProjectLocation[];
		destinationId: string;
		onclose: () => void;
	}

	let { projects, locations, destinationId = $bindable(), onclose }: Props = $props();

	let dialog = $state<HTMLDialogElement>();
	let unchecked = $state.raw(new Set<string>());
	let failures = $state.raw<{ name: string; message: string }[]>([]);
	let isMoving = $state(false);

	const destination = $derived(locations.find(location => location.id === destinationId));
	const checked = $derived(projects.filter(project => !unchecked.has(project.id)));

	function toggle(projectId: string, include: boolean) {
		const next = new Set(unchecked);
		if (include) next.delete(projectId);
		else next.add(projectId);
		unchecked = next;
	}

	async function move(event: SubmitEvent) {
		event.preventDefault();
		if (!destination || isMoving) return;
		isMoving = true;
		const nextFailures: { name: string; message: string }[] = [];
		let moved = 0;
		for (const project of checked) {
			try {
				await syncService.moveProject(project.id, destination.id);
				moved += 1;
			} catch (cause) {
				nextFailures.push({
					name: project.name,
					message: cause instanceof Error ? cause.message : 'The move did not complete.',
				});
			}
		}
		if (moved > 0) recordLastUsedLocation(destination.id);
		failures = nextFailures;
		isMoving = false;
		if (nextFailures.length === 0) dialog?.close();
	}
</script>

<dialog
	bind:this={dialog}
	{@attach node => node.showModal()}
	class="modal modal-bottom sm:modal-middle"
	aria-label="Back up projects"
	{onclose}
	oncancel={event => isMoving && event.preventDefault()}
>
	<form class="modal-box w-full space-y-3 sm:max-w-md" onsubmit={move}>
		<h2 class="font-serif text-lg font-bold">Back up projects</h2>
		<p class="text-sm text-base-content/70">
			These projects are saved only in this browser. Move them to back them up as you work.
		</p>
		<ul class="max-h-64 space-y-2 overflow-y-auto">
			{#each projects as project (project.id)}
				<li>
					<label class="flex cursor-pointer items-center gap-3 text-sm">
						<input
							type="checkbox"
							class="checkbox checkbox-sm"
							checked={!unchecked.has(project.id)}
							disabled={isMoving}
							onchange={event => toggle(project.id, event.currentTarget.checked)}
						/>
						{project.name}
					</label>
				</li>
			{/each}
		</ul>
		{#if locations.length > 1}
			<label class="block text-sm font-medium" for="move-projects-destination">Move to</label>
			<select
				id="move-projects-destination"
				class="select select-bordered select-sm w-full"
				bind:value={destinationId}
				disabled={isMoving}
			>
				{#each locations as location (location.id)}
					<option value={location.id}>{location.displayPath}</option>
				{/each}
			</select>
		{:else if destination}
			<p class="text-sm">
				Moves to <span class="font-medium">{destination.displayPath}</span>
			</p>
		{/if}
		{#if failures.length > 0}
			<ul class="space-y-1 text-sm text-error" role="alert">
				{#each failures as failure, index (index)}
					<li><span class="font-medium">{failure.name}</span>: {failure.message}</li>
				{/each}
			</ul>
		{/if}
		<div class="modal-action mt-2">
			<button
				type="button"
				class="btn btn-sm btn-ghost"
				disabled={isMoving}
				onclick={() => dialog?.close()}
			>
				Not now
			</button>
			<button
				type="submit"
				class="btn btn-sm btn-primary"
				disabled={isMoving || checked.length === 0 || !destination}
			>
				{#if isMoving}<span class="loading loading-spinner loading-xs"></span>{/if}
				Move
			</button>
		</div>
	</form>
</dialog>
