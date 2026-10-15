<script lang="ts">
	import {
		BUNDLED_READING_TYPES,
		readingTypeSuffixProblem,
		resolveReadingTypeVocabulary,
		type ReadingTypeDefinition,
	} from '$lib/collation/reading-types';
	import Plus from 'phosphor-svelte/lib/Plus';
	import Trash from 'phosphor-svelte/lib/Trash';

	let { projectId, readingTypes, onAddReadingType, onRemoveReadingType } = $props<{
		projectId: string;
		readingTypes: ReadingTypeDefinition[];
		onAddReadingType: (type: ReadingTypeDefinition) => void;
		onRemoveReadingType: (id: string) => void;
	}>();

	let labelDraft = $derived.by(() => {
		projectId;
		return '';
	});
	let suffixDraft = $derived.by(() => {
		projectId;
		return '';
	});
	let descriptionDraft = $derived.by(() => {
		projectId;
		return '';
	});

	const bundledTypes = BUNDLED_READING_TYPES.filter(type => type.suffix);

	let vocabulary = $derived(resolveReadingTypeVocabulary(readingTypes));
	let id = $derived(labelDraft.trim().toLowerCase().replace(/\s+/g, '-'));
	let labelProblem = $derived(
		id === ''
			? 'Name the reading type.'
			: vocabulary.some(type => type.id === id)
				? 'A reading type with this name already exists.'
				: null
	);
	let suffixProblem = $derived(readingTypeSuffixProblem(suffixDraft.trim(), vocabulary));

	function addReadingType() {
		if (labelProblem || suffixProblem) return;
		onAddReadingType({
			id,
			label: labelDraft.trim(),
			description: descriptionDraft.trim(),
			selectable: true,
			suffix: suffixDraft.trim(),
		});
		labelDraft = '';
		suffixDraft = '';
		descriptionDraft = '';
	}
</script>

<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<div class="mb-3">
		<h2 class="font-serif text-lg font-semibold">Reading Types</h2>
		<p class="text-xs text-base-content/50">
			A reading type's one-letter suffix labels its subreadings, as in
			<span class="font-mono">ao</span>
			or <span class="font-mono">af1</span>. Bundled:
			{#each bundledTypes as type, index (type.id)}
				{type.label} <span class="font-mono">{type.suffix}</span>{index <
				bundledTypes.length - 1
					? ', '
					: '.'}
			{/each}
		</p>
	</div>

	<div class="space-y-2 rounded-box border border-base-300/50 bg-base-200/40 p-3">
		<div class="flex flex-wrap gap-2">
			<label class="form-control min-w-40 flex-1">
				<div class="label py-0.5"><span class="label-text text-xs">Type name</span></div>
				<input
					type="text"
					class="input input-bordered input-sm w-full"
					placeholder="e.g. Itacism"
					bind:value={labelDraft}
				/>
			</label>
			<label class="form-control w-20">
				<div class="label py-0.5"><span class="label-text text-xs">Suffix</span></div>
				<input
					type="text"
					class="input input-bordered input-sm w-full font-mono"
					maxlength="1"
					placeholder="i"
					bind:value={suffixDraft}
				/>
			</label>
		</div>
		<label class="form-control w-full">
			<div class="label py-0.5"><span class="label-text text-xs">Description</span></div>
			<input
				type="text"
				class="input input-bordered input-sm w-full"
				placeholder="Optional note"
				bind:value={descriptionDraft}
			/>
		</label>
		{#if labelDraft.trim() && labelProblem}
			<p class="text-xs text-error">{labelProblem}</p>
		{/if}
		{#if suffixDraft && suffixProblem}
			<p class="text-xs text-error">{suffixProblem}</p>
		{/if}
		<button
			type="button"
			class="btn btn-primary btn-sm w-full gap-1"
			disabled={labelProblem !== null || suffixProblem !== null}
			onclick={addReadingType}
		>
			<Plus size={14} />
			Add Reading Type
		</button>
	</div>

	{#if readingTypes.length === 0}
		<div class="py-4 text-center text-sm text-base-content/40">
			No project reading types yet.
		</div>
	{:else}
		<ul class="mt-3 space-y-2">
			{#each readingTypes as type (type.id)}
				<li
					class="flex items-start gap-2 rounded-box border border-base-300/40 bg-base-100 px-3 py-2.5"
				>
					<span class="badge badge-outline badge-sm mt-0.5 font-mono">{type.suffix}</span>
					<div class="min-w-0 flex-1">
						<div class="text-sm font-medium">{type.label}</div>
						{#if type.description}
							<div class="mt-0.5 text-xs text-base-content/50">
								{type.description}
							</div>
						{/if}
					</div>
					<button
						type="button"
						class="btn btn-ghost btn-xs btn-circle shrink-0"
						aria-label={`Remove reading type ${type.label}`}
						onclick={() => onRemoveReadingType(type.id)}
					>
						<Trash size={14} />
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
