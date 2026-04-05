<script lang="ts">
	import TranscriptionForm from '$lib/components/TranscriptionForm.svelte';

	let { data } = $props();
</script>

<div class="container mx-auto max-w-2xl p-4">
	<h1 class="text-2xl font-bold mb-6">Create a New Transcription</h1>
	<TranscriptionForm {data} />
</div>
