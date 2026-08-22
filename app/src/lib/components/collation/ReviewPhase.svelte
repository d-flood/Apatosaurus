<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		ApparatusExportError,
		exportApparatusTei,
		type ApparatusExportRefusal,
		type ApparatusTeiExportInput,
		type ApparatusTeiUnit,
	} from '$lib/client/collation/collation-tei';
	import { renderApparatusUnit } from '$lib/client/collation/collation-apparatus';
	import { collationState } from '$lib/client/collation/collation-state.svelte';
	import { layoutLocalStemma } from '$lib/client/collation/collation-stemma-layout';
	import { variationUnitId } from '$lib/client/collation/collation-unit-id';
	import { findReadingTypeDefinition } from '$lib/client/collation/reading-types';

	type WorklistEntry = {
		unitIndex?: number;
	title: string;
	detail: string;
	phase: 'alignment' | 'readings' | 'stemma';
	untranscribedWitnessIds?: string[];
	untranscribedLocation?: string;
	};

	let {
		canCommitVersion,
		commitDisabledReason,
		commitInFlight,
		isCommitFormOpen,
		commitMessage,
		commitError,
		commitSuccess,
		onOpenCommitForm,
		onCloseCommitForm,
		onCommitVersion,
		onCommitMessage,
	}: {
		canCommitVersion: boolean;
		commitDisabledReason: string;
		commitInFlight: boolean;
		isCommitFormOpen: boolean;
		commitMessage: string;
		commitError: string | null;
		commitSuccess: string | null;
		onOpenCommitForm: () => void;
		onCloseCommitForm: () => void;
		onCommitVersion: (event: SubmitEvent) => void;
		onCommitMessage: (message: string) => void;
	} = $props();

	let segments = $derived(collationState.getSegmentSequence());
	let unitSegments = $derived(segments.filter(segment => segment.kind === 'unit'));
	let vocabulary = $derived(collationState.getReadingTypeVocabulary());
	let divergence = $derived(collationState.getLemmaDivergence());
	let exportRefusals = $state<ApparatusExportRefusal[]>([]);
	let exportError = $state<string | null>(null);

	let stemmata = $derived.by(() =>
		unitSegments.map(segment => {
			const stemma = collationState.getLocalStemma(segment.span.startIndex);
			return { segment, stemma, layout: layoutLocalStemma(stemma.nodes) };
		})
	);

	let worklist = $derived.by<WorklistEntry[]>(() => {
		const entries: WorklistEntry[] = [];
		const activeWitnessIds = new Set(
			collationState.witnesses
				.filter(witness => !witness.isExcluded)
				.map(witness => witness.witnessId)
		);
		for (const unit of collationState.getUnitsNeedingLemmaDecision()) {
			entries.push({
				unitIndex: unit.unitIndex,
				title: 'Establish a lemma reading',
				detail: 'The base text does not testify here.',
				phase: 'readings',
			});
		}
		for (const unit of collationState.getSubreadingsMissingReadingType()) {
			entries.push({
				unitIndex: unit.unitIndex,
				title: 'Review subreading type',
				detail: `${unit.readingIds.length} subreading${unit.readingIds.length === 1 ? '' : 's'} has no type.`,
				phase: 'readings',
			});
		}
		for (const segment of unitSegments) {
			const unitIndex = segment.span.startIndex;
			for (const orphan of collationState.getOrphanedDecisionsForUnit(unitIndex)) {
				entries.push({
					unitIndex,
					title: 'Resolve orphaned reading decision',
					detail: `A saved ${orphan.kind === 'sourceArc' ? 'source' : orphan.kind} decision refers to a reading that is no longer in this variation unit.`,
					phase:
						orphan.kind === 'sourceArc' || orphan.kind === 'sourceDecision'
							? 'stemma'
							: 'readings',
				});
			}
			const witnessIds = segment.untranscribedWitnessIds.filter(witnessId =>
				activeWitnessIds.has(witnessId)
			);
			if (witnessIds.length > 0) {
				entries.push({
					unitIndex,
					title: 'Finish transcribing witnesses',
					detail: `${witnessIds.map(siglumOf).join(', ')} ${witnessIds.length === 1 ? 'is' : 'are'} untranscribed at variation unit ${segment.label}.`,
					phase: 'readings',
					untranscribedWitnessIds: witnessIds,
					untranscribedLocation: `variation unit ${segment.label}`,
				});
			}
			const stemma = collationState.getLocalStemma(unitIndex);
			if (
				stemma.nodes.some(node => !node.isRoot && node.sourceDecision.kind === 'undecided')
			) {
				entries.push({
					unitIndex,
					title: 'Set reading sources',
					detail: 'At least one reading source is undecided.',
					phase: 'stemma',
				});
			}
		}
		for (const segment of segments) {
			if (segment.kind !== 'agreed') continue;
			const witnessIds = segment.untranscribedWitnessIds.filter(witnessId =>
				activeWitnessIds.has(witnessId)
			);
			if (witnessIds.length === 0) continue;
			entries.push({
				title: 'Finish transcribing witnesses',
				detail: `${witnessIds.map(siglumOf).join(', ')} ${witnessIds.length === 1 ? 'is' : 'are'} untranscribed in agreed text ${segment.label}. No variation unit is responsible.`,
				phase: 'alignment',
				untranscribedWitnessIds: witnessIds,
				untranscribedLocation: `agreed text ${segment.label}`,
			});
		}
		for (const unit of collationState.getStemmaViolations()) {
			entries.push({
				unitIndex: unit.unitIndex,
				title: 'Resolve local stemma warning',
				detail: `${unit.violations.length} recorded stemma contradiction${unit.violations.length === 1 ? '' : 's'}.`,
				phase: 'stemma',
			});
		}
		for (const orphan of collationState.getOrphanedUnitDecisions()) {
			entries.push({
				title: 'Review vanished variation unit',
				detail: `Saved decisions remain for ${orphan.unitId}, but that variation unit no longer exists. Review the alignment to restore it before resolving those decisions.`,
				phase: 'alignment',
			});
		}
		return entries;
	});

	function siglumOf(witnessId: string): string {
		return (
			collationState.witnesses.find(witness => witness.witnessId === witnessId)?.siglum ??
			witnessId
		);
	}

	function transcriptionHref(witnessId: string): string | null {
		const transcriptionId = collationState.witnesses.find(
			witness => witness.witnessId === witnessId
		)?.transcriptionId;
		if (!transcriptionId) return null;
		const path = `/transcription/${encodeURIComponent(transcriptionId)}`;
		const verse = collationState.selectedVerse;
		if (!verse?.book || !verse.chapter || !verse.verse) return path;
		const params = new URLSearchParams({
			book: verse.book,
			chapter: verse.chapter,
			verse: verse.verse,
		});
		return `${path}?${params.toString()}`;
	}

	function setupHref(): string {
		if (!collationState.collationId) return '#';
		return resolve('/collation/[id]/[phase]', {
			id: collationState.collationId,
			phase: 'setup',
		});
	}

	function unitLabel(unitIndex: number): string {
		return (
			unitSegments.find(segment => segment.span.startIndex === unitIndex)?.label ??
			String(unitIndex + 1)
		);
	}

	async function openUnit(entry: WorklistEntry) {
		if (!collationState.collationId) return;
		if (entry.unitIndex !== undefined) collationState.selectedUnitIndex = entry.unitIndex;
		await goto(
			resolve('/collation/[id]/[phase]', {
				id: collationState.collationId,
				phase: entry.phase,
			}),
			{ replaceState: true }
		);
	}

	function buildExportInput(): ApparatusTeiExportInput {
		const sharedSegments = collationState.getSegmentSequence();
		const units = new Map<string, ApparatusTeiUnit>();
		for (const segment of sharedSegments) {
			if (segment.kind !== 'unit') continue;
			const unitId = variationUnitId(segment.span.columnIds[0]);
			units.set(unitId, {
				view: collationState.peekUnitView(segment.span.startIndex),
				nonAttestation: collationState.getNonAttestationForUnit(segment.span.startIndex),
				stemma: collationState.getLocalStemma(segment.span.startIndex),
				connectivity: collationState.getConnectivity(segment.span.startIndex),
				recordedReadingTypeIds: Object.keys(
					collationState.unitDecisions.get(unitId)?.readingType ?? {}
				),
			});
		}
		return {
			title: collationState.projectName
				? `${collationState.projectName} Collation`
				: 'Apatosaurus Collation',
			segmentName: collationState.segment?.name ?? 'Collation',
			witnesses: collationState.witnesses,
			baseTextWitnessId: collationState.getBaseTextWitnessId(),
			segments: sharedSegments,
			units,
		};
	}

	function downloadExport() {
		try {
			const xml = exportApparatusTei(buildExportInput());
			exportRefusals = [];
			exportError = null;
			const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
			const link = document.createElement('a');
			link.href = url;
			link.download = `${collationState.segment?.name || 'collation'}-apparatus.xml`;
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(url);
		} catch (error) {
			if (error instanceof ApparatusExportError) {
				exportRefusals = error.refusals;
				exportError = null;
				return;
			}
			exportRefusals = [];
			exportError =
				error instanceof Error ? error.message : 'The apparatus could not be exported.';
		}
	}

	function exportRefusalPhase(
		refusal: ApparatusExportRefusal
	): 'alignment' | 'readings' | 'stemma' {
		if (!refusal.unitId) return 'alignment';
		return refusal.kind === 'undecided-source' ? 'stemma' : 'readings';
	}

	function exportRefusalHref(refusal: ApparatusExportRefusal): string {
		if (!collationState.collationId) return '#';
		return resolve('/collation/[id]/[phase]', {
			id: collationState.collationId,
			phase: exportRefusalPhase(refusal),
		});
	}

	function selectExportRefusal(refusal: ApparatusExportRefusal) {
		if (!refusal.unitId) return;
		const unitIndex = unitSegments.find(
			segment => variationUnitId(segment.span.columnIds[0]) === refusal.unitId
		)?.span.startIndex;
		if (unitIndex !== undefined) collationState.selectedUnitIndex = unitIndex;
	}

	function refusalWitnesses(refusal: ApparatusExportRefusal): string {
		return (refusal.witnessIds ?? []).map(siglumOf).join(', ');
	}
</script>

<div class="h-full overflow-auto">
	<div class="mx-auto max-w-7xl space-y-6 pb-8">
		<section class="rounded-xl border border-base-300/60 bg-base-100 p-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 class="font-serif text-xl font-bold tracking-tight">Review</h2>
					<p class="mt-1 text-sm text-base-content/60">
						Review the apparatus, settle outstanding decisions, then export or commit a
						version.
					</p>
				</div>
				<button type="button" class="btn btn-primary btn-sm" onclick={downloadExport}>
					Export TEI apparatus
				</button>
			</div>
			{#if exportError}
				<p class="mt-3 text-sm text-error" role="alert">{exportError}</p>
			{/if}
			{#if exportRefusals.length > 0}
				<div
					class="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3"
					role="alert"
				>
					<p class="text-sm font-medium">Export needs more editorial decisions.</p>
					<ul class="mt-2 space-y-1">
						{#each exportRefusals as refusal (`${refusal.kind}-${refusal.unitId ?? refusal.label}`)}
							<li>
								{#if refusal.unitId}
									<a
										href={exportRefusalHref(refusal)}
										class="link link-hover text-left text-sm"
										onclick={() => selectExportRefusal(refusal)}
									>
										Unit {refusal.label}:
										{refusal.kind === 'undecided-source'
											? ' set every reading source'
											: refusal.kind === 'untranscribed-witness'
												? ` finish transcribing ${refusalWitnesses(refusal)}`
												: ' establish a lemma reading'}
									</a>
							{:else}
									<a
										href={exportRefusalHref(refusal)}
										class="link link-hover text-left text-sm"
									>
										Agreed text {refusal.label}: review untranscribed witness coverage
										({refusalWitnesses(refusal)}) in Alignment before export. This agreed-text
										refusal has no variation unit.
									</a>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</section>

		<section aria-labelledby="verse-apparatus-heading">
			<h3
				id="verse-apparatus-heading"
				class="mb-2 text-sm font-bold uppercase tracking-wider text-base-content/50"
			>
				Verse apparatus
			</h3>
			<div
				class="space-y-2 rounded-xl border border-base-300/60 bg-base-100 p-4 font-greek text-sm leading-relaxed"
			>
				{#each segments as segment (segment.kind === 'unit' ? `unit-${segment.span.startIndex}` : segment.columnIds.join('+'))}
					{#if segment.kind === 'agreed'}
						<span class="select-text text-base-content/70">{segment.text}</span>
					{:else}
						{@const notation = renderApparatusUnit(
							collationState.peekUnitView(segment.span.startIndex),
							{
								label: segment.label,
								siglumOf,
								nonAttestation: collationState.getNonAttestationForUnit(
									segment.span.startIndex
								),
								readingTypeLabelOf: readingType =>
									findReadingTypeDefinition(vocabulary, readingType)?.label ??
									readingType,
							}
						)}
						<p class="select-text rounded bg-base-200/50 px-2 py-1">{notation}</p>
					{/if}
				{/each}
			</div>
		</section>

		<section aria-labelledby="local-stemmata-heading">
			<h3
				id="local-stemmata-heading"
				class="mb-2 text-sm font-bold uppercase tracking-wider text-base-content/50"
			>
				Local stemmata
			</h3>
			<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
				{#each stemmata as item (item.segment.span.startIndex)}
					<article class="rounded-xl border border-base-300/60 bg-base-100 p-3">
						<h4 class="font-mono text-xs text-base-content/60">
							Unit {item.segment.label}
						</h4>
						{#if item.layout.nodes.length === 0}
							<p class="mt-3 text-sm text-base-content/40">No readings.</p>
						{:else}
							<svg
								viewBox="0 0 {item.layout.bounds.width} {item.layout.bounds.height}"
								class="mt-2 h-40 w-full"
								aria-label="Local stemma for unit {item.segment.label}"
								role="img"
							>
								{#each item.layout.arcs as arc (arc.id)}
									<path
										d={arc.path}
										fill="none"
										stroke="currentColor"
										class="text-base-content/40"
										stroke-width="2"
									/>
								{/each}
								{#each item.layout.nodes as node (node.id)}
									<rect
										x={node.x}
										y={node.y}
										width={node.width}
										height={node.height}
										rx="4"
										class="fill-base-200 stroke-base-content/40"
									/>
									<text
										x={node.x + 8}
										y={node.y + 18}
										class="fill-base-content text-[12px] font-mono"
										>{item.stemma.nodes.find(
											entry => entry.readingId === node.id
										)?.label}</text
									>
								{/each}
							</svg>
						{/if}
					</article>
				{/each}
			</div>
		</section>

		<section class="grid gap-4 lg:grid-cols-2">
			<div class="rounded-xl border border-base-300/60 bg-base-100 p-4">
				<h3 class="text-sm font-bold uppercase tracking-wider text-base-content/50">
					Divergence report
				</h3>
				{#if divergence.length === 0}
					<p class="mt-3 text-sm text-base-content/50">
						Every established lemma agrees with the base text.
					</p>
				{:else}
					<ul class="mt-3 space-y-2">
						{#each divergence as entry (entry.unitId)}
							<li class="text-sm">
								Unit {unitLabel(entry.unitIndex)}: established lemma differs from
								the base-text reading.
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			<div class="rounded-xl border border-base-300/60 bg-base-100 p-4">
				<h3 class="text-sm font-bold uppercase tracking-wider text-base-content/50">
					Decision worklist
				</h3>
				{#if worklist.length === 0}
					<p class="mt-3 text-sm text-success">No unresolved decisions.</p>
				{:else}
					<ul class="mt-3 space-y-2">
						{#each worklist as entry, index (`${entry.unitIndex ?? 'vanished'}-${entry.title}-${index}`)}
							<li>
								{#if entry.unitIndex === undefined && entry.untranscribedLocation}
									<p class="text-sm">{entry.untranscribedLocation}: {entry.title}</p>
								{:else}
									<button
										type="button"
										class="link link-hover text-left text-sm"
										onclick={() => openUnit(entry)}
									>
										{entry.unitIndex === undefined
											? ''
											: `Unit ${unitLabel(entry.unitIndex)}: `}{entry.title}
									</button>
								{/if}
								<p class="text-xs text-base-content/55">{entry.detail}</p>
								{#if entry.untranscribedWitnessIds && entry.untranscribedLocation}
									<div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
										{#each entry.untranscribedWitnessIds as witnessId (witnessId)}
											{@const href = transcriptionHref(witnessId)}
											{#if href}
												<a class="link link-hover" {href}
													>Open {siglumOf(witnessId)} transcription for {entry.untranscribedLocation}</a
												>
											{/if}
											<a class="link link-hover" href={setupHref()}
												>Exclude {siglumOf(witnessId)} in Setup</a
											>
										{/each}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</section>

		<section class="rounded-xl border border-base-300/60 bg-base-100 p-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h3 class="text-sm font-bold uppercase tracking-wider text-base-content/50">
						Version
					</h3>
					<p class="mt-1 text-sm text-base-content/60">
						Record this reviewed collation as a local version.
					</p>
				</div>
				<button
					type="button"
					class="btn btn-secondary btn-sm"
					disabled={!canCommitVersion}
					title={commitDisabledReason}
					onclick={onOpenCommitForm}
				>
					{commitInFlight ? 'Committing...' : 'Commit version'}
				</button>
			</div>
			{#if isCommitFormOpen}
				<form class="mt-4 space-y-2" onsubmit={onCommitVersion}>
					<div class="flex items-center justify-between gap-3">
						<p class="text-xs font-semibold uppercase tracking-[0.14em] opacity-70">
							Commit collation version
						</p>
						<div class="flex gap-2">
							<button
								type="button"
								class="btn btn-sm btn-ghost"
								disabled={commitInFlight}
								onclick={onCloseCommitForm}>Cancel</button
							>
							<button
								type="submit"
								class="btn btn-sm btn-primary"
								disabled={commitInFlight}
								>{commitInFlight ? 'Committing...' : 'Commit version'}</button
							>
						</div>
					</div>
					<fieldset class="fieldset p-0">
						<legend
							class="fieldset-legend text-xs uppercase tracking-[0.14em] opacity-70"
							>Version note</legend
						>
						<textarea
							value={commitMessage}
							class="textarea textarea-sm min-h-20 w-full"
							placeholder="Describe this version"
							disabled={commitInFlight}
							oninput={event => onCommitMessage(event.currentTarget.value)}
						></textarea>
						<p class="label text-xs">Optional note for this local version.</p>
					</fieldset>
					{#if commitError}<p class="text-sm text-error" role="alert">
							{commitError}
						</p>{/if}
				</form>
			{/if}
			{#if commitSuccess}<p class="mt-3 text-sm text-success">{commitSuccess}</p>{/if}
		</section>
	</div>
</div>
