<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';
	import {
		buildPlainTextFormWorkContent,
		formWorkContentToPlainText,
		normalizeMarginaliaContent,
	} from './formworkContent';
	import { classifyFormWork, type MarginaliaCategory } from './formworkConcepts';
	import InlineCarrierWorkspace from './InlineCarrierWorkspace.svelte';
	import {
		MARGINALIA_CATEGORIES,
		MARGINALIA_PLACEMENTS,
		defaultPlacementForCategory,
		marginaliaPlacementPreset,
	} from './marginalia';

	interface Props {
		attrs: Record<string, any>;
		onApply: (attrs: Record<string, any>) => void;
	}

	let { attrs, onApply }: Props = $props();

	const classification = $derived(classifyFormWork(attrs));
	let textValue = $state('');
	let categoryValue = $state<Exclude<MarginaliaCategory, null>>('Other');
	let placementValue = $state('unknown');
	let typeValue = $state('');
	let subtypeValue = $state('');
	let placeValue = $state('');
	let rendValue = $state('');
	let segTypeValue = $state('');
	let segSubtypeValue = $state('');
	let segPlaceValue = $state('');
	let contentValue = $state<Record<string, any>>(normalizeMarginaliaContent([]));
	const contentTypeOptions = ['runTitle', 'pageNum', 'quireSig', 'chapTitle', 'lectTitle'];

	$effect(() => {
		textValue = formWorkContentToPlainText(attrs?.content || []);
		categoryValue = classification.marginaliaCategory || 'Other';
		placementValue = derivePlacementValue(classification);
		typeValue = attrs?.type || '';
		subtypeValue = attrs?.subtype || '';
		placeValue = attrs?.place || '';
		rendValue = attrs?.rend || '';
		segTypeValue = attrs?.segType || '';
		segSubtypeValue = attrs?.segSubtype || '';
		segPlaceValue = attrs?.segPlace || '';
		contentValue = normalizeMarginaliaContent(attrs?.content);
	});

	function applyChanges() {
		const placementChanged =
			classification.entryPoint === 'marginalia' &&
			(categoryValue !== (classification.marginaliaCategory || 'Other') ||
				placementValue !== derivePlacementValue(classification));
		const structuredPlacement =
			classification.entryPoint === 'marginalia' && placementChanged
				? marginaliaPlacementPreset(categoryValue, placementValue)
				: {};
		const nextPlace = structuredPlacement.place ?? placeValue;
		const nextSegType = structuredPlacement.segType ?? segTypeValue;
		const nextSegSubtype = structuredPlacement.segSubtype ?? segSubtypeValue;
		const nextSegPlace = structuredPlacement.segPlace ?? segPlaceValue;
		onApply({
			...attrs,
			type: typeValue,
			subtype: subtypeValue,
			place: nextPlace,
			rend: rendValue,
			segType: nextSegType,
			segSubtype: nextSegSubtype,
			segPlace: nextSegPlace,
			content:
				classification.entryPoint === 'marginalia'
					? contentValue
					: buildPlainTextFormWorkContent(textValue),
			teiAttrs: {
				...(attrs?.teiAttrs || {}),
				type: typeValue || undefined,
				subtype: subtypeValue || undefined,
				place: nextPlace || undefined,
				rend: rendValue || undefined,
			},
			segAttrs: {
				...(attrs?.segAttrs || {}),
				type: nextSegType || undefined,
				subtype: nextSegSubtype || undefined,
				place: nextSegPlace || undefined,
			},
		});
	}

	function applyCategory(nextCategory: string) {
		categoryValue = nextCategory as Exclude<MarginaliaCategory, null>;
		placementValue = defaultPlacementForCategory(categoryValue);
	}

	function derivePlacementValue(currentClassification: ReturnType<typeof classifyFormWork>): string {
		if (currentClassification.entryPoint !== 'marginalia') {
			return 'unknown';
		}

		switch (currentClassification.placementConcept) {
			case 'lineLeft':
			case 'lineRight':
			case 'margin':
			case 'lineAbove':
			case 'lineBelow':
			case 'columnTop':
			case 'columnBottom':
			case 'inline':
			case 'inSpace':
			case 'oppositePage':
			case 'overleaf':
			case 'pageEnd':
				return currentClassification.placementConcept;
			default:
				return 'unknown';
		}
	}
</script>

<div class="space-y-3">
	{#if classification.entryPoint === 'marginalia'}
		<div class="text-xs text-base-content/70">
			{classification.marginaliaCategory || 'Other'} &middot; {classification.placementLabel}
		</div>

		<InlineCarrierWorkspace
			title="Marginalia Content"
			description="Use the inline editor for multi-line content or nested corrections."
			initialContent={contentValue}
			onChange={nextContent => (contentValue = normalizeMarginaliaContent(nextContent))}
		/>

		<div class="grid gap-2 md:grid-cols-2">
			<label class="form-control">
				<span class="label-text text-xs font-semibold">Category</span>
				<select
					bind:value={categoryValue}
					onchange={e => applyCategory((e.currentTarget as HTMLSelectElement).value)}
					class="select select-bordered select-sm"
				>
					{#each MARGINALIA_CATEGORIES as category}
						<option value={category}>{category}</option>
					{/each}
				</select>
			</label>
			<label class="form-control">
				<span class="label-text text-xs font-semibold">Placement</span>
				<select
					bind:value={placementValue}
					class="select select-bordered select-sm"
				>
					{#each MARGINALIA_PLACEMENTS[categoryValue] as placement}
						<option value={placement.value}>{placement.label}</option>
					{/each}
				</select>
			</label>
		</div>
	{:else}
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Text</span>
			<input bind:value={textValue} class="input input-bordered input-sm" />
		</label>
		<div class="grid gap-2 md:grid-cols-2">
			<label class="form-control">
				<span class="label-text text-xs font-semibold">Content Type</span>
				<input bind:value={typeValue} class="input input-bordered input-sm" list="fw-content-types" />
				<datalist id="fw-content-types">
					{#each contentTypeOptions as opt}
						<option value={opt}></option>
					{/each}
				</datalist>
			</label>
			<label class="form-control">
				<span class="label-text text-xs font-semibold">Position</span>
				<input bind:value={placeValue} class="input input-bordered input-sm" />
			</label>
			<label class="form-control">
				<span class="label-text text-xs font-semibold">Appearance</span>
				<input bind:value={rendValue} class="input input-bordered input-sm" />
			</label>
		</div>
	{/if}

	<div class="flex justify-end">
		<button class="btn btn-sm btn-primary" onclick={applyChanges}>
			<Check size={16} />
			Apply
		</button>
	</div>

</div>
