<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';
	interface Props {
		type: string;
		attrs: Record<string, any>;
		onApply: (attrs: Record<string, any>) => void;
	}

	let { type, attrs, onApply }: Props = $props();

	const usesTeiAttrs = $derived(
		['pageBreak', 'lineBreak', 'columnBreak', 'handShift', 'teiMilestone', 'space'].includes(type)
	);
	const editedAttrs = $derived(
		usesTeiAttrs ? (attrs?.teiAttrs as Record<string, any>) || {} : (attrs || {})
	);

	// Per-type structured field state
	let reason = $state('');
	let unit = $state('');
	let extent = $state('');
	let dim = $state('');
	let hand = $state('');
	let medium = $state('');
	let milestoneUnit = $state('');
	let milestoneN = $state('');
	let milestoneEd = $state('');
	let breakValue = $state<'yes' | 'no'>('yes');
	let untranscribedReason = $state('');
	let untranscribedExtent = $state<'partial' | 'full'>('partial');

	let lastSnapshot = $state('');

	const gapReasons = ['Damage/Loss', 'Illegible', 'Missing', 'Witness End', 'Other'];

	$effect(() => {
		const snapshot = JSON.stringify(editedAttrs);
		if (snapshot === lastSnapshot) return;
		lastSnapshot = snapshot;

		if (type === 'gap') {
			reason = String(editedAttrs.reason || '');
			unit = String(editedAttrs.unit || '');
			extent = String(editedAttrs.extent || '');
		} else if (type === 'pageBreak' || type === 'lineBreak' || type === 'columnBreak') {
			milestoneN = String(editedAttrs.n || '');
			milestoneEd = String(editedAttrs.ed || '');
			breakValue = editedAttrs.break === 'no' ? 'no' : 'yes';
		} else if (type === 'space') {
			unit = String(editedAttrs.unit || '');
			extent = String(editedAttrs.extent || '');
			dim = String(editedAttrs.dim || '');
		} else if (type === 'handShift') {
			hand = String(editedAttrs.new || '');
			medium = String(editedAttrs.medium || '');
		} else if (type === 'teiMilestone') {
			milestoneUnit = String(editedAttrs.unit || '');
			milestoneN = String(editedAttrs.n || '');
			milestoneEd = String(editedAttrs.ed || '');
		} else if (type === 'untranscribed') {
			untranscribedReason = String(editedAttrs.reason || '');
			untranscribedExtent = editedAttrs.extent === 'full' ? 'full' : 'partial';
		}
	});

	function apply() {
		if (type === 'gap') {
			onApply({
				...attrs,
				reason: reason.trim() || undefined,
				unit: unit.trim() || undefined,
				extent: extent.trim() || undefined,
			});
		} else if (type === 'pageBreak' || type === 'lineBreak' || type === 'columnBreak') {
			onApply({
				...attrs,
				teiAttrs: {
					...(milestoneN.trim() ? { n: milestoneN.trim() } : {}),
					...(milestoneEd.trim() ? { ed: milestoneEd.trim() } : {}),
					...(breakValue === 'no' ? { break: 'no' } : {}),
				},
			});
		} else if (type === 'space') {
			onApply({
				...attrs,
				teiAttrs: {
					...(unit.trim() ? { unit: unit.trim() } : {}),
					...(extent.trim() ? { extent: extent.trim() } : {}),
					...(dim.trim() ? { dim: dim.trim() } : {}),
				},
			});
		} else if (type === 'handShift') {
			onApply({
				...attrs,
				teiAttrs: {
					...(hand.trim() ? { new: hand.trim() } : {}),
					...(medium.trim() ? { medium: medium.trim() } : {}),
				},
			});
		} else if (type === 'teiMilestone') {
			onApply({
				...attrs,
				teiAttrs: {
					...(milestoneUnit.trim() ? { unit: milestoneUnit.trim() } : {}),
					...(milestoneN.trim() ? { n: milestoneN.trim() } : {}),
					...(milestoneEd.trim() ? { ed: milestoneEd.trim() } : {}),
				},
			});
		} else if (type === 'untranscribed') {
			onApply({
				...attrs,
				reason: untranscribedReason.trim() || undefined,
				extent: untranscribedExtent,
			});
		}
	}
</script>

<div class="space-y-3">
	{#if type === 'gap'}
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Reason</span>
			<select class="select select-bordered select-sm" bind:value={reason}>
				<option value="">--</option>
				{#each gapReasons as r}
					<option value={r}>{r}</option>
				{/each}
			</select>
		</label>
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Unit</span>
			<input class="input input-bordered input-sm" bind:value={unit} placeholder="e.g. chars, lines, words" />
		</label>
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Extent</span>
			<input class="input input-bordered input-sm" bind:value={extent} placeholder="e.g. 3, several, unknown" />
		</label>
	{:else if type === 'pageBreak' || type === 'lineBreak' || type === 'columnBreak'}
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Number</span>
			<input class="input input-bordered input-sm" bind:value={milestoneN} placeholder="e.g. 2" />
		</label>
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Edition</span>
			<input class="input input-bordered input-sm" bind:value={milestoneEd} placeholder="e.g. NA28" />
		</label>
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Break</span>
			<select class="select select-bordered select-sm" bind:value={breakValue}>
				<option value="yes">Break here</option>
				<option value="no">Word continues</option>
			</select>
		</label>
	{:else if type === 'space'}
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Unit</span>
			<input class="input input-bordered input-sm" bind:value={unit} placeholder="e.g. chars, lines" />
		</label>
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Extent</span>
			<input class="input input-bordered input-sm" bind:value={extent} placeholder="e.g. 1" />
		</label>
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Dimension</span>
			<input class="input input-bordered input-sm" bind:value={dim} placeholder="e.g. horizontal" />
		</label>
	{:else if type === 'handShift'}
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Hand</span>
			<input class="input input-bordered input-sm" bind:value={hand} placeholder="e.g. #corrector1" />
		</label>
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Medium</span>
			<input class="input input-bordered input-sm" bind:value={medium} placeholder="e.g. ink" />
		</label>
	{:else if type === 'teiMilestone'}
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Unit</span>
			<input class="input input-bordered input-sm" bind:value={milestoneUnit} placeholder="e.g. section" />
		</label>
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Value</span>
			<input class="input input-bordered input-sm" bind:value={milestoneN} placeholder="e.g. A" />
		</label>
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Edition</span>
			<input class="input input-bordered input-sm" bind:value={milestoneEd} placeholder="e.g. NA28" />
		</label>
	{:else if type === 'untranscribed'}
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Reason</span>
			<input class="input input-bordered input-sm" bind:value={untranscribedReason} placeholder="e.g. damage, illegible" />
		</label>
		<label class="form-control">
			<span class="label-text text-xs font-semibold">Extent</span>
			<select class="select select-bordered select-sm" bind:value={untranscribedExtent}>
				<option value="partial">Partial</option>
				<option value="full">Full</option>
			</select>
		</label>
	{/if}

	<div class="flex justify-end">
		<button type="button" class="btn btn-primary btn-sm" onclick={apply}>
			<Check size={16} />
			Apply
		</button>
	</div>
</div>
