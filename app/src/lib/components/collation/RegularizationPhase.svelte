<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		collationState,
	} from '$lib/client/collation/collation-state.svelte';
	import type {
		RegularizationRule,
		RegularizationType,
		RuleScope,
	} from '$lib/client/collation/collation-types';
	import { runCollationInWorker } from '$lib/client/collation/collation-service';
	import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
	import Plus from 'phosphor-svelte/lib/Plus';
	import Trash from 'phosphor-svelte/lib/Trash';
	import ToggleLeft from 'phosphor-svelte/lib/ToggleLeft';
	import ToggleRight from 'phosphor-svelte/lib/ToggleRight';
	import Lightning from 'phosphor-svelte/lib/Lightning';
	import ArrowClockwise from 'phosphor-svelte/lib/ArrowClockwise';

	let newPattern = $state('');
	let newReplacement = $state('');
	let newScope = $state<RuleScope>('verse');
	let newDescription = $state('');
	let newType = $state<RegularizationType>('none');
	let isCollating = $state(false);
	let isRefreshing = $state(false);
	let collationError = $state<string | null>(null);

	let activeWitnesses = $derived(collationState.witnesses.filter((w) => !w.isExcluded));

	function addRule() {
		if (!newPattern.trim()) return;
		const rule: RegularizationRule = {
			id: crypto.randomUUID(),
			pattern: newPattern,
			replacement: newReplacement,
			scope: newScope,
			description: newDescription || `${newPattern} -> ${newReplacement}`,
			enabled: true,
			type: newType,
		};
		collationState.addRule(rule);
		collationState.applyRegularization();
		newPattern = '';
		newReplacement = '';
		newDescription = '';
		newType = 'none';
	}

	function getDisplayTokens(
		witnessId: string,
	): Array<{
			original: string;
			originalSegments: Array<{ text: string; hasUnclear: boolean }>;
			regularized: string;
			changed: boolean;
		}> {
		const tokens = collationState.regularizedTexts.get(witnessId);
		if (!tokens) {
			const w = collationState.witnesses.find((w) => w.witnessId === witnessId);
			if (!w) return [];
			return w.content.split(/\s+/).filter(Boolean).map((t) => ({
				original: t,
				originalSegments: [{ text: t, hasUnclear: false }],
				regularized: t,
				changed: false,
			}));
		}
		return tokens.map((t) => ({
			original: t.original,
			originalSegments:
				t.originalSegments?.map((segment) => ({
					text: segment.text,
					hasUnclear: segment.hasUnclear,
				})) ?? [{ text: t.original, hasUnclear: false }],
			regularized: t.regularized ?? t.original,
			changed: t.original !== (t.regularized ?? t.original),
		}));
	}

	async function runCollation() {
		if (collationState.alignmentColumns.length > 0) {
			const shouldContinue = window.confirm(
				'This collation already has alignment data. Running collation again may undo manual alignments. Continue?',
			);
			if (!shouldContinue) return;
		}

		isCollating = true;
		collationError = null;
		try {
			const witnesses = collationState.buildCollationWitnessInputs();
			const result = await runCollationInWorker({
				witnesses,
				options: { segmentation: collationState.segmentation },
			});
			collationState.setAlignmentSnapshot(result.snapshot);
			collationState.nextPhase();
			if (collationState.collationId) {
				await goto(`/collation/${collationState.collationId}/alignment`, { replaceState: true });
			}
		} catch (err) {
			collationError = err instanceof Error ? err.message : 'Collation failed';
		} finally {
			isCollating = false;
		}
	}

	async function refreshWitnesses() {
		isRefreshing = true;
		collationError = null;
		try {
			await collationState.refreshWitnessesFromSource();
		} catch (err) {
			collationError = err instanceof Error ? err.message : 'Witness refresh failed';
		} finally {
			isRefreshing = false;
		}
	}

	$effect(() => {
		// Re-apply regularization when rules change
		if (collationState.rules.length >= 0) {
			collationState.applyRegularization();
		}
	});
</script>

<div class="flex flex-col lg:flex-row gap-6 h-full">
	<!-- Main View: Text Streams -->
	<div class="flex-1 min-w-0 overflow-y-auto">
		<h2 class="text-lg font-serif font-bold mb-4 text-base-content/90 tracking-tight">
			Witness Texts
		</h2>

		{#if activeWitnesses.length === 0}
			<div class="alert alert-warning">No active witnesses.</div>
		{:else}
			<div class="space-y-4">
				{#each activeWitnesses as witness (witness.witnessId)}
					{@const tokens = getDisplayTokens(witness.witnessId)}
					<div class="bg-base-200/50 rounded-box p-4 border border-base-300/50">
						<div class="font-mono text-xs font-bold text-base-content/50 mb-2 tracking-wider uppercase">
							{witness.siglum}
						</div>
						<div class="font-greek text-base leading-relaxed flex flex-wrap gap-x-1.5 gap-y-0.5 show-unclear">
							{#each tokens as token}
								{#if token.changed}
									<span class="inline-flex items-baseline gap-0.5">
										<span class="line-through text-error/70 text-sm whitespace-pre">
											{#each token.originalSegments as segment}
												<span class:unclear={segment.hasUnclear}>{segment.text}</span>
											{/each}
										</span>
										<span class="text-success font-medium">{token.regularized}</span>
									</span>
								{:else}
									<span class="whitespace-pre">
										{#each token.originalSegments as segment}
											<span class:unclear={segment.hasUnclear}>{segment.text}</span>
										{/each}
									</span>
								{/if}
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if collationError}
			<div class="alert alert-error mt-4 text-sm">{collationError}</div>
		{/if}

		<div class="mt-6 flex items-center justify-between gap-3">
			<a
				class="btn btn-ghost gap-2"
				href={collationState.collationId ? `/collation/${collationState.collationId}/setup` : '#'}
				aria-disabled={!collationState.collationId}
				tabindex={collationState.collationId ? 0 : -1}
				onclick={(e) => {
					if (!collationState.collationId) e.preventDefault();
				}}
			>
				<ArrowLeft size={18} />
				Back to Setup
			</a>
			<div class="flex items-center gap-2">
				<button
					type="button"
					class="btn btn-ghost gap-2"
					disabled={isRefreshing}
					onclick={refreshWitnesses}
				>
					{#if isRefreshing}
						<span class="loading loading-spinner loading-sm"></span>
						Refreshing...
					{:else}
						<ArrowClockwise size={18} />
						Refresh Witnesses
					{/if}
				</button>
				<button
					type="button"
					class="btn btn-primary gap-2"
					disabled={isCollating || isRefreshing || activeWitnesses.length < 2}
					onclick={runCollation}
				>
					{#if isCollating}
						<span class="loading loading-spinner loading-sm"></span>
						Running CollateX...
					{:else}
						<Lightning size={18} weight="fill" />
						Run Collation
					{/if}
				</button>
			</div>
		</div>
	</div>

	<!-- Side Panel: Rule Builder -->
	<div class="lg:w-80 shrink-0">
		<div class="sticky top-0 space-y-4">
			<h2 class="text-lg font-serif font-bold text-base-content/90 tracking-tight">
				Regularization Rules
			</h2>

			<!-- Add new rule form -->
			<div class="bg-base-200 rounded-box p-4 space-y-3 border border-base-300/50">
				<div class="text-xs font-bold uppercase tracking-wider text-base-content/50 mb-1">
					New Rule
				</div>
				<label class="form-control w-full">
					<div class="label py-0.5"><span class="label-text text-xs">Pattern (regex)</span></div>
					<input
						type="text"
						class="input input-bordered input-sm w-full font-mono"
						placeholder="e.g. ν(?=\s|$)"
						bind:value={newPattern}
					/>
				</label>
				<label class="form-control w-full">
					<div class="label py-0.5"><span class="label-text text-xs">Replacement</span></div>
					<input
						type="text"
						class="input input-bordered input-sm w-full font-mono"
						placeholder="e.g. (empty for deletion)"
						bind:value={newReplacement}
					/>
				</label>
				<label class="form-control w-full">
					<div class="label py-0.5"><span class="label-text text-xs">Scope</span></div>
					<select class="select select-bordered select-sm w-full" bind:value={newScope}>
						<option value="verse">Verse-Level (local only)</option>
						<option value="project">Project-Level (all collations)</option>
					</select>
				</label>
				<label class="form-control w-full">
					<div class="label py-0.5"><span class="label-text text-xs">Description</span></div>
					<input
						type="text"
						class="input input-bordered input-sm w-full"
						placeholder="Optional note"
						bind:value={newDescription}
					/>
				</label>
				<button
					type="button"
					class="btn btn-sm btn-primary w-full gap-1"
					disabled={!newPattern.trim()}
					onclick={addRule}
				>
					<Plus size={14} />
					Add Rule
				</button>
			</div>

			<!-- Active rules list -->
			{#if collationState.rules.length === 0}
				<div class="text-center text-sm text-base-content/40 py-6">
					No rules defined yet.
				</div>
			{:else}
				<div class="space-y-2">
					{#each collationState.rules as rule (rule.id)}
						<div
							class="bg-base-200/60 rounded-box px-3 py-2.5 border border-base-300/40 flex items-start gap-2 group transition-opacity"
							class:opacity-50={!rule.enabled}
						>
							<button
								type="button"
								class="btn btn-ghost btn-xs btn-circle shrink-0 mt-0.5"
								title={rule.enabled ? 'Disable rule' : 'Enable rule'}
								onclick={() => collationState.toggleRule(rule.id)}
							>
								{#if rule.enabled}
									<ToggleRight size={18} class="text-success" />
								{:else}
									<ToggleLeft size={18} class="text-base-content/40" />
								{/if}
							</button>
							<div class="flex-1 min-w-0">
								<div class="font-mono text-xs truncate">
									<span class="text-error/80">{rule.pattern}</span>
									<span class="text-base-content/30 mx-1">&rarr;</span>
									<span class="text-success/80">{rule.replacement || '(delete)'}</span>
								</div>
								{#if rule.description}
									<div class="text-xs text-base-content/50 truncate mt-0.5">
										{rule.description}
									</div>
								{/if}
								<span class="badge badge-xs mt-1 {rule.scope === 'project' ? 'badge-primary' : 'badge-ghost'}">
									{rule.scope}
								</span>
							</div>
							<button
								type="button"
								class="btn btn-ghost btn-xs btn-circle shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
								title="Remove rule"
								onclick={() => collationState.removeRule(rule.id)}
							>
								<Trash size={14} class="text-error/70" />
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
