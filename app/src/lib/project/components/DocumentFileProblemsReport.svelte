<script lang="ts">
	import { resolve } from '$app/paths';
	import type { DocumentFileProblemListing } from '$lib/db/repositories/document-refresh';

	let { problems }: { problems: DocumentFileProblemListing[] } = $props();
</script>

{#if problems.length > 0}
	<section
		class="rounded-box border border-error/30 bg-error/5 p-4"
		role="alert"
		aria-labelledby="document-file-problems-heading"
	>
		<h2 id="document-file-problems-heading" class="font-serif text-lg font-semibold">
			{problems.length === 1
				? 'A file changed outside the app no longer parses'
				: `${problems.length} files changed outside the app no longer parse`}
		</h2>
		<p class="mt-1 max-w-prose text-sm text-base-content/70">
			Each file is left as it is. Saving its document is blocked until the file parses again.
			Fix it in your XML editor; the app checks again when you open this project.
		</p>
		<ul class="mt-3 space-y-2">
			{#each problems as problem (problem.path)}
				<li class="rounded border border-error/25 bg-base-100 p-3 text-xs">
					<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
						{#if problem.transcriptionId && problem.entityType === 'transcription'}
							<a
								class="link font-serif text-sm font-medium"
								href={resolve('/transcription/[id]', {
									id: problem.transcriptionId,
								})}
							>
								{problem.title ?? problem.documentId}
							</a>
						{:else if problem.kind === 'collation' && problem.entityType === 'collation'}
							<a
								class="link font-serif text-sm font-medium"
								href={resolve('/collation/[id]', { id: problem.documentId })}
							>
								{problem.title ?? problem.documentId}
							</a>
						{:else}
							<span class="font-serif text-sm font-medium">
								{problem.title ?? problem.documentId}
								{#if problem.entityType === 'version'}
									<span class="font-sans text-base-content/60">(Version)</span>
								{/if}
							</span>
						{/if}
						<span class="font-semibold text-error">{problem.code}</span>
					</div>
					<div class="mt-1 break-all font-mono text-[0.7rem] text-base-content/70">
						{problem.path}
					</div>
					<div class="mt-1 break-words text-base-content/80">{problem.message}</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}
