<script lang="ts">
	import { loadReferenceEdition } from '$lib/client/reference-editions/reference-edition-worker';
	import {
		listReferenceEditions,
		type ReferenceEditionCatalogEntry,
	} from '$lib/reference-editions/catalog';
	import {
		listUnits,
		type ParsedReferenceEdition,
		type ReferenceEditionUnit,
	} from '$lib/reference-editions/source';

	interface Props {
		open: boolean;
		onClose: () => void;
		onInsert: (
			entry: ReferenceEditionCatalogEntry,
			source: ParsedReferenceEdition,
			startPosition: number,
			endPosition: number
		) => void;
		loadSource?: (entry: ReferenceEditionCatalogEntry) => Promise<ParsedReferenceEdition>;
	}

	let { open, onClose, onInsert, loadSource = loadReferenceEdition }: Props = $props();

	const entries = listReferenceEditions();
	let selectedEntryId = $state(entries[0]?.id || '');
	let filter = $state('');
	let source = $state<ParsedReferenceEdition | null>(null);
	let startPosition = $state<number | null>(null);
	let endPosition = $state<number | null>(null);
	let loading = $state(false);
	let error = $state('');
	let loadGeneration = 0;

	const selectedEntry = $derived(entries.find(entry => entry.id === selectedEntryId) || null);
	const units = $derived(source ? listUnits(source) : []);
	const filteredUnits = $derived(
		units.filter(unit =>
			formatUnitLabel(unit).toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())
		)
	);
	const canInsert = $derived(
		!!source &&
			selectedEntry !== null &&
			startPosition !== null &&
			endPosition !== null &&
			startPosition <= endPosition
	);

	$effect(() => {
		if (!open || !selectedEntry) return;
		const generation = ++loadGeneration;
		loading = true;
		error = '';
		source = null;
		startPosition = null;
		endPosition = null;

		void loadSource(selectedEntry)
			.then(nextSource => {
				if (generation !== loadGeneration) return;
				source = nextSource;
			})
			.catch(reason => {
				if (generation !== loadGeneration) return;
				error = reason instanceof Error ? reason.message : String(reason);
			})
			.finally(() => {
				if (generation === loadGeneration) loading = false;
			});
	});

	function selectUnit(position: number) {
		if (startPosition === null || endPosition !== startPosition) {
			startPosition = position;
			endPosition = position;
			return;
		}

		if (position >= startPosition) {
			endPosition = position;
		} else {
			endPosition = startPosition;
			startPosition = position;
		}
	}

	function updateStartPosition(event: Event) {
		const value = Number((event.currentTarget as HTMLSelectElement).value);
		if (!Number.isInteger(value)) return;
		startPosition = value;
		if (endPosition === null || endPosition < value) endPosition = value;
	}

	function updateEndPosition(event: Event) {
		const value = Number((event.currentTarget as HTMLSelectElement).value);
		if (!Number.isInteger(value)) return;
		endPosition = value;
		if (startPosition === null || startPosition > value) startPosition = value;
	}

	function insertSelection() {
		if (
			!canInsert ||
			!selectedEntry ||
			!source ||
			startPosition === null ||
			endPosition === null
		)
			return;
		onInsert(selectedEntry, source, startPosition, endPosition);
		onClose();
	}

	function formatUnitLabel(unit: ReferenceEditionUnit): string {
		const label = unit.label;
		const parts = [label.book, label.chapter, label.verse, label.unit, label.value].filter(
			(value): value is string => !!value
		);
		return parts.join(' / ') || 'Addressed unit';
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/35 p-4 sm:items-center"
		data-testid="reference-edition-picker"
	>
		<div
			class="flex max-h-[min(42rem,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="reference-edition-picker-title"
		>
			<header
				class="flex items-start justify-between gap-4 border-b border-base-300 px-5 py-4"
			>
				<div>
					<p class="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
						Reference edition
					</p>
					<h2 id="reference-edition-picker-title" class="text-xl font-semibold">
						Seed at cursor
					</h2>
				</div>
				<button
					type="button"
					class="btn btn-sm btn-ghost"
					aria-label="Close reference edition picker"
					onclick={onClose}
				>
					Close
				</button>
			</header>

			<div class="grid min-h-0 flex-1 gap-4 overflow-hidden p-5 md:grid-cols-[13rem_1fr]">
				<section class="min-h-0 space-y-2">
					<h3
						class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/60"
					>
						Edition
					</h3>
					<div class="space-y-2" role="list" aria-label="Reference editions">
						{#each entries as entry (entry.id)}
							<button
								type="button"
								class={[
									'w-full rounded-box border px-3 py-2 text-left transition',
									selectedEntryId === entry.id
										? 'border-primary bg-primary/10'
										: 'border-base-300 hover:border-primary/60',
								]}
								data-testid={`reference-edition-entry-${entry.id}`}
								onclick={() => (selectedEntryId = entry.id)}
							>
								<span class="block text-sm font-semibold">{entry.title}</span>
								<span class="mt-1 block text-xs text-base-content/65"
									>{entry.attribution}</span
								>
							</button>
						{/each}
					</div>
				</section>

				<section class="flex min-h-0 flex-col gap-3">
					{#if selectedEntry}
						<div
							class="rounded-box border border-base-300 bg-base-200/45 px-3 py-2 text-sm"
						>
							<div class="font-semibold">{selectedEntry.title}</div>
							<div class="text-xs text-base-content/65">
								{selectedEntry.attribution}
							</div>
						</div>
					{/if}

					<label class="input input-sm w-full">
						<span class="label">Filter units</span>
						<input
							type="search"
							data-testid="reference-edition-filter"
							placeholder="Filter by label"
							bind:value={filter}
						/>
					</label>

					{#if loading}
						<div
							class="flex min-h-32 items-center justify-center text-sm text-base-content/65"
						>
							Loading edition...
						</div>
					{:else if error}
						<div class="alert alert-error text-sm" role="alert">{error}</div>
					{:else if source}
						<div class="grid min-h-0 gap-3 sm:grid-cols-2">
							<label class="select select-sm w-full">
								<span class="label">Start unit</span>
								<select
									data-testid="reference-edition-start"
									value={startPosition ?? ''}
									onchange={updateStartPosition}
								>
									<option value="" disabled>Choose a start</option>
									{#each units as unit (unit.position)}
										<option value={unit.position}
											>{formatUnitLabel(unit)}</option
										>
									{/each}
								</select>
							</label>
							<label class="select select-sm w-full">
								<span class="label">End unit</span>
								<select
									data-testid="reference-edition-end"
									value={endPosition ?? ''}
									onchange={updateEndPosition}
								>
									<option value="" disabled>Choose an end</option>
									{#each units as unit (unit.position)}
										<option value={unit.position}
											>{formatUnitLabel(unit)}</option
										>
									{/each}
								</select>
							</label>
						</div>

						<div
							class="min-h-0 flex-1 overflow-y-auto rounded-box border border-base-300"
							role="listbox"
							aria-label="Edition units"
						>
							{#each filteredUnits as unit (unit.position)}
								<button
									type="button"
									class={[
										'block w-full border-b border-base-200 px-3 py-2 text-left text-sm last:border-b-0',
										startPosition !== null &&
										endPosition !== null &&
										unit.position >= startPosition &&
										unit.position <= endPosition
											? 'bg-primary/12 text-primary'
											: 'hover:bg-base-200',
									]}
									data-testid={`reference-edition-unit-${unit.position}`}
									role="option"
									aria-selected={startPosition === unit.position ||
										endPosition === unit.position}
									onclick={() => selectUnit(unit.position)}
								>
									{formatUnitLabel(unit)}
								</button>
							{:else}
								<div class="p-4 text-sm text-base-content/60">
									No units match this filter.
								</div>
							{/each}
						</div>
					{:else}
						<div
							class="min-h-32 rounded-box border border-dashed border-base-300 p-4 text-sm text-base-content/65"
						>
							Choose an edition to load its addressable units.
						</div>
					{/if}
				</section>
			</div>

			<footer
				class="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 px-5 py-3"
			>
				<p class="text-xs text-base-content/65">
					{#if startPosition !== null && endPosition !== null}
						Selected units {startPosition}-{endPosition} in document order.
					{:else}
						Select a start and end unit.
					{/if}
				</p>
				<button
					type="button"
					class="btn btn-primary"
					data-testid="insert-reference-edition"
					disabled={!canInsert}
					onclick={insertSelection}
				>
					Insert at cursor
				</button>
			</footer>
		</div>
	</div>
{/if}
