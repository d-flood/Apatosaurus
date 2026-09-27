<script lang="ts">
	import FilePicker from '$lib/components/FilePicker.svelte';
	import { onMount } from 'svelte';
	import {
		createTranscriptionRecords,
		formatTranscriptionFieldList,
		listMissingRequiredTranscriptionFields,
		type CreateTranscriptionInput,
	} from '$lib/client/transcription/create-transcription';
	import { checkpointLocalDb, ensureLocalDbRuntime } from '$lib/client/db/runtime';
	import {
		ensureDefaultProject,
		listProjects,
		listTranscriptionSummaries,
	} from '$lib/client/db/client';
	import type { ProjectOption } from '$lib/client/db/repositories/projects';
	import { resolveCreationTargetProjectId } from '$lib/client/navigation/last-opened-project';
	import { buildTranscriptionDuplicateKey } from '$lib/igntp/duplicate-key';
	import {
		filePath,
		prepareLocalTeiImport,
		selectTeiFiles,
		type LocalTeiImportDefaults,
	} from '$lib/client/transcription/local-tei-import';

	interface ImportResult {
		fileName: string;
		status: 'created' | 'duplicate' | 'failed';
		message: string;
	}

	let { data }: { data: { projectId?: string } } = $props();

	let projects = $state<ProjectOption[]>([]);
	let selectedProjectId = $state('');
	let files = $state<File[]>([]);
	let defaults = $state<LocalTeiImportDefaults>({
		transcriber: '',
		repository: '',
		settlement: '',
		language: '',
	});
	let busy = $state(false);
	let progress = $state('');
	let results = $state<ImportResult[]>([]);

	const summary = $derived({
		created: results.filter(r => r.status === 'created').length,
		duplicates: results.filter(r => r.status === 'duplicate').length,
		failed: results.filter(r => r.status === 'failed').length,
	});

	onMount(async () => {
		await ensureLocalDbRuntime();
		const defaultProjectId = await ensureDefaultProject();
		projects = await listProjects();
		selectedProjectId = resolveCreationTargetProjectId(data.projectId, projects, defaultProjectId);
	});

	function handleFolderChange(event: Event) {
		files = selectTeiFiles((event.currentTarget as HTMLInputElement).files ?? []);
		results = [];
	}

	async function handleImport() {
		busy = true;
		results = [];
		const pending: { input: CreateTranscriptionInput; fileName: string }[] = [];
		const output: ImportResult[] = [];

		try {
			await ensureLocalDbRuntime();
			const seenKeys = new Set(
				(await listTranscriptionSummaries())
					.map(t => buildTranscriptionDuplicateKey({ siglum: t.siglum, title: t.title }))
					.filter(key => !!key)
			);

			for (const [index, file] of files.entries()) {
				const fileName = filePath(file);
				progress = `Reading ${index + 1} of ${files.length}: ${fileName}`;
				try {
					const prepared = prepareLocalTeiImport(file.name, await file.text(), defaults);
					if (prepared.duplicateKey && seenKeys.has(prepared.duplicateKey)) {
						output.push({ fileName, status: 'duplicate', message: 'Already imported.' });
						continue;
					}
					const missing = listMissingRequiredTranscriptionFields(prepared.metadata);
					if (missing.length > 0) {
						output.push({
							fileName,
							status: 'failed',
							message: `Missing required metadata: ${formatTranscriptionFieldList(missing)}`,
						});
						continue;
					}
					if (prepared.duplicateKey) seenKeys.add(prepared.duplicateKey);
					pending.push({
						fileName,
						input: {
							projectId: selectedProjectId,
							...prepared.metadata,
							document: prepared.document,
						},
					});
				} catch (error) {
					output.push({
						fileName,
						status: 'failed',
						message: error instanceof Error ? error.message : 'Import failed.',
					});
				}
			}

			let saved = 0;
			try {
				await createTranscriptionRecords(
					pending.map(p => p.input),
					completed => {
						saved = completed;
						progress = `Saving ${completed} of ${pending.length}`;
					}
				);
				saved = pending.length;
			} catch (error) {
				console.error('Local TEI bulk create failed:', error);
			}
			for (const [index, { fileName, input }] of pending.entries()) {
				output.push(
					index < saved
						? { fileName, status: 'created', message: `Imported ${input.title}.` }
						: { fileName, status: 'failed', message: 'Bulk save failed.' }
				);
			}

			try {
				await checkpointLocalDb();
			} catch {
				// Checkpoint failure is safe to ignore.
			}
		} finally {
			results = output;
			progress = '';
			busy = false;
		}
	}
</script>

<div class="container mx-auto max-w-3xl space-y-6 p-4">
	<h1 class="text-2xl font-bold">Import TEI Folder</h1>

	<label class="select w-full">
		<span class="font-bold label">Import into project</span>
		<select bind:value={selectedProjectId} disabled={busy}>
			{#each projects as project (project.id)}
				<option value={project.id}>{project.name}</option>
			{/each}
		</select>
	</label>

	<FilePicker
		label="Folder"
		directory
		disabled={busy}
		onchange={handleFolderChange}
		testid="tei-folder-input"
	/>

	<fieldset class="fieldset rounded-box border border-base-300 bg-base-200 p-4">
		<legend class="fieldset-legend text-lg">Defaults for missing metadata</legend>
		<p class="text-sm text-base-content/70">
			Values from each file's TEI header take precedence. These fill only what a header lacks. Title and siglum fall back to the file name.
		</p>
		<div class="grid gap-2 sm:grid-cols-2">
			<label class="input w-full">
				<span class="font-bold label">Transcriber</span>
				<input type="text" class="grow" bind:value={defaults.transcriber} disabled={busy} />
			</label>
			<label class="input w-full">
				<span class="font-bold label">Repository</span>
				<input type="text" class="grow" bind:value={defaults.repository} disabled={busy} />
			</label>
			<label class="input w-full">
				<span class="font-bold label">Settlement</span>
				<input type="text" class="grow" bind:value={defaults.settlement} disabled={busy} />
			</label>
			<label class="input w-full">
				<span class="font-bold label">Language</span>
				<input type="text" class="grow" bind:value={defaults.language} disabled={busy} />
			</label>
		</div>
	</fieldset>

	<button
		type="button"
		class="btn btn-success w-full"
		disabled={busy || files.length === 0 || !selectedProjectId}
		onclick={handleImport}
	>
		{#if busy}
			Importing...
		{:else}
			Import {files.length} TEI {files.length === 1 ? 'file' : 'files'}
		{/if}
	</button>

	{#if progress}
		<p class="text-sm text-base-content/75">{progress}</p>
	{/if}

	{#if results.length > 0}
		<div
			class="rounded-box border p-4 {summary.failed > 0 ? 'border-warning/50 bg-warning/10' : 'border-success/40 bg-success/10'}"
			data-testid="tei-folder-import-results"
		>
			<p class="font-semibold">
				Imported {summary.created}, skipped {summary.duplicates}, failed {summary.failed}.
			</p>
			<ul class="mt-3 space-y-2 text-sm">
				{#each results as result (result.fileName)}
					<li class="flex flex-wrap items-center gap-2">
						<span
							class="badge badge-sm {result.status === 'created' ? 'badge-success' : result.status === 'duplicate' ? 'badge-neutral' : 'badge-warning'}"
						>
							{result.status}
						</span>
						<span class="font-semibold break-all">{result.fileName}</span>
						<span class="text-base-content/70">{result.message}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
