<script lang="ts">
	import { version } from '$app/environment';
	import {
		checkStoragePersistence,
		getStorageEstimate,
		isLocalFolderProviderSupported,
		shouldShowDurabilityWarning,
		type StorageEstimateReport,
		type StoragePersistenceReport,
	} from '$lib/shell/capabilities';
	import {
		getProjectTranscriptionStatusForOwnedTranscription,
		listCollationsWithProjectNames,
		listConflictCopies,
		listProjectIdsWithContent,
		listProjects,
		listTranscriptionSummaries,
		subscribeLocalDbInvalidations,
	} from '$lib/db/client';
	import type { CollationListItem } from '$lib/db/repositories/collations';
	import type { ProjectOption } from '$lib/db/repositories/projects';
	import type { TranscriptionSummary } from '$lib/db/repositories/transcriptions';
	import { ensureLocalDbRuntime } from '$lib/db/runtime';
	import {
		readLastOpenedProjectId,
		resolveLastOpenedProjectId,
	} from '$lib/shell/last-opened-project';
	import {
		loadProjectBackupOverviews,
		type ProjectBackupOverview,
	} from '$lib/backup/project-backup-overview';
	import { deriveProjectBackupHealthState } from '$lib/backup/project-backup-health-state';
	import { dismissPlacementNotice } from '$lib/backup/location-connections';
	import { isNotBackedUp } from '$lib/backup/sync-status';
	import { listProjectPlacements } from '$lib/storage/project-locations';
	import type { WarmProgress } from '$lib/shell/offline-cache-policy';
	import { formatConflictCopyTitle } from '$lib/shell/source-labels';
	import { onCacheWarmProgress } from '$lib/shell/sw-registration';
	import Dashboard, {
		type DashboardAttentionItem,
		type DashboardDocument,
	} from '$lib/shell/components/Dashboard.svelte';
	import WelcomeGate from '$lib/shell/components/WelcomeGate.svelte';
	import { onMount } from 'svelte';

	type RecentSummary =
		| { type: 'Transcription'; id: string; updatedAt: string; summary: TranscriptionSummary }
		| { type: 'Collation'; id: string; updatedAt: string; summary: CollationListItem };

	let projects = $state.raw<ProjectOption[]>([]);
	let lastOpenedProject = $state<ProjectOption | null>(null);
	let recentDocuments = $state.raw<DashboardDocument[]>([]);
	let attentionItems = $state.raw<DashboardAttentionItem[]>([]);
	let routesWarmProgress = $state<WarmProgress | null>(null);
	let displayedAttentionItems = $derived([
		...attentionItems,
		...(offlineAttentionItem(routesWarmProgress)
			? [offlineAttentionItem(routesWarmProgress)!]
			: []),
	]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let loadRunId = 0;

	async function loadDashboard() {
		const runId = ++loadRunId;
		isLoading = true;
		try {
			await ensureLocalDbRuntime();
			const [projectRows, transcriptionRows, collationRows, persistence, estimate] =
				await Promise.all([
					listProjects(),
					listTranscriptionSummaries(),
					listCollationsWithProjectNames(),
					checkStoragePersistence(),
					getStorageEstimate(),
				]);
			const recentRows = mergeRecentSummaries(transcriptionRows, collationRows);
			const [documents, warnings] = await Promise.all([
				enrichRecentDocuments(recentRows),
				buildAttentionItems(projectRows, persistence, estimate),
			]);
			if (runId !== loadRunId) return;

			projects = projectRows;
			const targetId = resolveLastOpenedProjectId(readLastOpenedProjectId(), projectRows);
			lastOpenedProject = projectRows.find(project => project.id === targetId) ?? null;
			recentDocuments = documents;
			attentionItems = warnings;
			error = null;
		} catch (cause) {
			if (runId !== loadRunId) return;
			error = cause instanceof Error ? cause.message : 'Failed to load the dashboard.';
			console.error('[dashboard-route] loadDashboard failed', { error });
		} finally {
			if (runId === loadRunId) isLoading = false;
		}
	}

	function mergeRecentSummaries(
		transcriptions: TranscriptionSummary[],
		collations: CollationListItem[]
	): RecentSummary[] {
		return [
			...transcriptions.map(summary => ({
				type: 'Transcription' as const,
				id: summary.id,
				updatedAt: summary.updated_at,
				summary,
			})),
			...collations.map(summary => ({
				type: 'Collation' as const,
				id: summary.id,
				updatedAt: summary.updatedAt,
				summary,
			})),
		]
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
			.slice(0, 5);
	}

	async function enrichRecentDocuments(rows: RecentSummary[]): Promise<DashboardDocument[]> {
		const documents = await Promise.all(
			rows.map(async row => {
				if (row.type === 'Transcription') {
					const status = await getProjectTranscriptionStatusForOwnedTranscription(row.id);
					if (!status) return null;
					return {
						id: row.id,
						type: row.type,
						title: row.summary.title,
						projectName: status.projectName?.trim() || 'Project unavailable',
						updatedAt: row.updatedAt,
						href: `/transcription/${row.id}`,
					} satisfies DashboardDocument;
				}

				return {
					id: row.id,
					type: row.type,
					title: row.summary.title,
					projectName: row.summary.projectName,
					updatedAt: row.updatedAt,
					href: `/collation/${row.id}`,
				} satisfies DashboardDocument;
			})
		);
		return documents.filter((document): document is DashboardDocument => document !== null);
	}

	async function buildAttentionItems(
		projectRows: ProjectOption[],
		persistence: StoragePersistenceReport,
		estimate: StorageEstimateReport
	): Promise<DashboardAttentionItem[]> {
		if (projectRows.length === 0) return [];
		const [overviews, conflictCopies, projectIdsWithContent, placements] = await Promise.all([
			loadProjectBackupOverviews(projectRows.map(project => project.id)),
			listConflictCopies(),
			listProjectIdsWithContent(),
			listProjectPlacements(),
		]);
		const items: DashboardAttentionItem[] = conflictCopies.map(copy => ({
			id: `conflict-copy:${copy.copyId}`,
			title: formatConflictCopyTitle(copy),
			description: 'Two copies changed separately. Choose what to keep.',
			href: `/projects/${copy.projectId}/conflicts/${copy.copyId}`,
			linkLabel: 'Reconcile',
		}));
		for (const project of projectRows) {
			const overview = overviews[project.id];
			if (overview.error) {
				console.warn('[dashboard-route] project backup summary load failed', {
					projectId: project.id,
					error:
						overview.error instanceof Error
							? overview.error.message
							: String(overview.error),
				});
			}
			const problem = summarizeBackupProblem(project, overview);
			if (problem) items.push(problem);
			const placement = placements.find(candidate => candidate.projectId === project.id);
			if (placement?.moved) {
				items.push({
					id: `moved:${project.id}`,
					title: `${project.name} moved`,
					description: `Moved by ${placement.moved.movedBy} on ${new Date(placement.moved.movedAt).toLocaleString()} to ${placement.moved.destinationLabel}. This copy no longer syncs.`,
					href: `/projects/${project.id}/location`,
					linkLabel: `Open location of ${project.name}`,
					dismissLabel: 'Dismiss',
					onDismiss: () => void dismissPlacementNotice(project.id),
				});
				continue;
			}
			if (placement?.deleted) {
				items.push({
					id: `deleted:${project.id}`,
					title: `${project.name} deleted`,
					description: `Deleted by ${placement.deleted.deletedBy} on ${new Date(placement.deleted.deletedAt).toLocaleString()}. This copy no longer syncs.`,
					href: `/projects/${project.id}/location`,
					linkLabel: `Open location of ${project.name}`,
					dismissLabel: 'Dismiss',
					onDismiss: () => void dismissPlacementNotice(project.id),
				});
				continue;
			}
			if (placement?.needsLocationChoice) {
				items.push({
					id: `needs-location-choice:${project.id}`,
					title: 'Choose where this project lives',
					description: `${project.name} used a sync folder before this update. Move it to keep syncing.`,
					href: `/projects/${project.id}/location`,
					linkLabel: `Move ${project.name}`,
					dismissLabel: 'Keep in this browser',
					onDismiss: () => void dismissPlacementNotice(project.id),
				});
				continue;
			}
			const health = deriveProjectBackupHealthState({
				hasContent: projectIdsWithContent.includes(project.id),
				hasLocation: overview.status !== 'local-only',
				localFolderSupported: isLocalFolderProviderSupported(),
			});
			if (health.showBrowserOnlyPrompt) {
				items.push({
					id: `choose-location:${project.id}`,
					title: 'Choose where this project lives',
					description: `${project.name} is stored only in this browser.`,
					href: `/projects/${project.id}/location`,
					linkLabel: `Choose a location for ${project.name}`,
				});
			}
		}

		if (
			projectRows.some(project =>
				isNotBackedUp(placements.find(placement => placement.projectId === project.id))
			) &&
			shouldShowDurabilityWarning({
				hasUserData: true,
				persistenceStatus: persistence.status,
				dismissedMilestone: readDismissedDurabilityMilestone(),
				currentMilestone: `projects:${projectRows.length}`,
			})
		) {
			items.push({
				id: 'storage-durability',
				title: 'Protect local work from browser cleanup',
				description: 'Persistent storage is not granted.',
				href: '/data#advanced',
				linkLabel: 'Review storage durability',
			});
		}

		if (estimate.isNearQuota) {
			items.push({
				id: 'storage-quota',
				title: 'Storage on this device is nearly full',
				description: 'Export a backup before adding large batches of work.',
				href: '/data#advanced',
				linkLabel: 'Review storage usage',
			});
		}

		return items;
	}

	function summarizeBackupProblem(
		project: ProjectOption,
		overview: ProjectBackupOverview
	): DashboardAttentionItem | null {
		if (overview.status === 'unavailable')
			return projectBackupAttention(project, 'Backup status is currently unavailable.');
		return null;
	}

	function projectBackupAttention(
		project: ProjectOption,
		description: string
	): DashboardAttentionItem {
		return {
			id: `project-backup:${project.id}`,
			title: `${project.name} backup needs attention`,
			description,
			href: `/projects/${project.id}/location`,
			linkLabel: 'Open project location',
		};
	}

	function offlineAttentionItem(progress: WarmProgress | null): DashboardAttentionItem | null {
		if (!progress || progress.tier !== 'routes') return null;
		if (progress.state !== 'failed' && progress.reason !== 'quota') return null;
		return {
			id: 'offline-readiness',
			title:
				progress.reason === 'quota'
					? 'Offline preparation needs storage'
					: 'Offline preparation failed',
			description:
				progress.reason === 'quota'
					? 'Not enough storage to cache every page.'
					: 'Some pages may not work offline.',
			href: '/data',
			linkLabel: 'Review offline readiness',
		};
	}

	function readDismissedDurabilityMilestone(): string | null {
		try {
			return localStorage.getItem('apatosaurus:durability-warning-dismissed-milestone');
		} catch {
			return null;
		}
	}

	onMount(() => {
		void loadDashboard();
		const unsubscribeWarmProgress = onCacheWarmProgress(progress => {
			if (progress.tier === 'routes') routesWarmProgress = progress;
		});
		const unsubscribeDb = subscribeLocalDbInvalidations(event => {
			if (
				['projects', 'transcriptions', 'collations', 'sync-targets', 'all'].includes(
					event.domain
				)
			) {
				void loadDashboard();
			}
		});
		return () => {
			unsubscribeWarmProgress();
			unsubscribeDb();
		};
	});
</script>

<WelcomeGate>
	<Dashboard
		{projects}
		{lastOpenedProject}
		{recentDocuments}
		attentionItems={displayedAttentionItems}
		{isLoading}
		{error}
		appVersion={version}
	/>
</WelcomeGate>
