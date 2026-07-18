<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { ProjectRecord } from '$lib/client/collation/project-collation';
	import type { Snippet } from 'svelte';

	let { data, children } = $props<{
		data: { project: ProjectRecord };
		children: Snippet;
	}>();

	let project = $derived(data.project);
	let projectActionQuery = $derived(`?projectId=${encodeURIComponent(project.id)}`);

	function isActive(section: string): boolean {
		return page.url.pathname.endsWith(`/${section}`);
	}
</script>

<div class="container mx-auto max-w-6xl p-4">
	<div class="space-y-6">
		<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<div class="text-xs font-semibold uppercase tracking-wide text-base-content/40">
						Open Project
					</div>
					<h1 class="font-serif text-xl font-semibold">{project.name}</h1>
					{#if project.description}
						<p class="mt-1 text-sm text-base-content/55">{project.description}</p>
					{/if}
				</div>
				<div class="flex flex-wrap gap-2">
					<a
						href={resolve(`/transcription/new${projectActionQuery}`)}
						class="btn btn-primary btn-sm"
					>
						New Transcription
					</a>
					<a
						href={resolve(`/transcription/igntp${projectActionQuery}`)}
						class="btn btn-outline btn-sm"
					>
						Import IGNTP
					</a>
					<a
						href={resolve(`/collation/new${projectActionQuery}`)}
						class="btn btn-outline btn-sm"
					>
						New Collation
					</a>
				</div>
			</div>

			<div class="tabs tabs-box mt-4 bg-base-200">
				<a
					href={resolve('/projects/[id]/transcriptions', { id: project.id })}
					class={['tab', isActive('transcriptions') && 'tab-active']}
				>
					Transcriptions
				</a>
				<a
					href={resolve('/projects/[id]/collations', { id: project.id })}
					class={['tab', isActive('collations') && 'tab-active']}
				>
					Collations
				</a>
				<a
					href={resolve('/projects/[id]/settings', { id: project.id })}
					class={['tab', isActive('settings') && 'tab-active']}
				>
					Settings
				</a>
				<a
					href={resolve('/projects/[id]/backup', { id: project.id })}
					class={['tab', isActive('backup') && 'tab-active']}
				>
					Backup and Sync
				</a>
			</div>
		</div>

		{@render children()}
	</div>
</div>
