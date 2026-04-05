<script lang="ts">
	import type { IgntpCatalog, IgntpCatalogEntry } from '$lib/igntp/types';

	interface Props {
		catalog: IgntpCatalog;
		importedKeys?: string[];
		isImporting?: boolean;
		onImport: (paths: string[]) => void | Promise<void>;
	}

	let { catalog, importedKeys = [], isImporting = false, onImport }: Props = $props();
	let query = $state('');
	let selectedPaths = $state<string[]>([]);

	const importedKeySet = $derived(new Set(importedKeys));
	const allEntries = $derived(catalog.groups.flatMap(group => group.entries));
	const entryByPath = $derived(new Map(allEntries.map(entry => [entry.path, entry])));
	const selectedPathSet = $derived(new Set(selectedPaths));
	const totalEntryCount = $derived(allEntries.length);
	const duplicateEntryCount = $derived(
		allEntries.filter(entry => importedKeySet.has(entry.duplicateKey)).length
	);
	const unsupportedEntryCount = $derived(allEntries.filter(entry => !entry.isSupported).length);
	const filteredGroups = $derived.by(() =>
		catalog.groups
			.map(group => ({
				...group,
				entries: group.entries.filter(entry => matchesQuery(entry, query)),
			}))
			.filter(group => group.entries.length > 0)
	);

	$effect(() => {
		const nextSelection = selectedPaths.filter(path => {
			const entry = entryByPath.get(path);
			return entry ? isImportable(entry) : false;
		});

		if (nextSelection.length !== selectedPaths.length) {
			selectedPaths = nextSelection;
		}
	});

	function matchesQuery(entry: IgntpCatalogEntry, value: string): boolean {
		const trimmed = value.trim().toLocaleLowerCase();
		if (!trimmed) return true;
		return [entry.fileName, entry.siglum, entry.title].some(field =>
			field.toLocaleLowerCase().includes(trimmed)
		);
	}

	function isAlreadyImported(entry: IgntpCatalogEntry): boolean {
		return importedKeySet.has(entry.duplicateKey);
	}

	function isImportable(entry: IgntpCatalogEntry): boolean {
		return entry.isSupported && !isAlreadyImported(entry);
	}

	function isSelected(path: string): boolean {
		return selectedPathSet.has(path);
	}

	function toggleEntry(path: string, checked: boolean) {
		if (checked) {
			if (!selectedPathSet.has(path)) {
				selectedPaths = [...selectedPaths, path];
			}
			return;
		}

		selectedPaths = selectedPaths.filter(selectedPath => selectedPath !== path);
	}

	function selectEntries(entries: IgntpCatalogEntry[]) {
		const nextSelection = new Set(selectedPaths);
		for (const entry of entries) {
			if (isImportable(entry)) {
				nextSelection.add(entry.path);
			}
		}
		selectedPaths = Array.from(nextSelection);
	}

	function clearEntries(entries: IgntpCatalogEntry[]) {
		const pathsToClear = new Set(entries.map(entry => entry.path));
		selectedPaths = selectedPaths.filter(path => !pathsToClear.has(path));
	}

	async function handleImport() {
		if (isImporting || selectedPaths.length === 0) return;
		await onImport(selectedPaths);
	}
</script>

<section
	class="rounded-[1.75rem] flex flex-col h-full border border-base-300 bg-linear-to-br from-base-100 via-base-100 to-base-200/70 p-5 shadow-sm space-y-5 overflow-hidden"
>
	<div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between shrink-0">
		<div class="space-y-2">
			<div
				class="inline-flex items-center gap-2 rounded-full border border-base-300 bg-base-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-base-content/70"
			>
				<span class="h-2 w-2 rounded-full bg-success"></span>
				Provided IGNTP TEI
			</div>
			<div>
				<h2 class="font-serif text-2xl font-semibold">Import Provided Transcriptions</h2>
				<p class="max-w-3xl text-sm text-base-content/70">
					Browse the bundled IGNTP TEI corpus by subdirectory, then import one or more
					witnesses directly into your local transcription library.
				</p>
			</div>
		</div>
		<div class="grid grid-cols-2 gap-2 text-center text-sm md:grid-cols-4">
			<div class="rounded-2xl border border-base-300 bg-base-100 px-3 py-2">
				<div class="text-lg font-semibold">{totalEntryCount}</div>
				<div class="text-base-content/60">Provided</div>
			</div>
			<div class="rounded-2xl border border-base-300 bg-base-100 px-3 py-2">
				<div class="text-lg font-semibold">{duplicateEntryCount}</div>
				<div class="text-base-content/60">Already Imported</div>
			</div>
			<div class="rounded-2xl border border-base-300 bg-base-100 px-3 py-2">
				<div class="text-lg font-semibold">{unsupportedEntryCount}</div>
				<div class="text-base-content/60">Unsupported</div>
			</div>
			<div class="rounded-2xl border border-base-300 bg-base-100 px-3 py-2">
				<div class="text-lg font-semibold">{selectedPaths.length}</div>
				<div class="text-base-content/60">Selected</div>
			</div>
		</div>
	</div>

	<label class="input w-full rounded-2xl border-base-300 bg-base-100 shrink-0">
		<span class="label font-semibold">Search</span>
		<input
			type="search"
			class="grow"
			placeholder="Filter by file name, siglum, or title"
			aria-label="Search provided transcriptions"
			bind:value={query}
		/>
	</label>

	{#if filteredGroups.length === 0}
		<div
			class="rounded-2xl border border-dashed border-base-300 bg-base-100 px-4 py-8 text-center text-sm text-base-content/60 flex-1 min-h-0"
		>
			No provided transcriptions match this filter.
		</div>
	{:else}
		<div class="space-y-4 overflow-y-auto flex-1 min-h-0 pr-2">
			{#each filteredGroups as group (group.name)}
				<section class="rounded-3xl border border-base-300 bg-base-100/90 p-4 space-y-3">
					<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
						<div>
							<div
								class="text-xs font-semibold uppercase tracking-[0.22em] text-base-content/50"
							>
								Directory
							</div>
							<h3 class="font-serif text-xl font-semibold break-all">{group.name}</h3>
							<p class="text-sm text-base-content/60">
								{group.entries.length} visible TEI file(s)
							</p>
						</div>
						<div class="flex flex-wrap gap-2">
							<button
								type="button"
								class="btn btn-sm rounded-full"
								disabled={isImporting}
								onclick={() => selectEntries(group.entries)}
							>
								Select Visible
							</button>
							<button
								type="button"
								class="btn btn-sm btn-ghost rounded-full"
								disabled={isImporting}
								onclick={() => clearEntries(group.entries)}
							>
								Clear Group
							</button>
						</div>
					</div>

					<div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
						{#each group.entries as entry (entry.path)}
							<label
								class="flex min-h-28 cursor-pointer gap-3 rounded-[1.25rem] border px-3 py-3 transition {!entry.isSupported
									? 'border-warning/40 bg-warning/10 text-base-content/75'
									: isAlreadyImported(entry)
										? 'border-success/40 bg-success/5 text-base-content/70'
										: isSelected(entry.path)
											? 'border-primary bg-primary/10 shadow-sm'
											: 'border-base-300 bg-base-100 hover:border-base-content/20'}"
							>
								<input
									type="checkbox"
									class="checkbox checkbox-sm mt-1"
									checked={isSelected(entry.path)}
									disabled={isImporting || !isImportable(entry)}
									aria-label={entry.fileName}
									onchange={event =>
										toggleEntry(
											entry.path,
											(event.currentTarget as HTMLInputElement).checked
										)}
								/>
								<div class="min-w-0 flex-1 space-y-2">
									<div class="flex flex-wrap items-center gap-2">
										<span class="badge badge-outline badge-sm"
											>{entry.fileName}</span
										>
										{#if entry.siglum}
											<span class="badge badge-neutral badge-sm"
												>{entry.siglum}</span
											>
										{/if}
										{#if isAlreadyImported(entry)}
											<span class="badge badge-success badge-sm"
												>Already Imported</span
											>
										{/if}
										{#if !entry.isSupported}
											<span class="badge badge-warning badge-sm"
												>Unsupported</span
											>
										{/if}
									</div>
									<div class="font-semibold leading-snug line-clamp-2">
										{entry.title}
									</div>
									<div
										class="text-xs uppercase tracking-[0.18em] text-base-content/50 break-all"
									>
										/{entry.directory}
									</div>
									{#if !entry.isSupported && entry.unsupportedReason}
										<div class="text-xs text-base-content/65 line-clamp-2">
											{entry.unsupportedReason}
										</div>
									{/if}
								</div>
							</label>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}

	<div
		class="flex flex-col gap-3 border-t border-base-300/80 pt-4 md:flex-row md:items-center md:justify-between shrink-0"
	>
		<p class="text-sm text-base-content/65">
			Already imported and unsupported witnesses stay visible but cannot be selected.
		</p>
		<button
			type="button"
			class="btn btn-primary rounded-full px-6"
			disabled={isImporting || selectedPaths.length === 0}
			onclick={handleImport}
		>
			{isImporting ? 'Importing…' : `Import Selected (${selectedPaths.length})`}
		</button>
	</div>
</section>
