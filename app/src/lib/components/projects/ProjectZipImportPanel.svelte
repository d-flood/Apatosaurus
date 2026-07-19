<script lang="ts">
	import { importProjectZip } from '$lib/client/db/client';
	import type {
		ProjectZipImportCollisionMode,
		ProjectZipImportResult,
	} from '$lib/client/sync/project-zip-import';

	let { onImported }: { onImported?: (projectId: string) => void | Promise<void> } = $props();

	let bytes = $state<Uint8Array | null>(null);
	let fileName = $state('');
	let result = $state<ProjectZipImportResult | null>(null);
	let error = $state<string | null>(null);
	let importing = $state(false);

	async function selectFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		bytes = new Uint8Array(await file.arrayBuffer());
		fileName = file.name;
		result = null;
		error = null;
		await runImport();
	}

	async function runImport(collisionMode?: ProjectZipImportCollisionMode) {
		if (!bytes || importing) return;
		importing = true;
		error = null;
		try {
			result = await importProjectZip(bytes, collisionMode);
			if (result.ok) await onImported?.(result.projectId);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Project import failed.';
		} finally {
			importing = false;
		}
	}

	function formatDate(value: string): string {
		return new Date(value).toLocaleString();
	}
</script>

<div class="rounded-box border border-base-300/60 bg-base-200/40 p-3">
	<h3 class="font-serif text-sm font-semibold">Import Project Backup</h3>
	<p class="mt-1 text-xs leading-relaxed text-base-content/55">
		Choose one project .zip backup. Files are validated before any local project is changed.
	</p>
	<label class="btn btn-outline btn-sm mt-3 w-full" class:btn-disabled={importing}>
		{importing ? 'Validating...' : 'Choose project .zip'}
		<input
			type="file"
			accept=".zip,application/zip"
			class="sr-only"
			disabled={importing}
			onchange={selectFile}
		/>
	</label>
	{#if fileName}
		<div class="mt-2 truncate text-xs text-base-content/55">{fileName}</div>
	{/if}
	{#if error}
		<div class="alert alert-error mt-3 py-2 text-xs">{error}</div>
	{/if}
	{#if result?.collision}
		<div class="alert alert-warning mt-3 block text-xs">
			<div class="font-semibold">This project already exists on this device.</div>
			<div class="mt-1">Local updated: {formatDate(result.collision.localUpdatedAt)}</div>
			<div>Imported updated: {formatDate(result.collision.importedUpdatedAt)}</div>
			<div class="mt-3 grid gap-2 sm:grid-cols-2">
				<button
					class="btn btn-error btn-sm"
					type="button"
					disabled={importing}
					onclick={() => runImport('replace')}
				>
					Replace local project
				</button>
				<button
					class="btn btn-outline btn-sm"
					type="button"
					disabled={importing}
					onclick={() => runImport('copy')}
				>
					Import as copy
				</button>
			</div>
		</div>
	{:else if result?.ok}
		<div class="alert alert-success mt-3 py-2 text-xs">
			Imported {result.mode === 'copied' ? 'a project copy' : 'the project'} successfully.
		</div>
	{:else if result && result.quarantinedFiles.length > 0}
		<div class="mt-3 space-y-2" aria-label="Import validation report">
			<div class="text-xs font-semibold text-error">The backup was not imported.</div>
			{#each result.quarantinedFiles as issue}
				<div class="rounded border border-error/30 bg-error/5 p-2 text-xs">
					<div class="font-mono font-semibold">{issue.path || 'archive'}</div>
					<div class="text-base-content/60">{issue.code}: {issue.message}</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
