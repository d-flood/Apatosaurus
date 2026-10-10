<script lang="ts">
	import type { VersionSummary } from '$lib/db/repositories/revisions';
	import { formatRelativeTime, formatSourceDate } from '$lib/shell/source-labels';

	interface Props {
		currentEditedAt: string | null;
		versions: VersionSummary[];
		value: string | null;
		disabled?: boolean;
	}

	let { currentEditedAt, versions, value = $bindable(), disabled = false }: Props = $props();
</script>

<label class="form-control w-full">
	<span class="label pb-1">
		<span class="label-text text-xs">Source</span>
	</span>
	<select
		class="select select-bordered select-sm w-full"
		aria-label="Source"
		{disabled}
		value={value ?? ''}
		onchange={event => {
			value = event.currentTarget.value || null;
		}}
	>
		<option value="">
			Current{currentEditedAt ? ` · edited ${formatRelativeTime(currentEditedAt)}` : ''}
		</option>
		{#each versions as version (version.id)}
			<option value={version.id}>
				{version.label || 'Unnamed version'} · {formatSourceDate(version.createdAt)}
			</option>
		{/each}
	</select>
</label>
