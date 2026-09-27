<script lang="ts">
	import Lock from 'phosphor-svelte/lib/Lock';
	import UserPlus from 'phosphor-svelte/lib/UserPlus';
</script>

<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<div class="mb-3 flex items-start justify-between gap-3">
		<div>
			<h2 class="font-serif text-lg font-semibold">Collaboration</h2>
			<p class="text-xs text-base-content/50">
				Shared projects, roles, and team ownership are not available yet.
			</p>
		</div>
		<span class="badge badge-neutral gap-1">
			<Lock size={12} />
			Solo
		</span>
	</div>

	<div class="space-y-2">
		<div class="flex items-center justify-between gap-3 rounded-box border border-base-300/50 bg-base-200/40 px-3 py-2.5">
			<div>
				<div class="text-sm font-medium">Project members</div>
				<div class="text-xs text-base-content/50">
					Invite collaborators and assign roles.
				</div>
			</div>
			<button type="button" class="btn btn-sm gap-2" disabled>
				<UserPlus size={14} />
				Invite
			</button>
		</div>

		{#each [
			{ name: 'You', role: 'Owner', status: 'Active' },
			{ name: 'Additional editors', role: 'Coming soon', status: 'Disabled' },
		] as row}
			<div class="flex items-center justify-between gap-3 rounded-box border border-base-300/50 bg-base-200/40 px-3 py-2.5">
				<div>
					<div class="text-sm font-medium">{row.name}</div>
					<div class="text-xs text-base-content/50">{row.status}</div>
				</div>
				<select class="select select-bordered select-xs w-28" disabled>
					<option selected>{row.role}</option>
				</select>
			</div>
		{/each}
	</div>
</div>
