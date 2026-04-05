<script lang="ts">
	import type {
		RegularizationRule,
		RegularizationType,
		SuppliedTextMode,
	} from '$lib/client/collation/collation-types';
	import Plus from 'phosphor-svelte/lib/Plus';
	import ToggleLeft from 'phosphor-svelte/lib/ToggleLeft';
	import ToggleRight from 'phosphor-svelte/lib/ToggleRight';
	import Trash from 'phosphor-svelte/lib/Trash';

	let {
		rules,
		lowercase,
		ignoreWordBreaks,
		ignorePunctuation,
		suppliedTextMode,
		segmentation,
		onAddRule,
		onRemoveRule,
		onToggleRule,
		onSetRuleType,
		onSetLowercase,
		onSetIgnoreWordBreaks,
		onSetIgnorePunctuation,
		onSetSuppliedTextMode,
		onSetSegmentation,
	} = $props<{
		rules: RegularizationRule[];
		lowercase: boolean;
		ignoreWordBreaks: boolean;
		ignorePunctuation: boolean;
		suppliedTextMode: SuppliedTextMode;
		segmentation: boolean;
		onAddRule: (rule: RegularizationRule) => void;
		onRemoveRule: (ruleId: string) => void;
		onToggleRule: (ruleId: string) => void;
		onSetRuleType: (ruleId: string, type: RegularizationType) => void;
		onSetLowercase: (value: boolean) => void;
		onSetIgnoreWordBreaks: (value: boolean) => void;
		onSetIgnorePunctuation: (value: boolean) => void;
		onSetSuppliedTextMode: (value: SuppliedTextMode) => void;
		onSetSegmentation: (value: boolean) => void;
	}>();

	let newPattern = $state('');
	let newReplacement = $state('');
	let newDescription = $state('');
	let newType = $state<RegularizationType>('none');

	let projectRules = $derived(
		rules.filter((rule: RegularizationRule) => rule.scope === 'project'),
	);

	function addProjectRule() {
		if (!newPattern.trim()) return;
		onAddRule({
			id: crypto.randomUUID(),
			pattern: newPattern,
			replacement: newReplacement,
			scope: 'project',
			description: newDescription || `${newPattern} -> ${newReplacement}`,
			enabled: true,
			type: newType,
		});
		newPattern = '';
		newReplacement = '';
		newDescription = '';
		newType = 'none';
	}
</script>

<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<div class="mb-3">
		<h2 class="font-serif text-lg font-semibold">
			Project Collation Settings
		</h2>
		<p class="text-xs text-base-content/50">
			Automatic unclear handling always regularizes to clear text for alignment. Transcription preprocessing and alignment normalization are configured here.
		</p>
	</div>

	<div class="mb-3 space-y-3 rounded-box border border-base-300/50 bg-base-200/40 p-3">
		<div>
			<div class="mb-2 text-xs font-medium uppercase tracking-wider text-base-content/55">
				Transcription preprocessing
			</div>
			<label class="flex items-center justify-between gap-3 rounded-box bg-base-100 px-3 py-2.5">
				<div>
					<div class="text-sm font-medium">Ignore word breaks</div>
					<div class="text-xs text-base-content/50">
						Remove wrapped word-break markers from the original tokens and readings before collation, not only from the alignment normalization form.
					</div>
				</div>
				<input
					type="checkbox"
					class="toggle toggle-sm toggle-primary"
					checked={ignoreWordBreaks}
					onchange={(event) =>
						onSetIgnoreWordBreaks((event.currentTarget as HTMLInputElement).checked)}
				/>
			</label>
		</div>

		<div>
			<div class="mb-2 text-xs font-medium uppercase tracking-wider text-base-content/55">
				Alignment settings
			</div>
			<label class="flex items-center justify-between gap-3 rounded-box bg-base-100 px-3 py-2.5">
				<div>
					<div class="text-sm font-medium">CollateX segmentation</div>
					<div class="text-xs text-base-content/50">
						Merge identical adjacent runs into one segment instead of keeping each token separate.
					</div>
				</div>
				<input
					type="checkbox"
					class="toggle toggle-sm toggle-primary"
					checked={segmentation}
					onchange={(event) => onSetSegmentation((event.currentTarget as HTMLInputElement).checked)}
				/>
			</label>

			<label class="flex items-center justify-between gap-3 rounded-box bg-base-100 px-3 py-2.5">
				<div>
					<div class="text-sm font-medium">Lowercase for alignment</div>
					<div class="text-xs text-base-content/50">
						Collate on lowercase text while keeping the original case available on demand.
					</div>
				</div>
				<input
					type="checkbox"
					class="toggle toggle-sm toggle-primary"
					checked={lowercase}
					onchange={(event) => onSetLowercase((event.currentTarget as HTMLInputElement).checked)}
				/>
			</label>

			<label class="flex items-center justify-between gap-3 rounded-box bg-base-100 px-3 py-2.5">
				<div>
					<div class="text-sm font-medium">Ignore punctuation in alignment</div>
					<div class="text-xs text-base-content/50">
						Original punctuation stays visible on demand, but can be removed from the alignment form.
					</div>
				</div>
				<input
					type="checkbox"
					class="toggle toggle-sm toggle-primary"
					checked={ignorePunctuation}
					onchange={(event) =>
						onSetIgnorePunctuation((event.currentTarget as HTMLInputElement).checked)}
				/>
			</label>

			<div class="rounded-box bg-base-100 px-3 py-3">
				<div class="mb-2 text-xs font-medium text-base-content/70">
					Supplied text in alignment
				</div>
				<select
					class="select select-bordered select-sm w-full"
					value={suppliedTextMode}
					onchange={(event) =>
						onSetSuppliedTextMode((event.currentTarget as HTMLSelectElement).value as SuppliedTextMode)}
				>
					<option value="clear">Treat supplied text as clear text</option>
					<option value="gap">Treat supplied text as gap / lacuna</option>
				</select>
			</div>
		</div>
	</div>

	<div class="space-y-2 rounded-box border border-base-300/50 bg-base-200/40 p-3">
		<label class="form-control w-full">
			<div class="label py-0.5"><span class="label-text text-xs">Pattern (regex)</span></div>
			<input
				type="text"
				class="input input-bordered input-sm w-full font-mono"
				placeholder="e.g. θς"
				bind:value={newPattern}
			/>
		</label>
		<label class="form-control w-full">
			<div class="label py-0.5"><span class="label-text text-xs">Replacement</span></div>
			<input
				type="text"
				class="input input-bordered input-sm w-full font-mono"
				placeholder="e.g. θεος"
				bind:value={newReplacement}
			/>
		</label>
		<label class="form-control w-full">
			<div class="label py-0.5"><span class="label-text text-xs">Type</span></div>
			<select class="select select-bordered select-sm w-full" bind:value={newType}>
				<option value="none">None</option>
				<option value="ns">Nomen sacrum</option>
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
			class="btn btn-primary btn-sm w-full gap-1"
			disabled={!newPattern.trim()}
			onclick={addProjectRule}
		>
			<Plus size={14} />
			Add Project Rule
		</button>
	</div>

	{#if projectRules.length === 0}
		<div class="py-4 text-center text-sm text-base-content/40">No project rules yet.</div>
	{:else}
		<div class="mt-3 space-y-2">
			{#each projectRules as rule (rule.id)}
				<div
					class="group flex items-start gap-2 rounded-box border border-base-300/40 bg-base-100 px-3 py-2.5 transition-opacity"
					class:opacity-50={!rule.enabled}
				>
					<button
						type="button"
						class="btn btn-ghost btn-xs btn-circle mt-0.5 shrink-0"
						title={rule.enabled ? 'Disable rule' : 'Enable rule'}
						onclick={() => onToggleRule(rule.id)}
					>
						{#if rule.enabled}
							<ToggleRight size={18} class="text-success" />
						{:else}
							<ToggleLeft size={18} class="text-base-content/40" />
						{/if}
					</button>
					<div class="min-w-0 flex-1">
						<div class="truncate font-mono text-xs">
							<span class="text-error/80">{rule.pattern}</span>
							<span class="mx-1 text-base-content/30">&rarr;</span>
							<span class="text-success/80">{rule.replacement || '(delete)'}</span>
						</div>
						<div class="mt-0.5 text-xs text-base-content/50">{rule.description}</div>
						<div class="mt-1 flex items-center gap-2">
							<span class="badge badge-primary badge-xs">project</span>
							<select
								class="select select-bordered select-xs max-w-[8rem]"
								value={rule.type}
								onchange={(event) =>
									onSetRuleType(
										rule.id,
										(event.currentTarget as HTMLSelectElement).value as RegularizationType,
									)}
							>
								<option value="none">none</option>
								<option value="ns">ns</option>
							</select>
						</div>
					</div>
					<button
						type="button"
						class="btn btn-ghost btn-xs btn-circle shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
						title="Remove rule"
						onclick={() => onRemoveRule(rule.id)}
					>
						<Trash size={14} />
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
