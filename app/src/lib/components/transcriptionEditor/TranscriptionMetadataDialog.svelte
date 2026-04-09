<script lang="ts">
	import PencilSimple from 'phosphor-svelte/lib/PencilSimple';
	import X from 'phosphor-svelte/lib/X';
	import { serializeTeiNode, serializeTeiNodes } from '@apatopwa/tei-transcription';
	import type { TranscriptionRecord } from '$lib/client/transcription/model';
	import { parseTranscriptionTags } from '$lib/client/transcription/model';
	import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
	import TranscriptionForm from '$lib/components/TranscriptionForm.svelte';
	import BookmarkSimple from 'phosphor-svelte/lib/BookmarkSimple';
	import Trash from 'phosphor-svelte/lib/Trash';
	import FlagBanner from 'phosphor-svelte/lib/FlagBanner';
	import { PanelTop } from 'lucide-svelte';
	import type { PageEditorMetadata } from './pageFormwork';

	interface Props {
		data: any;
		transcription: TranscriptionRecord | undefined | null;
		canonicalDocument: StoredTranscriptionDocument;
		pages: PageEditorMetadata[];
		onUpdatePageName: (pos: number, newName: string) => void;
		onDeletePage: (pos: number) => void;
		onUpdatePageFormWork: (
			pagePos: number,
			kind: 'pageLabel' | 'runningTitle' | 'catchword' | 'quireSignature',
			newText: string
		) => void;
		onSaveTranscription?: (transcription: TranscriptionRecord) => void;
	}

	let {
		transcription,
		canonicalDocument,
		pages,
		onUpdatePageName,
		onDeletePage,
		onUpdatePageFormWork,
		data,
		onSaveTranscription,
	}: Props = $props();
	let editMode = $state(false);

	const tags = $derived(parseTranscriptionTags(transcription?.tags));
	const teiHeader = $derived(canonicalDocument.header);
	const preservedSections = $derived(buildPreservedSections(canonicalDocument));

	function handleSaveTranscription(updatedTranscription: TranscriptionRecord) {
		editMode = false;
		if (onSaveTranscription) {
			onSaveTranscription(updatedTranscription);
		}
	}

	function buildPreservedSections(document: StoredTranscriptionDocument) {
		return [
			{
				label: 'front',
				items: document.front ? [serializeTeiNode(document.front)] : [],
			},
			{
				label: 'back',
				items: document.back ? [serializeTeiNode(document.back)] : [],
			},
			{
				label: 'text-leading',
				items: serializeTeiNodes(document.textLeading),
			},
			{
				label: 'between front/body',
				items: serializeTeiNodes(document.textBetweenFrontBody),
			},
			{
				label: 'between body/back',
				items: serializeTeiNodes(document.textBetweenBodyBack),
			},
			{
				label: 'text-trailing',
				items: serializeTeiNodes(document.textTrailing),
			},
			{
				label: 'resource siblings',
				items: (document.resourceNodes || []).map(serializeTeiNode),
			},
			{
				label: 'nested TEI siblings',
				items: (document.nestedTei || []).map(serializeTeiNode),
			},
			{
				label: 'facsimile',
				items: (document.facsimile || []).map(serializeTeiNode),
			},
			{
				label: 'standOff',
				items: (document.standOff || []).map(serializeTeiNode),
			},
			{
				label: 'sourceDoc',
				items: (document.sourceDoc || []).map(serializeTeiNode),
			},
		].filter(section => section.items.length > 0);
	}

	function summarizeXml(xml: string, maxLength: number = 180): string {
		const compact = xml.replace(/\s+/g, ' ').trim();
		return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
	}

	function confirmDeletePage(page: PageEditorMetadata) {
		const pageLabel = page.pageName?.trim() || `Page ${page.pageOrder}`;
		if (!window.confirm(`Remove ${pageLabel}? This cannot be undone.`)) {
			return;
		}

		onDeletePage(page.pos);
	}
</script>

<dialog id="transcription-metadata-modal" class="modal">
	<div class="modal-box h-auto max-h-[90vh] overflow-y-auto w-full">
		<form method="dialog" class="mb-4">
			<button
				type="submit"
				class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
				aria-label="Close modal"
			>
				<X size={16} />
			</button>
		</form>

		<h2 class="text-lg font-bold mb-4">Transcription Metadata</h2>

		{#if editMode}
			<div class="mb-6">
				<TranscriptionForm {data} {transcription} onSave={handleSaveTranscription} />
			</div>
			<div class="modal-action mt-4">
				<form method="dialog">
					<button
						type="button"
						onclick={() => (editMode = false)}
						class="btn"
					>
						<X size={16} />
						Cancel
					</button>
				</form>
			</div>
		{:else}
			<nav id="visibility-filters-nav" class="menu p-0 space-y-2 w-full">
				<details class="collapse bg-base-100 border-base-300 border collapse-arrow w-full">
					<summary class="collapse-title font-semibold w-full">Database Metadata</summary>
					<div class="collapse-content text-sm">
						<dl class="">
							<dt class="font-bold">Title</dt>
							<dd class="mb-2">{transcription?.title}</dd>
							<dt class="font-bold">Siglum</dt>
							<dd class="mb-2">{transcription?.siglum}</dd>
							<dt class="font-bold">Transcriber</dt>
							<dd class="mb-2">{transcription?.transcriber || transcription?.owner || '—'}</dd>
							<dt class="font-bold">Repository</dt>
							<dd class="mb-2">{transcription?.repository || '—'}</dd>
							<dt class="font-bold">Settlement</dt>
							<dd class="mb-2">{transcription?.settlement || '—'}</dd>
							<dt class="font-bold">Language</dt>
							<dd class="mb-2">{transcription?.language || '—'}</dd>
							<dt class="font-bold">Description</dt>
							<dd class="mb-2">{transcription?.description}</dd>
							<dt class="font-bold">Tags</dt>
							<dd class="mb-2">{tags.join(', ')}</dd>
							<dt class="font-bold">Created</dt>
							<dd class="mb-2">
								{new Date(transcription?.created_at || '').toLocaleString()}
							</dd>
							<dt class="font-bold">Last Updated</dt>
							<dd class="mb-2">
								{new Date(transcription?.updated_at || '').toLocaleString()}
							</dd>
							<dt class="font-bold">Public?</dt>
							<dd class="mb-2">{transcription?.is_public ? 'Yes' : 'No'}</dd>
							{#if transcription?.owner}
								<dt class="font-bold">Owned by</dt>
								<dd>{transcription?.owner}</dd>
							{/if}
						</dl>
					</div>
				</details>
				<details class="collapse bg-base-100 border-base-300 border collapse-arrow w-full">
					<summary class="collapse-title font-semibold w-full">Document TEI Context</summary>
					<div class="collapse-content text-sm space-y-4">
						<p class="text-gray-600">
							Common export metadata is managed on the transcription record, not in the Tiptap document. This section only shows TEI-specific witness and manuscript context that may still matter for the imported document.
						</p>
						{#if teiHeader}
							<div>
								<h3 class="font-semibold mb-2">Typed TEI Context</h3>
								<dl>
									<dt class="font-bold">Witness IDs</dt>
									<dd class="mb-2">{teiHeader.witnessIds?.join(', ') || '—'}</dd>
									<dt class="font-bold">Encoding Version</dt>
									<dd class="mb-2">{teiHeader.encodingVersion || '—'}</dd>
									<dt class="font-bold">Publication Date</dt>
									<dd class="mb-2">{teiHeader.publicationDate || '—'}</dd>
									<dt class="font-bold">MS Identifier</dt>
									<dd class="mb-2">
										{[
											teiHeader.msIdentifier?.country,
											teiHeader.msIdentifier?.settlement,
											teiHeader.msIdentifier?.repository,
											teiHeader.msIdentifier?.idno,
										]
											.filter(Boolean)
											.join(' / ') || '—'}
									</dd>
									<dt class="font-bold">MS Description</dt>
									<dd>
										{[
											teiHeader.msDescription?.msName,
											teiHeader.msDescription?.objectType,
											teiHeader.msDescription?.material,
											teiHeader.msDescription?.origDate,
											teiHeader.msDescription?.origPlace,
										]
											.filter(Boolean)
											.join(' / ') || '—'}
									</dd>
								</dl>
							</div>
						{:else}
							<p class="text-gray-500">
								No extra TEI-specific witness/manuscript context is currently attached to this document.
							</p>
						{/if}
					</div>
				</details>
				<details class="collapse bg-base-100 border-base-300 border collapse-arrow w-full">
					<summary class="collapse-title font-semibold w-full">
						Preserved TEI Sections ({preservedSections.length})
					</summary>
					<div class="collapse-content text-sm space-y-3">
						{#if preservedSections.length > 0}
							<p class="text-gray-600">
								These sections are preserved losslessly for export even when they are not
								directly editable in the flattened transcription view.
							</p>
							{#each preservedSections as section}
								<div class="rounded border border-base-300 p-3">
									<div class="font-semibold mb-2">
										{section.label} ({section.items.length})
									</div>
									<div class="space-y-2">
										{#each section.items as xml}
											<details class="bg-base-200 rounded p-2">
												<summary class="cursor-pointer font-mono text-xs break-all">
													{summarizeXml(xml)}
												</summary>
												<pre class="mt-2 whitespace-pre-wrap break-all text-xs">{xml}</pre>
											</details>
										{/each}
									</div>
								</div>
							{/each}
						{:else}
							<p class="text-gray-500">
								No preserved non-body TEI sections are currently attached to this document.
							</p>
						{/if}
					</div>
				</details>
				<details class="collapse bg-base-100 border-base-300 border collapse-arrow">
					<summary class="collapse-title font-semibold w-full"
						>Page Metadata ({pages.length} pages)</summary
					>
					<div class="collapse-content text-sm">
						{#each pages as page, index (page.pageId)}
							<div class="rounded border border-base-300 p-3 space-y-3">
								<div class="flex items-start justify-between gap-3">
									<div class="font-semibold text-sm">Page {index + 1}</div>
									<button
										type="button"
										class="btn btn-sm btn-outline btn-error"
										onclick={() => confirmDeletePage(page)}
									>
										<Trash size={14} />
										Remove page
									</button>
								</div>
								<div class="flex gap-2 items-center">
									<span class="text-sm text-gray-600 w-28">Page name</span>
									<input
										type="text"
										value={page.pageName || ''}
										oninput={e => onUpdatePageName(page.pos, e.currentTarget.value)}
										placeholder="Page name (e.g. 123r)"
										class="rounded px-3 py-1 border border-gray-300 flex-1"
									/>
								</div>
								<div class="flex gap-2 items-center">
									<span class="text-sm text-gray-600 w-28">Page label</span>
									<input
										type="text"
										value={page.pageLabel?.text || ''}
										oninput={e =>
											onUpdatePageFormWork(page.pos, 'pageLabel', e.currentTarget.value)}
										placeholder="Visible page number / folio label"
										class="rounded px-3 py-1 border border-gray-300 flex-1"
									/>
								</div>
								<div class="flex gap-2 items-center">
									<span class="text-sm text-gray-600 w-28">Running title</span>
									<input
										type="text"
										value={page.runningTitle?.text || ''}
										oninput={e =>
											onUpdatePageFormWork(page.pos, 'runningTitle', e.currentTarget.value)}
										placeholder="Running title / page header"
										class="rounded px-3 py-1 border border-gray-300 flex-1"
									/>
								</div>
								<div class="flex gap-2 items-center">
									<span class="text-sm text-gray-600 w-28">Catchword</span>
									<input
										type="text"
										value={page.catchword?.text || ''}
										oninput={e =>
											onUpdatePageFormWork(page.pos, 'catchword', e.currentTarget.value)}
										placeholder="Catchword at page boundary"
										class="rounded px-3 py-1 border border-gray-300 flex-1"
									/>
								</div>
								<div class="flex gap-2 items-center">
									<span class="text-sm text-gray-600 w-28">Quire signature</span>
									<input
										type="text"
										value={page.quireSignature?.text || ''}
										oninput={e =>
											onUpdatePageFormWork(page.pos, 'quireSignature', e.currentTarget.value)}
										placeholder="Quire signature / codicological mark"
										class="rounded px-3 py-1 border border-gray-300 flex-1"
									/>
								</div>
								{#if page.pageLabel || page.runningTitle || page.catchword || page.quireSignature}
									<div class="flex flex-wrap gap-2 text-xs text-base-content/70">
										{#if page.pageLabel}
											<span class="badge badge-outline badge-sm inline-flex items-center gap-1">
												<BookmarkSimple size={12} />
												pageLabel: {page.pageLabel.attrs?.type || 'pageNum'}
											</span>
										{/if}
										{#if page.runningTitle}
											<span class="badge badge-outline badge-sm inline-flex items-center gap-1">
												<PanelTop size={12} />
												runningTitle: {page.runningTitle.attrs?.type || 'runTitle'}
											</span>
										{/if}
										{#if page.catchword}
											<span class="badge badge-outline badge-sm inline-flex items-center gap-1">
												<FlagBanner size={12} />
												catchword: {page.catchword.attrs?.type || 'catchword'}
											</span>
										{/if}
										{#if page.quireSignature}
											<span class="badge badge-outline badge-sm inline-flex items-center gap-1">
												<BookmarkSimple size={12} />
												quireSignature: {page.quireSignature.attrs?.type || 'sig'}
											</span>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
						{#if pages.length === 0}
							<p class="text-gray-500 text-sm">
								No pages yet. Add a page using the button below.
							</p>
						{/if}
					</div>
				</details>
			</nav>

			<div class="modal-action mt-4">
				<form method="dialog" class="flex gap-2">
					<button
						type="button"
						onclick={() => (editMode = true)}
						class="btn btn-primary"
					>
						<PencilSimple size={16} />
						Edit Metadata
					</button>
					<button class="btn">
						<X size={16} />
						Close
					</button>
				</form>
			</div>
		{/if}
	</div>

	<form method="dialog" class="modal-backdrop">
		<button aria-label="Close sidebar modal"></button>
	</form>
</dialog>
