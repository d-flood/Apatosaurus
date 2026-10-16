<script lang="ts">
	import FilePicker from '$lib/shell/components/FilePicker.svelte';
	import type { LocalTeiImportDefaults } from '$lib/transcription/local-tei-import';
	import {
		classicBaseSiglumCandidates,
		parseClassicCollationExport,
		type ClassicCollationExport,
	} from '../classic-import';
	import { importClassicCollationProject } from '../classic-import-project';

	let {
		projectId,
		onclose,
		onimported,
	}: { projectId: string; onclose: () => void; onimported: () => void } = $props();
	let source = $state.raw<ClassicCollationExport | null>(null);
	let choice = $state('');
	let newSiglum = $state('');
	let title = $state('');
	let defaults = $state<LocalTeiImportDefaults>({
		transcriber: '',
		repository: '',
		settlement: '',
		language: '',
	});
	let busy = $state(false);
	let reading = $state(false);
	let error = $state('');
	let readId = 0;
	const candidates = $derived(source ? classicBaseSiglumCandidates(source) : []);
	const baseSiglum = $derived(choice === 'new' ? newSiglum.trim() : choice.slice(2));

	async function readFile(event: Event) {
		const runId = ++readId;
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		source = null;
		error = '';
		if (!file) return;
		reading = true;
		try {
			const parsed = parseClassicCollationExport(await file.text());
			if (runId !== readId) return;
			source = parsed;
			title = file.name.replace(/\.xml$/i, '');
			const candidate = classicBaseSiglumCandidates(parsed)[0];
			choice = candidate ? `w:${candidate}` : 'new';
		} catch (err) {
			if (runId === readId)
				error = err instanceof Error ? err.message : 'Could not read the export.';
		} finally {
			if (runId === readId) reading = false;
		}
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!source) return;
		busy = true;
		error = '';
		try {
			await importClassicCollationProject({
				projectId,
				source,
				baseSiglum,
				title,
				defaults: { ...defaults },
			});
			onimported();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Import failed.';
		} finally {
			busy = false;
		}
	}
</script>

<dialog
	{@attach node => node.showModal()}
	class="modal"
	aria-labelledby="classic-import-title"
	{onclose}
	oncancel={event => busy && event.preventDefault()}
>
	<div class="modal-box w-[calc(100%-2rem)] max-w-xl max-h-[90dvh]" tabindex="-1">
		<h2 id="classic-import-title" class="mb-4 font-serif text-xl font-semibold">
			Import classic collation
		</h2>
		<form class="space-y-4" onsubmit={submit}>
			<FilePicker
				label="Classic export"
				accept=".xml"
				disabled={busy || reading}
				onchange={readFile}
				testid="classic-export-input"
			/>
			{#if reading}<p role="status">Reading export…</p>{/if}
			{#if source}
				<p role="status">
					{source.verses.length} verses · {source.witnesses.length} witnesses
				</p>
				<label class="fieldset w-full">
					<span class="fieldset-legend">Base text siglum</span>
					<select
						aria-label="Base text siglum"
						class="select w-full"
						bind:value={choice}
						disabled={busy}
					>
						{#each candidates as siglum (siglum)}<option value={`w:${siglum}`}
								>{siglum}</option
							>{/each}
						<option value="new">Name a new siglum</option>
					</select>
				</label>
				{#if choice === 'new'}
					<label class="fieldset w-full"
						><span class="fieldset-legend">New base siglum</span><input
							class="input w-full"
							required
							bind:value={newSiglum}
							disabled={busy}
						/></label
					>
				{/if}
				<label class="fieldset w-full"
					><span class="fieldset-legend">Transcription title</span><input
						class="input w-full"
						required
						bind:value={title}
						disabled={busy}
					/></label
				>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each ['transcriber', 'repository', 'settlement', 'language'] as field (field)}
						<label class="fieldset min-w-0"
							><span class="fieldset-legend capitalize">{field}</span><input
								class="input w-full"
								required
								bind:value={defaults[field as keyof LocalTeiImportDefaults]}
								disabled={busy}
							/></label
						>
					{/each}
				</div>
			{/if}
			{#if error}<p class="alert alert-error text-sm" role="alert">{error}</p>{/if}
			<div class="modal-action flex-wrap">
				<button type="button" class="btn" disabled={busy} onclick={onclose}>Cancel</button>
				<button
					type="submit"
					class="btn btn-primary"
					disabled={busy || reading || !source || !baseSiglum}
					>{busy ? 'Importing…' : 'Import collation'}</button
				>
			</div>
		</form>
	</div>
</dialog>
