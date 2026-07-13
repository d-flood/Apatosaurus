<script lang="ts">
	import type { IndexRebuildReport } from '$lib/client/db/repositories/index-rebuild';

	let {
		report,
		restoringPath = null,
		onRestore,
	}: {
		report: IndexRebuildReport;
		restoringPath?: string | null;
		onRestore: (path: string) => void | Promise<void>;
	} = $props();
</script>

<div class="rounded-box bg-base-200/70 p-3 text-xs text-base-content/70">
	<div class="font-medium text-base-content">Repair complete</div>
	<div class="mt-1">
		Restored {report.projectsRestored} projects, {report.transcriptionsRestored} transcriptions,
		and {report.collationsRestored} collations.
	</div>

	{#if report.quarantinedFiles.length > 0}
		<div class="mt-3 font-medium text-base-content">Quarantined files</div>
		<div class="mt-1 space-y-2">
			{#each report.quarantinedFiles as file (file.path)}
				<div class="rounded border border-error/25 bg-error/5 p-2">
					<div class="break-all font-mono text-[0.7rem] text-base-content">{file.path}</div>
					<div class="mt-1 font-semibold text-error">{file.code}</div>
					<div>{file.message}</div>
					<div class="mt-1 text-base-content/50">The file was left unchanged for manual recovery.</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if report.orphanedFiles.length > 0}
		<div class="mt-3 font-medium text-base-content">Orphaned files</div>
		<div class="mt-1 space-y-2">
			{#each report.orphanedFiles as file (file.path)}
				<div class="rounded border border-warning/30 bg-warning/5 p-2">
					<div class="break-all font-mono text-[0.7rem] text-base-content">{file.path}</div>
					<div class="mt-1 font-semibold text-warning">{file.code}</div>
					<div>{file.message}</div>
					{#if file.recoverable && file.entityId}
						<button
							type="button"
							class="btn btn-warning btn-xs mt-2"
							disabled={restoringPath !== null}
							onclick={() => onRestore(file.path)}
						>
							{restoringPath === file.path ? 'Restoring...' : `Restore ${file.entityId}`}
						</button>
					{:else}
						<div class="mt-1 text-base-content/50">No automatic recovery is safe for this file.</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	{#if report.quarantinedFiles.length === 0 && report.orphanedFiles.length === 0}
		<div class="mt-1">No quarantined or orphaned files were found.</div>
	{/if}
</div>
