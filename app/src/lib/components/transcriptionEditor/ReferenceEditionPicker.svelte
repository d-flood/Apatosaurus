<script lang="ts">
	import {
		loadReferenceEdition,
		parseReferenceEditionInWorker,
	} from '$lib/client/reference-editions/reference-edition-worker';
	import {
		listUserReferenceEditions,
		loadUserReferenceEditionXml,
		registerUserReferenceEdition,
		removeUserReferenceEdition,
	} from '$lib/client/store/user-reference-editions';
	import {
		listReferenceEditions,
		type ReferenceEditionCatalogEntry,
	} from '$lib/reference-editions/catalog';
	import {
		listUnits,
		type ParsedReferenceEdition,
		type ReferenceEditionUnit,
		type ReferenceEditionUnitLabel,
	} from '$lib/reference-editions/source';

	type LevelKind = 'book' | 'chapter' | 'verse' | 'unit';
	type SavedPosition = {
		entryId: string;
		startPosition: number | null;
		endPosition: number | null;
		levelSelections: Partial<Record<LevelKind, string>>;
	};

	interface Props {
		open: boolean;
		transcriptionId: string;
		onClose: () => void;
		onInsert: (
			entry: ReferenceEditionCatalogEntry,
			source: ParsedReferenceEdition,
			startPosition: number,
			endPosition: number
		) => void;
		loadSource?: (entry: ReferenceEditionCatalogEntry) => Promise<ParsedReferenceEdition>;
		requiredEditionIds?: string[];
	}

	let {
		open,
		transcriptionId,
		onClose,
		onInsert,
		loadSource = loadAvailableReferenceEdition,
		requiredEditionIds = [],
	}: Props = $props();

	let entries = $state(listReferenceEditions());
	let selectedEntryId = $state(listReferenceEditions()[0]?.id || '');
	let filter = $state('');
	let source = $state<ParsedReferenceEdition | null>(null);
	let startPosition = $state<number | null>(null);
	let endPosition = $state<number | null>(null);
	let levelSelections = $state<Partial<Record<LevelKind, string>>>({});
	let loading = $state(false);
	let error = $state('');
	let loadedEntryId = $state('');
	let activeTranscriptionId = $state('');
	let restoredTranscriptionId = $state('');
	let savedPosition = $state<SavedPosition | null>(null);
	let loadGeneration = 0;
	let catalogLoading = $state(false);
	let catalogReady = $state(false);
	let registrationError = $state('');
	let pendingRegistration = $state<{ xml: string; fileName: string } | null>(null);
	let suppliedAttribution = $state('');

	const selectedEntry = $derived(entries.find(entry => entry.id === selectedEntryId) || null);
	const missingEditionIds = $derived(
		requiredEditionIds.filter(id => !entries.some(entry => entry.id === id))
	);
	const units = $derived(source ? listUnits(source) : []);
	const levels = $derived(getLevels(units));
	const finalLevel = $derived(levels.at(-1) || null);
	const enclosingLevels = $derived(levels.slice(0, -1));
	const scopedUnits = $derived(
		units.filter(unit => matchesLevelSelections(unit, enclosingLevels, levelSelections))
	);
	const filteredUnits = $derived(
		scopedUnits.filter(unit =>
			formatUnitLabel(unit).toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())
		)
	);
	const preview = $derived(
		startPosition === null || endPosition === null
			? ''
			: units
					.slice(startPosition, endPosition + 1)
					.map(unit => previewText(unit.content))
					.filter(Boolean)
					.join('\n')
	);
	const canInsert = $derived(
		!!source &&
			selectedEntry !== null &&
			startPosition !== null &&
			endPosition !== null &&
			startPosition <= endPosition &&
			scopedUnits.some(unit => unit.position === startPosition) &&
			scopedUnits.some(unit => unit.position === endPosition)
	);

	$effect(() => {
		if (!open) return;
		void refreshCatalog();
	});

	$effect(() => {
		if (!open || activeTranscriptionId === transcriptionId) return;
		activeTranscriptionId = transcriptionId;
		restoredTranscriptionId = '';
		savedPosition = readSavedPosition(transcriptionId);
		filter = '';
		source = null;
		loadedEntryId = '';
		levelSelections = {};
		startPosition = null;
		endPosition = null;
		loading = false;
		error = '';
		loadGeneration += 1;
	});

	$effect(() => {
		if (
			!open ||
			activeTranscriptionId !== transcriptionId ||
			restoredTranscriptionId === transcriptionId ||
			!catalogReady
		)
			return;
		if (savedPosition && entries.some(entry => entry.id === savedPosition?.entryId)) {
			selectedEntryId = savedPosition.entryId;
		} else {
			selectedEntryId = entries[0]?.id || '';
		}
		restoredTranscriptionId = transcriptionId;
	});

	async function refreshCatalog() {
		catalogLoading = true;
		catalogReady = false;
		try {
			entries = listReferenceEditions(await listUserReferenceEditions());
			if (!entries.some(entry => entry.id === selectedEntryId)) {
				selectedEntryId = entries[0]?.id || '';
				loadedEntryId = '';
			}
		} catch (reason) {
			registrationError = reason instanceof Error ? reason.message : String(reason);
		} finally {
			catalogLoading = false;
			catalogReady = true;
		}
	}

	async function addEdition(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		registrationError = '';
		const candidate = { xml: await file.text(), fileName: file.name };
		try {
			const entry = await registerUserReferenceEdition(candidate);
			pendingRegistration = null;
			await refreshCatalog();
			selectedEntryId = entry.id;
			loadedEntryId = '';
		} catch (reason) {
			const message = reason instanceof Error ? reason.message : String(reason);
			if (message.startsWith('Attribution is required')) pendingRegistration = candidate;
			registrationError = message;
		}
	}

	async function finishRegistration() {
		if (!pendingRegistration || !suppliedAttribution.trim()) return;
		try {
			const entry = await registerUserReferenceEdition({
				...pendingRegistration,
				attribution: suppliedAttribution,
			});
			pendingRegistration = null;
			suppliedAttribution = '';
			registrationError = '';
			await refreshCatalog();
			selectedEntryId = entry.id;
			loadedEntryId = '';
		} catch (reason) {
			registrationError = reason instanceof Error ? reason.message : String(reason);
		}
	}

	async function removeSelectedEdition() {
		if (selectedEntry?.source !== 'user') return;
		await removeUserReferenceEdition(selectedEntry);
		await refreshCatalog();
	}

	async function loadAvailableReferenceEdition(entry: ReferenceEditionCatalogEntry) {
		if (entry.source === 'bundled') return loadReferenceEdition(entry);
		const xml = await loadUserReferenceEditionXml(entry);
		return parseReferenceEditionInWorker({ xml });
	}

	$effect(() => {
		if (
			!open ||
			restoredTranscriptionId !== transcriptionId ||
			!selectedEntry ||
			loadedEntryId === selectedEntry.id
		)
			return;
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
				loadedEntryId = selectedEntry.id;
				const nextUnits = listUnits(nextSource);
				if (savedPosition?.entryId === selectedEntry.id) {
					levelSelections = normalizeLevelSelections(
						nextUnits,
						savedPosition.levelSelections
					);
					const nextScopedUnits = unitsMatchingEnclosingLevels(
						nextUnits,
						levelSelections
					);
					startPosition = validPosition(savedPosition.startPosition, nextScopedUnits)
						? savedPosition.startPosition
						: null;
					endPosition = validPosition(savedPosition.endPosition, nextScopedUnits)
						? savedPosition.endPosition
						: startPosition;
				} else {
					levelSelections = initialLevelSelections(nextUnits);
				}
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
			rememberPosition();
			return;
		}

		if (position >= startPosition) {
			endPosition = position;
		} else {
			endPosition = startPosition;
			startPosition = position;
		}
		rememberPosition();
	}

	function updateStartPosition(event: Event) {
		const value = Number((event.currentTarget as HTMLSelectElement).value);
		if (!Number.isInteger(value)) return;
		startPosition = value;
		if (endPosition === null || endPosition < value) endPosition = value;
		rememberPosition();
	}

	function updateEndPosition(event: Event) {
		const value = Number((event.currentTarget as HTMLSelectElement).value);
		if (!Number.isInteger(value)) return;
		endPosition = value;
		if (startPosition === null || startPosition > value) startPosition = value;
		rememberPosition();
	}

	function selectLevel(level: LevelKind, value: string) {
		const levelIndex = levels.indexOf(level);
		const nextSelections = { ...levelSelections, [level]: value };
		for (const laterLevel of enclosingLevels.slice(levelIndex + 1)) {
			const firstOption = levelOptionsFor(laterLevel, nextSelections)[0];
			if (firstOption) nextSelections[laterLevel] = firstOption;
			else delete nextSelections[laterLevel];
		}
		levelSelections = nextSelections;
		startPosition = null;
		endPosition = null;
		rememberPosition();
	}

	function levelOptions(level: LevelKind): string[] {
		return levelOptionsFor(level, levelSelections);
	}

	function levelOptionsFor(
		level: LevelKind,
		selections: Partial<Record<LevelKind, string>>
	): string[] {
		const levelIndex = levels.indexOf(level);
		const priorLevels = levels.slice(0, levelIndex);
		return Array.from(
			new Set(
				units
					.filter(unit => matchesLevelSelections(unit, priorLevels, selections))
					.map(unit => getLevelValue(unit.label, level))
					.filter((value): value is string => !!value)
			)
		);
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

	function rememberPosition() {
		if (!transcriptionId) return;
		const position: SavedPosition = {
			entryId: selectedEntryId,
			startPosition,
			endPosition,
			levelSelections: { ...levelSelections },
		};
		savedPosition = position;
		try {
			localStorage.setItem(storageKey(transcriptionId), JSON.stringify(position));
		} catch {
			// Picker state is a convenience; storage failures must not block seeding.
		}
	}

	function getLevels(sourceUnits: ReferenceEditionUnit[]): LevelKind[] {
		const standardLevels = (['book', 'chapter', 'verse'] as const).filter(level =>
			sourceUnits.some(unit => !!unit.label[level])
		);
		return standardLevels.length > 0 ? standardLevels : sourceUnits.length > 0 ? ['unit'] : [];
	}

	function getLevelValue(label: ReferenceEditionUnitLabel, level: LevelKind): string | undefined {
		return level === 'unit' ? label.value || label.unit : label[level];
	}

	function matchesLevelSelections(
		unit: ReferenceEditionUnit,
		levelsToMatch: LevelKind[],
		selections: Partial<Record<LevelKind, string>>
	): boolean {
		return levelsToMatch.every(level => {
			const selected = selections[level];
			return !selected || getLevelValue(unit.label, level) === selected;
		});
	}

	function initialLevelSelections(sourceUnits: ReferenceEditionUnit[]) {
		return normalizeLevelSelections(sourceUnits, {});
	}

	function normalizeLevelSelections(
		sourceUnits: ReferenceEditionUnit[],
		selections: Partial<Record<LevelKind, string>>
	): Partial<Record<LevelKind, string>> {
		const sourceLevels = getLevels(sourceUnits);
		const nextSelections: Partial<Record<LevelKind, string>> = {};
		for (const level of sourceLevels.slice(0, -1)) {
			const priorLevels = sourceLevels.slice(0, sourceLevels.indexOf(level));
			const options = Array.from(
				new Set(
					sourceUnits
						.filter(unit => matchesLevelSelections(unit, priorLevels, nextSelections))
						.map(unit => getLevelValue(unit.label, level))
						.filter((value): value is string => !!value)
				)
			);
			const saved = selections[level];
			const value = saved && options.includes(saved) ? saved : options[0];
			if (value) nextSelections[level] = value;
		}
		return nextSelections;
	}

	function unitsMatchingEnclosingLevels(
		sourceUnits: ReferenceEditionUnit[],
		selections: Partial<Record<LevelKind, string>>
	): ReferenceEditionUnit[] {
		const sourceLevels = getLevels(sourceUnits);
		return sourceUnits.filter(unit =>
			matchesLevelSelections(unit, sourceLevels.slice(0, -1), selections)
		);
	}

	function validPosition(position: number | null, sourceUnits: ReferenceEditionUnit[]) {
		return position !== null && sourceUnits.some(unit => unit.position === position);
	}

	function storageKey(id: string) {
		return `transcription:${id}:reference-edition-picker`;
	}

	function readSavedPosition(id: string): SavedPosition | null {
		if (!id) return null;
		try {
			const value = localStorage.getItem(storageKey(id));
			return value ? (JSON.parse(value) as SavedPosition) : null;
		} catch {
			return null;
		}
	}

	function previewText(items: unknown[]): string {
		return items.map(itemText).join('').replace(/\s+/g, ' ').trim();
	}

	function itemText(value: unknown): string {
		if (!value || typeof value !== 'object') return typeof value === 'string' ? value : '';
		if (Array.isArray(value)) return value.map(itemText).join('');
		const item = value as Record<string, unknown>;
		if (item.type === 'boundary') return ' ';
		if (item.type === 'milestone' || item.type === 'teiMilestone') return '';
		if (typeof item.text === 'string') return item.text;
		if (Array.isArray(item.content)) return item.content.map(itemText).join('');
		if (Array.isArray(item.children)) return item.children.map(itemText).join('');
		if (item.node) return itemText(item.node);
		if (Array.isArray(item.corrections))
			return item.corrections.slice(0, 1).map(itemText).join('');
		return '';
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/35 p-4 sm:items-center"
		data-testid="reference-edition-picker"
	>
		<div
			class="flex max-h-[min(46rem,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-2xl"
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
								<span class="block text-sm font-semibold">
									{entry.title}
									{#if entry.source === 'user'}
										<span class="badge badge-ghost badge-xs ml-1">Yours</span>
									{/if}
								</span>
								<span class="mt-1 block text-xs text-base-content/65"
									>{entry.attribution}</span
								>
							</button>
						{/each}
					</div>
					<label class="btn btn-sm btn-outline w-full">
						{catalogLoading ? 'Loading...' : 'Add edition file'}
						<input
							type="file"
							accept=".xml,.tei,text/xml,application/xml"
							class="sr-only"
							onchange={addEdition}
						/>
					</label>
					{#if selectedEntry?.source === 'user'}
						<button
							type="button"
							class="btn btn-sm btn-ghost w-full"
							onclick={removeSelectedEdition}
						>
							Remove from this device
						</button>
					{/if}
					{#if missingEditionIds.length > 0}
						<div
							class="rounded-box border border-info/40 bg-info/10 p-3 text-xs"
							data-testid="missing-reference-edition"
						>
							This edition is not on this device. Add the edition file to seed from it
							again.
						</div>
					{/if}
					{#if pendingRegistration}
						<div class="space-y-2 rounded-box border border-base-300 p-3">
							<label class="form-control">
								<span class="label-text text-xs">Attribution</span>
								<input
									class="input input-sm input-bordered"
									bind:value={suppliedAttribution}
									placeholder="Edition and licence"
								/>
							</label>
							<button
								type="button"
								class="btn btn-sm btn-primary w-full"
								disabled={!suppliedAttribution.trim()}
								onclick={finishRegistration}>Add edition</button
							>
						</div>
					{/if}
					{#if registrationError}
						<div class="alert alert-error py-2 text-xs" role="alert">
							{registrationError}
						</div>
					{/if}
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
						{#if enclosingLevels.length > 0}
							<div class="grid gap-3 sm:grid-cols-2">
								{#each enclosingLevels as level (level)}
									<label class="select select-sm w-full">
										<span class="label capitalize">{level}</span>
										<select
											data-testid={`reference-edition-level-${level}`}
											value={levelSelections[level] || ''}
											onchange={event =>
												selectLevel(
													level,
													(event.currentTarget as HTMLSelectElement).value
												)}
										>
											{#each levelOptions(level) as value (value)}
												<option {value}>{value}</option>
											{/each}
										</select>
									</label>
								{/each}
							</div>
						{/if}

						<div class="grid min-h-0 gap-3 sm:grid-cols-2">
							<label class="select select-sm w-full">
								<span class="label">Start unit</span>
								<select
									data-testid="reference-edition-start"
									value={startPosition ?? ''}
									onchange={updateStartPosition}
								>
									<option value="" disabled>Choose a start</option>
									{#each scopedUnits as unit (unit.position)}
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
									{#each scopedUnits as unit (unit.position)}
										<option value={unit.position}
											>{formatUnitLabel(unit)}</option
										>
									{/each}
								</select>
							</label>
						</div>

						<div
							class="min-h-0 flex-1 overflow-y-auto rounded-box border border-base-300"
							data-testid={`reference-edition-level-${finalLevel || 'unit'}`}
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

						<div class="rounded-box border border-base-300 bg-base-200/35 p-3">
							<h3
								class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/60"
							>
								Preview
							</h3>
							<div
								class="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap font-serif text-sm leading-relaxed"
								data-testid="reference-edition-preview"
							>
								{preview || 'Select a range to preview its text.'}
							</div>
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
