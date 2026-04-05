<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';
	import { renderCorrectionContent } from '$lib/client/transcriptionEditorSchema';
	import FloppyDisk from 'phosphor-svelte/lib/FloppyDisk';
	import PencilSimple from 'phosphor-svelte/lib/PencilSimple';
	import Plus from 'phosphor-svelte/lib/Plus';
	import Trash from 'phosphor-svelte/lib/Trash';
	import InlineCarrierWorkspace from './InlineCarrierWorkspace.svelte';
	import type { Correction } from './types';

	interface Props {
		idPrefix: string;
		title: string;
		description?: string;
		initialCorrections: Correction[];
		applyLabel?: string;
		onApply: (corrections: Correction[]) => void;
		onRemoveAll?: () => void;
		variant?: 'popover' | 'panel';
	}

	let {
		idPrefix,
		title,
		description = '',
		initialCorrections,
		applyLabel = 'Apply',
		onApply,
		onRemoveAll,
		variant = 'panel',
	}: Props = $props();

	let tempCorrections = $state<Correction[]>([]);
	let draftContent = $state<unknown>([]);
	let editingIndex = $state<number | null>(null);
	let hand = $state('');
	let type = $state('');
	let position = $state('');
	let lastSnapshot = $state('');

	const commonCorrectionTypes = [
		'correction',
		'deletion',
		'substitution',
		'addition',
		'transposition',
	];

	const commonCorrectionPositions = [
		'above',
		'below',
		'left',
		'right',
		'margin',
		'interlinear',
		'overwritten',
	];
	const cardClass = $derived(
		variant === 'popover'
			? 'rounded-box bg-primary/15 border border-primary/25 p-3'
			: 'rounded border border-base-300 bg-base-200/70 p-3'
	);
	const previewClass = $derived(
		variant === 'popover'
			? 'mt-2 rounded bg-base-100 p-2 text-sm correction-display font-greek show-lacunose show-unclear show-abbreviation'
			: 'mt-2 rounded bg-base-200 p-2 text-sm correction-display font-greek show-lacunose show-unclear show-abbreviation'
	);

	$effect(() => {
		const snapshot = JSON.stringify(initialCorrections || []);
		if (snapshot === lastSnapshot) return;
		lastSnapshot = snapshot;
		tempCorrections = cloneCorrections(initialCorrections);
		resetDraft();
	});

	function cloneCorrections(corrections: Correction[] | undefined): Correction[] {
		if (!Array.isArray(corrections)) return [];
		return JSON.parse(JSON.stringify(corrections)) as Correction[];
	}

	function resetDraft() {
		editingIndex = null;
		hand = '';
		type = '';
		position = '';
		draftContent = [];
	}

	function loadCorrection(index: number) {
		const correction = tempCorrections[index];
		if (!correction) return;
		editingIndex = index;
		hand = correction.hand || '';
		type = correction.type || '';
		position = correction.position || '';
		draftContent = JSON.parse(JSON.stringify(correction.content || []));
	}

	function upsertCorrection() {
		if (!hand.trim()) return;
		const content = Array.isArray(draftContent) ? draftContent : [];
		if (content.length === 0) return;

		const nextCorrection: Correction = {
			hand: hand.trim(),
			content,
			...(type.trim() ? { type: type.trim() } : {}),
			...(position.trim() ? { position: position.trim() } : {}),
		};

		if (editingIndex === null) {
			tempCorrections = [...tempCorrections, nextCorrection];
		} else {
			tempCorrections = tempCorrections.map((item, index) =>
				index === editingIndex ? nextCorrection : item
			);
		}

		resetDraft();
	}

	function removeCorrection(index: number) {
		tempCorrections = tempCorrections.filter((_, currentIndex) => currentIndex !== index);
		if (editingIndex === index) {
			resetDraft();
		}
	}
</script>

<div class="space-y-4">
	<div class={cardClass}>
		<div class="mb-3 flex items-center justify-between gap-3">
			<div>
				<h4 class="text-sm font-semibold">{title}</h4>
				{#if description}
					<p class="text-xs text-base-content/70">{description}</p>
				{/if}
			</div>
			<div class="badge badge-warning badge-sm">
				{tempCorrections.length} reading{tempCorrections.length === 1 ? '' : 's'}
			</div>
		</div>

		<div class="grid gap-3 md:grid-cols-3">
			<label class="form-control">
				<span class="label-text text-xs font-semibold">Hand</span>
				<input class="input input-bordered input-sm" bind:value={hand} placeholder="corrector" />
			</label>
			<label class="form-control">
				<span class="label-text text-xs font-semibold">Type</span>
				<input
					class="input input-bordered input-sm"
					bind:value={type}
					placeholder="correction"
					list={`${idPrefix}-types`}
				/>
			</label>
			<label class="form-control">
				<span class="label-text text-xs font-semibold">Position</span>
				<input
					class="input input-bordered input-sm"
					bind:value={position}
					placeholder="above"
					list={`${idPrefix}-positions`}
				/>
			</label>
		</div>

		<datalist id={`${idPrefix}-types`}>
			{#each commonCorrectionTypes as option}
				<option value={option}></option>
			{/each}
		</datalist>
		<datalist id={`${idPrefix}-positions`}>
			{#each commonCorrectionPositions as option}
				<option value={option}></option>
			{/each}
		</datalist>

		<InlineCarrierWorkspace
			title="Correction Text"
			description="Use the same structured sub editor as marginalia; line and column edits flatten back to TEI break markers when you save the reading."
			initialContent={draftContent}
			storageMode="flattened"
			footerNote=""
			toolbarIdPrefix={`${idPrefix}-nested-toolbar`}
			onChange={nextContent => (draftContent = nextContent)}
		/>

		<div class="mt-3 flex justify-end gap-2">
			<button type="button" class="btn btn-sm btn-secondary" onclick={upsertCorrection}>
				{#if editingIndex === null}
					<Plus size={16} />
					Add Reading
				{:else}
					<FloppyDisk size={16} />
					Save Reading
				{/if}
			</button>
		</div>
	</div>

	{#if tempCorrections.length > 0}
		<div class="space-y-2">
			{#each tempCorrections as correction, index}
				<div class="rounded border border-base-300 bg-base-100 p-3">
					<div class="flex items-start justify-between gap-3">
						<div>
							<div class="text-sm font-semibold">{correction.hand}</div>
							<div class="text-xs text-base-content/65">
								{[correction.type, correction.position].filter(Boolean).join(' | ') || 'No extra metadata'}
							</div>
						</div>
						<div class="flex gap-2">
							<button type="button" class="btn btn-xs btn-outline" onclick={() => loadCorrection(index)}>
								<PencilSimple size={14} />
								Edit
							</button>
							<button type="button" class="btn btn-xs btn-error btn-outline" onclick={() => removeCorrection(index)}>
								<Trash size={14} />
							</button>
						</div>
					</div>
					<div class={previewClass}>
						{@html renderCorrectionContent(correction.content)}
					</div>
				</div>
			{/each}
		</div>

		<div class="flex justify-end gap-2">
			<button type="button" class="btn btn-primary btn-sm" onclick={() => onApply(tempCorrections)}>
				<Check size={16} />
				{applyLabel}
			</button>
			{#if onRemoveAll}
				<button type="button" class="btn btn-error btn-outline btn-sm" onclick={onRemoveAll}>
					<Trash size={16} />
					Remove All
				</button>
			{/if}
		</div>
	{/if}
</div>
