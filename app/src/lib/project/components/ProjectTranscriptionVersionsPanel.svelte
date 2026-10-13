<script lang="ts">
	import ArrowsClockwise from 'phosphor-svelte/lib/ArrowsClockwise';
	import ArrowsLeftRight from 'phosphor-svelte/lib/ArrowsLeftRight';
	import GitCommit from 'phosphor-svelte/lib/GitCommit';
	import PencilSimple from 'phosphor-svelte/lib/PencilSimple';
	import { resolve } from '$app/paths';
	import { formatSourceDate } from '$lib/shell/source-labels';
	import type {
		ProjectTranscriptionStatus,
		ProjectTranscriptionSourceState,
	} from '$lib/db/repositories/projects';

	interface Props {
		projectId: string;
		statuses: ProjectTranscriptionStatus[];
		isLoading: boolean;
		onRefreshTranscription: (status: ProjectTranscriptionStatus) => Promise<void> | void;
		onAddFromProject: () => Promise<void> | void;
	}

	let { projectId, statuses, isLoading, onRefreshTranscription, onAddFromProject }: Props =
		$props();

	function deriveSourceTypeLabel(status: ProjectTranscriptionStatus): string {
		const canonical = status.canonicalSource;
		const immediate = status.immediateSource;
		if (canonical && canonical.projectId !== projectId) {
			return 'Other project';
		}
		if (
			immediate?.sourceType === 'project_snapshot' &&
			immediate.sourceProjectId !== projectId
		) {
			return 'Other project';
		}
		if (!status.immediateSource && !status.canonicalSource) return 'Unknown';
		return 'Unknown';
	}

	function deriveSourceLabel(status: ProjectTranscriptionStatus): string {
		const canonical = status.canonicalSource;
		if (canonical) {
			return canonical.title || canonical.siglum || canonical.transcriptionId;
		}
		if (status.immediateSource?.sourceProjectName) {
			return status.immediateSource.sourceProjectName;
		}
		return '';
	}

	function deriveSourceStateLabel(state: ProjectTranscriptionSourceState): string {
		switch (state.kind) {
			case 'no-source':
				return 'No source recorded';
			case 'source-missing':
				return 'Source missing';
			case 'up-to-date':
				return 'Up to date with source';
			case 'source-changed':
				return 'Source changed';
			default:
				return 'Unknown source state';
		}
	}

	function canRefresh(status: ProjectTranscriptionStatus): boolean {
		return (
			status.sourceState.kind === 'up-to-date' || status.sourceState.kind === 'source-changed'
		);
	}

	function sourceStateBadgeClass(state: ProjectTranscriptionSourceState): string {
		if (state.kind === 'up-to-date') return 'badge-success';
		if (state.kind === 'source-changed') return 'badge-info';
		return 'badge-ghost';
	}

	function transcriptionHref(status: ProjectTranscriptionStatus): string {
		return resolve(`/transcription/${status.projectOwnedTranscriptionId}`);
	}
</script>

<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<div class="mb-3 flex items-center justify-between gap-3">
		<div>
			<h2 class="font-serif text-lg font-semibold">Project Transcription Versions</h2>
		</div>
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="btn btn-xs btn-outline btn-secondary gap-1"
				disabled={isLoading}
				onclick={() => onAddFromProject()}
			>
				<ArrowsLeftRight size={12} />
				Add from another project
			</button>
			{#if isLoading}
				<span class="loading loading-spinner loading-xs"></span>
			{/if}
		</div>
	</div>

	{#if isLoading}
		<div
			class="flex items-center gap-2 rounded-box bg-base-200/70 p-4 text-sm text-base-content/60"
		>
			<span class="loading loading-spinner loading-sm"></span>
			Loading project transcription status...
		</div>
	{:else if statuses.length === 0}
		<div
			class="rounded-box border border-dashed border-base-300/80 p-4 text-sm text-base-content/55"
		>
			No project transcriptions linked yet.
		</div>
	{:else}
		<div class="space-y-2">
			{#each statuses as status (status.projectTranscriptionId)}
				<div class="rounded-box border border-base-300/50 bg-base-100 px-3 py-2.5">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="font-mono text-sm font-bold"
									>{status.siglum || status.title}</span
								>
								{#if status.title}
									<span class="text-xs text-base-content/45">{status.title}</span>
								{/if}
							</div>
							<div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
								<span class="badge badge-outline badge-xs"
									>{deriveSourceTypeLabel(status)}</span
								>
								<span
									class={`badge badge-xs ${sourceStateBadgeClass(status.sourceState)}`}
								>
									{deriveSourceStateLabel(status.sourceState)}
								</span>
							</div>
							<div class="mt-1 text-[11px] text-base-content/45">
								{#if deriveSourceLabel(status)}
									Source: <span class="text-base-content/60"
										>{deriveSourceLabel(status)}</span
									>
								{/if}
								{#if status.immediateSource?.sourceVersionLabel}
									<span class="ml-2"
										>@ {status.immediateSource.sourceVersionLabel}</span
									>
								{:else if status.immediateSource?.sourceCapturedAt}
									<span class="ml-2"
										>@ Current as of {formatSourceDate(
											status.immediateSource.sourceCapturedAt
										)}</span
									>
								{/if}
							</div>
							<p class="mt-1 text-[11px] text-base-content/40">
								Collations keep their text until refreshed.
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-2">
							{#if status.commitState === 'clean'}
								<GitCommit size={14} class="text-base-content/40" />
							{/if}
							<a
								class="btn btn-xs btn-outline gap-1"
								href={transcriptionHref(status)}
							>
								<PencilSimple size={12} />
								Open
							</a>
							<button
								type="button"
								class="btn btn-xs btn-secondary gap-1"
								disabled={!canRefresh(status)}
								title={canRefresh(status)
									? 'Refresh from the source'
									: 'Source unavailable'}
								onclick={() => canRefresh(status) && onRefreshTranscription(status)}
							>
								<ArrowsClockwise size={12} />
								Refresh from source
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
