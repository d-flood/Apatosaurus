<script lang="ts">
	import { goto } from '$app/navigation';
	import { ensureDjazzkitRuntime } from '$lib/client/djazzkit-runtime';
	import {
		createTranscriptionRecord,
		formatTranscriptionFieldList,
		listMissingRequiredTranscriptionFields,
	} from '$lib/client/transcription/create-transcription';
	import { importTEIDocument } from '$lib/tei/tei-importer';
	import {
		summarizeImportedTeiDocument,
		type ImportedTeiSummary,
	} from '$lib/tei/imported-tei-summary';
	import { extractTranscriptionRecordMetadataPatch } from '$lib/tei/transcription-record-metadata';
	import {
		parseTranscriptionTags,
		serializeTranscriptionTags,
		type TranscriptionRecord,
	} from '$lib/client/transcription/model';
	import {
		EMPTY_TRANSCRIPTION_DOC,
		type StoredTranscriptionDocument,
	} from '$lib/client/transcription/content';
	import { Transcription } from '../../generated/models/Transcription';
	import { onMount } from 'svelte';

	interface Props {
		data: any;
		transcription?: TranscriptionRecord | null;
		onSave?: (transcription: TranscriptionRecord) => void;
	}

	let { data: _data, transcription = null, onSave }: Props = $props();
	let loading = $state(false);
	let error = $state('');
	let importMode = $state<'blank' | 'tei'>('blank');
	let importedFileName = $state('');
	let importedPreview = $state<Record<string, string>>({});
	let importedSummary = $state<ImportedTeiSummary | null>(null);
	let importedDocument = $state<StoredTranscriptionDocument | null>(null);

	let title = $state('');
	let siglum = $state('');
	let description = $state('');
	let tagsInput = $state('');
	let isPublic = $state(false);
	let transcriber = $state('');
	let repository = $state('');
	let settlement = $state('');
	let language = $state('');

	const isEditMode = $derived(!!transcription);

	$effect(() => {
		if (!transcription) return;
		title = transcription.title || '';
		siglum = transcription.siglum || '';
		description = transcription.description || '';
		tagsInput = parseTranscriptionTags(transcription.tags).join(', ');
		isPublic = transcription.is_public || false;
		transcriber = transcription.transcriber || '';
		repository = transcription.repository || '';
		settlement = transcription.settlement || '';
		language = transcription.language || '';
	});

	onMount(async () => {
		await ensureDjazzkitRuntime();
	});

	async function handleTeiFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		error = '';

		if (!file) {
			importedFileName = '';
			importedPreview = {};
			importedSummary = null;
			importedDocument = null;
			return;
		}

		try {
			const xml = await file.text();
			const document = importTEIDocument(xml);
			const patch = extractTranscriptionRecordMetadataPatch(document);

			importedDocument = document;
			importedFileName = file.name;
			importedPreview = Object.fromEntries(
				Object.entries(patch).map(([key, value]) => [key, value ?? ''])
			);
			importedSummary = summarizeImportedTeiDocument(document);

			title = patch.title || title;
			siglum = patch.siglum || siglum;
			transcriber = patch.transcriber || transcriber;
			repository = patch.repository || repository;
			settlement = patch.settlement || settlement;
			language = patch.language || language;
		} catch (err) {
			console.error('Failed to import TEI into creation form:', err);
			importedDocument = null;
			importedFileName = '';
			importedPreview = {};
			importedSummary = null;
			error = err instanceof Error ? `Failed to import TEI: ${err.message}` : 'Failed to import TEI';
		} finally {
			input.value = '';
		}
	}

	async function handleSubmit() {
		loading = true;
		error = '';

		await ensureDjazzkitRuntime();

		if (!isEditMode && importMode === 'tei' && !importedDocument) {
			error = 'Choose a TEI XML file to import';
			loading = false;
			return;
		}
		const missingFields = listMissingRequiredTranscriptionFields({
			title,
			siglum,
			transcriber,
			repository,
			settlement,
			language,
		});
		if (missingFields.length > 0) {
			error =
				`${formatTranscriptionFieldList(missingFields)} are required before creating or exporting a transcription`;
			loading = false;
			return;
		}

		const tags = tagsInput
			.split(',')
			.map(tag => tag.trim())
			.filter(tag => tag.length > 0);

		const effectiveSiglum = siglum.trim();
		const effectiveTranscriber = transcriber.trim();
		const effectiveRepository = repository.trim();
		const effectiveSettlement = settlement.trim();
		const effectiveLanguage = language.trim();

		try {
			if (isEditMode && transcription) {
				const now = new Date().toISOString();
				await Transcription.objects.update(transcription._djazzkit_id, {
					title: title.trim(),
					siglum: siglum.trim(),
					description: description.trim(),
					updated_at: now,
					_djazzkit_updated_at: now,
					is_public: isPublic,
					tags: serializeTranscriptionTags(tags),
					transcriber: transcriber?.trim() || '',
					repository: repository?.trim() || '',
					settlement: settlement?.trim() || '',
					language: language?.trim() || '',
				});

				const updatedTranscription = await Transcription.objects.get(f =>
					f._djazzkit_id.eq(transcription._djazzkit_id),
				);
				if (onSave) {
					onSave(updatedTranscription);
				}
			} else {
				const transcriptionId = await createTranscriptionRecord({
					title,
					siglum: effectiveSiglum,
					description,
					document: importedDocument || EMPTY_TRANSCRIPTION_DOC,
					isPublic,
					tags,
					transcriber: effectiveTranscriber,
					repository: effectiveRepository,
					settlement: effectiveSettlement,
					language: effectiveLanguage,
				});
				await goto(`/transcription/${transcriptionId}`);
			}
		} catch (err) {
			console.error(`Failed to ${isEditMode ? 'update' : 'create'} transcription:`, err);
			error = `Failed to ${isEditMode ? 'update' : 'create'} transcription`;
			loading = false;
		}
	}
</script>

<form
	onsubmit={e => {
		e.preventDefault();
		handleSubmit();
	}}
	class="space-y-8"
>
	<label class="input w-full input-lg">
		<span class="font-bold label">Title*</span>
		<input type="text" class="grow" name="title" bind:value={title} required />
	</label>

	{#if !isEditMode}
		<div class="tabs tabs-box bg-base-200">
			<button
				type="button"
				class:tab-active={importMode === 'blank'}
				class="tab"
				onclick={() => (importMode = 'blank')}
			>
				Start Blank
			</button>
			<button
				type="button"
				class:tab-active={importMode === 'tei'}
				class="tab"
				onclick={() => (importMode = 'tei')}
			>
				Import TEI
			</button>
		</div>
	{/if}

	<label class="input w-full input-lg">
		<span class="font-bold label">Siglum*</span>
		<input type="text" class="grow" name="siglum" bind:value={siglum} required />
	</label>

	{#if !isEditMode && importMode === 'tei'}
		<div class="fieldset bg-base-200 border border-base-300 rounded-box p-4 space-y-4">
			<legend class="fieldset-legend text-lg">Import TEI XML</legend>
			<p class="text-sm text-base-content/70">
				Choose a TEI transcription file. The TEI header will prefill the record metadata below, and the TEI body will become the initial transcription content. Review the fields before creating the transcription.
			</p>
			<label class="file-input w-full">
				<span class="font-bold label">TEI File</span>
				<input type="file" accept=".xml,text/xml,application/xml" onchange={handleTeiFileChange} />
			</label>
			{#if importedFileName}
				<div class="rounded-box bg-base-100 p-3 text-sm space-y-4">
					<div class="font-semibold">Imported {importedFileName}</div>
					<dl class="grid gap-1 md:grid-cols-2">
						<dt class="font-semibold">Title</dt>
						<dd>{title || importedPreview.title || '—'}</dd>
						<dt class="font-semibold">Siglum</dt>
						<dd>{importedPreview.siglum || 'Will fall back to the title if TEI has no idno'}</dd>
						<dt class="font-semibold">Transcriber</dt>
						<dd>{importedPreview.transcriber || '—'}</dd>
						<dt class="font-semibold">Repository</dt>
						<dd>{importedPreview.repository || '—'}</dd>
						<dt class="font-semibold">Settlement</dt>
						<dd>{importedPreview.settlement || '—'}</dd>
						<dt class="font-semibold">Language</dt>
						<dd>{importedPreview.language || '—'}</dd>
					</dl>
					{#if importedSummary}
						<div class="grid gap-4 md:grid-cols-2">
							<div>
								<div class="font-semibold mb-2">Witness Summary</div>
								<dl class="space-y-1">
									<dt class="font-medium inline">MS Name:</dt>
									<dd class="inline ml-1">{importedSummary.msName || '—'}</dd>
									<br />
									<dt class="font-medium inline">Pages:</dt>
									<dd class="inline ml-1">
										{importedSummary.pageCount} pages, {importedSummary.columnCount} columns, {importedSummary.lineCount} lines
									</dd>
									<br />
									<dt class="font-medium inline">Hands:</dt>
									<dd class="inline ml-1">
										{importedSummary.hands.length > 0 ? importedSummary.hands.join(', ') : '—'}
									</dd>
									<br />
									<dt class="font-medium inline">Base hand:</dt>
									<dd class="inline ml-1">{importedSummary.baseHand || '—'}</dd>
									<br />
									<dt class="font-medium inline">Correction hands:</dt>
									<dd class="inline ml-1">
										{importedSummary.correctionHands.length > 0
											? importedSummary.correctionHands.join(', ')
											: '—'}
									</dd>
									<br />
									<dt class="font-medium inline">Hand shifts:</dt>
									<dd class="inline ml-1">
										{importedSummary.handShiftTargets.length > 0
											? importedSummary.handShiftTargets.join(', ')
											: '—'}
									</dd>
								</dl>
							</div>
							<div>
								<div class="font-semibold mb-2">Verse Coverage</div>
								{#if importedSummary.verseIdentifiers.length > 0}
									<div class="text-base-content/70 mb-2">
										{importedSummary.verseIdentifiers.length} verses
										{#if importedSummary.firstVerse && importedSummary.lastVerse}
											, from {importedSummary.firstVerse} to {importedSummary.lastVerse}
										{/if}
									</div>
									<div class="flex flex-wrap gap-1">
										{#each importedSummary.verseIdentifiers.slice(0, 12) as verseId}
											<span class="badge badge-outline badge-sm">{verseId}</span>
										{/each}
										{#if importedSummary.verseIdentifiers.length > 12}
											<span class="badge badge-ghost badge-sm">
												+{importedSummary.verseIdentifiers.length - 12} more
											</span>
										{/if}
									</div>
								{:else}
									<div class="text-base-content/70">
										No verse milestones were detected in the imported TEI.
									</div>
								{/if}
							</div>
						</div>
						<div class="grid gap-4 md:grid-cols-2">
							<div>
								<div class="font-semibold mb-2">Editorial Features</div>
								<dl class="space-y-1">
									<dt class="font-medium inline">Correction sites:</dt>
									<dd class="inline ml-1">{importedSummary.correctionSiteCount}</dd>
									<br />
									<dt class="font-medium inline">Correction readings:</dt>
									<dd class="inline ml-1">{importedSummary.correctionReadingCount}</dd>
									<br />
									<dt class="font-medium inline">Marginalia:</dt>
									<dd class="inline ml-1">{importedSummary.marginaliaCount}</dd>
									<br />
									<dt class="font-medium inline">Gaps:</dt>
									<dd class="inline ml-1">{importedSummary.gapCount}</dd>
									<br />
									<dt class="font-medium inline">Untranscribed spans:</dt>
									<dd class="inline ml-1">{importedSummary.untranscribedCount}</dd>
								</dl>
							</div>
							<div>
								<div class="font-semibold mb-2">Book Coverage</div>
								{#if importedSummary.bookIdentifiers.length > 0}
									<div class="flex flex-wrap gap-1">
										{#each importedSummary.bookIdentifiers as bookId}
											<span class="badge badge-outline badge-sm">{bookId}</span>
										{/each}
									</div>
								{:else}
									<div class="text-base-content/70">No book milestones detected.</div>
								{/if}
							</div>
							<div>
								<div class="font-semibold mb-2">Chapter Coverage</div>
								{#if importedSummary.chapterIdentifiers.length > 0}
									<div class="flex flex-wrap gap-1">
										{#each importedSummary.chapterIdentifiers.slice(0, 16) as chapterId}
											<span class="badge badge-outline badge-sm">{chapterId}</span>
										{/each}
										{#if importedSummary.chapterIdentifiers.length > 16}
											<span class="badge badge-ghost badge-sm">
												+{importedSummary.chapterIdentifiers.length - 16} more
											</span>
										{/if}
									</div>
								{:else}
									<div class="text-base-content/70">No chapter milestones detected.</div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<label class="floating-label w-full mt-2">
		<span class="font-bold label text-2xl">Description</span>
		<textarea class="textarea w-full" name="description" rows="2" bind:value={description}></textarea>
	</label>

	<label class="input w-full">
		<span class="font-bold label">Tags</span>
		<input
			type="text"
			class="grow"
			name="tags"
			bind:value={tagsInput}
			placeholder="E.g., Romans, Minuscule"
		/>
	</label>

	<label class="label block">
		<input
			type="checkbox"
			name="is_public"
			class="checkbox checkbox-neutral"
			bind:checked={isPublic}
		/>
		Make Public
	</label>

	<fieldset class="fieldset">
		<legend class="fieldset-legend text-lg">Database-backed Export Metadata</legend>
		<p class="text-sm text-base-content/70 mb-2">
			{#if !isEditMode && importMode === 'tei'}
				These fields were prefilled from the imported TEI where possible. Review and adjust them before creating the transcription.
			{:else}
				These fields live on the transcription record and are used to build the TEI header at export time.
			{/if}
		</p>
			<div class="tooltip" data-tip="The name of the person who transcribed the text.">
				<label class="input w-full">
					<span class="font-bold label">Transcriber*</span>
					<input
						type="text"
						name="transcriber"
						class="grow"
						bind:value={transcriber}
						required
					/>
				</label>
			</div>
			<div
				class="tooltip"
				data-tip="The institution, archive, or library that holds the manuscript."
			>
				<label class="input w-full">
					<span class="font-bold label">Repository*</span>
					<input
						type="text"
						name="repository"
						class="grow"
						bind:value={repository}
						required
					/>
				</label>
			</div>
			<div class="tooltip" data-tip="The city, town, or locality of the repository.">
				<label class="input w-full">
					<span class="font-bold label">Settlement*</span>
					<input
						type="text"
						name="settlement"
						class="grow"
						bind:value={settlement}
						required
					/>
				</label>
			</div>
			<div class="tooltip" data-tip="The language of the manuscript.">
				<label class="input w-full">
					<span class="font-bold label">Language*</span>
					<input
						type="text"
						name="language"
						class="grow"
						bind:value={language}
						required
					/>
				</label>
			</div>
	</fieldset>

	{#if error}
		<div class="alert alert-error">
			<span>{error}</span>
		</div>
	{/if}

	<button type="submit" disabled={loading} class="btn btn-success btn-lg w-full">
		{#if loading}
			{isEditMode ? 'Saving...' : 'Creating...'}
		{:else}
			{isEditMode ? 'Save Changes' : 'Create Transcription'}
		{/if}
	</button>
</form>
