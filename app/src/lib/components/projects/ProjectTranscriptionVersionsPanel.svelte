<script lang="ts">
	import ArrowsClockwise from 'phosphor-svelte/lib/ArrowsClockwise';
	import ArrowsLeftRight from 'phosphor-svelte/lib/ArrowsLeftRight';
	import ArrowUp from 'phosphor-svelte/lib/ArrowUp';
	import GitCommit from 'phosphor-svelte/lib/GitCommit';
	import type {
		ProjectTranscriptionStatus,
		ProjectTranscriptionSourceState,
	} from '$lib/client/collation/project-collation';

	interface Props {
		projectId: string;
		statuses: ProjectTranscriptionStatus[];
		isLoading: boolean;
		onRefreshTranscription: (status: ProjectTranscriptionStatus) => Promise<void> | void;
		onPromoteTranscription: (status: ProjectTranscriptionStatus) => Promise<void> | void;
		onAddFromProject: () => Promise<void> | void;
	}

	let {
		projectId,
		statuses,
		isLoading,
		onRefreshTranscription,
		onPromoteTranscription,
		onAddFromProject,
	}: Props = $props();

	function shortRevisionId(revisionId: string | null | undefined): string {
		if (!revisionId) return '';
		return revisionId.length <= 12 ? revisionId : `${revisionId.slice(0, 8)}...`;
	}

	function deriveSourceTypeLabel(status: ProjectTranscriptionStatus): string {
		const canonical = status.canonicalSource;
		const immediate = status.immediateSource;
		if (canonical?.scopeType === 'global') return 'Library';
		if (canonical?.scopeType === 'project_snapshot' && canonical.projectId !== projectId) {
			return 'Other project';
		}
		if (immediate?.sourceType === 'canonical') return 'Library';
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
		if (status.immediateSource?.sourceTranscriptionId) {
			return status.immediateSource.sourceTranscriptionId;
		}
		return '';
	}

	function deriveCommitStateLabel(status: ProjectTranscriptionStatus): string {
		if (status.commitState === 'never-committed') return 'No committed version yet';
		if (status.commitState === 'dirty') return 'Changes since commit';
		return 'Committed';
	}

	function deriveSourceStateLabel(state: ProjectTranscriptionSourceState): string {
		switch (state.kind) {
			case 'no-source':
				return 'No source recorded';
			case 'source-missing':
				return 'Source missing';
			case 'source-has-no-committed-version':
				return 'No committed source version';
			case 'up-to-date':
				return 'Up to date with source';
			case 'newer-source-available':
				return 'Newer committed source available';
			case 'source-has-uncommitted-changes':
				return 'Source has uncommitted edits';
			default:
				return 'Unknown source state';
		}
	}

	interface RefreshAvailability {
		sourceTranscriptionId: string;
		sourceCheckpointId: string;
		state: ProjectTranscriptionSourceState;
		canRefresh: boolean;
		warnSourceUncommitted: boolean;
	}

	function deriveRefreshAvailability(
		status: ProjectTranscriptionStatus
	): RefreshAvailability | null {
		const state = status.sourceState;
		if (state.kind === 'up-to-date' || state.kind === 'newer-source-available') {
			return {
				sourceTranscriptionId: state.sourceTranscriptionId,
				sourceCheckpointId: state.sourceRevisionId,
				state,
				canRefresh: true,
				warnSourceUncommitted: false,
			};
		}
		if (state.kind === 'source-has-uncommitted-changes') {
			return {
				sourceTranscriptionId: state.sourceTranscriptionId,
				sourceCheckpointId: state.sourceRevisionId ?? '',
				state,
				canRefresh: Boolean(state.sourceRevisionId),
				warnSourceUncommitted: true,
			};
		}
		return null;
	}

	function commitStateBadgeClass(status: ProjectTranscriptionStatus): string {
		if (status.commitState === 'never-committed') return 'badge-ghost';
		if (status.commitState === 'dirty') return 'badge-warning';
		return 'badge-success';
	}

	function sourceStateBadgeClass(state: ProjectTranscriptionSourceState): string {
		switch (state.kind) {
			case 'up-to-date':
				return 'badge-success';
			case 'newer-source-available':
				return 'badge-info';
			case 'source-has-uncommitted-changes':
				return 'badge-warning';
			case 'source-missing':
			case 'source-has-no-committed-version':
				return 'badge-ghost';
			default:
				return 'badge-ghost';
		}
	}
</script>

<div class="rounded-box border border-base-300/50 bg-base-100 p-4 shadow-md">
	<div class="mb-3 flex items-center justify-between gap-3">
		<div>
			<h2 class="font-serif text-lg font-semibold">Project Transcription Versions</h2>
			<p class="text-xs text-base-content/50">
				Provenance, source freshness, and committed version status for each linked project
				transcription.
			</p>
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
				{@const refresh = deriveRefreshAvailability(status)}
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
								<span class={`badge badge-xs ${commitStateBadgeClass(status)}`}>
									{deriveCommitStateLabel(status)}
								</span>
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
								{#if status.currentCheckpoint}
									<span class="ml-2 font-mono"
										>Version {shortRevisionId(
											status.currentCheckpoint.revisionId
										)}</span
									>
								{/if}
							</div>
							<p class="mt-1 text-[11px] text-base-content/40">
								Collation witnesses stay pinned to their current versions until
								refreshed separately.
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-2">
							{#if status.commitState === 'clean'}
								<GitCommit size={14} class="text-base-content/40" />
							{/if}
							<button
								type="button"
								class="btn btn-xs btn-outline btn-primary gap-1"
								disabled={!status.currentCheckpoint}
								title={status.currentCheckpoint
									? 'Promote the committed project transcription into the reusable library'
									: 'Commit this project transcription before promoting'}
								onclick={() => onPromoteTranscription(status)}
							>
								<ArrowUp size={12} />
								Promote to library
							</button>
							<button
								type="button"
								class="btn btn-xs btn-secondary gap-1"
								disabled={!refresh?.canRefresh}
								title={refresh
									? 'Refresh from the latest committed source version'
									: 'No committed source version available'}
								onclick={() => refresh && onRefreshTranscription(status)}
							>
								<ArrowsClockwise size={12} />
								Refresh from source
							</button>
						</div>
					</div>
					{#if refresh?.warnSourceUncommitted}
						<p class="mt-2 text-[11px] text-warning/80">
							Source has uncommitted edits. Refresh uses the last committed source
							version. Commit the source first to include the latest edits.
						</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
