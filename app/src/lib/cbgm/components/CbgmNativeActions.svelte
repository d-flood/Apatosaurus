<script lang="ts">
	import { importNativeResults } from '$lib/cbgm/cbgm-analysis-runs';
	import { exportCbgmNativeInputs, readCbgmAnalysisCache } from '$lib/db/client';
	import FilePicker from '$lib/shell/components/FilePicker.svelte';
	import { downloadBlob, downloadZipArchive } from '$lib/shell/download-blob';
	import type { CbgmAnalysisMetadata } from '$lib/storage/formats';

	let { analysis }: { analysis: CbgmAnalysisMetadata } = $props();

	let database = $state.raw<File | null>(null);
	let globalStemma = $state.raw<File | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);

	const importable = $derived(
		analysis.coherence !== 'ready' || analysis.global_stemma === 'computing'
	);

	function chosenFile(event: Event): File | null {
		return (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
	}

	async function act(action: () => Promise<void>, failure: string) {
		busy = true;
		error = null;
		try {
			await action();
		} catch (err) {
			error = err instanceof Error ? err.message : failure;
		} finally {
			busy = false;
		}
	}

	async function exportInputs() {
		const { fileName, bytes } = await exportCbgmNativeInputs(analysis.id);
		downloadZipArchive(fileName, bytes);
	}

	async function downloadDatabase() {
		const cache = await readCbgmAnalysisCache(analysis.id);
		if (!cache) throw new Error('This analysis has no database yet.');
		downloadBlob(
			`${analysis.name}.sqlite`,
			new Blob([cache.slice().buffer], { type: 'application/vnd.sqlite3' })
		);
	}

	function importResults(event: SubmitEvent) {
		event.preventDefault();
		const file = database;
		if (!file) return;
		void act(async () => {
			await importNativeResults(analysis, {
				cache: new Uint8Array(await file.arrayBuffer()),
				globalStemmaDot: globalStemma ? await globalStemma.text() : null,
			});
		}, 'Importing failed.');
	}
</script>

<div class="space-y-4">
	<p class="text-sm text-base-content/70">
		Export the frozen input XML with the open-cbgm v2.1 commands for this analysis's settings,
		to compute it on a workstation or cluster.
	</p>
	<div class="flex flex-wrap gap-2">
		<button
			type="button"
			class="btn btn-sm w-full sm:w-auto"
			disabled={busy}
			onclick={() => act(exportInputs, 'Exporting failed.')}
		>
			Export inputs
		</button>
		{#if analysis.cache_hash}
			<button
				type="button"
				class="btn btn-sm w-full sm:w-auto"
				disabled={busy}
				onclick={() => act(downloadDatabase, 'Downloading failed.')}
			>
				Download database
			</button>
		{/if}
	</div>

	{#if importable}
		<form class="space-y-3 border-t border-base-300/60 pt-3" onsubmit={importResults}>
			<h3 class="text-sm font-medium">Import native results</h3>
			<FilePicker
				label="Database"
				accept=".db,.sqlite,.sqlite3"
				disabled={busy}
				onchange={event => (database = chosenFile(event))}
			/>
			<FilePicker
				label="Global stemma"
				accept=".dot,.gv"
				disabled={busy}
				placeholder="Optional global-stemma.dot"
				onchange={event => (globalStemma = chosenFile(event))}
			/>
			{#if analysis.coherence === 'computing' || analysis.global_stemma === 'computing'}
				<p class="text-xs text-base-content/60">
					Importing cancels the computation in progress.
				</p>
			{/if}
			<button
				type="submit"
				class="btn btn-primary btn-sm w-full sm:w-auto"
				disabled={busy || !database}
			>
				{#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
				Import
			</button>
		</form>
	{/if}

	{#if error}
		<div class="alert alert-error text-sm" role="alert">{error}</div>
	{/if}
</div>
