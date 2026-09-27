<script lang="ts">
	import FileArrowUp from 'phosphor-svelte/lib/FileArrowUp';
	import FolderOpen from 'phosphor-svelte/lib/FolderOpen';

	let {
		label,
		directory = false,
		accept,
		disabled = false,
		placeholder = directory ? 'No folder chosen' : 'No file chosen',
		onchange,
		testid,
	}: {
		label: string;
		directory?: boolean;
		accept?: string;
		disabled?: boolean;
		placeholder?: string;
		onchange: (event: Event) => void;
		testid?: string;
	} = $props();

	let selection = $state('');

	function handleChange(event: Event) {
		const files = (event.currentTarget as HTMLInputElement).files;
		if (!files?.length) selection = '';
		else if (directory) {
			const root = files[0].webkitRelativePath.split('/')[0];
			selection = `${root} · ${files.length} ${files.length === 1 ? 'file' : 'files'}`;
		} else selection = files[0].name;
		onchange(event);
	}
</script>

<label
	class="input w-full cursor-pointer focus-within:outline-2 focus-within:outline-offset-2"
	class:input-disabled={disabled}
>
	<span class="font-bold label">{label}</span>
	<span class="btn btn-xs btn-outline" class:btn-disabled={disabled}>
		{#if directory}<FolderOpen size={14} />Choose folder{:else}<FileArrowUp size={14} />Choose
			file{/if}
	</span>
	<span class="grow truncate" class:opacity-60={!selection}>
		{selection || placeholder}
	</span>
	<input
		type="file"
		class="sr-only"
		webkitdirectory={directory || undefined}
		multiple={directory || undefined}
		{accept}
		{disabled}
		onchange={handleChange}
		data-testid={testid}
	/>
</label>
