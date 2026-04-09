<script lang="ts">
	import { ensureDjazzkitRuntime } from '$lib/client/djazzkit-runtime';
	import type { TranscriptionRecord } from '$lib/client/transcription/model';
	import {
		buildHarnessTranscriptionCreatePayload,
		buildHarnessTranscriptionUpdatePayload,
		HARNESS_TRANSCRIPTION_ID,
		HARNESS_TRANSCRIPTION_TITLE,
	} from '$lib/testing/transcriptionEditorHarness';
	import TranscriptionEditor from '$lib/components/transcriptionEditor/TranscriptionEditor.svelte';
	import { Transcription } from '$generated/models/Transcription';
	import { onMount } from 'svelte';

	const harnessData = {};

	let transcription = $state<TranscriptionRecord | null>(null);
	let loadError = $state<string | null>(null);
	let toolbarHost = $state<HTMLElement | null>(null);
	let statusBarHost = $state<HTMLElement | null>(null);
	let unsubscribe: (() => void) | null = null;

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
		const queryset = Transcription.objects
			.filter(f => f._djazzkit_id.eq(HARNESS_TRANSCRIPTION_ID))
			.filter(f => f._djazzkit_deleted.eq(false));
		const existing = await queryset.first();

		if (existing) {
			await Transcription.objects.update(
				HARNESS_TRANSCRIPTION_ID,
				buildHarnessTranscriptionUpdatePayload(now, existing.created_at)
			);
			return;
		}

		await Transcription.objects.create(buildHarnessTranscriptionCreatePayload(now));
	}

	onMount(() => {
		let cancelled = false;

		void ensureDjazzkitRuntime()
			.then(async () => {
				await seedHarnessTranscription();
				if (cancelled) return;

				const queryset = Transcription.objects
					.filter(f => f._djazzkit_id.eq(HARNESS_TRANSCRIPTION_ID))
					.filter(f => f._djazzkit_deleted.eq(false));
				const nextTranscription = await queryset.first();
				if (cancelled) return;

				transcription = nextTranscription;
				loadError = nextTranscription ? null : 'Failed to load transcription harness';
				unsubscribe = queryset.subscribe(rows => {
					transcription = rows[0] ?? null;
				});
			})
			.catch(error => {
				if (cancelled) return;
				loadError =
					error instanceof Error ? error.message : 'Failed to initialize transcription harness';
			});

		return () => {
			cancelled = true;
			unsubscribe?.();
			unsubscribe = null;
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
			data-transcription-id={transcription._djazzkit_id}
			class="sr-only"
		>
			Harness ready
		</div>
	</div>
{/if}
