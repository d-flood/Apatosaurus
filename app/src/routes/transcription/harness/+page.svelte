<script lang="ts">
	import {
		createTranscription,
		getTranscription,
		subscribeLocalDbInvalidations,
		updateTranscriptionContent,
	} from '$lib/client/db/client';
	import { ensureLocalDbRuntime } from '$lib/client/db/runtime';
	import {
		mapLocalTranscriptionRecord,
		type TranscriptionRecord,
	} from '$lib/client/transcription/model';
	import {
		buildHarnessTranscriptionCreatePayload,
		HARNESS_TRANSCRIPTION_ID,
		HARNESS_TRANSCRIPTION_TITLE,
	} from '$lib/testing/transcriptionEditorHarness';
	import TranscriptionEditor from '$lib/components/transcriptionEditor/TranscriptionEditor.svelte';
	import { onMount } from 'svelte';

	const harnessData = {};

	let transcription = $state<TranscriptionRecord | null>(null);
	let loadError = $state<string | null>(null);
	let toolbarHost = $state<HTMLElement | null>(null);
	let statusBarHost = $state<HTMLElement | null>(null);
	let unsubscribeInvalidations: (() => void) | null = null;

	function captureToolbarHost(node: HTMLElement) {
		toolbarHost = node;
		return {
			destroy() {
				if (toolbarHost === node) {
					toolbarHost = null;
				}
			},
		};
	}

	function captureStatusBarHost(node: HTMLElement) {
		statusBarHost = node;
		return {
			destroy() {
				if (statusBarHost === node) {
					statusBarHost = null;
				}
			},
		};
	}

	async function seedHarnessTranscription() {
		const now = new Date().toISOString();
		const existing = await getTranscription(HARNESS_TRANSCRIPTION_ID);
		const payload = buildHarnessTranscriptionCreatePayload(now);

		if (existing) {
			await updateTranscriptionContent({
				id: HARNESS_TRANSCRIPTION_ID,
				contentJson: payload.content_json,
				format: payload.format,
				updatedAt: now,
			});
			return;
		}

		await createTranscription({
			id: HARNESS_TRANSCRIPTION_ID,
			title: payload.title,
			siglum: payload.siglum,
			description: payload.description,
			contentJson: payload.content_json,
			format: payload.format,
			createdAt: payload.created_at,
			updatedAt: payload.updated_at,
			owner: payload.owner,
			isPublic: payload.is_public,
			tags: [],
			transcriber: payload.transcriber,
			repository: payload.repository,
			settlement: payload.settlement,
			language: payload.language,
		});
	}

	onMount(() => {
		let cancelled = false;

		async function loadTranscription() {
			const nextTranscription = await getTranscription(HARNESS_TRANSCRIPTION_ID);
			if (cancelled) return;
			transcription = nextTranscription ? mapLocalTranscriptionRecord(nextTranscription) : null;
			loadError = nextTranscription ? null : 'Failed to load transcription harness';
		}

		void ensureLocalDbRuntime()
			.then(async () => {
				await seedHarnessTranscription();
				await loadTranscription();
			})
			.catch(error => {
				if (cancelled) return;
				loadError =
					error instanceof Error ? error.message : 'Failed to initialize transcription harness';
			});

		unsubscribeInvalidations = subscribeLocalDbInvalidations(event => {
			if (event.domain === 'transcriptions') void loadTranscription();
		});

		return () => {
			cancelled = true;
			unsubscribeInvalidations?.();
			unsubscribeInvalidations = null;
		};
	});
</script>

{#if loadError}
	<div class="container mx-auto max-w-3xl p-4" data-testid="harness-error">
		<div class="alert alert-error">
			<span>{loadError}</span>
		</div>
	</div>
{:else if !transcription}
	<div class="container mx-auto max-w-3xl p-4" data-testid="harness-loading">
		<div class="alert alert-info">
			<span>Loading transcription editor harness...</span>
		</div>
	</div>
{:else}
	<div class="mx-auto max-w-450 px-4 pb-24" data-testid="transcription-harness">
		<div class="my-4 space-y-1 text-center">
			<h1 class="font-serif text-3xl">{HARNESS_TRANSCRIPTION_TITLE}</h1>
			<p class="text-sm opacity-70">Deterministic multi-page framed-page editor fixture for Playwright.</p>
		</div>

		<div class="sticky top-0 z-20 mb-4 rounded-box border border-base-300 bg-base-100/95 p-3 shadow-sm backdrop-blur">
			<div use:captureToolbarHost></div>
		</div>

		<div class="overflow-x-auto" data-transcription-scroll-container>
			<TranscriptionEditor
				{transcription}
				data={harnessData}
				toolbarTarget={toolbarHost}
				statusBarTarget={statusBarHost}
			/>
		</div>

		<div class="sticky bottom-0 z-30 pointer-events-none mt-4">
			<div class="pointer-events-auto">
				<div use:captureStatusBarHost></div>
			</div>
		</div>

		<div
			data-testid="harness-ready"
			data-transcription-id={transcription.id}
			class="sr-only"
		>
			Harness ready
		</div>
	</div>
{/if}
