<script lang="ts">
	import { downloadBlob } from '$lib/shell/download-blob';

	let { fileStem, csv, json }: { fileStem: string; csv: () => string; json: unknown } = $props();
</script>

<div class="flex flex-wrap gap-2">
	<button
		type="button"
		class="btn btn-sm"
		onclick={() => downloadBlob(`${fileStem}.csv`, new Blob([csv()], { type: 'text/csv' }))}
	>
		Download CSV
	</button>
	<button
		type="button"
		class="btn btn-sm"
		onclick={() =>
			downloadBlob(
				`${fileStem}.json`,
				new Blob([JSON.stringify(json, null, '\t')], { type: 'application/json' })
			)}
	>
		Download JSON
	</button>
</div>
